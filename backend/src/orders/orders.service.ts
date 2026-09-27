import { Inject, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { ApiException } from '../common/filters/api.exception';
import { ERROR_CODE } from '../common/contracts/api-error';
import { MENU_READER, MenuReader, MenuSnapshot } from '../common/contracts/menu-reader';
import {
  ORDER_EVENT_PUBLISHER,
  OrderEventPublisher,
} from '../common/events/order-event.publisher';
import { AdminOrderListView, AdminOrderView, OrderView } from '../common/contracts/order-view';
import { OrderHistoryView } from '../common/contracts/order-history-view';
import { AuthenticatedAdmin } from '../common/contracts/admin-principal';
import { OrderStatus } from '../common/contracts/order-status';
import { OrdersRepository, OrderRow } from './orders.repository';
import { OrderItemsRepository, OrderItemRow } from './order-items.repository';
import { OrderHistoryRepository } from './order-history.repository';
import { OrderRefundsRepository, OrderRefundRow } from './order-refunds.repository';
import { OrderNumberService } from './order-number.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListAdminOrdersQueryDto } from './dto/list-admin-orders-query.dto';
import { PatchableOrderStatus } from './dto/update-order-status.dto';
import { CreateRefundDto } from './dto/create-refund.dto';
import { toAdminOrderView, toOrderView } from './order-view.mapper';
import { toOrderHistoryView } from './order-history.mapper';
import { computeRequestFingerprint } from './order-fingerprint.util';
import { mergeOrderItems, OrderItemInput } from './merge-order-items.util';
import {
  decodeAdminOrderCursor,
  encodeAdminOrderCursor,
} from './admin-order-cursor.util';
import { ORDER_HISTORY_ACTION } from './constants/order-history-action.constants';

const PG_UNIQUE_VIOLATION = '23505';
const DEFAULT_ADMIN_ORDERS_LIMIT = 20;

/** §24: 입금 확인된 주문(상태 무관)만 환불 가능. */
const REFUNDABLE_STATUSES: readonly OrderStatus[] = [
  'ACCEPTED',
  'COOKING',
  'READY',
  'COMPLETED',
];

/**
 * §18: PATCH /admin/orders/:orderId/status가 허용하는 전이만 여기 있다.
 * 입금 확인(PAYMENT_PENDING → ACCEPTED)은 별도 API(payment-confirmation)
 * 전용이라 이 맵에 없다 — 일반 status PATCH로 ACCEPTED를 만들 수 없다.
 */
const STATUS_TRANSITIONS: Partial<
  Record<OrderStatus, Partial<Record<PatchableOrderStatus, (typeof ORDER_HISTORY_ACTION)[keyof typeof ORDER_HISTORY_ACTION]>>>
> = {
  ACCEPTED: { COOKING: ORDER_HISTORY_ACTION.COOKING_STARTED },
  COOKING: { READY: ORDER_HISTORY_ACTION.READY },
  READY: { COMPLETED: ORDER_HISTORY_ACTION.COMPLETED },
};

function isUniqueViolationOn(error: unknown, constraint: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === PG_UNIQUE_VIOLATION &&
    (error as { constraint?: string }).constraint === constraint
  );
}

function isOrderRequestIdConflict(error: unknown): boolean {
  return isUniqueViolationOn(error, 'orders_order_request_id_key');
}

/**
 * order_refunds에는 UNIQUE가 2개다 — order_id(주문당 1건)와
 * refund_request_id(테이블 전역 멱등키). 어느 쪽이 위반됐는지에 따라
 * "같은 주문에 경합"과 "다른 주문에 키 재사용"을 구분해서 처리해야 하므로
 * 하나의 boolean이 아니라 둘 다 검사한다(orders.service.ts#refund 참고).
 */
function isOrderRefundOrderIdConflict(error: unknown): boolean {
  return isUniqueViolationOn(error, 'order_refunds_order_id_key');
}

function isOrderRefundRequestIdConflict(error: unknown): boolean {
  return isUniqueViolationOn(error, 'order_refunds_refund_request_id_key');
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly ordersRepository: OrdersRepository,
    private readonly orderItemsRepository: OrderItemsRepository,
    private readonly orderHistoryRepository: OrderHistoryRepository,
    private readonly orderRefundsRepository: OrderRefundsRepository,
    private readonly orderNumberService: OrderNumberService,
    @Inject(MENU_READER) private readonly menuReader: MenuReader,
    @Inject(ORDER_EVENT_PUBLISHER)
    private readonly events: OrderEventPublisher,
  ) {}

  async create(dto: CreateOrderDto): Promise<OrderView> {
    const mergedItems = mergeOrderItems(dto.items);
    const fingerprint = computeRequestFingerprint({
      customerName: dto.customerName,
      customerPhone: dto.customerPhone,
      items: mergedItems,
    });

    const existing = await this.ordersRepository.findByOrderRequestId(
      this.database,
      dto.orderRequestId,
    );

    if (existing) {
      return this.resolveExistingOrder(existing, fingerprint);
    }

    try {
      const view = await this.database.withTransaction((client) =>
        this.insertOrder(client, dto, mergedItems, fingerprint),
      );

      this.events.publish('order.created', { orderId: view.id });

      return view;
    } catch (error) {
      if (!isOrderRequestIdConflict(error)) {
        throw error;
      }

      // 동시에 같은 orderRequestId로 들어온 다른 요청이 먼저 커밋한 경우.
      const raceExisting = await this.ordersRepository.findByOrderRequestId(
        this.database,
        dto.orderRequestId,
      );

      if (!raceExisting) {
        throw error;
      }

      return this.resolveExistingOrder(raceExisting, fingerprint);
    }
  }

  async listForAdmin(query: ListAdminOrdersQueryDto): Promise<AdminOrderListView> {
    const limit = query.limit ?? DEFAULT_ADMIN_ORDERS_LIMIT;
    const before = query.cursor ? decodeAdminOrderCursor(query.cursor) : undefined;

    const rows = await this.ordersRepository.findPage(this.database, limit + 1, before);
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const itemsByOrderId = await this.groupItemsByOrderId(pageRows.map((row) => row.id));

    const items = pageRows.map((row) =>
      toAdminOrderView(row, itemsByOrderId.get(row.id) ?? []),
    );

    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last ? encodeAdminOrderCursor({ id: last.id }) : null;

    return { items, nextCursor };
  }

  async confirmPayment(
    orderId: string,
    admin: AuthenticatedAdmin,
  ): Promise<AdminOrderView> {
    const view = await this.database.withTransaction(async (client) => {
      const order = await this.ordersRepository.findByIdForUpdate(client, orderId);

      if (!order) {
        throw new ApiException(ERROR_CODE.ORDER_NOT_FOUND, '주문을 찾을 수 없습니다.');
      }

      if (order.status !== 'PAYMENT_PENDING') {
        throw new ApiException(
          ERROR_CODE.ORDER_STATE_CONFLICT,
          '입금 확인할 수 없는 주문 상태입니다.',
        );
      }

      const updated = await this.ordersRepository.updateStatus(client, orderId, 'ACCEPTED');

      await this.orderHistoryRepository.create(client, {
        orderId,
        action: ORDER_HISTORY_ACTION.PAYMENT_CONFIRMED,
        fromStatus: order.status,
        toStatus: updated.status,
        actorType: 'ADMIN',
        actorId: admin.adminId,
      });

      const items = await this.orderItemsRepository.findByOrderId(client, orderId);

      return toAdminOrderView(updated, items);
    });

    this.events.publish('order.updated', { orderId, status: view.status });

    return view;
  }

  async changeStatus(
    orderId: string,
    targetStatus: PatchableOrderStatus,
    admin: AuthenticatedAdmin,
  ): Promise<AdminOrderView> {
    const view = await this.database.withTransaction(async (client) => {
      const order = await this.ordersRepository.findByIdForUpdate(client, orderId);

      if (!order) {
        throw new ApiException(ERROR_CODE.ORDER_NOT_FOUND, '주문을 찾을 수 없습니다.');
      }

      const action = STATUS_TRANSITIONS[order.status]?.[targetStatus];

      if (!action) {
        throw new ApiException(
          ERROR_CODE.ORDER_STATE_CONFLICT,
          '현재 주문 상태에서 허용되지 않는 상태 변경입니다.',
        );
      }

      const updated = await this.ordersRepository.updateStatus(
        client,
        orderId,
        targetStatus,
      );

      await this.orderHistoryRepository.create(client, {
        orderId,
        action,
        fromStatus: order.status,
        toStatus: updated.status,
        actorType: 'ADMIN',
        actorId: admin.adminId,
      });

      const items = await this.orderItemsRepository.findByOrderId(client, orderId);

      return toAdminOrderView(updated, items);
    });

    this.events.publish('order.updated', { orderId, status: view.status });

    return view;
  }

  async cancel(orderId: string, admin: AuthenticatedAdmin): Promise<AdminOrderView> {
    const view = await this.database.withTransaction(async (client) => {
      const order = await this.ordersRepository.findByIdForUpdate(client, orderId);

      if (!order) {
        throw new ApiException(ERROR_CODE.ORDER_NOT_FOUND, '주문을 찾을 수 없습니다.');
      }

      if (order.status !== 'PAYMENT_PENDING') {
        throw new ApiException(
          ERROR_CODE.ORDER_STATE_CONFLICT,
          '취소할 수 없는 주문 상태입니다.',
        );
      }

      const updated = await this.ordersRepository.updateStatus(client, orderId, 'CANCELLED');

      await this.orderHistoryRepository.create(client, {
        orderId,
        action: ORDER_HISTORY_ACTION.CANCELLED,
        fromStatus: order.status,
        toStatus: updated.status,
        actorType: 'ADMIN',
        actorId: admin.adminId,
      });

      const items = await this.orderItemsRepository.findByOrderId(client, orderId);

      return toAdminOrderView(updated, items);
    });

    this.events.publish('order.updated', { orderId, status: view.status });

    return view;
  }

  async refund(
    orderId: string,
    dto: CreateRefundDto,
    admin: AuthenticatedAdmin,
  ): Promise<AdminOrderView> {
    const existingRefund = await this.orderRefundsRepository.findByOrderId(
      this.database,
      orderId,
    );

    if (existingRefund) {
      return this.resolveExistingRefund(orderId, existingRefund, dto.refundRequestId);
    }

    try {
      const view = await this.database.withTransaction(async (client) => {
        // 잠근 뒤 다시 확인한다 — 환불 가능 상태 집합(REFUNDABLE_STATUSES)은
        // STATUS_TRANSITIONS/cancel/confirmPayment가 만드는 모든 전이에 대해
        // 닫혀 있어(§24 상태들 사이에서만 움직이고 되돌아가지 않음) 원칙적으로
        // 락 없는 검증도 안전하지만, 응답/이벤트가 이 트랜잭션과 다른 시점의
        // 스냅샷을 섞지 않도록(예: 환불 처리 중 다른 관리자가 상태를 바꾼 경우)
        // amount·status 조회 자체를 이 트랜잭션 안에서 한다.
        const order = await this.ordersRepository.findByIdForUpdate(client, orderId);

        if (!order) {
          throw new ApiException(ERROR_CODE.ORDER_NOT_FOUND, '주문을 찾을 수 없습니다.');
        }

        if (!REFUNDABLE_STATUSES.includes(order.status)) {
          throw new ApiException(
            ERROR_CODE.ORDER_STATE_CONFLICT,
            '환불할 수 없는 주문 상태입니다.',
          );
        }

        await this.orderRefundsRepository.create(client, {
          orderId,
          refundRequestId: dto.refundRequestId,
          amount: order.total_price,
          processedBy: admin.adminId,
          reason: dto.reason ?? null,
        });

        // §24: 환불은 OrderStatus를 바꾸지 않는다 — from/to 둘 다 상태 전이가
        // 아니므로 null이다(§4 order_history "상태 변경 이력일 때만 값 존재").
        await this.orderHistoryRepository.create(client, {
          orderId,
          action: ORDER_HISTORY_ACTION.REFUNDED,
          fromStatus: null,
          toStatus: null,
          actorType: 'ADMIN',
          actorId: admin.adminId,
          reason: dto.reason ?? null,
          // §2-2: "환불 금액은 GET .../history로 확인한다" — order_refunds를
          // 조회하는 별도 API가 없으므로 history metadata에 함께 남긴다.
          metadata: { amount: order.total_price },
        });

        const items = await this.orderItemsRepository.findByOrderId(client, orderId);

        return toAdminOrderView(order, items);
      });

      this.events.publish('order.updated', { orderId, status: view.status });

      return view;
    } catch (error) {
      // 동시에 같은 주문에 다른 환불 요청이 먼저 커밋한 경우.
      if (isOrderRefundOrderIdConflict(error)) {
        const raceExisting = await this.orderRefundsRepository.findByOrderId(
          this.database,
          orderId,
        );

        if (!raceExisting) {
          throw error;
        }

        return this.resolveExistingRefund(orderId, raceExisting, dto.refundRequestId);
      }

      // refundRequestId가 이미 쓰인 경우 — 같은 주문에 동시 재시도였다면
      // 위 order_id 분기와 동일하게 기존 결과를 반환하고, 다른 주문에 키가
      // 재사용된 것이라면 그 사실을 명확히 알린다(500으로 새지 않도록).
      if (isOrderRefundRequestIdConflict(error)) {
        const existingByRequestId = await this.orderRefundsRepository.findByRefundRequestId(
          this.database,
          dto.refundRequestId,
        );

        if (!existingByRequestId) {
          throw error;
        }

        if (existingByRequestId.order_id !== orderId) {
          throw new ApiException(
            ERROR_CODE.IDEMPOTENCY_CONFLICT,
            '이미 다른 주문에 사용된 refundRequestId입니다.',
          );
        }

        return this.resolveExistingRefund(orderId, existingByRequestId, dto.refundRequestId);
      }

      throw error;
    }
  }

  private async resolveExistingRefund(
    orderId: string,
    existing: OrderRefundRow,
    refundRequestId: string,
  ): Promise<AdminOrderView> {
    if (existing.refund_request_id !== refundRequestId) {
      throw new ApiException(ERROR_CODE.ORDER_STATE_CONFLICT, '이미 환불된 주문입니다.');
    }

    const order = await this.ordersRepository.findById(this.database, orderId);

    if (!order) {
      throw new ApiException(ERROR_CODE.ORDER_NOT_FOUND, '주문을 찾을 수 없습니다.');
    }

    const items = await this.orderItemsRepository.findByOrderId(this.database, orderId);

    return toAdminOrderView(order, items);
  }

  async getHistory(orderId: string): Promise<OrderHistoryView[]> {
    const order = await this.ordersRepository.findById(this.database, orderId);

    if (!order) {
      throw new ApiException(ERROR_CODE.ORDER_NOT_FOUND, '주문을 찾을 수 없습니다.');
    }

    const rows = await this.orderHistoryRepository.findByOrderId(this.database, orderId);

    return rows.map(toOrderHistoryView);
  }

  private async groupItemsByOrderId(
    orderIds: readonly string[],
  ): Promise<Map<string, OrderItemRow[]>> {
    const items = await this.orderItemsRepository.findByOrderIds(this.database, orderIds);
    const itemsByOrderId = new Map<string, OrderItemRow[]>();

    for (const item of items) {
      const bucket = itemsByOrderId.get(item.order_id);

      if (bucket) {
        bucket.push(item);
      } else {
        itemsByOrderId.set(item.order_id, [item]);
      }
    }

    return itemsByOrderId;
  }

  private async resolveExistingOrder(
    order: OrderRow,
    fingerprint: string,
  ): Promise<OrderView> {
    if (order.request_fingerprint !== fingerprint) {
      throw new ApiException(
        ERROR_CODE.IDEMPOTENCY_CONFLICT,
        '이미 다른 내용의 주문 요청이 처리되었습니다.',
      );
    }

    const items = await this.orderItemsRepository.findByOrderId(this.database, order.id);

    return toOrderView(order, items);
  }

  private async insertOrder(
    client: PoolClient,
    dto: CreateOrderDto,
    mergedItems: readonly OrderItemInput[],
    fingerprint: string,
  ): Promise<OrderView> {
    const menuIds = mergedItems.map((item) => item.menuId);
    const menus = await this.menuReader.getSnapshotsForOrder(client, menuIds);
    const menuById = new Map(menus.map((menu) => [menu.id, menu]));

    if (menuById.size !== menuIds.length) {
      throw new ApiException(
        ERROR_CODE.MENU_UNAVAILABLE,
        '존재하지 않는 메뉴가 포함되어 있습니다.',
      );
    }

    for (const item of mergedItems) {
      const menu = this.getMenuOrThrow(menuById, item.menuId);

      if (!menu.isAvailable) {
        throw new ApiException(
          ERROR_CODE.MENU_UNAVAILABLE,
          '품절된 메뉴가 포함되어 있습니다.',
        );
      }
    }

    const totalPrice = mergedItems.reduce((sum, item) => {
      const menu = this.getMenuOrThrow(menuById, item.menuId);
      return sum + menu.price * item.quantity;
    }, 0);

    const orderNumber = await this.orderNumberService.issue(client);

    const order = await this.ordersRepository.create(client, {
      orderNumber,
      orderRequestId: dto.orderRequestId,
      requestFingerprint: fingerprint,
      customerName: dto.customerName,
      customerPhone: dto.customerPhone,
      totalPrice,
    });

    const items = await this.orderItemsRepository.createMany(
      client,
      order.id,
      mergedItems.map((item) => {
        const menu = this.getMenuOrThrow(menuById, item.menuId);
        return {
          menuId: menu.id,
          menuName: menu.name,
          unitPrice: menu.price,
          quantity: item.quantity,
        };
      }),
    );

    await this.orderHistoryRepository.create(client, {
      orderId: order.id,
      action: ORDER_HISTORY_ACTION.ORDER_CREATED,
      fromStatus: null,
      toStatus: order.status,
      actorType: 'CUSTOMER',
      actorId: null,
    });

    return toOrderView(order, items);
  }

  private getMenuOrThrow(
    menuById: Map<string, MenuSnapshot>,
    menuId: string,
  ): MenuSnapshot {
    const menu = menuById.get(menuId);

    if (!menu) {
      throw new ApiException(
        ERROR_CODE.MENU_UNAVAILABLE,
        '존재하지 않는 메뉴가 포함되어 있습니다.',
      );
    }

    return menu;
  }
}

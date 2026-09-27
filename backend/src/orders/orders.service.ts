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
import { OrderNumberService } from './order-number.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListAdminOrdersQueryDto } from './dto/list-admin-orders-query.dto';
import { PatchableOrderStatus } from './dto/update-order-status.dto';
import { toAdminOrderView, toOrderView } from './order-view.mapper';
import { toOrderHistoryView } from './order-history.mapper';
import { computeRequestFingerprint } from './order-fingerprint.util';
import { mergeOrderItems, OrderItemInput } from './merge-order-items.util';
import {
  decodeAdminOrderCursor,
  encodeAdminOrderCursor,
} from './admin-order-cursor.util';
import { ORDER_HISTORY_ACTION } from './constants/order-history-action.constants';

const ORDER_REQUEST_ID_UNIQUE_VIOLATION = '23505';
const DEFAULT_ADMIN_ORDERS_LIMIT = 20;

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

function isOrderRequestIdConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === ORDER_REQUEST_ID_UNIQUE_VIOLATION &&
    (error as { constraint?: string }).constraint === 'orders_order_request_id_key'
  );
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly ordersRepository: OrdersRepository,
    private readonly orderItemsRepository: OrderItemsRepository,
    private readonly orderHistoryRepository: OrderHistoryRepository,
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

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
import { OrderView } from '../common/contracts/order-view';
import { OrdersRepository, OrderRow } from './orders.repository';
import { OrderItemsRepository } from './order-items.repository';
import { OrderNumberService } from './order-number.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { toOrderView } from './order-view.mapper';
import { computeRequestFingerprint } from './order-fingerprint.util';
import { mergeOrderItems, OrderItemInput } from './merge-order-items.util';

const ORDER_REQUEST_ID_UNIQUE_VIOLATION = '23505';

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

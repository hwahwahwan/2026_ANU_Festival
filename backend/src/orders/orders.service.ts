import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ApiException } from '../common/filters/api.exception';
import { ERROR_CODE } from '../common/contracts/api-error';
import { MENU_READER, MenuReader, MenuSnapshot } from '../common/contracts/menu-reader';
import {
  ORDER_EVENT_PUBLISHER,
  OrderEventPublisher,
} from '../common/events/order-event.publisher';
import { OrderView } from '../common/contracts/order-view';
import { OrdersRepository } from './orders.repository';
import { OrderItemsRepository } from './order-items.repository';
import { OrderNumberService } from './order-number.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { toOrderView } from './order-view.mapper';

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
    const view = await this.database.withTransaction(async (client) => {
      const menuIds = dto.items.map((item) => item.menuId);
      const menus = await this.menuReader.getSnapshotsForOrder(client, menuIds);
      const menuById = new Map(menus.map((menu) => [menu.id, menu]));

      if (menuById.size !== new Set(menuIds).size) {
        throw new ApiException(
          ERROR_CODE.MENU_UNAVAILABLE,
          '존재하지 않는 메뉴가 포함되어 있습니다.',
        );
      }

      for (const item of dto.items) {
        const menu = menuById.get(item.menuId) as MenuSnapshot;

        if (!menu.isAvailable) {
          throw new ApiException(
            ERROR_CODE.MENU_UNAVAILABLE,
            '품절된 메뉴가 포함되어 있습니다.',
          );
        }
      }

      const totalPrice = dto.items.reduce((sum, item) => {
        const menu = menuById.get(item.menuId) as MenuSnapshot;
        return sum + menu.price * item.quantity;
      }, 0);

      const orderNumber = await this.orderNumberService.issue(client);

      const order = await this.ordersRepository.create(client, {
        orderNumber,
        orderRequestId: dto.orderRequestId,
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        totalPrice,
      });

      const items = await this.orderItemsRepository.createMany(
        client,
        order.id,
        dto.items.map((item) => {
          const menu = menuById.get(item.menuId) as MenuSnapshot;
          return {
            menuId: menu.id,
            menuName: menu.name,
            unitPrice: menu.price,
            quantity: item.quantity,
          };
        }),
      );

      return toOrderView(order, items);
    });

    this.events.publish('order.created', { orderId: view.id });

    return view;
  }
}

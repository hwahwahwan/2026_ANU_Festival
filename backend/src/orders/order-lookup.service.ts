import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ApiException } from '../common/filters/api.exception';
import { ERROR_CODE } from '../common/contracts/api-error';
import { OrderView } from '../common/contracts/order-view';
import { OrdersRepository } from './orders.repository';
import { OrderItemsRepository } from './order-items.repository';
import { LookupOrderDto } from './dto/lookup-order.dto';
import { toOrderView } from './order-view.mapper';

@Injectable()
export class OrderLookupService {
  constructor(
    private readonly database: DatabaseService,
    private readonly ordersRepository: OrdersRepository,
    private readonly orderItemsRepository: OrderItemsRepository,
  ) {}

  async lookup(dto: LookupOrderDto): Promise<OrderView> {
    const order = await this.ordersRepository.findByCustomerNameAndOrderNumber(
      this.database,
      dto.customerName,
      dto.orderNumber,
    );

    if (!order) {
      throw new ApiException(
        ERROR_CODE.ORDER_NOT_FOUND,
        '입력하신 정보와 일치하는 주문이 없습니다.',
      );
    }

    const items = await this.orderItemsRepository.findByOrderId(this.database, order.id);

    return toOrderView(order, items);
  }
}

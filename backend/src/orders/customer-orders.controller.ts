import { Body, Controller, Post } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderView } from '../common/contracts/order-view';

@Controller('orders')
export class CustomerOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  async create(@Body() dto: CreateOrderDto): Promise<OrderView> {
    return this.ordersService.create(dto);
  }
}

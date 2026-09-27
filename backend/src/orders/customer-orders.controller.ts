import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { OrdersService } from './orders.service';
import { OrderLookupService } from './order-lookup.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { LookupOrderDto } from './dto/lookup-order.dto';
import { OrderView } from '../common/contracts/order-view';

@Controller('orders')
export class CustomerOrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderLookupService: OrderLookupService,
  ) {}

  @Post()
  async create(@Body() dto: CreateOrderDto): Promise<OrderView> {
    return this.ordersService.create(dto);
  }

  @Post('lookup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async lookup(@Body() dto: LookupOrderDto): Promise<OrderView> {
    return this.orderLookupService.lookup(dto);
  }
}

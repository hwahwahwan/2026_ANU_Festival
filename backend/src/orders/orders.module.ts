import { Module } from '@nestjs/common';
import { CustomerOrdersController } from './customer-orders.controller';
import { OrdersService } from './orders.service';
import { OrdersRepository } from './orders.repository';
import { OrderItemsRepository } from './order-items.repository';
import { OrderNumberService } from './order-number.service';
import { MenusModule } from '../menus/menus.module';

@Module({
  imports: [MenusModule],
  controllers: [CustomerOrdersController],
  providers: [
    OrdersService,
    OrdersRepository,
    OrderItemsRepository,
    OrderNumberService,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}

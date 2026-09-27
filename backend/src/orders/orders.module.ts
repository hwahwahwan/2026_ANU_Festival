import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { CustomerOrdersController } from './customer-orders.controller';
import { OrdersService } from './orders.service';
import { OrderLookupService } from './order-lookup.service';
import { OrdersRepository } from './orders.repository';
import { OrderItemsRepository } from './order-items.repository';
import { OrderNumberService } from './order-number.service';
import { MenusModule } from '../menus/menus.module';

@Module({
  imports: [MenusModule, ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }])],
  controllers: [CustomerOrdersController],
  providers: [
    OrdersService,
    OrderLookupService,
    OrdersRepository,
    OrderItemsRepository,
    OrderNumberService,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}

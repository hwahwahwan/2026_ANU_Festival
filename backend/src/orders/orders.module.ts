import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { CustomerOrdersController } from './customer-orders.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { OrdersService } from './orders.service';
import { OrderLookupService } from './order-lookup.service';
import { OrdersRepository } from './orders.repository';
import { OrderItemsRepository } from './order-items.repository';
import { OrderHistoryRepository } from './order-history.repository';
import { OrderNumberService } from './order-number.service';
import { MenusModule } from '../menus/menus.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';

@Module({
  imports: [
    MenusModule,
    AdminAuthModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
  ],
  controllers: [CustomerOrdersController, AdminOrdersController],
  providers: [
    OrdersService,
    OrderLookupService,
    OrdersRepository,
    OrderItemsRepository,
    OrderHistoryRepository,
    OrderNumberService,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}

import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminSalesController } from './admin-sales.controller';
import { SalesService } from './sales.service';
import { SalesRepository } from './sales.repository';
import { RefundAggregationService } from './refund-aggregation.service';
import { SalesThrottlerGuard } from './sales-throttler.guard';

@Module({
  imports: [AdminAuthModule],
  controllers: [AdminSalesController],
  providers: [SalesService, SalesRepository, RefundAggregationService, SalesThrottlerGuard],
})
export class SalesModule {}

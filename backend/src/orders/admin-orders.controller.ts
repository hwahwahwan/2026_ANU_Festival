import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../admin-auth/admin.guard';
import { OrdersService } from './orders.service';
import { ListAdminOrdersQueryDto } from './dto/list-admin-orders-query.dto';
import { AdminOrderListView } from '../common/contracts/order-view';

@Controller('admin/orders')
@UseGuards(AdminGuard)
export class AdminOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  list(@Query() query: ListAdminOrdersQueryDto): Promise<AdminOrderListView> {
    return this.ordersService.listForAdmin(query);
  }
}

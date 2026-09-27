import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../admin-auth/admin.guard';
import { CurrentAdmin } from '../common/decorators/current-admin.decorator';
import { AuthenticatedAdmin } from '../common/contracts/admin-principal';
import { OrdersService } from './orders.service';
import { ListAdminOrdersQueryDto } from './dto/list-admin-orders-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { CreateRefundDto } from './dto/create-refund.dto';
import { AdminOrderListView, AdminOrderView } from '../common/contracts/order-view';
import { OrderHistoryView } from '../common/contracts/order-history-view';

@Controller('admin/orders')
@UseGuards(AdminGuard)
export class AdminOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  list(@Query() query: ListAdminOrdersQueryDto): Promise<AdminOrderListView> {
    return this.ordersService.listForAdmin(query);
  }

  @Post(':orderId/payment-confirmation')
  @HttpCode(HttpStatus.OK)
  confirmPayment(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<AdminOrderView> {
    return this.ordersService.confirmPayment(orderId, admin);
  }

  @Patch(':orderId/status')
  changeStatus(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: UpdateOrderStatusDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<AdminOrderView> {
    return this.ordersService.changeStatus(orderId, dto.status, admin);
  }

  @Post(':orderId/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<AdminOrderView> {
    return this.ordersService.cancel(orderId, admin);
  }

  @Post(':orderId/refunds')
  refund(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CreateRefundDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<AdminOrderView> {
    return this.ordersService.refund(orderId, dto, admin);
  }

  @Get(':orderId/history')
  getHistory(
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<OrderHistoryView[]> {
    return this.ordersService.getHistory(orderId);
  }
}

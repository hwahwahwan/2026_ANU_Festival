import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../admin-auth/admin.guard';
import { CurrentAdmin } from '../common/decorators/current-admin.decorator';
import { AuthenticatedAdmin } from '../common/contracts/admin-principal';
import { PaymentSettingsView } from '../common/contracts/payment-settings-view';
import { PaymentSettingsService } from './payment-settings.service';
import { UpdatePaymentSettingsDto } from './dto/update-payment-settings.dto';

/**
 * AdminGuard를 개별 메서드가 아니라 클래스 전체에 건다(admin-menus.controller.ts와
 * 동일한 이유 — 이 컨트롤러의 모든 라우트는 관리자 전용이다).
 */
@Controller('admin/settings/payment')
@UseGuards(AdminGuard)
export class AdminPaymentSettingsController {
  constructor(private readonly paymentSettingsService: PaymentSettingsService) {}

  @Get()
  getCurrent(): Promise<PaymentSettingsView> {
    return this.paymentSettingsService.getCurrent();
  }

  @Patch()
  update(
    @Body() dto: UpdatePaymentSettingsDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<PaymentSettingsView> {
    return this.paymentSettingsService.update(dto, admin.adminId);
  }
}

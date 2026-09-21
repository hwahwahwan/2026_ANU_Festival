import { Controller, Get } from '@nestjs/common';
import { PaymentSettingsView } from '../common/contracts/payment-settings-view';
import { PaymentSettingsService } from './payment-settings.service';

@Controller('settings/payment')
export class PaymentSettingsController {
  constructor(private readonly paymentSettingsService: PaymentSettingsService) {}

  @Get()
  getCurrent(): Promise<PaymentSettingsView> {
    return this.paymentSettingsService.getCurrent();
  }
}

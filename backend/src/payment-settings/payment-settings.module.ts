import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { PaymentSettingsController } from './payment-settings.controller';
import { AdminPaymentSettingsController } from './admin-payment-settings.controller';
import { PaymentSettingsService } from './payment-settings.service';
import { PaymentSettingsRepository } from './payment-settings.repository';
import { PaymentSettingsHistoryRepository } from './payment-settings-history.repository';

@Module({
  imports: [AdminAuthModule],
  controllers: [PaymentSettingsController, AdminPaymentSettingsController],
  providers: [
    PaymentSettingsService,
    PaymentSettingsRepository,
    PaymentSettingsHistoryRepository,
  ],
})
export class PaymentSettingsModule {}

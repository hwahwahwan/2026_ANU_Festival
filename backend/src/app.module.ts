import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { DomainEventsModule } from './common/events/domain-events.module';
import { AdminAuthModule } from './admin-auth/admin-auth.module';
import {
  ADMIN_LOGIN_RATE_LIMIT_MAX,
  ADMIN_LOGIN_RATE_LIMIT_MESSAGE,
  ADMIN_LOGIN_RATE_LIMIT_TTL_MS,
} from './admin-auth/admin-auth-rate-limit';
import { OrdersModule } from './orders/orders.module';
import { MenusModule } from './menus/menus.module';
import { PaymentSettingsModule } from './payment-settings/payment-settings.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    DomainEventsModule,
    // ThrottlerModule은 @nestjs/throttler 특성상 @Global()이므로 앱 전체에서
    // 한 번만 forRoot()로 등록한다 (admin-auth-rate-limit.ts 참고).
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: ADMIN_LOGIN_RATE_LIMIT_TTL_MS,
          limit: ADMIN_LOGIN_RATE_LIMIT_MAX,
        },
      ],
      errorMessage: ADMIN_LOGIN_RATE_LIMIT_MESSAGE,
    }),
    AdminAuthModule,
    MenusModule,
    PaymentSettingsModule,
    OrdersModule,
    RealtimeModule,
  ],
})
export class AppModule {}

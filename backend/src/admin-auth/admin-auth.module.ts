import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminsRepository } from './admins.repository';
import { AdminGuard } from './admin.guard';
import { ADMIN_JWT_EXPIRES_IN_SECONDS } from './admin-cookie';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('ADMIN_JWT_SECRET'),
        signOptions: { expiresIn: ADMIN_JWT_EXPIRES_IN_SECONDS },
      }),
    }),
    // ThrottlerModule은 app.module.ts에서 전역으로 한 번만 등록한다
    // (admin-auth-rate-limit.ts 참고). AdminAuthController가
    // @UseGuards(ThrottlerGuard)를 쓰므로 여기서 다시 import할 필요는 없다
    // — ThrottlerModule이 @Global()이라 exports가 앱 전체에 이미 제공된다.
  ],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminsRepository, AdminGuard],
  exports: [AdminGuard, AdminAuthService, JwtModule],
})
export class AdminAuthModule {}

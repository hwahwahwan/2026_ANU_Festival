import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AdminAuthService } from './admin-auth.service';
import { LoginAdminDto } from './dto/login-admin.dto';
import {
  ADMIN_COOKIE_NAME,
  ADMIN_JWT_EXPIRES_IN_SECONDS,
  buildAdminCookieOptions,
} from './admin-cookie';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly adminAuthService: AdminAuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('login')
  @UseGuards(ThrottlerGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async login(
    @Body() dto: LoginAdminDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = await this.adminAuthService.login(dto.username, dto.password);

    res.cookie(ADMIN_COOKIE_NAME, token, {
      ...buildAdminCookieOptions(this.configService),
      maxAge: ADMIN_JWT_EXPIRES_IN_SECONDS * 1000,
    });
  }

  /**
   * JWT 존재/유효성과 무관하게 항상 Cookie를 지우고 204를 반환한다(멱등적 로그아웃).
   * AdminGuard를 걸지 않는 이유: 만료되었거나 변조된 토큰을 가진 브라우저도
   * 로그아웃 시도에서 401을 받지 않고 정상적으로 쿠키를 정리할 수 있어야 한다.
   * Cookie가 유효한 세션이면 현재 브라우저의 관리자 Socket도 함께 종료한다
   * (003_백엔드2_운영실시간.md §10).
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): void {
    this.adminAuthService.notifyLogout(req.cookies?.[ADMIN_COOKIE_NAME]);

    res.clearCookie(
      ADMIN_COOKIE_NAME,
      buildAdminCookieOptions(this.configService),
    );
  }
}

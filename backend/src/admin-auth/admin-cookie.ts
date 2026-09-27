import { ConfigService } from '@nestjs/config';
import { CookieOptions } from 'express';

export const ADMIN_COOKIE_NAME = 'admin_access_token';

/**
 * 관리자 JWT 유효기간(확정, 2026-09-20): 12시간. 축제 운영 중 관리자가 기기를
 * 하루 종일 켜둔 채 사용하는 실제 운영 방식에 맞춘 값이며, Refresh Token은
 * 도입하지 않는다(001_백엔드_공통.md §41, §46). 환경변수로 임의 변경하지
 * 않고 서비스 계약으로 고정한다 — REST(로그인 Cookie maxAge/JWT 서명)와
 * Socket(admin-socket-auth.ts가 재사용하는 verifyAdminJwt의 exp) 모두
 * 이 값 하나로부터 파생된다.
 */
export const ADMIN_JWT_EXPIRES_IN_SECONDS = 12 * 60 * 60;

export function buildAdminCookieOptions(
  configService: ConfigService,
): CookieOptions {
  const domain = configService.get<string>('COOKIE_DOMAIN');

  return {
    httpOnly: true,
    secure: configService.get<string>('COOKIE_SECURE') === 'true',
    sameSite: configService.get<string>(
      'COOKIE_SAME_SITE',
    ) as CookieOptions['sameSite'],
    domain: domain || undefined,
    path: '/',
  };
}

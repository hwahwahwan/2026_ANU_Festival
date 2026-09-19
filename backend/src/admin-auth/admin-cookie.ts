import { ConfigService } from '@nestjs/config';
import { CookieOptions } from 'express';

export const ADMIN_COOKIE_NAME = 'admin_access_token';

export const ADMIN_JWT_EXPIRES_IN_SECONDS = 30 * 60;

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

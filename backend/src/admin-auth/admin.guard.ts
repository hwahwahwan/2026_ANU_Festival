import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ERROR_CODE } from '../common/contracts/api-error';
import { ApiException } from '../common/filters/api.exception';
import { ADMIN_COOKIE_NAME } from './admin-cookie';
import { verifyAdminJwt } from './verify-admin-jwt';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = request.cookies?.[ADMIN_COOKIE_NAME];

    try {
      request.admin = verifyAdminJwt(this.jwtService, token);
    } catch {
      throw new ApiException(
        ERROR_CODE.ADMIN_UNAUTHORIZED,
        '로그인이 필요합니다.',
      );
    }

    return true;
  }
}

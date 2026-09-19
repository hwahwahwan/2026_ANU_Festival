import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ERROR_CODE } from '../common/contracts/api-error';
import { ApiException } from '../common/filters/api.exception';
import {
  AdminJwtPayload,
  AuthenticatedAdmin,
} from '../common/contracts/admin-principal';
import { ADMIN_COOKIE_NAME } from './admin-cookie';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = request.cookies?.[ADMIN_COOKIE_NAME];

    if (!token) {
      throw new ApiException(
        ERROR_CODE.ADMIN_UNAUTHORIZED,
        '로그인이 필요합니다.',
      );
    }

    let payload: AdminJwtPayload & { exp: number };

    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new ApiException(
        ERROR_CODE.ADMIN_UNAUTHORIZED,
        '로그인이 필요합니다.',
      );
    }

    const admin: AuthenticatedAdmin = {
      adminId: payload.sub,
      expiresAt: payload.exp,
    };

    request.admin = admin;

    return true;
  }
}

import { JwtService } from '@nestjs/jwt';
import {
  AdminJwtPayload,
  AuthenticatedAdmin,
} from '../common/contracts/admin-principal';

/**
 * AdminGuard(HTTP)와 Realtime Gateway(Socket.IO handshake)가 공유하는 Admin
 * JWT 검증 로직. 토큰이 없거나 서명/만료 검증에 실패하면 그대로 예외를 던진다 —
 * 호출자가 컨텍스트(HTTP 401 vs Socket 연결 거부)에 맞는 방식으로 처리한다.
 */
export function verifyAdminJwt(
  jwtService: JwtService,
  token: string | undefined,
): AuthenticatedAdmin {
  if (!token) {
    throw new Error('ADMIN_TOKEN_MISSING');
  }

  const payload = jwtService.verify<AdminJwtPayload & { exp: number }>(token);

  if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') {
    throw new Error('ADMIN_TOKEN_INVALID');
  }

  return {
    adminId: payload.sub,
    expiresAt: payload.exp,
  };
}

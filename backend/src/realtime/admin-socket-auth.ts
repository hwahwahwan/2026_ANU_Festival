import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { AuthenticatedAdmin } from '../common/contracts/admin-principal';
import { ADMIN_COOKIE_NAME } from '../admin-auth/admin-cookie';
import { verifyAdminJwt } from '../admin-auth/verify-admin-jwt';

/**
 * Socket.IO handshake는 cookie-parser 미들웨어를 거치지 않으므로, HTTP 요청과
 * 달리 raw Cookie 헤더 문자열에서 직접 관리자 쿠키를 파싱한 뒤 AdminGuard와
 * 동일한 JWT 검증(verifyAdminJwt)을 재사용한다. 003_백엔드2_운영실시간.md §29.
 */
export function authenticateAdminSocket(
  jwtService: JwtService,
  socket: Socket,
): AuthenticatedAdmin {
  const token = extractCookieValue(
    socket.handshake.headers.cookie,
    ADMIN_COOKIE_NAME,
  );

  return verifyAdminJwt(jwtService, token);
}

function extractCookieValue(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  const prefix = `${name}=`;
  const match = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  return match ? decodeURIComponent(match.slice(prefix.length)) : undefined;
}

import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import { authenticateAdminSocket } from '../../../src/realtime/admin-socket-auth';
import { ADMIN_COOKIE_NAME } from '../../../src/admin-auth/admin-cookie';

const SECRET = 'admin-socket-auth-unit-test-secret';
const ADMIN_ID = '44444444-4444-4444-4444-444444444444';

function createSocket(cookieHeader: string | undefined): Socket {
  return {
    handshake: { headers: { cookie: cookieHeader } },
  } as unknown as Socket;
}

describe('authenticateAdminSocket', () => {
  let jwtService: JwtService;

  beforeEach(() => {
    jwtService = new JwtService({
      secret: SECRET,
      signOptions: { expiresIn: 60 },
    });
  });

  it('Cookie 헤더가 없으면 예외를 던진다', () => {
    expect(() => authenticateAdminSocket(jwtService, createSocket(undefined))).toThrow();
  });

  it('Cookie 헤더에 관리자 쿠키가 없으면 예외를 던진다', () => {
    const socket = createSocket('other_cookie=value');

    expect(() => authenticateAdminSocket(jwtService, socket)).toThrow();
  });

  it('만료된 JWT가 담긴 Cookie는 예외를 던진다', () => {
    const expired = jwtService.sign({ sub: ADMIN_ID }, { expiresIn: -10 });
    const socket = createSocket(`${ADMIN_COOKIE_NAME}=${expired}`);

    expect(() => authenticateAdminSocket(jwtService, socket)).toThrow();
  });

  it('유효한 JWT가 담긴 Cookie면 AuthenticatedAdmin을 반환한다', () => {
    const token = jwtService.sign({ sub: ADMIN_ID });
    const socket = createSocket(`foo=bar; ${ADMIN_COOKIE_NAME}=${token}; other=1`);

    const result = authenticateAdminSocket(jwtService, socket);

    expect(result.adminId).toBe(ADMIN_ID);
  });

  it('JWT에 jti(세션 식별자)가 있으면 sessionId로 그대로 전달한다', () => {
    const token = jwtService.sign({ sub: ADMIN_ID, jti: 'session-socket-1' });
    const socket = createSocket(`${ADMIN_COOKIE_NAME}=${token}`);

    const result = authenticateAdminSocket(jwtService, socket);

    expect(result.sessionId).toBe('session-socket-1');
  });
});

import type { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdminGuard } from '../../../src/admin-auth/admin.guard';
import { ADMIN_COOKIE_NAME } from '../../../src/admin-auth/admin-cookie';
import { ApiException } from '../../../src/common/filters/api.exception';
import { ERROR_CODE } from '../../../src/common/contracts/api-error';

const SECRET = 'guard-unit-test-secret';
const ADMIN_ID = '22222222-2222-2222-2222-222222222222';

function createContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  let jwtService: JwtService;
  let guard: AdminGuard;

  beforeEach(() => {
    jwtService = new JwtService({
      secret: SECRET,
      signOptions: { expiresIn: 60 },
    });
    guard = new AdminGuard(jwtService);
  });

  it('Cookie가 없으면 ADMIN_UNAUTHORIZED를 던진다', () => {
    const context = createContext({ cookies: {} });

    expect(() => guard.canActivate(context)).toThrow(ApiException);
    try {
      guard.canActivate(context);
    } catch (error) {
      expect((error as ApiException).getResponse()).toMatchObject({
        code: ERROR_CODE.ADMIN_UNAUTHORIZED,
      });
    }
  });

  it('서명이 변조된 JWT는 ADMIN_UNAUTHORIZED를 던진다', () => {
    const validToken = jwtService.sign({ sub: ADMIN_ID });
    const tamperedToken = validToken.slice(0, -1) + (validToken.endsWith('a') ? 'b' : 'a');

    const context = createContext({
      cookies: { [ADMIN_COOKIE_NAME]: tamperedToken },
    });

    try {
      guard.canActivate(context);
      fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiException);
      expect((error as ApiException).getResponse()).toMatchObject({
        code: ERROR_CODE.ADMIN_UNAUTHORIZED,
      });
    }
  });

  it('만료된 JWT는 ADMIN_UNAUTHORIZED를 던진다', () => {
    const expiredToken = jwtService.sign(
      { sub: ADMIN_ID },
      { expiresIn: -10 },
    );

    const context = createContext({
      cookies: { [ADMIN_COOKIE_NAME]: expiredToken },
    });

    try {
      guard.canActivate(context);
      fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiException);
      expect((error as ApiException).getResponse()).toMatchObject({
        code: ERROR_CODE.ADMIN_UNAUTHORIZED,
      });
    }
  });

  it('유효한 JWT면 request.admin을 설정하고 true를 반환한다', () => {
    const token = jwtService.sign({ sub: ADMIN_ID });
    const request = { cookies: { [ADMIN_COOKIE_NAME]: token } };
    const context = createContext(request);

    const result = guard.canActivate(context);

    expect(result).toBe(true);
    expect((request as { admin?: { adminId: string } }).admin).toMatchObject({
      adminId: ADMIN_ID,
    });
  });
});

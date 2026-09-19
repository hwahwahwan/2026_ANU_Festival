import { JwtService } from '@nestjs/jwt';
import { verifyAdminJwt } from '../../../src/admin-auth/verify-admin-jwt';

const SECRET = 'verify-admin-jwt-unit-test-secret';
const ADMIN_ID = '33333333-3333-3333-3333-333333333333';

describe('verifyAdminJwt', () => {
  let jwtService: JwtService;

  beforeEach(() => {
    jwtService = new JwtService({
      secret: SECRET,
      signOptions: { expiresIn: 60 },
    });
  });

  it('토큰이 없으면 예외를 던진다', () => {
    expect(() => verifyAdminJwt(jwtService, undefined)).toThrow();
  });

  it('서명이 변조된 토큰은 예외를 던진다', () => {
    const validToken = jwtService.sign({ sub: ADMIN_ID });
    const tampered = validToken.slice(0, -1) + (validToken.endsWith('a') ? 'b' : 'a');

    expect(() => verifyAdminJwt(jwtService, tampered)).toThrow();
  });

  it('만료된 토큰은 예외를 던진다', () => {
    const expired = jwtService.sign({ sub: ADMIN_ID }, { expiresIn: -10 });

    expect(() => verifyAdminJwt(jwtService, expired)).toThrow();
  });

  it('유효한 토큰이면 adminId와 expiresAt을 반환한다', () => {
    const token = jwtService.sign({ sub: ADMIN_ID });

    const result = verifyAdminJwt(jwtService, token);

    expect(result.adminId).toBe(ADMIN_ID);
    expect(typeof result.expiresAt).toBe('number');
  });
});

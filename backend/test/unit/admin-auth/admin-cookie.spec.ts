import { ADMIN_JWT_EXPIRES_IN_SECONDS } from '../../../src/admin-auth/admin-cookie';

/**
 * 관리자 JWT 유효기간은 REST(로그인 Cookie maxAge/JWT 서명)와 Socket(exp 기반
 * 종료 타이머) 모두가 공유하는 단일 서비스 계약 값이다(확정, 2026-09-20: 12시간).
 * 상수 값을 초 단위로 잘못 계산하거나(예: 분 단위 착각) 실수로 되돌리는 회귀를
 * 막기 위해 실제 초 값을 고정 단언한다.
 */
describe('ADMIN_JWT_EXPIRES_IN_SECONDS', () => {
  it('12시간(43200초)으로 고정되어 있다', () => {
    expect(ADMIN_JWT_EXPIRES_IN_SECONDS).toBe(43200);
    expect(ADMIN_JWT_EXPIRES_IN_SECONDS).toBe(12 * 60 * 60);
  });
});

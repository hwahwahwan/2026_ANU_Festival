import { ERROR_CODE, ERROR_CODE_HTTP_STATUS } from '../../../../src/common/contracts/api-error';

describe('ERROR_CODE_HTTP_STATUS', () => {
  it('공통 HTTP status와 error code가 의도한 대로 매핑된다', () => {
    expect(ERROR_CODE_HTTP_STATUS[ERROR_CODE.VALIDATION_ERROR]).toBe(400);
    expect(ERROR_CODE_HTTP_STATUS[ERROR_CODE.UNAUTHORIZED]).toBe(401);
    expect(ERROR_CODE_HTTP_STATUS[ERROR_CODE.FORBIDDEN]).toBe(403);
    expect(ERROR_CODE_HTTP_STATUS[ERROR_CODE.NOT_FOUND]).toBe(404);
    expect(ERROR_CODE_HTTP_STATUS[ERROR_CODE.CONFLICT]).toBe(409);
    expect(ERROR_CODE_HTTP_STATUS[ERROR_CODE.TOO_MANY_REQUESTS]).toBe(429);
    expect(ERROR_CODE_HTTP_STATUS[ERROR_CODE.INTERNAL_ERROR]).toBe(500);
  });

  it('도메인 error code도 각자 정의된 status를 유지한다', () => {
    expect(ERROR_CODE_HTTP_STATUS[ERROR_CODE.ADMIN_UNAUTHORIZED]).toBe(401);
    expect(ERROR_CODE_HTTP_STATUS[ERROR_CODE.ADMIN_LOGIN_FAILED]).toBe(401);
    expect(ERROR_CODE_HTTP_STATUS[ERROR_CODE.SALES_PASSWORD_INVALID]).toBe(403);
    expect(ERROR_CODE_HTTP_STATUS[ERROR_CODE.ORDER_NOT_FOUND]).toBe(404);
    expect(ERROR_CODE_HTTP_STATUS[ERROR_CODE.MENU_UNAVAILABLE]).toBe(409);
    expect(ERROR_CODE_HTTP_STATUS[ERROR_CODE.IDEMPOTENCY_CONFLICT]).toBe(409);
    expect(ERROR_CODE_HTTP_STATUS[ERROR_CODE.ORDER_STATE_CONFLICT]).toBe(409);
  });

  it('ERROR_CODE에 정의된 모든 code가 status 매핑을 빠짐없이 가진다', () => {
    const codes = Object.values(ERROR_CODE);

    for (const code of codes) {
      expect(typeof ERROR_CODE_HTTP_STATUS[code]).toBe('number');
    }
  });
});

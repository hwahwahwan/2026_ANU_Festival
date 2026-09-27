import {
  decodeAdminOrderCursor,
  encodeAdminOrderCursor,
} from '../../../src/orders/admin-order-cursor.util';
import { ApiException } from '../../../src/common/filters/api.exception';
import { ERROR_CODE } from '../../../src/common/contracts/api-error';

const VALID_ID = '11111111-1111-4111-8111-111111111111';

describe('admin-order-cursor.util', () => {
  it('encode한 값을 decode하면 원래 id를 그대로 복원한다', () => {
    const cursor = encodeAdminOrderCursor({ id: VALID_ID });

    const decoded = decodeAdminOrderCursor(cursor);

    expect(decoded.id).toBe(VALID_ID);
  });

  it('클라이언트가 값을 해석할 필요 없는 불투명 문자열이다 (평문 JSON이 그대로 노출되지 않음)', () => {
    const cursor = encodeAdminOrderCursor({ id: VALID_ID });

    expect(cursor).not.toContain(VALID_ID);
    expect(cursor).not.toContain('{');
  });

  it('base64 형식이 아닌 문자열은 VALIDATION_ERROR를 던진다', () => {
    expect(() => decodeAdminOrderCursor('not-a-valid-cursor!!')).toThrow(
      new ApiException(ERROR_CODE.VALIDATION_ERROR, '유효하지 않은 cursor입니다.'),
    );
  });

  it('구조는 맞지만 id가 없는 payload는 VALIDATION_ERROR를 던진다', () => {
    const malformed = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf-8').toString(
      'base64url',
    );

    expect(() => decodeAdminOrderCursor(malformed)).toThrow(
      new ApiException(ERROR_CODE.VALIDATION_ERROR, '유효하지 않은 cursor입니다.'),
    );
  });

  it('id가 UUID 형식이 아니면 VALIDATION_ERROR를 던진다 (위조된 cursor가 DB 쿼리까지 도달해 500이 되는 것을 방지)', () => {
    const malformed = Buffer.from(
      JSON.stringify({ id: "' OR 1=1" }),
      'utf-8',
    ).toString('base64url');

    expect(() => decodeAdminOrderCursor(malformed)).toThrow(
      new ApiException(ERROR_CODE.VALIDATION_ERROR, '유효하지 않은 cursor입니다.'),
    );
  });
});

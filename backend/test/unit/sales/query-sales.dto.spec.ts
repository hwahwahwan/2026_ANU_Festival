import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QuerySalesDto } from '../../../src/sales/dto/query-sales.dto';

/**
 * HTTP 통합 테스트(sales.integration.spec.ts)는 이미 password 누락/빈 값/타입
 * 오류 케이스를 다루고 있다. `MaxLength(128)`처럼 DTO 자체의 검증 규칙은
 * HTTP/DB까지 가지 않고 `class-validator`로 직접 검증하는 편이 더 빠르고
 * 각 규칙의 원인을 더 명확히 짚어준다(`errors[0].constraints`로 어떤 제약이
 * 걸렸는지 바로 확인 가능).
 */
describe('QuerySalesDto', () => {
  async function validateDto(payload: unknown) {
    const dto = plainToInstance(QuerySalesDto, payload);
    return validate(dto);
  }

  it('128자 이하 비밀번호는 통과한다', async () => {
    const errors = await validateDto({ password: 'a'.repeat(128) });

    expect(errors).toHaveLength(0);
  });

  it('128자를 초과하는 비밀번호는 거부된다', async () => {
    const errors = await validateDto({ password: 'a'.repeat(129) });

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  it('빈 문자열 비밀번호는 거부된다', async () => {
    const errors = await validateDto({ password: '' });

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('minLength');
  });

  it('password가 문자열이 아니면 거부된다', async () => {
    const errors = await validateDto({ password: 12345 });

    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].constraints).toHaveProperty('isString');
  });
});

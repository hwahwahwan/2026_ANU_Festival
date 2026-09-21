import { validateEnv } from '../../../src/config/env.validation';

function baseConfig(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    NODE_ENV: 'development',
    PORT: '3001',
    DATABASE_URL: 'postgres://localhost:5432/festival',
    ADMIN_JWT_SECRET: 'unit-test-admin-jwt-secret-with-enough-length',
    FRONTEND_ORIGIN: 'http://localhost:3000',
    COOKIE_SECURE: 'false',
    COOKIE_SAME_SITE: 'lax',
    SOCKET_PATH: '/socket.io',
    FESTIVAL_START_AT: '2026-09-20',
    FESTIVAL_END_AT: '2026-09-22',
    ...overrides,
  };
}

describe('validateEnv', () => {
  it('정상 환경변수 입력을 그대로 통과시킨다', () => {
    const result = validateEnv(baseConfig());

    expect(result.NODE_ENV).toBe('development');
    expect(result.DATABASE_URL).toBe('postgres://localhost:5432/festival');
  });

  it('필수 환경변수가 누락되면 시작을 거부한다', () => {
    const config = baseConfig();
    delete config.DATABASE_URL;

    expect(() => validateEnv(config)).toThrow(/DATABASE_URL/);
  });

  it('필수 환경변수가 빈 문자열이면 시작을 거부한다', () => {
    expect(() => validateEnv(baseConfig({ ADMIN_JWT_SECRET: '' }))).toThrow(
      /ADMIN_JWT_SECRET/,
    );
  });

  it('DB 타임아웃 값이 없으면 지정된 기본값을 채운다', () => {
    const result = validateEnv(baseConfig());

    expect(result.DB_CONNECTION_TIMEOUT_MS).toBe(5000);
    expect(result.DB_IDLE_TIMEOUT_MS).toBe(30000);
    expect(result.DB_STATEMENT_TIMEOUT_MS).toBe(10000);
    expect(result.DB_IDLE_TRANSACTION_TIMEOUT_MS).toBe(10000);
    expect(result.DB_POOL_MAX).toBeUndefined();
  });

  it('숫자 문자열로 주어진 값을 실제 number 타입으로 변환한다', () => {
    const result = validateEnv(
      baseConfig({ DB_POOL_MAX: '20', DB_STATEMENT_TIMEOUT_MS: '15000' }),
    );

    expect(result.DB_POOL_MAX).toBe(20);
    expect(typeof result.DB_POOL_MAX).toBe('number');
    expect(result.DB_STATEMENT_TIMEOUT_MS).toBe(15000);
    expect(typeof result.DB_STATEMENT_TIMEOUT_MS).toBe('number');
  });

  it('정수가 아닌 값이 들어오면 시작을 거부한다', () => {
    expect(() =>
      validateEnv(baseConfig({ DB_STATEMENT_TIMEOUT_MS: 'not-a-number' })),
    ).toThrow(/DB_STATEMENT_TIMEOUT_MS/);
  });

  it('소수 값이 들어오면 시작을 거부한다', () => {
    expect(() =>
      validateEnv(baseConfig({ DB_IDLE_TIMEOUT_MS: '1000.5' })),
    ).toThrow(/DB_IDLE_TIMEOUT_MS/);
  });

  it('허용 범위를 초과하면 시작을 거부한다', () => {
    expect(() =>
      validateEnv(baseConfig({ DB_POOL_MAX: '9999' })),
    ).toThrow(/DB_POOL_MAX/);
  });

  it('허용 범위 미만이면 시작을 거부한다', () => {
    expect(() =>
      validateEnv(baseConfig({ DB_CONNECTION_TIMEOUT_MS: '0' })),
    ).toThrow(/DB_CONNECTION_TIMEOUT_MS/);
  });

  it('COOKIE_SECURE가 "true"/"false"가 아니면 시작을 거부한다', () => {
    expect(() =>
      validateEnv(baseConfig({ COOKIE_SECURE: 'TRUE' })),
    ).toThrow(/COOKIE_SECURE/);
  });

  it('COOKIE_SAME_SITE가 허용된 값이 아니면 시작을 거부한다', () => {
    expect(() =>
      validateEnv(baseConfig({ COOKIE_SAME_SITE: 'laxx' })),
    ).toThrow(/COOKIE_SAME_SITE/);
  });

  it('COOKIE_SAME_SITE=none은 COOKIE_SECURE 값과 무관하게 항상 시작을 거부한다 (동일 Origin 배포 확정, cross-site Cookie 미지원)', () => {
    expect(() =>
      validateEnv(
        baseConfig({ COOKIE_SAME_SITE: 'none', COOKIE_SECURE: 'true' }),
      ),
    ).toThrow(/COOKIE_SAME_SITE/);

    expect(() =>
      validateEnv(
        baseConfig({ COOKIE_SAME_SITE: 'none', COOKIE_SECURE: 'false' }),
      ),
    ).toThrow(/COOKIE_SAME_SITE/);
  });

  it('ADMIN_JWT_SECRET이 32자 미만이면 시작을 거부한다', () => {
    expect(() =>
      validateEnv(baseConfig({ ADMIN_JWT_SECRET: 'too-short-secret' })),
    ).toThrow(/ADMIN_JWT_SECRET/);
  });

  it('ADMIN_JWT_SECRET이 32자 이상이면 통과한다', () => {
    const result = validateEnv(
      baseConfig({ ADMIN_JWT_SECRET: 'a'.repeat(32) }),
    );

    expect(result.ADMIN_JWT_SECRET).toBe('a'.repeat(32));
  });

  it('COOKIE_SAME_SITE=strict는 정상적으로 통과한다', () => {
    const result = validateEnv(baseConfig({ COOKIE_SAME_SITE: 'strict' }));

    expect(result.COOKIE_SAME_SITE).toBe('strict');
  });

  describe('FESTIVAL_START_AT/FESTIVAL_END_AT (KST 축제 운영 날짜)', () => {
    it('정상 YYYY-MM-DD 값은 통과한다', () => {
      const result = validateEnv(
        baseConfig({ FESTIVAL_START_AT: '2026-09-20', FESTIVAL_END_AT: '2026-09-22' }),
      );

      expect(result.FESTIVAL_START_AT).toBe('2026-09-20');
      expect(result.FESTIVAL_END_AT).toBe('2026-09-22');
    });

    it('시작일과 종료일이 같아도(하루짜리 축제) 통과한다', () => {
      expect(() =>
        validateEnv(
          baseConfig({ FESTIVAL_START_AT: '2026-09-20', FESTIVAL_END_AT: '2026-09-20' }),
        ),
      ).not.toThrow();
    });

    it('FESTIVAL_START_AT이 없으면 시작을 거부한다', () => {
      const config = baseConfig();
      delete config.FESTIVAL_START_AT;

      expect(() => validateEnv(config)).toThrow(/FESTIVAL_START_AT/);
    });

    it('FESTIVAL_END_AT이 빈 문자열이면 시작을 거부한다', () => {
      expect(() =>
        validateEnv(baseConfig({ FESTIVAL_END_AT: '' })),
      ).toThrow(/FESTIVAL_END_AT/);
    });

    it.each([
      ['2026-9-20', '월/일이 한 자리'],
      ['2026/09/20', '구분자가 다름'],
      ['2026-09-20T00:00:00+09:00', '시각 포함 전체 타임스탬프(과거 버그 재발 방지)'],
      ['not-a-date', '날짜가 아닌 문자열'],
      ['2026-02-30', '2월에 존재하지 않는 30일'],
      ['2026-13-01', '13월은 없음'],
    ])('FESTIVAL_START_AT이 "%s"(%s)이면 시작을 거부한다', (value) => {
      expect(() =>
        validateEnv(baseConfig({ FESTIVAL_START_AT: value })),
      ).toThrow(/FESTIVAL_START_AT/);
    });

    it('FESTIVAL_END_AT 형식이 잘못되면 시작을 거부한다', () => {
      expect(() =>
        validateEnv(baseConfig({ FESTIVAL_END_AT: '2026/09/22' })),
      ).toThrow(/FESTIVAL_END_AT/);
    });

    it('FESTIVAL_START_AT이 FESTIVAL_END_AT보다 늦으면 시작을 거부한다', () => {
      expect(() =>
        validateEnv(
          baseConfig({ FESTIVAL_START_AT: '2026-09-23', FESTIVAL_END_AT: '2026-09-22' }),
        ),
      ).toThrow(/FESTIVAL_START_AT.*FESTIVAL_END_AT/);
    });
  });
});

import { validateEnv } from '../../../src/config/env.validation';

function baseConfig(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    NODE_ENV: 'development',
    PORT: '3001',
    DATABASE_URL: 'postgres://localhost:5432/festival',
    ADMIN_JWT_SECRET: 'secret',
    FRONTEND_ORIGIN: 'http://localhost:3000',
    COOKIE_SECURE: 'false',
    COOKIE_SAME_SITE: 'lax',
    SOCKET_PATH: '/socket.io',
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
});

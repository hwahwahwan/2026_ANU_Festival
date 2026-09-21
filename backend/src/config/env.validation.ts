import { isValidKstDateString, kstDateStringToRange } from '../common/kst-date.util';

const REQUIRED_ENV_KEYS = [
  'NODE_ENV',
  'PORT',
  'DATABASE_URL',
  'ADMIN_JWT_SECRET',
  'FRONTEND_ORIGIN',
  'COOKIE_SECURE',
  'COOKIE_SAME_SITE',
  'SOCKET_PATH',
  'FESTIVAL_START_AT',
  'FESTIVAL_END_AT',
] as const;

interface NumericEnvSpec {
  key: string;
  min: number;
  max: number;
  defaultValue?: number;
}

const NUMERIC_ENV_SPECS: NumericEnvSpec[] = [
  { key: 'DB_POOL_MAX', min: 1, max: 100 },
  {
    key: 'DB_CONNECTION_TIMEOUT_MS',
    min: 1,
    max: 300_000,
    defaultValue: 5000,
  },
  { key: 'DB_IDLE_TIMEOUT_MS', min: 1, max: 300_000, defaultValue: 30_000 },
  {
    key: 'DB_STATEMENT_TIMEOUT_MS',
    min: 1,
    max: 300_000,
    defaultValue: 10_000,
  },
  {
    key: 'DB_IDLE_TRANSACTION_TIMEOUT_MS',
    min: 1,
    max: 300_000,
    defaultValue: 10_000,
  },
];

/**
 * 프론트엔드/백엔드는 항상 동일 Origin(Nginx Reverse Proxy)으로 배포한다
 * (001_백엔드_공통.md §42). cross-site Cookie 인증을 지원하지 않으므로
 * COOKIE_SAME_SITE=none은 허용하지 않는다.
 */
const COOKIE_SAME_SITE_VALUES = ['lax', 'strict'] as const;

export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const missing = REQUIRED_ENV_KEYS.filter(
    (key) => config[key] === undefined || config[key] === '',
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  const validated: Record<string, unknown> = { ...config };

  for (const spec of NUMERIC_ENV_SPECS) {
    validated[spec.key] = parseNumericEnv(spec, config[spec.key]);
  }

  validateCookieEnv(config);
  validateAdminJwtSecret(config);
  validateFestivalPeriodEnv(config);

  return validated;
}

const ADMIN_JWT_SECRET_MIN_LENGTH = 32;

function validateAdminJwtSecret(config: Record<string, unknown>): void {
  const secret = config.ADMIN_JWT_SECRET;

  if (typeof secret !== 'string' || secret.length < ADMIN_JWT_SECRET_MIN_LENGTH) {
    throw new Error(
      `Invalid value for ADMIN_JWT_SECRET: must be a string of at least ${ADMIN_JWT_SECRET_MIN_LENGTH} characters (e.g. \`openssl rand -base64 48\`)`,
    );
  }
}

function validateCookieEnv(config: Record<string, unknown>): void {
  const cookieSecure = config.COOKIE_SECURE;

  if (cookieSecure !== 'true' && cookieSecure !== 'false') {
    throw new Error(
      `Invalid value for COOKIE_SECURE: "${String(cookieSecure)}" (expected "true" or "false")`,
    );
  }

  const cookieSameSite = config.COOKIE_SAME_SITE;

  if (
    !COOKIE_SAME_SITE_VALUES.includes(
      cookieSameSite as (typeof COOKIE_SAME_SITE_VALUES)[number],
    )
  ) {
    throw new Error(
      `Invalid value for COOKIE_SAME_SITE: "${String(cookieSameSite)}" (expected one of: ${COOKIE_SAME_SITE_VALUES.join(', ')} — "none" is not supported, frontend/backend are always deployed same-origin)`,
    );
  }
}

/**
 * `FESTIVAL_START_AT`/`FESTIVAL_END_AT`(001_백엔드_공통.md §45~46, 003_백엔드2_운영실시간.md
 * §20~23)은 "시각"이 아니라 Asia/Seoul(KST) 기준 축제 운영 날짜다. `YYYY-MM-DD`
 * 형식만 허용하며, 두 값 모두 그 날짜를 포함한다(inclusive) — 즉
 * `FESTIVAL_START_AT=2026-09-20`, `FESTIVAL_END_AT=2026-09-22`이면 9/20~9/22
 * 3일이 모두 포함되고, Sales는 이를 `[2026-09-20T00:00:00+09:00,
 * 2026-09-23T00:00:00+09:00)` 구간으로 변환해 집계한다
 * (`sales/sales.service.ts`가 `kstDateStringToRange(END).to`로 다음날 자정을
 * 배타적 상한으로 계산한다).
 *
 * 예전에는 이 두 값을 `new Date(fromRaw)`로 그대로 파싱했는데, 오프셋 없는
 * 날짜 문자열(`"2026-09-20"`)은 JS에서 UTC 자정으로 해석되어 KST 자정보다
 * 9시간 이르게 밀리는 문제가 있었다. 이제 형식을 날짜 전용으로 명확히
 * 고정하고, 부팅 시점에 검증해 잘못된 값으로 서버가 조용히 떠 있지 않도록
 * 한다(다른 필수 환경변수와 동일한 fail-fast 원칙, §46).
 */
function validateFestivalPeriodEnv(config: Record<string, unknown>): void {
  const start = config.FESTIVAL_START_AT;
  const end = config.FESTIVAL_END_AT;

  if (typeof start !== 'string' || !isValidKstDateString(start)) {
    throw new Error(
      `Invalid value for FESTIVAL_START_AT: "${String(start)}" (expected a KST calendar date in YYYY-MM-DD format, e.g. "2026-09-20")`,
    );
  }

  if (typeof end !== 'string' || !isValidKstDateString(end)) {
    throw new Error(
      `Invalid value for FESTIVAL_END_AT: "${String(end)}" (expected a KST calendar date in YYYY-MM-DD format, e.g. "2026-09-22")`,
    );
  }

  if (kstDateStringToRange(start).from.getTime() > kstDateStringToRange(end).from.getTime()) {
    throw new Error(
      `Invalid festival period: FESTIVAL_START_AT("${start}") is after FESTIVAL_END_AT("${end}")`,
    );
  }
}

function parseNumericEnv(
  spec: NumericEnvSpec,
  rawValue: unknown,
): number | undefined {
  if (rawValue === undefined || rawValue === '') {
    return spec.defaultValue;
  }

  const parsed = Number(rawValue);

  if (!Number.isInteger(parsed) || parsed < spec.min || parsed > spec.max) {
    throw new Error(
      `Invalid value for ${spec.key}: "${String(rawValue)}" (expected an integer between ${spec.min} and ${spec.max})`,
    );
  }

  return parsed;
}

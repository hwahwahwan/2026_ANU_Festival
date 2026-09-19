const REQUIRED_ENV_KEYS = [
  'NODE_ENV',
  'PORT',
  'DATABASE_URL',
  'ADMIN_JWT_SECRET',
  'FRONTEND_ORIGIN',
  'COOKIE_SECURE',
  'COOKIE_SAME_SITE',
  'SOCKET_PATH',
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

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

  return validated;
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

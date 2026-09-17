import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { validateEnv } from '../../src/config/env.validation';
import { DatabaseModule } from '../../src/database/database.module';
import { DatabaseService } from '../../src/database/database.service';

/**
 * 실제 로컬 PostgreSQL(festival DB)에 연결해서 공통 DB 계층
 * (DatabaseService / Pool 설정)이 실제로 동작하는지 검증한다.
 *
 * 이 테스트를 실행하려면 backend/.env의 DATABASE_URL이 접근 가능한
 * PostgreSQL을 가리키고 있어야 한다. 도메인 테이블이 아직 없으므로,
 * 이 파일이 직접 만들고 지우는 전용 probe 테이블만 사용한다
 * (production/migration 스키마에는 어떤 테이블도 추가하지 않는다).
 */
const PROBE_TABLE = '_backend_common_integration_test_probe';

function parsePgDurationToMs(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|min|h|d)?$/i);

  if (!match) {
    throw new Error(`Unexpected PostgreSQL duration format: "${value}"`);
  }

  const amount = Number(match[1]);
  const unit = (match[2] ?? 'ms').toLowerCase();
  const unitToMs: Record<string, number> = {
    ms: 1,
    s: 1000,
    min: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };

  return amount * unitToMs[unit];
}

describe('DatabaseService (실제 PostgreSQL integration)', () => {
  let databaseService: DatabaseService;
  let configService: ConfigService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        DatabaseModule,
      ],
    }).compile();

    databaseService = moduleRef.get(DatabaseService);
    configService = moduleRef.get(ConfigService);

    await databaseService.query(`
      CREATE TABLE IF NOT EXISTS ${PROBE_TABLE} (
        id SERIAL PRIMARY KEY,
        label TEXT NOT NULL
      )
    `);
  });

  afterEach(async () => {
    await databaseService.query(`DELETE FROM ${PROBE_TABLE}`);
  });

  afterAll(async () => {
    await databaseService.query(`DROP TABLE IF EXISTS ${PROBE_TABLE}`);
    await databaseService.onApplicationShutdown();
  });

  it('[1] 실제 PostgreSQL Pool을 통해 단순 SELECT가 정상 수행된다', async () => {
    const result = await databaseService.query<{ value: number }>(
      'SELECT 1 AS value',
    );

    expect(result.rows[0].value).toBe(1);
  });

  it('[2] withTransaction이 성공하면 실제로 COMMIT되어 데이터가 남는다', async () => {
    await databaseService.withTransaction(async (client) => {
      await client.query(`INSERT INTO ${PROBE_TABLE} (label) VALUES ($1)`, [
        'commit-check',
      ]);
    });

    const result = await databaseService.query<{ label: string }>(
      `SELECT label FROM ${PROBE_TABLE} WHERE label = $1`,
      ['commit-check'],
    );

    expect(result.rows).toHaveLength(1);
  });

  it('[3] withTransaction 중 예외가 발생하면 ROLLBACK되어 데이터가 남지 않는다', async () => {
    await expect(
      databaseService.withTransaction(async (client) => {
        await client.query(`INSERT INTO ${PROBE_TABLE} (label) VALUES ($1)`, [
          'rollback-check',
        ]);
        throw new Error('intentional failure to verify rollback');
      }),
    ).rejects.toThrow('intentional failure to verify rollback');

    const result = await databaseService.query<{ label: string }>(
      `SELECT label FROM ${PROBE_TABLE} WHERE label = $1`,
      ['rollback-check'],
    );

    expect(result.rows).toHaveLength(0);
  });

  it('[4] 설정한 서버측 timeout이 실제 PostgreSQL session에 적용된다', async () => {
    const statementTimeoutResult = await databaseService.query<{
      statement_timeout: string;
    }>('SHOW statement_timeout');
    const idleTxTimeoutResult = await databaseService.query<{
      idle_in_transaction_session_timeout: string;
    }>('SHOW idle_in_transaction_session_timeout');

    const actualStatementTimeoutMs = parsePgDurationToMs(
      statementTimeoutResult.rows[0].statement_timeout,
    );
    const actualIdleTxTimeoutMs = parsePgDurationToMs(
      idleTxTimeoutResult.rows[0].idle_in_transaction_session_timeout,
    );

    expect(actualStatementTimeoutMs).toBe(
      configService.get<number>('DB_STATEMENT_TIMEOUT_MS'),
    );
    expect(actualIdleTxTimeoutMs).toBe(
      configService.get<number>('DB_IDLE_TRANSACTION_TIMEOUT_MS'),
    );

    // connectionTimeoutMillis / idleTimeoutMillis는 pg-pool의 클라이언트 측
    // 옵션(커넥션을 기다리거나 idle 커넥션을 정리하는 타이밍)이며 PostgreSQL
    // 서버 GUC가 아니라서 SHOW로 조회할 수 없다. 여기서는 서버에 실제로
    // 전달되는 두 값(statement_timeout, idle_in_transaction_session_timeout)만
    // 검증한다.
  });
});

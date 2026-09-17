import type { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { DatabaseService } from '../../../src/database/database.service';

jest.mock('pg', () => {
  return {
    Pool: jest.fn().mockImplementation(() => ({
      query: jest.fn(),
      connect: jest.fn(),
      on: jest.fn(),
      end: jest.fn(),
    })),
  };
});

type MockPool = {
  query: jest.Mock;
  connect: jest.Mock;
  on: jest.Mock;
  end: jest.Mock;
};

const PoolMock = Pool as unknown as jest.Mock;

function createConfigServiceStub(
  values: Record<string, unknown> = {},
): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function createService(configValues: Record<string, unknown> = {}): {
  service: DatabaseService;
  pool: MockPool;
} {
  const service = new DatabaseService(createConfigServiceStub(configValues));
  const pool = PoolMock.mock.results[PoolMock.mock.results.length - 1]
    .value as MockPool;

  return { service, pool };
}

describe('DatabaseService', () => {
  beforeEach(() => {
    PoolMock.mockClear();
  });

  it('ConfigService에서 읽은 값으로 Pool 옵션을 구성한다', () => {
    createService({
      DATABASE_URL: 'postgres://localhost/test',
      DB_POOL_MAX: 15,
      DB_CONNECTION_TIMEOUT_MS: 1234,
      DB_IDLE_TIMEOUT_MS: 2345,
      DB_STATEMENT_TIMEOUT_MS: 3456,
      DB_IDLE_TRANSACTION_TIMEOUT_MS: 4567,
    });

    expect(PoolMock).toHaveBeenCalledWith({
      connectionString: 'postgres://localhost/test',
      max: 15,
      connectionTimeoutMillis: 1234,
      idleTimeoutMillis: 2345,
      statement_timeout: 3456,
      idle_in_transaction_session_timeout: 4567,
    });
  });

  it('pool에 error 리스너를 등록해 idle client 에러로 프로세스가 죽지 않게 한다', () => {
    const { pool } = createService();

    expect(pool.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('query()는 Pool.query에 위임하고 결과를 그대로 반환한다', async () => {
    const { service, pool } = createService();
    const expected = { rows: [{ id: 1 }] };
    pool.query.mockResolvedValue(expected);

    const result = await service.query('SELECT 1 WHERE id = $1', [1]);

    expect(pool.query).toHaveBeenCalledWith('SELECT 1 WHERE id = $1', [1]);
    expect(result).toBe(expected);
  });

  it('withTransaction 성공 시 BEGIN → work → COMMIT 순서로 실행하고 client를 release한다', async () => {
    const { service, pool } = createService();
    const client = {
      query: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);
    const work = jest.fn().mockResolvedValue('ok');

    const result = await service.withTransaction(work);

    expect(client.query.mock.calls.map((call) => call[0])).toEqual([
      'BEGIN',
      'COMMIT',
    ]);
    expect(work).toHaveBeenCalledWith(client);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(result).toBe('ok');
  });

  it('withTransaction 실패 시 ROLLBACK을 실행하고, 원본 에러를 그대로 던지며, client를 release한다', async () => {
    const { service, pool } = createService();
    const client = {
      query: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);
    const failure = new Error('insert failed');
    const work = jest.fn().mockRejectedValue(failure);

    await expect(service.withTransaction(work)).rejects.toBe(failure);

    expect(client.query.mock.calls.map((call) => call[0])).toEqual([
      'BEGIN',
      'ROLLBACK',
    ]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('ROLLBACK 자체가 실패해도 원본 에러가 유지되고 client는 release된다', async () => {
    const { service, pool } = createService();
    const client = {
      query: jest.fn((sql: string) => {
        if (sql === 'ROLLBACK') {
          return Promise.reject(new Error('connection already closed'));
        }
        return Promise.resolve(undefined);
      }),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);
    const originalError = new Error('insert failed');
    const work = jest.fn().mockRejectedValue(originalError);

    await expect(service.withTransaction(work)).rejects.toBe(originalError);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('onApplicationShutdown은 pool을 종료한다', async () => {
    const { service, pool } = createService();
    pool.end.mockResolvedValue(undefined);

    await service.onApplicationShutdown();

    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});

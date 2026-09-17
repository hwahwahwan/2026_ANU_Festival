import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly pool: Pool;
  private readonly logger = new Logger(DatabaseService.name);

  constructor(configService: ConfigService) {
    this.pool = new Pool({
      connectionString: configService.get<string>('DATABASE_URL'),
      max: configService.get<number>('DB_POOL_MAX'),
      connectionTimeoutMillis: configService.get<number>(
        'DB_CONNECTION_TIMEOUT_MS',
      ),
      idleTimeoutMillis: configService.get<number>('DB_IDLE_TIMEOUT_MS'),
      statement_timeout: configService.get<number>(
        'DB_STATEMENT_TIMEOUT_MS',
      ),
      idle_in_transaction_session_timeout: configService.get<number>(
        'DB_IDLE_TRANSACTION_TIMEOUT_MS',
      ),
    });

    this.pool.on('error', (err) => {
      this.logger.error('Unexpected idle client error', err.stack);
    });
  }

  async query<T extends QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params as unknown[]);
  }

  async withTransaction<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const result = await work(client);

      await client.query('COMMIT');

      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // rollback 오류는 별도 내부 로그 처리
      }

      throw error;
    } finally {
      client.release();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

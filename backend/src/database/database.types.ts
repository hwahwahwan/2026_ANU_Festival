import { QueryResult, QueryResultRow } from 'pg';

export type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

/**
 * Repository read 메서드가 받는 최소 실행자 타입.
 * DatabaseService(트랜잭션 밖)와 PoolClient(트랜잭션 안) 둘 다 이 시그니처를 만족하므로,
 * 호출자(Service)가 어느 커넥션에서 실행할지 항상 명시적으로 넘긴다.
 */
export interface Queryable {
  query<T extends QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}

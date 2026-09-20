import { PoolClient } from 'pg';

/**
 * 한 매출 조회 요청 안에서 실행하는 여러 집계 쿼리(오늘/축제 전체/일자별/메뉴별)가
 * 서로 다른 시점의 데이터를 섞어보지 않도록, 트랜잭션의 격리 수준을
 * REPEATABLE READ(+ READ ONLY)로 올린다.
 *
 * PostgreSQL의 기본 격리 수준인 READ COMMITTED는 "트랜잭션" 단위가 아니라
 * "각 개별 문장(statement)" 단위로 새 스냅샷을 잡는다. 따라서 `BEGIN` ...
 * `COMMIT`으로 감싸기만 하고 격리 수준을 그대로 두면, 같은 트랜잭션 안에서도
 * 쿼리와 쿼리 사이에 다른 트랜잭션이 커밋한 변경(예: 방금 입금 확인된 주문)이
 * 끼어들어 일부 집계에만 반영되고 다른 집계에는 반영되지 않는 불일치가 생길
 * 수 있다. REPEATABLE READ는 트랜잭션의 첫 쿼리 시점 스냅샷을 트랜잭션이 끝날
 * 때까지 고정하므로 이 문제를 막는다. 이 트랜잭션은 쓰기를 하지 않으므로
 * READ ONLY를 함께 지정한다 — 읽기 전용 트랜잭션은 REPEATABLE READ여도
 * write skew로 인한 직렬화 실패(serialization failure)가 발생하지 않으므로
 * 재시도 로직 없이도 안전하다.
 *
 * PostgreSQL 요구사항: `SET TRANSACTION`은 해당 트랜잭션의 "첫 문장"이어야
 * 하므로, 반드시 `DatabaseService.withTransaction()` 콜백 맨 앞에서(다른
 * 쿼리보다 먼저) 호출해야 한다.
 */
export async function useRepeatableReadSnapshot(client: PoolClient): Promise<void> {
  await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
}

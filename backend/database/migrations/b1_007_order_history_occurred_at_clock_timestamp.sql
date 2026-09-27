-- order_history.occurred_at의 기본값을 now()(=transaction_timestamp, BEGIN 시각)에서
-- clock_timestamp()(실제 INSERT 실행 시각)로 바꾼다. FOR UPDATE 락 대기가 있는
-- 상태 변경 흐름에서, 나중에 커밋된 이력이 트랜잭션 시작 시각 때문에 더 이른
-- 시각으로 기록되어 "생성부터 처리까지 시간순" 계약(§20)이 깨질 수 있었다.
ALTER TABLE order_history
  ALTER COLUMN occurred_at SET DEFAULT clock_timestamp();

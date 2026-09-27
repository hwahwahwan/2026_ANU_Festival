import { PoolClient } from 'pg';
import { RefundAggregationService } from '../../../src/sales/refund-aggregation.service';

const FAKE_CLIENT = {} as PoolClient;

/**
 * 이 테스트는 버그 재현이 아니라 "현재 Backend 1의 order_refunds가 아직
 * 구현되지 않아 refundedAmount가 항상 0으로 반환된다"는 의도된 임시 동작을
 * 문서화한다(refund-aggregation.service.ts의 TODO 주석 참고). Backend 1의
 * order_refunds 연동이 실제로 구현되면 이 테스트는 실제 집계값을 검증하도록
 * 교체되어야 한다.
 */
describe('RefundAggregationService (Backend 1 order_refunds 미구현 임시 동작)', () => {
  const service = new RefundAggregationService();

  it('어떤 날짜 범위를 넘겨도 항상 0을 반환한다(client는 사용하지 않는다)', async () => {
    await expect(
      service.getRefundedAmount(FAKE_CLIENT, {
        from: new Date('2026-09-18T00:00:00.000Z'),
        to: new Date('2026-09-19T00:00:00.000Z'),
      }),
    ).resolves.toBe(0);
  });

  it('축제 전체 기간처럼 넓은 범위를 넘겨도 항상 0을 반환한다', async () => {
    await expect(
      service.getRefundedAmount(FAKE_CLIENT, {
        from: new Date('2000-01-01T00:00:00.000Z'),
        to: new Date('2099-01-01T00:00:00.000Z'),
      }),
    ).resolves.toBe(0);
  });
});

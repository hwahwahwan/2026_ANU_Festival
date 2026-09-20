import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DateRange } from '../common/kst-date.util';

/**
 * 환불 금액 집계를 격리한 지점.
 *
 * TODO(Backend 1 Refund 연동, 003_백엔드2_운영실시간.md §24/§24-1 "Refund와
 * Sales" / Step 10 "Refund Sales 반영", 002_백엔드1_주문결제.md §24 참고): 이
 * 브랜치 기준 Backend 1의 `order_refunds` 테이블과 환불 기능
 * (`POST /admin/orders/:orderId/refunds`)이 아직 구현되지 않았다. 환불 정책
 * 자체는 이미 확정되었지만(전액 환불만, 주문당 1건 — 위 문서 참고) 실제로
 * 집계할 테이블이 없다. 그 전까지 `getRefundedAmount()`는 항상 0을 반환하는
 * 자리표시(placeholder) 구현이다 — 버그가 아니라 의존 기능(`order_refunds`)
 * 미구현에 따른 의도된 임시 동작이며, 이 사실은 테스트로 명시한다
 * (test/unit/sales/refund-aggregation.service.spec.ts).
 *
 * Backend 1이 `order_refunds(id, order_id, refund_request_id, amount,
 * processed_at, processed_by, reason)`를 구현하면, 이 메서드의 "본문"만 아래와
 * 같은 실제 집계 쿼리로 교체하면 된다. 이 클래스를 호출하는 `SalesService`는
 * `getRefundedAmount(client, range): Promise<number>` 시그니처만 알고 있으므로
 * 호출부를 바꿀 필요가 없다:
 *
 *   SELECT COALESCE(SUM(amount), 0)::integer
 *   FROM order_refunds
 *   WHERE processed_at >= $1 AND processed_at < $2
 *
 * `client`는 `SalesService`가 이미 열어 둔 REPEATABLE READ READ ONLY
 * 트랜잭션(`sales-snapshot.ts`)의 `PoolClient`다. 지금은 실제 쿼리를 하지
 * 않아 사용하지 않지만, 실제 구현으로 교체할 때는 반드시 이 `client`로
 * 쿼리해야 한다(별도 Pool 연결을 쓰면 같은 요청 안의 `amount`/`quantity`
 * 집계와 다른 스냅샷을 볼 수 있다 — 003_백엔드2_운영실시간.md §24-1).
 *
 * 교체 시에도 지켜야 할 계약(변경하지 않음):
 *   - `SalesView` 응답 계약 자체는 유지한다(필드 추가/삭제 없음).
 *   - `byMenu`에는 `refundedAmount`를 넣지 않는다(전액 환불만 지원, 메뉴별 환불
 *     배분 미지원 정책은 계속 유지 — sales.service.ts 참고).
 *   - `daily`는 현재 `payment_confirmed_at`(결제일) 기준으로만 행이 생성된다.
 *     "결제 0건 + 환불만 있는 날짜"는 아직 `daily`에 나타나지 않는 구조적 한계가
 *     있으므로, 실제 연동 시 이 부분도 함께 처리해야 한다(003_백엔드2_운영실시간.md
 *     §24-1 TODO 참고).
 */
@Injectable()
export class RefundAggregationService {
  async getRefundedAmount(_client: PoolClient, _range: DateRange): Promise<number> {
    return 0;
  }
}

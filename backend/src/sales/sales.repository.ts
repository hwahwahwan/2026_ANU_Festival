import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { SalesByMenuItem, SalesTotals } from '../common/contracts/sales-view';
import { DateRange } from '../common/kst-date.util';

interface TotalsRow {
  quantity: number;
  amount: number;
}

interface DailyRow {
  date: string;
  quantity: number;
  amount: number;
}

interface ByMenuRow {
  menu_id: string;
  menu_name: string;
  quantity: number;
  amount: number;
}

/**
 * Sales는 Backend 1이 소유한 `orders`/`order_items`를 읽기 전용으로 집계한다
 * (04_DB스키마.md §1, 003_백엔드2_운영실시간.md §18). Backend 1의 `OrdersRepository`를
 * import하지 않고, 직접 SELECT만 실행한다 — 이 도메인은 두 테이블에 절대 쓰지 않는다.
 *
 * 한 매출 조회 요청 안의 모든 쿼리는 `SalesService`가 연 하나의 REPEATABLE READ
 * READ ONLY 트랜잭션(`sales-snapshot.ts`) 위에서 실행되어야 서로 다른 시점의
 * 데이터를 섞어보지 않는다(003_백엔드2_운영실시간.md §24-1). 그래서 이 Repository는
 * `DatabaseService`를 직접 주입받지 않고, 호출부가 넘겨주는 같은 `PoolClient`만
 * 사용한다 — `payment-settings.repository.ts`의 `findCurrentForUpdate(client)` /
 * `applyChanges(client, ...)`와 동일한 패턴이다.
 *
 * `payment_confirmed_at`이 `NULL`인 주문(`PAYMENT_PENDING`, 미입금 `CANCELLED`)은
 * `WHERE payment_confirmed_at >= $1 AND < $2` 비교에서 자연히 제외된다
 * (001_백엔드_공통.md §43).
 *
 * 금액/수량은 원 단위 정수이고 학교 축제 규모에서 2^31(약 21억)을 넘을 수 없으므로
 * SUM 결과를 `::integer`로 캐스팅한다 — 캐스팅하지 않으면 SUM(integer)의 결과 타입인
 * bigint(OID 20)를 pg 드라이버가 정밀도 손실 방지를 위해 문자열로 반환해 응답
 * 스키마(number)와 어긋난다. `orders.total_price`도 INTEGER(`b1_001_create_orders.sql`)라
 * 상한이 이미 같은 범위로 맞춰져 있다.
 */
@Injectable()
export class SalesRepository {
  async getTotals(client: PoolClient, range: DateRange): Promise<SalesTotals> {
    const result = await client.query<TotalsRow>(
      `SELECT
         COALESCE(SUM(oi.quantity), 0)::integer AS quantity,
         COALESCE(SUM(oi.unit_price * oi.quantity), 0)::integer AS amount
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.payment_confirmed_at >= $1
         AND o.payment_confirmed_at < $2`,
      [range.from, range.to],
    );

    return result.rows[0];
  }

  /** `range` 구간을 Asia/Seoul 캘린더 날짜 단위로 묶어 판매수량/금액을 반환한다. */
  async getDailyBreakdown(
    client: PoolClient,
    range: DateRange,
  ): Promise<(SalesTotals & { date: string })[]> {
    const result = await client.query<DailyRow>(
      `SELECT
         to_char(
           date_trunc('day', o.payment_confirmed_at AT TIME ZONE 'Asia/Seoul'),
           'YYYY-MM-DD'
         ) AS date,
         SUM(oi.quantity)::integer AS quantity,
         SUM(oi.unit_price * oi.quantity)::integer AS amount
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.payment_confirmed_at >= $1
         AND o.payment_confirmed_at < $2
       GROUP BY 1
       ORDER BY 1`,
      [range.from, range.to],
    );

    return result.rows;
  }

  /** 주문 시점 스냅샷 컬럼(menu_id, menu_name)으로 묶는다 — 현재 menus 테이블 값으로 재계산하지 않는다. */
  async getByMenu(client: PoolClient, range: DateRange): Promise<SalesByMenuItem[]> {
    const result = await client.query<ByMenuRow>(
      `SELECT
         oi.menu_id AS menu_id,
         oi.menu_name AS menu_name,
         SUM(oi.quantity)::integer AS quantity,
         SUM(oi.unit_price * oi.quantity)::integer AS amount
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       WHERE o.payment_confirmed_at >= $1
         AND o.payment_confirmed_at < $2
       GROUP BY oi.menu_id, oi.menu_name
       ORDER BY amount DESC, oi.menu_id`,
      [range.from, range.to],
    );

    return result.rows.map((row) => ({
      menuId: row.menu_id,
      menuName: row.menu_name,
      quantity: row.quantity,
      amount: row.amount,
    }));
  }
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PoolClient } from 'pg';
import { AdminAuthService } from '../admin-auth/admin-auth.service';
import { ApiException } from '../common/filters/api.exception';
import { ERROR_CODE } from '../common/contracts/api-error';
import { SalesView } from '../common/contracts/sales-view';
import { DatabaseService } from '../database/database.service';
import { DateRange, kstDateStringToRange, toKstDateString } from '../common/kst-date.util';
import { SalesRepository } from './sales.repository';
import { RefundAggregationService } from './refund-aggregation.service';
import { useRepeatableReadSnapshot } from './sales-snapshot';

@Injectable()
export class SalesService {
  constructor(
    private readonly adminAuthService: AdminAuthService,
    private readonly database: DatabaseService,
    private readonly salesRepository: SalesRepository,
    private readonly refundAggregationService: RefundAggregationService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 흐름(003_백엔드2_운영실시간.md §19): AdminGuard로 얻은 adminId(요청 바디의
   * adminId가 아니라 JWT principal)로 현재 로그인한 계정의 비밀번호를 매 요청마다
   * 재검증한다. 별도 Sales JWT/Cookie/유지 세션은 만들지 않는다 — 검증 성공
   * 상태를 어디에도 저장하지 않고 같은 응답으로 통계를 바로 반환한다.
   */
  async query(adminId: string, password: string): Promise<SalesView> {
    const passwordValid = await this.adminAuthService.verifyAdminPassword(
      adminId,
      password,
    );

    if (!passwordValid) {
      throw new ApiException(
        ERROR_CODE.SALES_PASSWORD_INVALID,
        '비밀번호가 일치하지 않습니다.',
      );
    }

    const now = new Date();
    const todayDate = toKstDateString(now);
    const todayRange = kstDateStringToRange(todayDate);
    const festivalRange = this.resolveFestivalPeriod();

    // 아래 5개 집계 쿼리와 환불 집계가 서로 다른 커넥션의 서로 다른 스냅샷을
    // 읽으면(예: 요청 도중 새 입금 확인이 COMMIT되어 일부 쿼리에만 반영되는
    // 경우) today/festival/daily/byMenu 숫자가 서로 어긋날 수 있다. 하나의
    // REPEATABLE READ READ ONLY 트랜잭션(sales-snapshot.ts) 안에서 실행해 같은
    // 스냅샷을 보장한다(003_백엔드2_운영실시간.md §24-1).
    return this.database.withTransaction((client) =>
      this.buildSalesView(client, now, todayDate, todayRange, festivalRange),
    );
  }

  private async buildSalesView(
    client: PoolClient,
    now: Date,
    todayDate: string,
    todayRange: DateRange,
    festivalRange: DateRange,
  ): Promise<SalesView> {
    await useRepeatableReadSnapshot(client);

    // 아래 쿼리들은 모두 같은 PoolClient(하나의 물리 커넥션)를 쓴다. pg는 같은
    // client에 대한 중첩 query() 호출을 향후 버전(pg@9)에서 제거할 예정이라고
    // 경고하므로(client.query()는 프로토콜상 어차피 한 번에 하나씩만 처리되어
    // Promise.all로 묶어도 실제로 동시에 실행되지는 않는다), Promise.all로 묶지
    // 않고 순서대로 await한다.
    const todayTotals = await this.salesRepository.getTotals(client, todayRange);
    const festivalTotals = await this.salesRepository.getTotals(client, festivalRange);
    const dailyRows = await this.salesRepository.getDailyBreakdown(client, festivalRange);
    const byMenuToday = await this.salesRepository.getByMenu(client, todayRange);
    const byMenuFestival = await this.salesRepository.getByMenu(client, festivalRange);

    const todayRefundedAmount = await this.refundAggregationService.getRefundedAmount(
      client,
      todayRange,
    );
    const festivalRefundedAmount = await this.refundAggregationService.getRefundedAmount(
      client,
      festivalRange,
    );
    const dailyRefundedAmounts: number[] = [];
    for (const row of dailyRows) {
      dailyRefundedAmounts.push(
        await this.refundAggregationService.getRefundedAmount(
          client,
          kstDateStringToRange(row.date),
        ),
      );
    }

    return {
      timezone: 'Asia/Seoul',
      basis: 'payment_confirmed_at',
      asOf: now.toISOString(),
      festivalPeriod: {
        from: festivalRange.from.toISOString(),
        to: festivalRange.to.toISOString(),
      },
      today: {
        date: todayDate,
        quantity: todayTotals.quantity,
        amount: todayTotals.amount,
        refundedAmount: todayRefundedAmount,
      },
      festival: {
        quantity: festivalTotals.quantity,
        amount: festivalTotals.amount,
        refundedAmount: festivalRefundedAmount,
      },
      daily: dailyRows.map((row, index) => ({
        date: row.date,
        quantity: row.quantity,
        amount: row.amount,
        refundedAmount: dailyRefundedAmounts[index],
      })),
      byMenu: {
        today: byMenuToday,
        festival: byMenuFestival,
      },
    };
  }

  /**
   * `FESTIVAL_START_AT`/`FESTIVAL_END_AT`은 KST 기준 축제 운영 날짜
   * (`YYYY-MM-DD`, 둘 다 포함/inclusive)이며, 형식·의미(시작<=종료) 검증은
   * 서버 부팅 시점에 `config/env.validation.ts`가 이미 수행한다(다른 필수
   * 환경변수와 동일한 fail-fast 원칙) — 정상적으로 부팅된 서버라면 여기서
   * 다시 그 형식 오류를 만날 일이 없다. 종료일의 다음날 KST 자정을 배타적
   * 상한으로 사용한다(`kstDateStringToRange(end).to`).
   *
   * 그래도 값 자체가 비어 있는 경우(예: 테스트에서 ConfigService를 직접
   * mock한 경우)까지 방어적으로 막는다 — 조용히 기본값으로 대체하지 않는다.
   */
  private resolveFestivalPeriod(): DateRange {
    const start = this.configService.get<string>('FESTIVAL_START_AT');
    const end = this.configService.get<string>('FESTIVAL_END_AT');

    if (!start || !end) {
      throw new Error(
        'FESTIVAL_START_AT/FESTIVAL_END_AT이 설정되지 않았습니다. 정상적으로 ' +
          '부팅된 서버라면 여기 도달하지 않아야 합니다(config/env.validation.ts 참고).',
      );
    }

    return {
      from: kstDateStringToRange(start).from,
      to: kstDateStringToRange(end).to,
    };
  }
}

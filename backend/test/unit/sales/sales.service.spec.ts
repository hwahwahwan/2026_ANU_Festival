import { ConfigService } from '@nestjs/config';
import { SalesService } from '../../../src/sales/sales.service';
import { SalesRepository } from '../../../src/sales/sales.repository';
import { RefundAggregationService } from '../../../src/sales/refund-aggregation.service';
import { AdminAuthService } from '../../../src/admin-auth/admin-auth.service';
import { DatabaseService } from '../../../src/database/database.service';
import { ApiException } from '../../../src/common/filters/api.exception';
import { ERROR_CODE } from '../../../src/common/contracts/api-error';

const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
const PASSWORD = 'correct-password';
const FAKE_CLIENT = { query: jest.fn().mockResolvedValue(undefined) };

function createHarness(
  festivalEnv: Record<string, string | undefined> = {
    FESTIVAL_START_AT: '2026-09-18',
    FESTIVAL_END_AT: '2026-09-21',
  },
) {
  FAKE_CLIENT.query.mockClear();

  const adminAuthService = {
    verifyAdminPassword: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<AdminAuthService>;

  const database = {
    withTransaction: jest.fn((work: (client: unknown) => Promise<unknown>) =>
      work(FAKE_CLIENT),
    ),
  } as unknown as jest.Mocked<DatabaseService>;

  const salesRepository = {
    getTotals: jest.fn().mockResolvedValue({ quantity: 0, amount: 0 }),
    getDailyBreakdown: jest.fn().mockResolvedValue([]),
    getByMenu: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<SalesRepository>;

  const refundAggregationService = {
    getRefundedAmount: jest.fn().mockResolvedValue(0),
  } as unknown as jest.Mocked<RefundAggregationService>;

  const configService = {
    get: jest.fn((key: string) => festivalEnv[key]),
  } as unknown as jest.Mocked<ConfigService>;

  const service = new SalesService(
    adminAuthService,
    database,
    salesRepository,
    refundAggregationService,
    configService,
  );

  return {
    service,
    adminAuthService,
    database,
    salesRepository,
    refundAggregationService,
    configService,
  };
}

describe('SalesService.query — 비밀번호 재검증', () => {
  it('비밀번호가 틀리면 SALES_PASSWORD_INVALID(403)를 던지고 통계를 조회하지 않는다', async () => {
    const { service, adminAuthService, database } = createHarness();
    adminAuthService.verifyAdminPassword.mockResolvedValue(false);

    await expect(service.query(ADMIN_ID, 'wrong')).rejects.toMatchObject(
      new ApiException(ERROR_CODE.SALES_PASSWORD_INVALID, '비밀번호가 일치하지 않습니다.'),
    );
    expect(database.withTransaction).not.toHaveBeenCalled();
  });

  it('요청 바디가 아니라 AdminGuard로 얻은 adminId로 검증한다', async () => {
    const { service, adminAuthService } = createHarness();

    await service.query(ADMIN_ID, PASSWORD);

    expect(adminAuthService.verifyAdminPassword).toHaveBeenCalledWith(
      ADMIN_ID,
      PASSWORD,
    );
  });
});

describe('SalesService.query — FESTIVAL_START_AT/END_AT 방어', () => {
  // 형식/의미(YYYY-MM-DD, 시작<=종료) 검증 자체는 서버 부팅 시점에
  // config/env.validation.ts가 담당한다(test/unit/config/env.validation.spec.ts
  // 참고). 여기서는 정상 부팅되지 않았을 극단적인 상황(예: 테스트가
  // ConfigService를 직접 mock)에 대한 방어만 검증한다.
  it.each([
    ['둘 다 비어있음', { FESTIVAL_START_AT: undefined, FESTIVAL_END_AT: undefined }],
    ['시작만 비어있음', { FESTIVAL_START_AT: undefined, FESTIVAL_END_AT: '2026-09-21' }],
  ])('%s이면 조용히 기본값으로 넘어가지 않고 에러를 던진다', async (_label, env) => {
    const { service } = createHarness(env);

    await expect(service.query(ADMIN_ID, PASSWORD)).rejects.toThrow();
  });
});

describe('SalesService.query — 스냅샷 일관성(트랜잭션)', () => {
  it('전체 조회를 하나의 withTransaction으로 감싼다', async () => {
    const { service, database } = createHarness();

    await service.query(ADMIN_ID, PASSWORD);

    expect(database.withTransaction).toHaveBeenCalledTimes(1);
  });

  it('트랜잭션의 첫 문장으로 REPEATABLE READ READ ONLY를 설정한다', async () => {
    const { service } = createHarness();

    await service.query(ADMIN_ID, PASSWORD);

    expect(FAKE_CLIENT.query.mock.calls[0][0]).toBe(
      'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY',
    );
  });

  it('모든 Repository/RefundAggregation 호출이 같은 트랜잭션 client를 사용한다', async () => {
    const { service, salesRepository, refundAggregationService } = createHarness();

    await service.query(ADMIN_ID, PASSWORD);

    for (const call of salesRepository.getTotals.mock.calls) {
      expect(call[0]).toBe(FAKE_CLIENT);
    }
    for (const call of salesRepository.getDailyBreakdown.mock.calls) {
      expect(call[0]).toBe(FAKE_CLIENT);
    }
    for (const call of salesRepository.getByMenu.mock.calls) {
      expect(call[0]).toBe(FAKE_CLIENT);
    }
    for (const call of refundAggregationService.getRefundedAmount.mock.calls) {
      expect(call[0]).toBe(FAKE_CLIENT);
    }
  });
});

describe('SalesService.query — 정상 조회', () => {
  it('festivalPeriod를 FESTIVAL_START_AT/END_AT(종료일 다음날 자정을 배타적 상한)으로 계산해 반환한다', async () => {
    const { service } = createHarness();

    const result = await service.query(ADMIN_ID, PASSWORD);

    expect(result.timezone).toBe('Asia/Seoul');
    expect(result.basis).toBe('payment_confirmed_at');
    expect(result.festivalPeriod).toEqual({
      from: new Date('2026-09-18T00:00:00+09:00').toISOString(),
      to: new Date('2026-09-22T00:00:00+09:00').toISOString(), // 종료일(9/21) 다음날 자정
    });
  });

  it('today/festival 조회 범위로 Repository를 호출하고 결과를 그대로 합성한다', async () => {
    const { service, salesRepository, refundAggregationService } = createHarness();
    salesRepository.getTotals
      .mockResolvedValueOnce({ quantity: 3, amount: 10500 }) // today
      .mockResolvedValueOnce({ quantity: 12, amount: 42000 }); // festival
    salesRepository.getDailyBreakdown.mockResolvedValue([
      { date: '2026-09-18', quantity: 12, amount: 42000 },
    ]);
    salesRepository.getByMenu
      .mockResolvedValueOnce([
        { menuId: 'm1', menuName: '크로플', quantity: 3, amount: 10500 },
      ])
      .mockResolvedValueOnce([
        { menuId: 'm1', menuName: '크로플', quantity: 12, amount: 42000 },
      ]);
    refundAggregationService.getRefundedAmount.mockResolvedValue(0);

    const result = await service.query(ADMIN_ID, PASSWORD);

    expect(result.today).toEqual({
      date: expect.any(String),
      quantity: 3,
      amount: 10500,
      refundedAmount: 0,
    });
    expect(result.festival).toEqual({
      quantity: 12,
      amount: 42000,
      refundedAmount: 0,
    });
    expect(result.daily).toEqual([
      { date: '2026-09-18', quantity: 12, amount: 42000, refundedAmount: 0 },
    ]);
    expect(result.byMenu.today).toEqual([
      { menuId: 'm1', menuName: '크로플', quantity: 3, amount: 10500 },
    ]);
    expect(result.byMenu.festival).toEqual([
      { menuId: 'm1', menuName: '크로플', quantity: 12, amount: 42000 },
    ]);
    // byMenu 항목에는 refundedAmount가 없어야 한다(정책 확정).
    expect(result.byMenu.today[0]).not.toHaveProperty('refundedAmount');
    expect(result.byMenu.festival[0]).not.toHaveProperty('refundedAmount');
  });

  it('daily의 각 날짜 범위로 RefundAggregationService를 호출한다(향후 실제 환불 연동 대비 계약 고정)', async () => {
    const { service, salesRepository, refundAggregationService } = createHarness();
    salesRepository.getDailyBreakdown.mockResolvedValue([
      { date: '2026-09-18', quantity: 1, amount: 3500 },
      { date: '2026-09-19', quantity: 2, amount: 7000 },
    ]);

    await service.query(ADMIN_ID, PASSWORD);

    const calledRanges = refundAggregationService.getRefundedAmount.mock.calls.map(
      ([, range]) => range,
    );
    expect(calledRanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: expect.any(Date), to: expect.any(Date) }),
      ]),
    );
    // today + festival + 2일치 daily = 4번 호출
    expect(refundAggregationService.getRefundedAmount).toHaveBeenCalledTimes(4);
  });
});

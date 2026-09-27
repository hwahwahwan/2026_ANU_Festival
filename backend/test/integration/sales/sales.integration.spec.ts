import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import {
  kstDateStringToRange,
  toKstDateString,
} from '../../../src/common/kst-date.util';
import { configureApp } from '../../../src/common/configure-app';
import { ADMIN_COOKIE_NAME } from '../../../src/admin-auth/admin-cookie';
import { AdminAuthModule } from '../../../src/admin-auth/admin-auth.module';
import { DatabaseService } from '../../../src/database/database.service';
import { SalesRepository } from '../../../src/sales/sales.repository';
import { useRepeatableReadSnapshot } from '../../../src/sales/sales-snapshot';
import { SalesThrottlerGuard } from '../../../src/sales/sales-throttler.guard';

/**
 * `FESTIVAL_START_AT`/`FESTIVAL_END_AT`(KST 달력 날짜 `YYYY-MM-DD`, 둘 다
 * inclusive)은 실제 값이 아직 정해지지 않은(00_전체요약.md "현재 미정") 배포
 * 시점 설정값이다. 이 테스트는 실행 날짜와 무관하게 항상 "오늘"을 포함하도록
 * 아주 넓은 범위로 직접 override한다. `config/env.validation.ts`가 이제 이
 * 두 값을 서버 부팅 시점에 필수로 검증하므로(형식이 다르면 앱 자체가 뜨지
 * 않는다), AppModule을 compile()하기 전(=ConfigModule이 실제로 값을 읽기 전)에
 * 반드시 이 형식(YYYY-MM-DD)으로 설정해야 한다.
 */
process.env.FESTIVAL_START_AT = '2000-01-01';
process.env.FESTIVAL_END_AT = '2099-12-31';

// AppModule을 위 env 설정 이후에 import(정확히는 컴파일)해야 하므로 동적으로 가져온다.
// eslint 스타일보다 "ConfigModule이 값을 읽기 전에 env를 설정한다"는 순서 보장이 우선이다.
import { AppModule } from '../../../src/app.module';

const TEST_ADMIN_USERNAME = '_sales_integration_test_admin';
const TEST_ADMIN_PASSWORD = 'sales-integration-test-password';
// 이 값으로 만든 주문만 "이 테스트가 만든 데이터"로 식별한다(아래 cleanupOwnOrders 참고).
const TEST_CUSTOMER_NAME = '_sales_integration_test_customer';
const NOT_TODAY_KST_DATE = '2020-06-15';
const MENU_ID_CROFFLE = '10000000-0000-0000-0000-000000000001';
const MENU_ID_LATTE = '10000000-0000-0000-0000-000000000002';

interface CreateOrderFixture {
  paymentConfirmedAt: Date | null;
  status: 'PAYMENT_PENDING' | 'ACCEPTED' | 'COMPLETED' | 'CANCELLED';
  totalPrice: number;
  items: { menuId: string; menuName: string; unitPrice: number; quantity: number }[];
}

describe('Sales (실제 PostgreSQL integration)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
  let salesRepository: SalesRepository;
  let adminId: string;
  let adminCookie: string;
  const createdOrderIds: string[] = [];

  /**
   * 이 파일은 로컬 공유 개발 DB(`festival`)에 대해 돈다(다른 통합 테스트와
   * 동일한 한계 — `payment-settings.integration.spec.ts` 주석 참고). 다른
   * 통합 테스트 파일은 `payment_confirmed_at`을 채우지 않으므로 평소에는
   * 섞이지 않지만(코드베이스 전체 `grep` 확인됨), 이 파일이 비정상 종료되어
   * `afterEach`가 돌지 못하면 이전 실행의 주문이 남을 수 있다. 절대값(0 등)을
   * 단언하기 전에 항상 `TEST_CUSTOMER_NAME`으로 표시된 이 테스트 소유 데이터만
   * 정리해서, 그런 잔여 데이터가 있어도 각 테스트가 독립적으로 성립하게 한다.
   */
  async function cleanupOwnOrders(): Promise<void> {
    await databaseService.query(
      `DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE customer_name = $1)`,
      [TEST_CUSTOMER_NAME],
    );
    await databaseService.query('DELETE FROM orders WHERE customer_name = $1', [
      TEST_CUSTOMER_NAME,
    ]);
  }

  beforeAll(async () => {
    // 이 파일은 aggregation 정확성(오늘/축제/일자별/메뉴별/KST 경계 등)을
    // 검증하는 게 목적이라 `/admin/sales/query`를 [1]~[10]에서 여러 번 호출한다.
    // rate limit(SalesThrottlerGuard) 자체의 동작(429, adminId 기준 tracker)은
    // `sales-rate-limit.integration.spec.ts`가 별도 AppModule로 전담하고
    // 있으므로, 여기서는 그 Guard를 항상 통과시켜 우연히 60초 10회 한도에
    // 걸려 무관한 테스트가 flaky해지는 것을 막는다(AdminGuard는 그대로 둔다 —
    // 인증 자체는 [1]에서 계속 검증한다).
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(SalesThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    databaseService = moduleFixture.get(DatabaseService);
    salesRepository = moduleFixture.get(SalesRepository);

    await cleanupOwnOrders();

    const passwordHash = await argon2.hash(TEST_ADMIN_PASSWORD);
    const adminResult = await databaseService.query<{ id: string }>(
      `INSERT INTO admins (username, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [TEST_ADMIN_USERNAME, passwordHash],
    );
    adminId = adminResult.rows[0].id;

    const jwtService = moduleFixture.select(AdminAuthModule).get(JwtService);
    adminCookie = `${ADMIN_COOKIE_NAME}=${jwtService.sign({ sub: adminId, jti: randomUUID() })}`;
  });

  afterEach(async () => {
    if (createdOrderIds.length === 0) {
      return;
    }
    await databaseService.query(
      `DELETE FROM order_items WHERE order_id = ANY($1::uuid[])`,
      [createdOrderIds],
    );
    await databaseService.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [
      createdOrderIds,
    ]);
    createdOrderIds.length = 0;
  });

  afterAll(async () => {
    await cleanupOwnOrders();
    await databaseService.query('DELETE FROM admins WHERE username = $1', [
      TEST_ADMIN_USERNAME,
    ]);
    await app.close();
  });

  async function createOrder(fixture: CreateOrderFixture): Promise<string> {
    return databaseService.withTransaction(async (client) => {
      const orderNumber = `TEST-${randomUUID().slice(0, 8)}`;
      const orderResult = await client.query<{ id: string }>(
        `INSERT INTO orders
           (order_number, order_request_id, customer_name, customer_phone, status, total_price, payment_confirmed_at)
         VALUES ($1, $2, $6, '010-0000-0000', $3, $4, $5)
         RETURNING id`,
        [
          orderNumber,
          randomUUID(),
          fixture.status,
          fixture.totalPrice,
          fixture.paymentConfirmedAt,
          TEST_CUSTOMER_NAME,
        ],
      );
      const orderId = orderResult.rows[0].id;
      createdOrderIds.push(orderId);

      for (const item of fixture.items) {
        await client.query(
          `INSERT INTO order_items (order_id, menu_id, menu_name, unit_price, quantity)
           VALUES ($1, $2, $3, $4, $5)`,
          [orderId, item.menuId, item.menuName, item.unitPrice, item.quantity],
        );
      }

      return orderId;
    });
  }

  describe('인증/입력 검증', () => {
    it('[1] 관리자 Cookie 없이 요청하면 401 ADMIN_UNAUTHORIZED', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/sales/query')
        .send({ password: TEST_ADMIN_PASSWORD });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('ADMIN_UNAUTHORIZED');
    });

    it('[2] password 없이 요청하면 400 VALIDATION_ERROR', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/sales/query')
        .set('Cookie', [adminCookie])
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('[3] 허용되지 않은 필드를 보내면 400 VALIDATION_ERROR', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/sales/query')
        .set('Cookie', [adminCookie])
        .send({ password: TEST_ADMIN_PASSWORD, adminId: 'hacked-admin-id' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('[4] 비밀번호가 틀리면 403 SALES_PASSWORD_INVALID', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/sales/query')
        .set('Cookie', [adminCookie])
        .send({ password: 'wrong-password' });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('SALES_PASSWORD_INVALID');
    });
  });

  describe('매출 집계', () => {
    // [6]~[8]은 "createOrder 전/후" 차이를 비교하는 delta 방식이다(절대값 0을
    // 가정하지 않아 다른 잔여 데이터가 있어도 안전하다 — 위 cleanupOwnOrders
    // 주석 참고). before/after 모두 실제 HTTP 요청으로 확인한다 — 위
    // beforeAll에서 SalesThrottlerGuard를 우회해 두었으므로 rate limit 예산을
    // 신경 쓸 필요가 없다(rate limit 자체는 sales-rate-limit.integration.spec.ts가
    // 검증).
    async function query(): Promise<request.Response> {
      return request(app.getHttpServer())
        .post('/admin/sales/query')
        .set('Cookie', [adminCookie])
        .send({ password: TEST_ADMIN_PASSWORD });
    }

    it('[5] 기본 응답 스키마(timezone/basis/festivalPeriod)가 계약대로 반환된다', async () => {
      await cleanupOwnOrders();

      const response = await query();

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        timezone: 'Asia/Seoul',
        basis: 'payment_confirmed_at',
      });
      // FESTIVAL_END_AT(2099-12-31) 다음날 KST 자정이 배타적 상한이다.
      expect(response.body.festivalPeriod).toEqual({
        from: kstDateStringToRange('2000-01-01').from.toISOString(),
        to: kstDateStringToRange('2099-12-31').to.toISOString(), // 종료일(12/31) 다음날 자정
      });
    });

    it('[6] PAYMENT_PENDING(입금 미확인) 주문은 today/festival 집계에서 제외된다', async () => {
      const before = (await query()).body;

      await createOrder({
        paymentConfirmedAt: null,
        status: 'PAYMENT_PENDING',
        totalPrice: 3500,
        items: [
          { menuId: MENU_ID_CROFFLE, menuName: '크로플', unitPrice: 3500, quantity: 1 },
        ],
      });

      const after = await query();

      expect(after.status).toBe(200);
      expect(after.body.today).toMatchObject(before.today);
      expect(after.body.festival).toMatchObject(before.festival);
    });

    it('[7] 오늘 입금 확인된 주문은 today와 festival 통계에 모두 반영되고 byMenu.today에 스냅샷 메뉴명으로 집계된다', async () => {
      const before = (await query()).body;

      const now = new Date();
      await createOrder({
        paymentConfirmedAt: now,
        status: 'ACCEPTED',
        totalPrice: 10500,
        items: [
          { menuId: MENU_ID_CROFFLE, menuName: '크로플', unitPrice: 3500, quantity: 2 },
          { menuId: MENU_ID_LATTE, menuName: '아이스라떼', unitPrice: 3500, quantity: 1 },
        ],
      });

      const response = await query();

      expect(response.status).toBe(200);
      expect(response.body.today).toMatchObject({
        date: toKstDateString(now),
        quantity: before.today.quantity + 3,
        amount: before.today.amount + 10500,
        refundedAmount: 0,
      });
      expect(response.body.festival).toMatchObject({
        quantity: before.festival.quantity + 3,
        amount: before.festival.amount + 10500,
        refundedAmount: 0,
      });
      expect(response.body.byMenu.today).toEqual(
        expect.arrayContaining([
          { menuId: MENU_ID_CROFFLE, menuName: '크로플', quantity: 2, amount: 7000 },
          { menuId: MENU_ID_LATTE, menuName: '아이스라떼', quantity: 1, amount: 3500 },
        ]),
      );
      expect(response.body.byMenu.today[0]).not.toHaveProperty('refundedAmount');
      expect(response.body.daily).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ date: toKstDateString(now) }),
        ]),
      );
    });

    it('[8] 오늘이 아닌 과거 날짜에 입금 확인된 주문은 festival/daily에는 포함되지만 today에는 포함되지 않는다', async () => {
      const before = (await query()).body;

      const pastRange = kstDateStringToRange(NOT_TODAY_KST_DATE);
      // 그 날짜의 KST 정오 시각(경계값 회귀 방지를 위해 자정에 걸치지 않는 값 사용).
      const paymentConfirmedAt = new Date(pastRange.from.getTime() + 12 * 60 * 60 * 1000);

      await createOrder({
        paymentConfirmedAt,
        status: 'COMPLETED',
        totalPrice: 4000,
        items: [
          { menuId: MENU_ID_LATTE, menuName: '아이스라떼', unitPrice: 4000, quantity: 1 },
        ],
      });

      const response = await query();

      expect(response.status).toBe(200);
      expect(response.body.today).toMatchObject(before.today);
      expect(response.body.festival).toMatchObject({
        quantity: before.festival.quantity + 1,
        amount: before.festival.amount + 4000,
      });
      expect(response.body.daily).toEqual(
        expect.arrayContaining([
          { date: NOT_TODAY_KST_DATE, quantity: 1, amount: 4000, refundedAmount: 0 },
        ]),
      );
      // 과거 날짜 주문은 오늘자 byMenu에는 나타나지 않는다.
      expect(response.body.byMenu.today).toEqual(before.byMenu.today);
      expect(response.body.byMenu.festival).toEqual(
        expect.arrayContaining([
          { menuId: MENU_ID_LATTE, menuName: '아이스라떼', quantity: 1, amount: 4000 },
        ]),
      );
    });

    it('[9] KST 자정 경계값 — 23:59:59는 전날, 00:00:00은 다음날 daily 버킷으로 집계된다', async () => {
      const dayBoundary = kstDateStringToRange(NOT_TODAY_KST_DATE);
      const justBeforeMidnight = new Date(dayBoundary.to.getTime() - 1000); // 전날 23:59:59 KST
      const exactlyMidnight = dayBoundary.to; // 다음날 00:00:00 KST
      const nextDate = toKstDateString(exactlyMidnight);

      await createOrder({
        paymentConfirmedAt: justBeforeMidnight,
        status: 'COMPLETED',
        totalPrice: 1000,
        items: [{ menuId: MENU_ID_CROFFLE, menuName: '크로플', unitPrice: 1000, quantity: 1 }],
      });
      await createOrder({
        paymentConfirmedAt: exactlyMidnight,
        status: 'COMPLETED',
        totalPrice: 2000,
        items: [{ menuId: MENU_ID_CROFFLE, menuName: '크로플', unitPrice: 2000, quantity: 1 }],
      });

      const response = await request(app.getHttpServer())
        .post('/admin/sales/query')
        .set('Cookie', [adminCookie])
        .send({ password: TEST_ADMIN_PASSWORD });

      expect(response.status).toBe(200);
      expect(response.body.daily).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ date: NOT_TODAY_KST_DATE, quantity: 1, amount: 1000 }),
          expect.objectContaining({ date: nextDate, quantity: 1, amount: 2000 }),
        ]),
      );
    });

    it('[10] 환불 처리 기능이 아직 없으므로(order_refunds 미구현) today/festival/daily의 refundedAmount는 데이터 유무와 무관하게 항상 0이다', async () => {
      await createOrder({
        paymentConfirmedAt: new Date(),
        status: 'COMPLETED',
        totalPrice: 5000,
        items: [{ menuId: MENU_ID_CROFFLE, menuName: '크로플', unitPrice: 5000, quantity: 1 }],
      });

      const response = await request(app.getHttpServer())
        .post('/admin/sales/query')
        .set('Cookie', [adminCookie])
        .send({ password: TEST_ADMIN_PASSWORD });

      expect(response.status).toBe(200);
      expect(response.body.today.refundedAmount).toBe(0);
      expect(response.body.festival.refundedAmount).toBe(0);
      for (const day of response.body.daily) {
        expect(day.refundedAmount).toBe(0);
      }
    });
  });

  describe('집계 일관성 (REPEATABLE READ 스냅샷)', () => {
    it('[11] 같은 트랜잭션 안에서는 첫 쿼리 이후 다른 트랜잭션이 커밋한 변경이 보이지 않고, 새 트랜잭션에서는 보인다', async () => {
      const wideRange = {
        from: kstDateStringToRange('2000-01-01').from,
        to: kstDateStringToRange('2099-12-31').to,
      };

      const { before, after } = await databaseService.withTransaction(async (client) => {
        await useRepeatableReadSnapshot(client);
        const before = await salesRepository.getTotals(client, wideRange);

        // 트랜잭션 A가 열려 있는 동안 "다른 커넥션"에서 새 주문을 커밋한다.
        await createOrder({
          paymentConfirmedAt: new Date(),
          status: 'COMPLETED',
          totalPrice: 1234,
          items: [
            { menuId: MENU_ID_CROFFLE, menuName: '크로플', unitPrice: 1234, quantity: 1 },
          ],
        });

        const after = await salesRepository.getTotals(client, wideRange);
        return { before, after };
      });

      // REPEATABLE READ 트랜잭션은 첫 쿼리 시점 스냅샷을 트랜잭션이 끝날 때까지 고정한다.
      expect(after).toEqual(before);

      // 트랜잭션이 끝난 뒤 새로 연 트랜잭션에서는 방금 커밋된 주문이 보인다.
      const afterCommit = await databaseService.withTransaction(async (client) => {
        await useRepeatableReadSnapshot(client);
        return salesRepository.getTotals(client, wideRange);
      });
      expect(afterCommit.quantity).toBe(before.quantity + 1);
      expect(afterCommit.amount).toBe(before.amount + 1234);
    });

    it('[12] 트랜잭션은 READ ONLY이므로 쓰기를 시도하면 거부된다(격리 수준이 실제로 적용됐는지 확인)', async () => {
      await expect(
        databaseService.withTransaction(async (client) => {
          await useRepeatableReadSnapshot(client);
          await client.query(
            `INSERT INTO orders (order_number, order_request_id, customer_name, customer_phone, total_price)
             VALUES ('SHOULD-NOT-INSERT', gen_random_uuid(), $1, '010-0000-0000', 1000)`,
            [TEST_CUSTOMER_NAME],
          );
        }),
      ).rejects.toMatchObject({ code: '25006' }); // read_only_sql_transaction
    });
  });
});

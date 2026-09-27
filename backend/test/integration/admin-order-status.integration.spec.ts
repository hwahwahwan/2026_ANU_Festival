import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/common/configure-app';
import { ADMIN_COOKIE_NAME } from '../../src/admin-auth/admin-cookie';
import { AdminAuthModule } from '../../src/admin-auth/admin-auth.module';
import { DatabaseService } from '../../src/database/database.service';

/**
 * 입금 확인 / 상태 변경 / History 조회 (실제 PostgreSQL + 실제 AdminGuard).
 * §17~§21, §2-2 payment-confirmation·status·history 계약을 검증한다.
 */
const TEST_MENU_NAME_PREFIX = '_admin_order_status_it_';

describe('주문 상태 변경 + OrderHistory (실제 PostgreSQL)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
  let adminId: string;
  let adminCookie: string;
  const createdMenuIds: string[] = [];
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    databaseService = moduleFixture.get(DatabaseService);

    const jwtService = moduleFixture.select(AdminAuthModule).get(JwtService);
    adminId = randomUUID();
    adminCookie = `${ADMIN_COOKIE_NAME}=${jwtService.sign({ sub: adminId, jti: randomUUID() })}`;

    await databaseService.query('DELETE FROM menus WHERE name LIKE $1', [
      `${TEST_MENU_NAME_PREFIX}%`,
    ]);
  });

  afterEach(async () => {
    if (createdOrderIds.length > 0) {
      await databaseService.query(
        'DELETE FROM order_history WHERE order_id = ANY($1::uuid[])',
        [createdOrderIds],
      );
      await databaseService.query(
        'DELETE FROM order_items WHERE order_id = ANY($1::uuid[])',
        [createdOrderIds],
      );
      await databaseService.query('DELETE FROM orders WHERE id = ANY($1::uuid[])', [
        createdOrderIds,
      ]);
      createdOrderIds.length = 0;
    }
    if (createdMenuIds.length > 0) {
      await databaseService.query('DELETE FROM menus WHERE id = ANY($1::uuid[])', [
        createdMenuIds,
      ]);
      createdMenuIds.length = 0;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  async function insertMenu(price = 3500): Promise<string> {
    const result = await databaseService.query<{ id: string }>(
      `INSERT INTO menus (name, price, is_available) VALUES ($1, $2, true) RETURNING id`,
      [`${TEST_MENU_NAME_PREFIX}${randomUUID()}`, price],
    );
    const id = result.rows[0].id;
    createdMenuIds.push(id);
    return id;
  }

  async function createOrder(): Promise<string> {
    const menuId = await insertMenu();
    const response = await request(app.getHttpServer())
      .post('/orders')
      .send({
        orderRequestId: randomUUID(),
        customerName: '홍길동',
        customerPhone: '010-1234-5678',
        items: [{ menuId, quantity: 1 }],
      });
    createdOrderIds.push(response.body.id);
    return response.body.id;
  }

  function confirmPayment(orderId: string) {
    return request(app.getHttpServer())
      .post(`/admin/orders/${orderId}/payment-confirmation`)
      .set('Cookie', adminCookie);
  }

  function changeStatus(orderId: string, status: string) {
    return request(app.getHttpServer())
      .patch(`/admin/orders/${orderId}/status`)
      .set('Cookie', adminCookie)
      .send({ status });
  }

  function getHistory(orderId: string) {
    return request(app.getHttpServer())
      .get(`/admin/orders/${orderId}/history`)
      .set('Cookie', adminCookie);
  }

  function cancel(orderId: string) {
    return request(app.getHttpServer())
      .post(`/admin/orders/${orderId}/cancel`)
      .set('Cookie', adminCookie);
  }

  describe('POST /admin/orders/:orderId/payment-confirmation', () => {
    it('[1] 관리자 Cookie 없이 요청하면 401을 반환한다', async () => {
      const orderId = await createOrder();

      const response = await request(app.getHttpServer()).post(
        `/admin/orders/${orderId}/payment-confirmation`,
      );

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('ADMIN_UNAUTHORIZED');
    });

    it('[2] PAYMENT_PENDING 주문을 ACCEPTED로 전환하고 payment_confirmed_at을 기록한다', async () => {
      const orderId = await createOrder();

      const response = await confirmPayment(orderId);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: orderId,
        status: 'ACCEPTED',
        customerPhone: '010-1234-5678',
      });
      expect(response.body.paymentConfirmedAt).not.toBeNull();
    });

    it('[3] 이미 ACCEPTED인 주문을 다시 확인하면 409 ORDER_STATE_CONFLICT를 반환한다', async () => {
      const orderId = await createOrder();
      await confirmPayment(orderId);

      const second = await confirmPayment(orderId);

      expect(second.status).toBe(409);
      expect(second.body.code).toBe('ORDER_STATE_CONFLICT');
    });

    it('[4] 존재하지 않는 orderId면 404 ORDER_NOT_FOUND를 반환한다', async () => {
      const response = await confirmPayment('00000000-0000-4000-8000-000000000000');

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('ORDER_NOT_FOUND');
    });

    it('[5] 동시에 두 번 입금 확인을 요청해도 하나만 성공하고 다른 하나는 409를 받는다', async () => {
      const orderId = await createOrder();

      const [first, second] = await Promise.all([
        confirmPayment(orderId),
        confirmPayment(orderId),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 409]);

      const countResult = await databaseService.query<{ count: string }>(
        `SELECT COUNT(*) FROM order_history WHERE order_id = $1 AND action = 'PAYMENT_CONFIRMED'`,
        [orderId],
      );
      expect(countResult.rows[0].count).toBe('1');
    });
  });

  describe('PATCH /admin/orders/:orderId/status', () => {
    it('[6] ACCEPTED → COOKING → READY → COMPLETED 순서로 정상 전이된다', async () => {
      const orderId = await createOrder();
      await confirmPayment(orderId);

      const cooking = await changeStatus(orderId, 'COOKING');
      expect(cooking.status).toBe(200);
      expect(cooking.body.status).toBe('COOKING');

      const ready = await changeStatus(orderId, 'READY');
      expect(ready.status).toBe(200);
      expect(ready.body.status).toBe('READY');

      const completed = await changeStatus(orderId, 'COMPLETED');
      expect(completed.status).toBe(200);
      expect(completed.body.status).toBe('COMPLETED');
    });

    it('[6-1] COOKING/READY/COMPLETED로 전이해도 paymentConfirmedAt은 입금 확인 시점 값 그대로 유지된다', async () => {
      const orderId = await createOrder();
      const confirmed = await confirmPayment(orderId);
      const paymentConfirmedAt = confirmed.body.paymentConfirmedAt;
      expect(paymentConfirmedAt).not.toBeNull();

      const cooking = await changeStatus(orderId, 'COOKING');
      expect(cooking.body.paymentConfirmedAt).toBe(paymentConfirmedAt);

      const ready = await changeStatus(orderId, 'READY');
      expect(ready.body.paymentConfirmedAt).toBe(paymentConfirmedAt);

      const completed = await changeStatus(orderId, 'COMPLETED');
      expect(completed.body.paymentConfirmedAt).toBe(paymentConfirmedAt);
    });

    it('[7] 허용되지 않는 전이(ACCEPTED → READY)는 409를 반환한다', async () => {
      const orderId = await createOrder();
      await confirmPayment(orderId);

      const response = await changeStatus(orderId, 'READY');

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ORDER_STATE_CONFLICT');
    });

    it('[8] 일반 status PATCH로는 ACCEPTED를 만들 수 없다(입금 확인 API 전용)', async () => {
      const orderId = await createOrder();

      const response = await changeStatus(orderId, 'ACCEPTED');

      expect(response.status).toBe(400);
    });

    it('[9] 정의되지 않은 status 값은 400 VALIDATION_ERROR를 반환한다', async () => {
      const orderId = await createOrder();

      const response = await changeStatus(orderId, 'NOT_A_STATUS');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('[10] 존재하지 않는 orderId면 404를 반환한다', async () => {
      const response = await changeStatus(
        '00000000-0000-4000-8000-000000000000',
        'COOKING',
      );

      expect(response.status).toBe(404);
    });
  });

  describe('POST /admin/orders/:orderId/cancel', () => {
    it('[14] 관리자 Cookie 없이 요청하면 401을 반환한다', async () => {
      const orderId = await createOrder();

      const response = await request(app.getHttpServer()).post(
        `/admin/orders/${orderId}/cancel`,
      );

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('ADMIN_UNAUTHORIZED');
    });

    it('[15] PAYMENT_PENDING 주문을 CANCELLED로 전환한다', async () => {
      const orderId = await createOrder();

      const response = await cancel(orderId);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: orderId, status: 'CANCELLED' });
    });

    it('[16] 입금 확인된 주문은 취소할 수 없고 409를 반환한다(환불을 사용해야 함)', async () => {
      const orderId = await createOrder();
      await confirmPayment(orderId);

      const response = await cancel(orderId);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ORDER_STATE_CONFLICT');
    });

    it('[17] 존재하지 않는 orderId면 404를 반환한다', async () => {
      const response = await cancel('00000000-0000-4000-8000-000000000000');

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('ORDER_NOT_FOUND');
    });

    it('[18] §19: 입금 확인과 취소가 동시에 들어오면 하나만 성공하고 둘 다 성공하지는 않는다', async () => {
      const orderId = await createOrder();

      const [confirmed, cancelled] = await Promise.all([
        confirmPayment(orderId),
        cancel(orderId),
      ]);

      const statuses = [confirmed.status, cancelled.status].sort();
      expect(statuses).toEqual([200, 409]);

      const orderResult = await databaseService.query<{ status: string }>(
        'SELECT status FROM orders WHERE id = $1',
        [orderId],
      );
      expect(['ACCEPTED', 'CANCELLED']).toContain(orderResult.rows[0].status);

      const historyResult = await databaseService.query<{ action: string }>(
        `SELECT action FROM order_history WHERE order_id = $1 AND action IN ('PAYMENT_CONFIRMED', 'CANCELLED')`,
        [orderId],
      );
      expect(historyResult.rows).toHaveLength(1);
    });

    it('[19] 취소된 주문은 입금 확인/상태 변경 모두 409로 거절된다 (터미널 상태)', async () => {
      const orderId = await createOrder();
      await cancel(orderId);

      const confirmResult = await confirmPayment(orderId);
      const statusResult = await changeStatus(orderId, 'COOKING');
      const cancelAgainResult = await cancel(orderId);

      expect(confirmResult.status).toBe(409);
      expect(statusResult.status).toBe(409);
      expect(cancelAgainResult.status).toBe(409);
    });
  });

  describe('GET /admin/orders/:orderId/history', () => {
    it('[11] 생성부터 상태 변경까지 시간순으로 이력을 반환하고 actorId가 처리한 관리자와 일치한다', async () => {
      const orderId = await createOrder();
      await confirmPayment(orderId);
      await changeStatus(orderId, 'COOKING');

      const response = await getHistory(orderId);

      expect(response.status).toBe(200);
      expect(response.body.map((h: { action: string }) => h.action)).toEqual([
        'ORDER_CREATED',
        'PAYMENT_CONFIRMED',
        'COOKING_STARTED',
      ]);
      expect(response.body[0]).toMatchObject({
        actorType: 'CUSTOMER',
        actorId: null,
        fromStatus: null,
        toStatus: 'PAYMENT_PENDING',
      });
      expect(response.body[1]).toMatchObject({
        actorType: 'ADMIN',
        actorId: adminId,
        fromStatus: 'PAYMENT_PENDING',
        toStatus: 'ACCEPTED',
      });
      expect(response.body[2]).toMatchObject({
        actorType: 'ADMIN',
        actorId: adminId,
        fromStatus: 'ACCEPTED',
        toStatus: 'COOKING',
      });
    });

    it('[12] 존재하지 않는 orderId면 404를 반환한다', async () => {
      const response = await getHistory('00000000-0000-4000-8000-000000000000');

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('ORDER_NOT_FOUND');
    });

    it('[13] 관리자 Cookie 없이 요청하면 401을 반환한다', async () => {
      const orderId = await createOrder();

      const response = await request(app.getHttpServer()).get(
        `/admin/orders/${orderId}/history`,
      );

      expect(response.status).toBe(401);
    });
  });
});

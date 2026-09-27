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
import { OrderView } from '../../src/common/contracts/order-view';

/**
 * 개별 엔드포인트 계약은 각 도메인 통합 테스트에서 이미 검증했으므로, 여기서는
 * 여러 엔드포인트를 실제로 엮은 전체 흐름 / 동시 생성 / 거부 시 부작용 없음 /
 * 취소·환불 후 고객 조회 결과만 확인한다(Step 11).
 */
const TEST_MENU_NAME_PREFIX = '_order_lifecycle_it_';
const CONCURRENT_ORDER_COUNT = 5;
// MMDD-XXXX 형식상 실제로 발급될 수 없는 값이라, 존재하지 않는 주문번호로
// 항상 안전하게 쓸 수 있다.
const NON_EXISTENT_ORDER_NUMBER = '0000-0000';
// 이 값으로 만든 주문만 "이 테스트가 만든 데이터"로 식별한다(아래 beforeAll의
// 정리 참고). sales.integration.spec.ts의 TEST_CUSTOMER_NAME과 같은 이유다 —
// 이 파일도 confirmPayment로 payment_confirmed_at을 채우므로, 비정상 종료로
// afterEach가 돌지 못하면 다른 통합 테스트(특히 매출 집계)와 잔여 데이터가
// 섞이지 않도록 고유한 이름으로 구분해야 한다.
const TEST_CUSTOMER_NAME = '_order_lifecycle_it_customer';

describe('주문 전체 라이프사이클 (실제 PostgreSQL)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
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
    adminCookie = `${ADMIN_COOKIE_NAME}=${jwtService.sign({
      sub: randomUUID(),
      jti: randomUUID(),
    })}`;

    await databaseService.query('DELETE FROM menus WHERE starts_with(name, $1)', [
      TEST_MENU_NAME_PREFIX,
    ]);
    await cleanupOwnOrders();
  });

  afterEach(async () => {
    if (createdOrderIds.length > 0) {
      await databaseService.query(
        'DELETE FROM order_refunds WHERE order_id = ANY($1::uuid[])',
        [createdOrderIds],
      );
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
    await cleanupOwnOrders();
    await app.close();
  });

  async function cleanupOwnOrders(): Promise<void> {
    await databaseService.query(
      `DELETE FROM order_refunds WHERE order_id IN (SELECT id FROM orders WHERE customer_name = $1)`,
      [TEST_CUSTOMER_NAME],
    );
    await databaseService.query(
      `DELETE FROM order_history WHERE order_id IN (SELECT id FROM orders WHERE customer_name = $1)`,
      [TEST_CUSTOMER_NAME],
    );
    await databaseService.query(
      `DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE customer_name = $1)`,
      [TEST_CUSTOMER_NAME],
    );
    await databaseService.query('DELETE FROM orders WHERE customer_name = $1', [
      TEST_CUSTOMER_NAME,
    ]);
  }

  async function insertMenu(price = 3500): Promise<string> {
    const result = await databaseService.query<{ id: string }>(
      `INSERT INTO menus (name, price, is_available) VALUES ($1, $2, true) RETURNING id`,
      [`${TEST_MENU_NAME_PREFIX}${randomUUID()}`, price],
    );
    const id = result.rows[0].id;
    createdMenuIds.push(id);
    return id;
  }

  function postOrder(menuId: string, customerName = TEST_CUSTOMER_NAME) {
    return request(app.getHttpServer())
      .post('/orders')
      .send({
        orderRequestId: randomUUID(),
        customerName,
        customerPhone: '010-1234-5678',
        items: [{ menuId, quantity: 1 }],
      });
  }

  async function createOrder(customerName = TEST_CUSTOMER_NAME): Promise<OrderView> {
    const menuId = await insertMenu();
    const response = await postOrder(menuId, customerName);
    expect(response.status).toBe(201);
    createdOrderIds.push(response.body.id);
    return response.body;
  }

  function lookup(customerName: string, orderNumber: string) {
    return request(app.getHttpServer())
      .post('/orders/lookup')
      .send({ customerName, orderNumber });
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

  function cancelOrder(orderId: string) {
    return request(app.getHttpServer())
      .post(`/admin/orders/${orderId}/cancel`)
      .set('Cookie', adminCookie);
  }

  function refundOrder(orderId: string, body: { refundRequestId: string }) {
    return request(app.getHttpServer())
      .post(`/admin/orders/${orderId}/refunds`)
      .set('Cookie', adminCookie)
      .send(body);
  }

  // API 응답이 아니라 order_history 테이블의 실제 기록을 직접 확인한다.
  async function getHistoryActions(orderId: string): Promise<string[]> {
    const result = await databaseService.query<{ action: string }>(
      'SELECT action FROM order_history WHERE order_id = $1 ORDER BY occurred_at, id',
      [orderId],
    );
    return result.rows.map((row) => row.action);
  }

  it('[1] 생성 → 조회 → 입금 → 제조 → 준비 → 수령까지 하나의 흐름으로 정상 처리된다', async () => {
    const order = await createOrder();

    const looked = await lookup(order.customerName, order.orderNumber);
    expect(looked.status).toBe(200);
    expect(looked.body).toMatchObject({
      id: order.id,
      status: 'PAYMENT_PENDING',
      items: order.items,
      totalPrice: order.totalPrice,
    });
    expect(looked.body.customerPhone).toBeUndefined();

    const confirmed = await confirmPayment(order.id);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('ACCEPTED');

    const cooking = await changeStatus(order.id, 'COOKING');
    expect(cooking.status).toBe(200);

    const ready = await changeStatus(order.id, 'READY');
    expect(ready.status).toBe(200);

    const completed = await changeStatus(order.id, 'COMPLETED');
    expect(completed.status).toBe(200);

    const final = await lookup(order.customerName, order.orderNumber);
    expect(final.status).toBe(200);
    expect(final.body.status).toBe('COMPLETED');

    expect(await getHistoryActions(order.id)).toEqual([
      'ORDER_CREATED',
      'PAYMENT_CONFIRMED',
      'COOKING_STARTED',
      'READY',
      'COMPLETED',
    ]);
  });

  it('[2] 이름 또는 주문번호가 실제 값과 다르면 생성된 주문이라도 조회되지 않는다', async () => {
    const order = await createOrder();

    const wrongName = await lookup('다른사람', order.orderNumber);
    const wrongNumber = await lookup(order.customerName, NON_EXISTENT_ORDER_NUMBER);

    expect(wrongName.status).toBe(404);
    expect(wrongNumber.status).toBe(404);
  });

  it('[2-1] 자모 분리(NFD) 입력이나 앞뒤 공백이 있어도 정규화되어 동일한 주문으로 조회된다', async () => {
    const composedName = '박서연';
    const order = await createOrder(composedName);

    const decomposed = await lookup(composedName.normalize('NFD'), order.orderNumber);
    const padded = await lookup(`  ${composedName}  `, order.orderNumber);

    expect(decomposed.status).toBe(200);
    expect(decomposed.body.id).toBe(order.id);
    expect(padded.status).toBe(200);
    expect(padded.body.id).toBe(order.id);
  });

  it('[3] 서로 다른 주문 5건이 동시에 생성돼도 모두 성공하고 주문번호가 서로 겹치지 않는다', async () => {
    const menuId = await insertMenu();

    const responses = await Promise.all(
      Array.from({ length: CONCURRENT_ORDER_COUNT }, () => postOrder(menuId)),
    );

    responses.forEach((response) => {
      if (response.body?.id) {
        createdOrderIds.push(response.body.id);
      }
    });
    responses.forEach((response) => {
      expect(response.status).toBe(201);
    });

    // 다른 통합 테스트 파일도 병렬로 같은 order_daily_counters 행을 증가시킬
    // 수 있어(공유 개발 DB), 발급 순번이 연속됨을 보장할 수 없다. 겹치지 않고
    // 잃어버린 갱신(lost update)이 없는지만 확인한다.
    const orderNumbers = responses.map((response) => response.body.orderNumber);
    expect(new Set(orderNumbers).size).toBe(CONCURRENT_ORDER_COUNT);
  });

  it('[4] 이미 ACCEPTED인 주문에 입금 확인을 재요청하면 거부되고 상태/History에 부작용이 없다', async () => {
    const order = await createOrder();
    const confirmed = await confirmPayment(order.id);
    expect(confirmed.status).toBe(200);
    const before = await getHistoryActions(order.id);
    expect(before).toEqual(['ORDER_CREATED', 'PAYMENT_CONFIRMED']);

    const rejected = await confirmPayment(order.id);

    expect(rejected.status).toBe(409);
    expect(rejected.body.code).toBe('ORDER_STATE_CONFLICT');
    expect(await getHistoryActions(order.id)).toEqual(before);
    const orderRow = await databaseService.query<{
      status: string;
      payment_confirmed_at: Date;
    }>('SELECT status, payment_confirmed_at FROM orders WHERE id = $1', [order.id]);
    expect(orderRow.rows[0].status).toBe('ACCEPTED');
    expect(orderRow.rows[0].payment_confirmed_at).toEqual(
      new Date(confirmed.body.paymentConfirmedAt),
    );
  });

  it('[5] 허용되지 않는 상태 전이(ACCEPTED → READY)가 거부되면 상태/History에 부작용이 없다', async () => {
    const order = await createOrder();
    const confirmed = await confirmPayment(order.id);
    expect(confirmed.status).toBe(200);
    const before = await getHistoryActions(order.id);
    expect(before).toEqual(['ORDER_CREATED', 'PAYMENT_CONFIRMED']);

    const rejected = await changeStatus(order.id, 'READY');

    expect(rejected.status).toBe(409);
    expect(rejected.body.code).toBe('ORDER_STATE_CONFLICT');
    expect(await getHistoryActions(order.id)).toEqual(before);
    const orderRow = await databaseService.query<{ status: string }>(
      'SELECT status FROM orders WHERE id = $1',
      [order.id],
    );
    expect(orderRow.rows[0].status).toBe('ACCEPTED');
  });

  it('[6] 취소된 주문을 고객이 조회하면 상태가 CANCELLED로 보인다', async () => {
    const order = await createOrder();

    const cancelled = await cancelOrder(order.id);
    expect(cancelled.status).toBe(200);

    const looked = await lookup(order.customerName, order.orderNumber);
    expect(looked.status).toBe(200);
    expect(looked.body.status).toBe('CANCELLED');
  });

  it('[7] 환불된 주문을 고객이 조회해도 상태와 금액은 환불 전과 동일하게 보인다', async () => {
    const order = await createOrder();
    await confirmPayment(order.id);

    const refunded = await refundOrder(order.id, { refundRequestId: randomUUID() });
    expect(refunded.status).toBe(201);

    const looked = await lookup(order.customerName, order.orderNumber);
    expect(looked.status).toBe(200);
    expect(looked.body).toMatchObject({
      status: 'ACCEPTED',
      totalPrice: order.totalPrice,
    });
  });
});

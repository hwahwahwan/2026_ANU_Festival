import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/common/configure-app';
import { DatabaseService } from '../../src/database/database.service';

/**
 * 실제 PostgreSQL로 주문 생성 멱등성(002_백엔드1_주문결제.md §12~14)을 검증한다.
 * 이 파일이 만드는 menu 이름은 TEST_MENU_NAME_PREFIX로 시작하며,
 * order/order_items는 각 테스트가 만든 직후 id를 추적해 afterEach에서 정확히 지운다.
 */
const TEST_MENU_NAME_PREFIX = '_order_idempotency_it_';

describe('주문 생성 멱등성 (실제 PostgreSQL)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
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

  function createOrderPayload(
    orderRequestId: string,
    menuId: string,
    quantity = 1,
  ) {
    return {
      orderRequestId,
      customerName: '홍길동',
      customerPhone: '010-1234-5678',
      items: [{ menuId, quantity }],
    };
  }

  it('[1] 같은 orderRequestId + 같은 내용으로 2번 요청하면 같은 주문을 반환하고 새 주문을 만들지 않는다', async () => {
    const menuId = await insertMenu();
    const orderRequestId = randomUUID();
    const payload = createOrderPayload(orderRequestId, menuId, 2);

    const first = await request(app.getHttpServer()).post('/orders').send(payload);
    createdOrderIds.push(first.body.id);
    const second = await request(app.getHttpServer()).post('/orders').send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.orderNumber).toBe(first.body.orderNumber);

    const countResult = await databaseService.query<{ count: string }>(
      'SELECT COUNT(*) FROM orders WHERE order_request_id = $1',
      [orderRequestId],
    );
    expect(countResult.rows[0].count).toBe('1');
  });

  it('[2] 같은 orderRequestId인데 주문 내용이 다르면 409 IDEMPOTENCY_CONFLICT를 반환한다', async () => {
    const menuId = await insertMenu();
    const orderRequestId = randomUUID();

    const first = await request(app.getHttpServer())
      .post('/orders')
      .send(createOrderPayload(orderRequestId, menuId, 1));
    createdOrderIds.push(first.body.id);

    const second = await request(app.getHttpServer())
      .post('/orders')
      .send(createOrderPayload(orderRequestId, menuId, 2));

    expect(second.status).toBe(409);
    expect(second.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('[3] 같은 orderRequestId로 동시에 요청해도 주문이 하나만 만들어지고 둘 다 같은 주문을 반환한다', async () => {
    const menuId = await insertMenu();
    const orderRequestId = randomUUID();
    const payload = createOrderPayload(orderRequestId, menuId, 1);

    const [first, second] = await Promise.all([
      request(app.getHttpServer()).post('/orders').send(payload),
      request(app.getHttpServer()).post('/orders').send(payload),
    ]);

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(first.body.id).toBe(second.body.id);
    createdOrderIds.push(first.body.id);

    const countResult = await databaseService.query<{ count: string }>(
      'SELECT COUNT(*) FROM orders WHERE order_request_id = $1',
      [orderRequestId],
    );
    expect(countResult.rows[0].count).toBe('1');
  });

  it('[4] items 배열 순서만 다르면 같은 요청으로 취급해 기존 주문을 반환한다', async () => {
    const menuA = await insertMenu();
    const menuB = await insertMenu();
    const orderRequestId = randomUUID();

    const first = await request(app.getHttpServer())
      .post('/orders')
      .send({
        orderRequestId,
        customerName: '홍길동',
        customerPhone: '010-1234-5678',
        items: [
          { menuId: menuA, quantity: 1 },
          { menuId: menuB, quantity: 2 },
        ],
      });
    createdOrderIds.push(first.body.id);

    const second = await request(app.getHttpServer())
      .post('/orders')
      .send({
        orderRequestId,
        customerName: '홍길동',
        customerPhone: '010-1234-5678',
        items: [
          { menuId: menuB, quantity: 2 },
          { menuId: menuA, quantity: 1 },
        ],
      });

    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
  });

  it('[5] menuId를 대문자 UUID로 보내도 500 없이 정상 생성된다', async () => {
    const menuId = await insertMenu();
    const orderRequestId = randomUUID();

    const response = await request(app.getHttpServer())
      .post('/orders')
      .send(createOrderPayload(orderRequestId, menuId.toUpperCase(), 1));

    expect(response.status).toBe(201);
    createdOrderIds.push(response.body.id);
    expect(response.body.items[0].menuId).toBe(menuId);
  });

  it('[6] 같은 orderRequestId + 같은 내용이면 menuId 대소문자가 달라도 동일 요청으로 취급해 기존 주문을 반환한다', async () => {
    const menuId = await insertMenu();
    const orderRequestId = randomUUID();

    const first = await request(app.getHttpServer())
      .post('/orders')
      .send(createOrderPayload(orderRequestId, menuId, 1));
    createdOrderIds.push(first.body.id);

    const second = await request(app.getHttpServer())
      .post('/orders')
      .send(createOrderPayload(orderRequestId, menuId.toUpperCase(), 1));

    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
  });

  it('[7] 같은 orderRequestId + 같은 items인데 고객 이름이 다르면 다른 사람의 주문으로 보고 409 IDEMPOTENCY_CONFLICT를 반환한다', async () => {
    const menuId = await insertMenu();
    const orderRequestId = randomUUID();

    const first = await request(app.getHttpServer())
      .post('/orders')
      .send(createOrderPayload(orderRequestId, menuId, 1));
    createdOrderIds.push(first.body.id);

    const second = await request(app.getHttpServer())
      .post('/orders')
      .send({
        ...createOrderPayload(orderRequestId, menuId, 1),
        customerName: '다른사람',
      });

    expect(second.status).toBe(409);
    expect(second.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('[8] 같은 요청 안에 동일한 menuId가 중복되면 quantity를 합산해 order_item 한 줄로 저장한다', async () => {
    const menuId = await insertMenu(3500);
    const orderRequestId = randomUUID();

    const response = await request(app.getHttpServer())
      .post('/orders')
      .send({
        orderRequestId,
        customerName: '홍길동',
        customerPhone: '010-1234-5678',
        items: [
          { menuId, quantity: 2 },
          { menuId, quantity: 3 },
        ],
      });

    expect(response.status).toBe(201);
    createdOrderIds.push(response.body.id);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({ menuId, quantity: 5 });
    expect(response.body.totalPrice).toBe(3500 * 5);

    const itemRows = await databaseService.query(
      'SELECT quantity FROM order_items WHERE order_id = $1',
      [response.body.id],
    );
    expect(itemRows.rows).toHaveLength(1);
    expect(itemRows.rows[0].quantity).toBe(5);
  });
});

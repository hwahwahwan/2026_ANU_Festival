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
 * GET /admin/orders (실제 PostgreSQL + 실제 AdminGuard).
 *
 * 이 파일은 로컬 공유 개발 DB(festival)에 대해 돈다. §2-2/§1-10 계약상
 * 이 API는 필터를 제공하지 않으므로(전체 주문을 최신순으로 반환), 다른
 * 테스트가 남긴 주문과 섞일 수 있다. 그래서 "목록이 비어있다/정확히 N건이다"
 * 같은 절대 단언은 하지 않고, 이 테스트가 만든 주문이 응답에 올바른 형태로
 * 나타나는지, cursor로 다음 페이지를 요청했을 때 이전 페이지와 겹치지 않고
 * 최신순을 유지하는지처럼 데이터 내용과 무관한 계약만 검증한다.
 */
const TEST_MENU_NAME_PREFIX = '_admin_orders_it_';

describe('GET /admin/orders (실제 PostgreSQL)', () => {
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
    adminCookie = `${ADMIN_COOKIE_NAME}=${jwtService.sign({ sub: randomUUID(), jti: randomUUID() })}`;

    await databaseService.query('DELETE FROM menus WHERE name LIKE $1', [
      `${TEST_MENU_NAME_PREFIX}%`,
    ]);
  });

  afterEach(async () => {
    if (createdOrderIds.length > 0) {
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

  async function createOrder(customerPhone = '010-1234-5678'): Promise<string> {
    const menuId = await insertMenu();
    const response = await request(app.getHttpServer())
      .post('/orders')
      .send({
        orderRequestId: randomUUID(),
        customerName: '홍길동',
        customerPhone,
        items: [{ menuId, quantity: 1 }],
      });
    createdOrderIds.push(response.body.id);
    return response.body.id;
  }

  it('[1] 관리자 Cookie 없이 요청하면 401 ADMIN_UNAUTHORIZED를 반환한다', async () => {
    const response = await request(app.getHttpServer()).get('/admin/orders');

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('ADMIN_UNAUTHORIZED');
  });

  it('[2] 방금 만든 주문이 목록에 customerPhone을 포함한 AdminOrderView 형태로 나타난다', async () => {
    const orderId = await createOrder('010-9999-0000');

    const response = await request(app.getHttpServer())
      .get('/admin/orders')
      .set('Cookie', adminCookie)
      .query({ limit: 50 });

    expect(response.status).toBe(200);
    const found = response.body.items.find((item: { id: string }) => item.id === orderId);
    expect(found).toMatchObject({
      id: orderId,
      customerPhone: '010-9999-0000',
      status: 'PAYMENT_PENDING',
    });
    expect(found.items).toHaveLength(1);
  });

  it('[3] limit이 1~50 범위를 벗어나면 400 VALIDATION_ERROR를 반환한다', async () => {
    const tooSmall = await request(app.getHttpServer())
      .get('/admin/orders')
      .set('Cookie', adminCookie)
      .query({ limit: 0 });
    const tooLarge = await request(app.getHttpServer())
      .get('/admin/orders')
      .set('Cookie', adminCookie)
      .query({ limit: 51 });

    expect(tooSmall.status).toBe(400);
    expect(tooLarge.status).toBe(400);
  });

  it('[4] 유효하지 않은 cursor를 보내면 400 VALIDATION_ERROR를 반환한다', async () => {
    const response = await request(app.getHttpServer())
      .get('/admin/orders')
      .set('Cookie', adminCookie)
      .query({ cursor: 'not-a-valid-cursor' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('[5] cursor로 다음 페이지를 요청하면 이전 페이지와 겹치지 않고 최신순(내림차순)을 유지한다', async () => {
    await createOrder();
    await createOrder();
    await createOrder();

    const firstPage = await request(app.getHttpServer())
      .get('/admin/orders')
      .set('Cookie', adminCookie)
      .query({ limit: 1 });

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items).toHaveLength(1);
    expect(firstPage.body.nextCursor).not.toBeNull();

    const secondPage = await request(app.getHttpServer())
      .get('/admin/orders')
      .set('Cookie', adminCookie)
      .query({ limit: 1, cursor: firstPage.body.nextCursor });

    expect(secondPage.status).toBe(200);
    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.items[0].id).not.toBe(firstPage.body.items[0].id);

    const firstCreatedAt = new Date(firstPage.body.items[0].createdAt).getTime();
    const secondCreatedAt = new Date(secondPage.body.items[0].createdAt).getTime();
    expect(secondCreatedAt).toBeLessThanOrEqual(firstCreatedAt);
  });
});

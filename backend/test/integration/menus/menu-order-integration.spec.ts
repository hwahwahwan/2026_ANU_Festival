import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { configureApp } from '../../../src/common/configure-app';
import { DatabaseService } from '../../../src/database/database.service';

/**
 * 이 브랜치의 핵심 변경(FixtureMenuReader → 실제 MenusModule)이 실제로
 * Backend 1의 주문 생성 경로에서 동작하는지 실제 PostgreSQL로 검증한다.
 * 003_백엔드2_운영실시간.md §14 "메뉴 가격 변경 → 기존 주문 가격 유지",
 * §41 체크리스트 "과거 OrderItem 불변"에 해당한다.
 *
 * 이 파일이 만드는 모든 테스트 menu 이름은 TEST_MENU_NAME_PREFIX로 시작한다.
 * 프로세스가 중간에 강제 종료돼 afterEach 정리가 못 돈 경우를 대비해
 * beforeAll에서 이 prefix로 시작하는 이름만 한 번 더 정리한다(테이블 전체
 * DELETE 아님). 이 파일이 만드는 order/order_items는 각 테스트가 만든 직후
 * id를 바로 추적해 afterEach에서 정확히 지우므로 별도 prefix 정리가 필요
 * 없다(orders.repository.integration.spec.ts와 동일한 기존 관례).
 */
const TEST_MENU_NAME_PREFIX = '_menu_order_it_';

describe('Menu ↔ Orders 통합 (실제 PostgreSQL)', () => {
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

  async function insertMenu(
    overrides: Partial<{ name: string; price: number; isAvailable: boolean }> = {},
  ): Promise<string> {
    const result = await databaseService.query<{ id: string }>(
      `INSERT INTO menus (name, price, is_available) VALUES ($1, $2, $3) RETURNING id`,
      [
        overrides.name ?? `${TEST_MENU_NAME_PREFIX}default`,
        overrides.price ?? 3500,
        overrides.isAvailable ?? true,
      ],
    );
    const id = result.rows[0].id;
    createdMenuIds.push(id);
    return id;
  }

  function createOrderPayload(menuId: string, quantity = 1) {
    return {
      orderRequestId: randomUUID(),
      customerName: '홍길동',
      customerPhone: '010-1234-5678',
      items: [{ menuId, quantity }],
    };
  }

  it('[1] 주문 생성 시 스냅샷 가격이 menus 테이블의 현재 가격과 일치한다', async () => {
    const menuId = await insertMenu({ price: 4200 });

    const response = await request(app.getHttpServer())
      .post('/orders')
      .send(createOrderPayload(menuId, 2));

    expect(response.status).toBe(201);
    createdOrderIds.push(response.body.id);
    expect(response.body.totalPrice).toBe(8400);
    expect(response.body.items[0]).toMatchObject({
      menuId,
      unitPrice: 4200,
      quantity: 2,
    });
  });

  it('[2] 주문 생성 후 메뉴 가격이 바뀌어도 기존 주문의 스냅샷 가격은 유지된다', async () => {
    const menuId = await insertMenu({ price: 3000 });

    const orderResponse = await request(app.getHttpServer())
      .post('/orders')
      .send(createOrderPayload(menuId, 1));
    createdOrderIds.push(orderResponse.body.id);

    await databaseService.query('UPDATE menus SET price = $1 WHERE id = $2', [
      9999,
      menuId,
    ]);

    const itemResult = await databaseService.query<{ unit_price: number }>(
      'SELECT unit_price FROM order_items WHERE order_id = $1',
      [orderResponse.body.id],
    );
    expect(itemResult.rows[0].unit_price).toBe(3000);
  });

  it('[3] 품절(isAvailable=false) 메뉴가 포함되면 409 MENU_UNAVAILABLE을 반환하고 주문을 생성하지 않는다', async () => {
    const menuId = await insertMenu({ isAvailable: false });

    const response = await request(app.getHttpServer())
      .post('/orders')
      .send(createOrderPayload(menuId));

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('MENU_UNAVAILABLE');
  });

  it('[4] 존재하지 않는 menuId가 포함되면 409 MENU_UNAVAILABLE을 반환한다', async () => {
    const response = await request(app.getHttpServer())
      .post('/orders')
      .send(createOrderPayload('11111111-1111-4111-8111-111111111111'));

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('MENU_UNAVAILABLE');
  });
});

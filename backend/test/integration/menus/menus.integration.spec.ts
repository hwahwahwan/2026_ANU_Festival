import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { AdminAuthModule } from '../../../src/admin-auth/admin-auth.module';
import { configureApp } from '../../../src/common/configure-app';
import { DatabaseService } from '../../../src/database/database.service';
import { ADMIN_COOKIE_NAME } from '../../../src/admin-auth/admin-cookie';

/**
 * 실제 로컬 PostgreSQL(festival DB)에 대해 Menu 도메인 API(GET /menus,
 * GET /admin/menus, PATCH /admin/menus/:menuId) 전체 흐름을 HTTP 레벨로
 * 검증한다. 이 파일이 만든 테스트 전용 menu만 사용/정리한다.
 *
 * 이 파일이 만드는 모든 테스트 menu 이름은 TEST_MENU_NAME_PREFIX로 시작한다.
 * 프로세스가 중간에 강제 종료돼 afterEach 정리가 못 돈 경우를 대비해
 * beforeAll에서 이 prefix로 시작하는 이름만 한 번 더 정리한다(테이블 전체
 * DELETE 아님, 실제 seed 메뉴는 이 prefix를 쓰지 않아 영향받지 않는다).
 *
 * menu_history.admin_id가 admins(id)를 FK로 참조하므로, 실제로 값이 바뀌는
 * PATCH 요청에는 DB에 존재하는 진짜 admin이 필요하다(adminCookie). 반대로
 * fakeAdminCookie는 존재하지 않는 adminId로 서명해, "History INSERT가
 * FK 위반으로 실패하면 menus UPDATE도 rollback되는지"를 검증하는 데 쓴다.
 */
const TEST_MENU_NAME_PREFIX = '_menus_http_it_';
const TEST_ADMIN_USERNAME = '_menus_integration_test_admin';
const NONEXISTENT_ADMIN_ID = '99999999-9999-4999-8999-999999999999';

describe('Menus (실제 PostgreSQL integration)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
  let adminId: string;
  let adminCookie: string;
  let fakeAdminCookie: string;
  const createdMenuIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    databaseService = moduleFixture.get(DatabaseService);

    const adminResult = await databaseService.query<{ id: string }>(
      `INSERT INTO admins (username, password_hash)
       VALUES ($1, 'not-a-real-hash-for-testing')
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
       RETURNING id`,
      [TEST_ADMIN_USERNAME],
    );
    adminId = adminResult.rows[0].id;

    const jwtService = moduleFixture.select(AdminAuthModule).get(JwtService);
    adminCookie = `${ADMIN_COOKIE_NAME}=${jwtService.sign({ sub: adminId })}`;
    fakeAdminCookie = `${ADMIN_COOKIE_NAME}=${jwtService.sign({
      sub: NONEXISTENT_ADMIN_ID,
    })}`;

    await databaseService.query('DELETE FROM menus WHERE name LIKE $1', [
      `${TEST_MENU_NAME_PREFIX}%`,
    ]);
  });

  afterEach(async () => {
    if (createdMenuIds.length === 0) {
      return;
    }
    // menu_history.menu_id가 menus(id)를 FK로 참조하므로, menus를 지우기
    // 전에 이 메뉴들에 딸린 history부터 먼저 지운다.
    await databaseService.query(
      'DELETE FROM menu_history WHERE menu_id = ANY($1::uuid[])',
      [createdMenuIds],
    );
    await databaseService.query('DELETE FROM menus WHERE id = ANY($1::uuid[])', [
      createdMenuIds,
    ]);
    createdMenuIds.length = 0;
  });

  afterAll(async () => {
    // menu_history.admin_id가 admins(id)를 FK로 참조하므로, 이 admin을
    // 참조하는 history가 남아있으면 안 된다 — 위 afterEach가 매 테스트마다
    // 그 테스트의 menu_history를 지우므로 이 시점에는 이미 없어야 한다.
    await databaseService.query('DELETE FROM admins WHERE username = $1', [
      TEST_ADMIN_USERNAME,
    ]);
    await app.close();
  });

  async function getHistoryRows(menuId: string) {
    const result = await databaseService.query<{
      id: string;
      menu_id: string;
      admin_id: string;
      old_price: number;
      new_price: number;
      old_is_available: boolean;
      new_is_available: boolean;
      changed_at: Date;
    }>('SELECT * FROM menu_history WHERE menu_id = $1 ORDER BY changed_at', [
      menuId,
    ]);
    return result.rows;
  }

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

  describe('GET /menus', () => {
    it('[1] 인증 없이 메뉴 목록을 조회한다', async () => {
      const id = await insertMenu({ name: `${TEST_MENU_NAME_PREFIX}public_menu`, price: 3000, isAvailable: true });

      const response = await request(app.getHttpServer()).get('/menus');

      expect(response.status).toBe(200);
      expect(response.body).toContainEqual({
        id,
        name: `${TEST_MENU_NAME_PREFIX}public_menu`,
        price: 3000,
        isAvailable: true,
      });
    });
  });

  describe('GET /admin/menus', () => {
    it('[2] Cookie 없이 요청하면 401 ADMIN_UNAUTHORIZED', async () => {
      const response = await request(app.getHttpServer()).get('/admin/menus');

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('ADMIN_UNAUTHORIZED');
    });

    it('[3] 관리자 Cookie가 있으면 메뉴 목록을 조회한다', async () => {
      const id = await insertMenu({ name: `${TEST_MENU_NAME_PREFIX}admin_menu`, price: 4000, isAvailable: false });

      const response = await request(app.getHttpServer())
        .get('/admin/menus')
        .set('Cookie', [adminCookie]);

      expect(response.status).toBe(200);
      expect(response.body).toContainEqual({
        id,
        name: `${TEST_MENU_NAME_PREFIX}admin_menu`,
        price: 4000,
        isAvailable: false,
      });
    });
  });

  describe('PATCH /admin/menus/:menuId', () => {
    it('[4] Cookie 없이 요청하면 401 ADMIN_UNAUTHORIZED', async () => {
      const id = await insertMenu();

      const response = await request(app.getHttpServer())
        .patch(`/admin/menus/${id}`)
        .send({ price: 4000 });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('ADMIN_UNAUTHORIZED');
    });

    it('[5] price/isAvailable 둘 다 없으면 400 VALIDATION_ERROR', async () => {
      const id = await insertMenu();

      const response = await request(app.getHttpServer())
        .patch(`/admin/menus/${id}`)
        .set('Cookie', [adminCookie])
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('[5-1] price가 null이면 400 VALIDATION_ERROR(아무 것도 바꾸지 않고 조용히 200을 반환하면 안 된다)', async () => {
      const id = await insertMenu({ price: 3500 });

      const response = await request(app.getHttpServer())
        .patch(`/admin/menus/${id}`)
        .set('Cookie', [adminCookie])
        .send({ price: null });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('[5-2] isAvailable이 null이면 400 VALIDATION_ERROR', async () => {
      const id = await insertMenu();

      const response = await request(app.getHttpServer())
        .patch(`/admin/menus/${id}`)
        .set('Cookie', [adminCookie])
        .send({ isAvailable: null });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('[6] 존재하지 않는 메뉴ID는 404 NOT_FOUND', async () => {
      const response = await request(app.getHttpServer())
        .patch('/admin/menus/11111111-1111-4111-8111-111111111111')
        .set('Cookie', [adminCookie])
        .send({ price: 4000 });

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('[7] 형식이 잘못된 menuId는 400 VALIDATION_ERROR', async () => {
      const response = await request(app.getHttpServer())
        .patch('/admin/menus/not-a-uuid')
        .set('Cookie', [adminCookie])
        .send({ price: 4000 });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('[8] name처럼 허용되지 않은 필드를 보내면 400 VALIDATION_ERROR로 거절한다', async () => {
      const id = await insertMenu();

      const response = await request(app.getHttpServer())
        .patch(`/admin/menus/${id}`)
        .set('Cookie', [adminCookie])
        .send({ price: 4500, name: `${TEST_MENU_NAME_PREFIX}hacked_name` });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('[9] 정상 수정은 200과 갱신된 MenuView를 반환하고 name은 유지된다', async () => {
      const id = await insertMenu({
        name: `${TEST_MENU_NAME_PREFIX}update_target`,
        price: 3500,
        isAvailable: true,
      });

      const response = await request(app.getHttpServer())
        .patch(`/admin/menus/${id}`)
        .set('Cookie', [adminCookie])
        .send({ price: 4000, isAvailable: false });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id,
        name: `${TEST_MENU_NAME_PREFIX}update_target`,
        price: 4000,
        isAvailable: false,
      });
    });

    it('[10] 가격만 변경하면 history가 1건 생성되고 old/new price, adminId, changed_at이 정확히 기록된다', async () => {
      const id = await insertMenu({ price: 3500, isAvailable: true });
      const before = new Date();

      const response = await request(app.getHttpServer())
        .patch(`/admin/menus/${id}`)
        .set('Cookie', [adminCookie])
        .send({ price: 4000 });

      expect(response.status).toBe(200);

      const history = await getHistoryRows(id);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        menu_id: id,
        admin_id: adminId,
        old_price: 3500,
        new_price: 4000,
        old_is_available: true,
        new_is_available: true,
      });
      expect(history[0].changed_at.getTime()).toBeGreaterThanOrEqual(
        before.getTime() - 1000,
      );
    });

    it('[11] 품절 상태만 변경하면 history가 1건 생성된다', async () => {
      const id = await insertMenu({ price: 3500, isAvailable: true });

      const response = await request(app.getHttpServer())
        .patch(`/admin/menus/${id}`)
        .set('Cookie', [adminCookie])
        .send({ isAvailable: false });

      expect(response.status).toBe(200);

      const history = await getHistoryRows(id);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        old_price: 3500,
        new_price: 3500,
        old_is_available: true,
        new_is_available: false,
      });
    });

    it('[12] 가격과 품절 상태를 동시에 변경해도 history는 필드별로 쪼개지지 않고 1건만 생성된다', async () => {
      const id = await insertMenu({ price: 3500, isAvailable: true });

      const response = await request(app.getHttpServer())
        .patch(`/admin/menus/${id}`)
        .set('Cookie', [adminCookie])
        .send({ price: 4500, isAvailable: false });

      expect(response.status).toBe(200);

      const history = await getHistoryRows(id);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        old_price: 3500,
        new_price: 4500,
        old_is_available: true,
        new_is_available: false,
      });
    });

    it('[13] 같은 값으로 PATCH하면(no-op) 200은 유지되지만 history는 생성되지 않는다', async () => {
      const id = await insertMenu({ price: 3500, isAvailable: true });

      const response = await request(app.getHttpServer())
        .patch(`/admin/menus/${id}`)
        .set('Cookie', [adminCookie])
        .send({ price: 3500 });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id,
        name: `${TEST_MENU_NAME_PREFIX}default`,
        price: 3500,
        isAvailable: true,
      });

      const history = await getHistoryRows(id);
      expect(history).toHaveLength(0);
    });

    it('[14] Menu UPDATE와 History INSERT는 같은 Transaction — History INSERT가 FK 위반으로 실패하면 Menu 값도 rollback된다', async () => {
      const id = await insertMenu({ price: 3500, isAvailable: true });

      const response = await request(app.getHttpServer())
        .patch(`/admin/menus/${id}`)
        .set('Cookie', [fakeAdminCookie])
        .send({ price: 9999 });

      expect(response.status).toBe(500);

      const menuRow = await databaseService.query<{ price: number }>(
        'SELECT price FROM menus WHERE id = $1',
        [id],
      );
      expect(menuRow.rows[0].price).toBe(3500);

      const history = await getHistoryRows(id);
      expect(history).toHaveLength(0);
    });
  });
});

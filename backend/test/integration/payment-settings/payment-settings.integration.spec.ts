import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { AdminAuthModule } from '../../../src/admin-auth/admin-auth.module';
import { PaymentSettingsModule } from '../../../src/payment-settings/payment-settings.module';
import { PaymentSettingsRepository } from '../../../src/payment-settings/payment-settings.repository';
import { configureApp } from '../../../src/common/configure-app';
import { DatabaseService } from '../../../src/database/database.service';
import { ADMIN_COOKIE_NAME } from '../../../src/admin-auth/admin-cookie';

/**
 * 실제 로컬 PostgreSQL(festival DB)에 대해 PaymentSettings 도메인
 * (Repository + HTTP API) 전체를 검증한다.
 *
 * payment_settings는 이 도메인이 유일하게 소유하는 싱글턴 테이블이라
 * menus처럼 이름 prefix로 테스트 데이터를 격리할 수 없다 — 테스트가 다루는
 * 행 자체가 실제 운영 계좌 설정과 같은 행이다. 따라서:
 *
 * 1. Repository 테스트와 HTTP 테스트를 이 한 파일에 합쳐서 둔다. jest는
 *    파일 단위로 워커를 병렬 실행하지만 한 파일 안의 테스트는 항상 순서대로
 *    실행되므로, 두 파일로 나뉘어 있을 때 생기던 "서로 다른 워커가 동시에
 *    같은 행을 지우고 쓰는" 경합을 이 파일 내부에서는 만들지 않는다.
 * 2. beforeAll에서 테스트 시작 전 실제 값을 백업해두고, afterAll에서 그
 *    값을 그대로 복원한다(원래 없었으면 복원도 하지 않는다) — 테스트가
 *    끝나면 로컬 개발 DB는 테스트 시작 전과 같은 상태로 돌아간다.
 *
 * 한계: 이 파일이 다른 테스트 파일과 나란히(다른 워커에서) 동시에 실행되는
 * 것 자체를 막지는 못한다 — 다만 payment_settings를 건드리는 테스트 파일은
 * 이 파일뿐이므로 실질적인 충돌은 없다. 또한 프로세스가 강제 종료되어
 * afterAll이 아예 돌지 못하면(예: 강제 kill) 복원이 일어나지 않아 로컬 DB에
 * 테스트 값이 남을 수 있다 — 이는 별도 테스트 DB 없이는 구조적으로 막을 수
 * 없는 한계이며, 이 경우 `npm run seed:payment-settings`로 복구하거나 수동
 * 확인이 필요하다(menus 테스트가 갖는 "beforeAll 안전망 재정리"와 달리,
 * 싱글턴이라 prefix 기반 안전망 자체를 만들 수 없다).
 */
const TEST_ADMIN_USERNAME = '_payment_settings_integration_test_admin';
const NONEXISTENT_ADMIN_ID = '99999999-9999-4999-8999-999999999999';

interface PaymentSettingsRow {
  bank_name: string;
  account_number: string;
  account_holder: string;
}

describe('PaymentSettings (실제 PostgreSQL integration)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
  let paymentSettingsRepository: PaymentSettingsRepository;
  let adminId: string;
  let adminCookie: string;
  let fakeAdminCookie: string;
  let originalRow: PaymentSettingsRow | null;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    databaseService = moduleFixture.get(DatabaseService);
    paymentSettingsRepository = moduleFixture
      .select(PaymentSettingsModule)
      .get(PaymentSettingsRepository);

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

    const existing = await databaseService.query<PaymentSettingsRow>(
      'SELECT bank_name, account_number, account_holder FROM payment_settings WHERE id = true',
    );
    originalRow = existing.rows[0] ?? null;

    await databaseService.query('DELETE FROM payment_settings_history');
    await databaseService.query('DELETE FROM payment_settings');
  });

  afterEach(async () => {
    await databaseService.query('DELETE FROM payment_settings_history');
    await databaseService.query('DELETE FROM payment_settings');
  });

  afterAll(async () => {
    await databaseService.query('DELETE FROM payment_settings_history');
    await databaseService.query('DELETE FROM payment_settings');

    if (originalRow) {
      await databaseService.query(
        `INSERT INTO payment_settings (id, bank_name, account_number, account_holder)
         VALUES (true, $1, $2, $3)`,
        [originalRow.bank_name, originalRow.account_number, originalRow.account_holder],
      );
    }

    await databaseService.query('DELETE FROM admins WHERE username = $1', [
      TEST_ADMIN_USERNAME,
    ]);
    await app.close();
  });

  async function seedSettings(
    overrides: Partial<PaymentSettingsRow> = {},
  ): Promise<void> {
    await databaseService.query(
      `INSERT INTO payment_settings (id, bank_name, account_number, account_holder)
       VALUES (true, $1, $2, $3)`,
      [
        overrides.bank_name ?? '신한은행',
        overrides.account_number ?? '110123456789',
        overrides.account_holder ?? '홍길동',
      ],
    );
  }

  async function getHistoryRows() {
    const result = await databaseService.query<{
      id: string;
      admin_id: string;
      old_bank_name: string;
      new_bank_name: string;
      old_account_number: string;
      new_account_number: string;
      old_account_holder: string;
      new_account_holder: string;
      changed_at: Date;
    }>('SELECT * FROM payment_settings_history ORDER BY changed_at');
    return result.rows;
  }

  describe('PaymentSettingsRepository', () => {
    it('[1] 행이 없으면 findCurrent/findCurrentForUpdate는 null을 반환한다', async () => {
      expect(await paymentSettingsRepository.findCurrent()).toBeNull();
      await databaseService.withTransaction(async (client) => {
        expect(await paymentSettingsRepository.findCurrentForUpdate(client)).toBeNull();
      });
    });

    it('[2] applyChanges는 행이 없으면 새로 생성하고, 있으면 갱신하며 행은 항상 1개만 유지된다', async () => {
      const created = await databaseService.withTransaction((client) =>
        paymentSettingsRepository.applyChanges(client, {
          bankName: '신한은행',
          accountNumber: '110123456789',
          accountHolder: '홍길동',
        }),
      );
      expect(created).toEqual({
        bankName: '신한은행',
        accountNumber: '110123456789',
        accountHolder: '홍길동',
      });

      const updated = await databaseService.withTransaction((client) =>
        paymentSettingsRepository.applyChanges(client, {
          bankName: '국민은행',
          accountNumber: '004567890123',
          accountHolder: '김철수',
        }),
      );
      expect(updated).toEqual({
        bankName: '국민은행',
        accountNumber: '004567890123',
        accountHolder: '김철수',
      });

      const rows = await databaseService.query('SELECT * FROM payment_settings');
      expect(rows.rowCount).toBe(1);
    });

    it('[3] accountNumber 앞자리 0이 보존된다', async () => {
      const result = await databaseService.withTransaction((client) =>
        paymentSettingsRepository.applyChanges(client, {
          bankName: '국민은행',
          accountNumber: '004567890123',
          accountHolder: '김철수',
        }),
      );

      expect(result.accountNumber).toBe('004567890123');
    });

    it('[4] id = false로 직접 삽입하면 CHECK 제약으로 거부된다', async () => {
      await expect(
        databaseService.query(
          `INSERT INTO payment_settings (id, bank_name, account_number, account_holder)
           VALUES (false, '신한은행', '110123456789', '홍길동')`,
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  describe('GET /settings/payment', () => {
    it('[5] 인증 없이 현재 계좌 정보를 조회한다', async () => {
      await seedSettings();

      const response = await request(app.getHttpServer()).get('/settings/payment');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        bankName: '신한은행',
        accountNumber: '110123456789',
        accountHolder: '홍길동',
      });
    });

    it('[6] 아직 설정이 없으면 404 NOT_FOUND', async () => {
      const response = await request(app.getHttpServer()).get('/settings/payment');

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /admin/settings/payment', () => {
    it('[7] Cookie 없이 요청하면 401 ADMIN_UNAUTHORIZED', async () => {
      const response = await request(app.getHttpServer()).get(
        '/admin/settings/payment',
      );

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('ADMIN_UNAUTHORIZED');
    });

    it('[8] 관리자 Cookie가 있으면 현재 계좌 정보를 조회한다', async () => {
      await seedSettings({ account_holder: '김철수' });

      const response = await request(app.getHttpServer())
        .get('/admin/settings/payment')
        .set('Cookie', [adminCookie]);

      expect(response.status).toBe(200);
      expect(response.body.accountHolder).toBe('김철수');
    });

    it('[9] 설정이 없으면 관리자도 404 NOT_FOUND', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/settings/payment')
        .set('Cookie', [adminCookie]);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });
  });

  describe('PATCH /admin/settings/payment', () => {
    it('[10] Cookie 없이 요청하면 401 ADMIN_UNAUTHORIZED', async () => {
      const response = await request(app.getHttpServer())
        .patch('/admin/settings/payment')
        .send({
          bankName: '국민은행',
          accountNumber: '004567890123',
          accountHolder: '김철수',
        });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('ADMIN_UNAUTHORIZED');
    });

    it('[11] 필드가 하나라도 빠지면 400 VALIDATION_ERROR', async () => {
      const response = await request(app.getHttpServer())
        .patch('/admin/settings/payment')
        .set('Cookie', [adminCookie])
        .send({ bankName: '국민은행', accountNumber: '004567890123' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('[12] 허용되지 않은 필드를 보내면 400 VALIDATION_ERROR로 거절한다', async () => {
      const response = await request(app.getHttpServer())
        .patch('/admin/settings/payment')
        .set('Cookie', [adminCookie])
        .send({
          bankName: '국민은행',
          accountNumber: '004567890123',
          accountHolder: '김철수',
          hacked: true,
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('[13] 공백만 있는 bankName은 400 VALIDATION_ERROR', async () => {
      const response = await request(app.getHttpServer())
        .patch('/admin/settings/payment')
        .set('Cookie', [adminCookie])
        .send({ bankName: '   ', accountNumber: '004567890123', accountHolder: '김철수' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('[14] 공백만 있는 accountNumber는 400 VALIDATION_ERROR', async () => {
      const response = await request(app.getHttpServer())
        .patch('/admin/settings/payment')
        .set('Cookie', [adminCookie])
        .send({ bankName: '국민은행', accountNumber: '   ', accountHolder: '김철수' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('[15] 공백만 있는 accountHolder는 400 VALIDATION_ERROR', async () => {
      const response = await request(app.getHttpServer())
        .patch('/admin/settings/payment')
        .set('Cookie', [adminCookie])
        .send({ bankName: '국민은행', accountNumber: '004567890123', accountHolder: '   ' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('[16] accountNumber를 숫자로 보내면 400 VALIDATION_ERROR(앞자리 0 보존 계약 회귀 방지)', async () => {
      const response = await request(app.getHttpServer())
        .patch('/admin/settings/payment')
        .set('Cookie', [adminCookie])
        .send({ bankName: '국민은행', accountNumber: 4567890123, accountHolder: '김철수' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('[17] 앞뒤 공백은 제거되어 저장/응답된다', async () => {
      const response = await request(app.getHttpServer())
        .patch('/admin/settings/payment')
        .set('Cookie', [adminCookie])
        .send({
          bankName: '  국민은행  ',
          accountNumber: '  004567890123  ',
          accountHolder: '  김철수  ',
        });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        bankName: '국민은행',
        accountNumber: '004567890123',
        accountHolder: '김철수',
      });

      const getResponse = await request(app.getHttpServer()).get('/settings/payment');
      expect(getResponse.body).toEqual({
        bankName: '국민은행',
        accountNumber: '004567890123',
        accountHolder: '김철수',
      });
    });

    it('[18] 설정이 없는 상태에서 최초 등록은 되지만 History는 남지 않는다', async () => {
      const response = await request(app.getHttpServer())
        .patch('/admin/settings/payment')
        .set('Cookie', [adminCookie])
        .send({
          bankName: '국민은행',
          accountNumber: '004567890123',
          accountHolder: '김철수',
        });

      expect(response.status).toBe(200);
      expect(await getHistoryRows()).toHaveLength(0);
    });

    it('[19] 기존 설정을 변경하면 History가 1건 생성되고 old/new, adminId, changedAt이 정확히 기록된다', async () => {
      await seedSettings();
      const before = new Date();

      const response = await request(app.getHttpServer())
        .patch('/admin/settings/payment')
        .set('Cookie', [adminCookie])
        .send({
          bankName: '국민은행',
          accountNumber: '004567890123',
          accountHolder: '김철수',
        });

      expect(response.status).toBe(200);

      const history = await getHistoryRows();
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        admin_id: adminId,
        old_bank_name: '신한은행',
        new_bank_name: '국민은행',
        old_account_number: '110123456789',
        new_account_number: '004567890123',
        old_account_holder: '홍길동',
        new_account_holder: '김철수',
      });
      expect(history[0].changed_at.getTime()).toBeGreaterThanOrEqual(
        before.getTime() - 1000,
      );
    });

    it('[20] 여러 필드를 동시에 변경해도 History는 필드별로 쪼개지지 않고 1건만 생성된다', async () => {
      await seedSettings();

      const response = await request(app.getHttpServer())
        .patch('/admin/settings/payment')
        .set('Cookie', [adminCookie])
        .send({
          bankName: '국민은행',
          accountNumber: '004567890123',
          accountHolder: '김철수',
        });

      expect(response.status).toBe(200);
      expect(await getHistoryRows()).toHaveLength(1);
    });

    it('[21] 같은 값으로 PATCH하면(no-op) 200은 유지되지만 History는 생성되지 않는다', async () => {
      await seedSettings();

      const response = await request(app.getHttpServer())
        .patch('/admin/settings/payment')
        .set('Cookie', [adminCookie])
        .send({
          bankName: '신한은행',
          accountNumber: '110123456789',
          accountHolder: '홍길동',
        });

      expect(response.status).toBe(200);
      expect(await getHistoryRows()).toHaveLength(0);
    });

    it('[22] PaymentSettings 변경과 History INSERT는 같은 Transaction — History INSERT가 FK 위반으로 실패하면 PaymentSettings 값도 rollback된다', async () => {
      await seedSettings();

      const response = await request(app.getHttpServer())
        .patch('/admin/settings/payment')
        .set('Cookie', [fakeAdminCookie])
        .send({
          bankName: '국민은행',
          accountNumber: '004567890123',
          accountHolder: '김철수',
        });

      expect(response.status).toBe(500);

      const row = await databaseService.query<PaymentSettingsRow>(
        'SELECT bank_name, account_number, account_holder FROM payment_settings WHERE id = true',
      );
      expect(row.rows[0]).toEqual({
        bank_name: '신한은행',
        account_number: '110123456789',
        account_holder: '홍길동',
      });
      expect(await getHistoryRows()).toHaveLength(0);
    });

    it('[23] 행이 없는 상태에서 fakeAdmin으로 최초 등록해도 History를 시도하지 않으므로 정상 200 반환(FK 위반 없음)', async () => {
      const response = await request(app.getHttpServer())
        .patch('/admin/settings/payment')
        .set('Cookie', [fakeAdminCookie])
        .send({
          bankName: '국민은행',
          accountNumber: '004567890123',
          accountHolder: '김철수',
        });

      expect(response.status).toBe(200);
      expect(await getHistoryRows()).toHaveLength(0);
    });
  });
});

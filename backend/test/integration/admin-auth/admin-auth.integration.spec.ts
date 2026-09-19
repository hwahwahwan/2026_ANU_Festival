import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { AdminAuthModule } from '../../../src/admin-auth/admin-auth.module';
import { configureApp } from '../../../src/common/configure-app';
import { DatabaseService } from '../../../src/database/database.service';
import { ADMIN_COOKIE_NAME } from '../../../src/admin-auth/admin-cookie';

/**
 * 실제 로컬 PostgreSQL(festival DB)에 대해 AdminAuth 도메인(로그인/로그아웃)
 * 전체 흐름을 HTTP 레벨로 검증한다. AdminGuard 자체의 인증 로직(쿠키 없음/변조/만료
 * 거절)은 admin.guard.spec.ts에서 단위 테스트로 커버하며, 로그아웃은 AdminGuard를
 * 사용하지 않으므로 여기서는 검증하지 않는다. 이 파일이 만든 테스트 전용 관리자
 * 계정만 사용/정리하며 다른 스키마에는 영향을 주지 않는다.
 */
const TEST_USERNAME = '_admin_auth_integration_test_admin';
const TEST_PASSWORD = 'integration-test-password';

describe('AdminAuth (실제 PostgreSQL integration)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
  let jwtService: JwtService;
  let adminId: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    databaseService = moduleFixture.get(DatabaseService);
    jwtService = moduleFixture.select(AdminAuthModule).get(JwtService);

    const passwordHash = await argon2.hash(TEST_PASSWORD);
    const result = await databaseService.query<{ id: string }>(
      `INSERT INTO admins (username, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id`,
      [TEST_USERNAME, passwordHash],
    );
    adminId = result.rows[0].id;
  });

  afterAll(async () => {
    await databaseService.query('DELETE FROM admins WHERE username = $1', [
      TEST_USERNAME,
    ]);
    await app.close();
  });

  describe('POST /admin/auth/login', () => {
    it('[1] 정상 로그인은 204와 admin_access_token Set-Cookie를 반환한다', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/auth/login')
        .send({ username: TEST_USERNAME, password: TEST_PASSWORD });

      expect(response.status).toBe(204);
      expect(response.body).toEqual({});

      const setCookie = response.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookie = (setCookie as unknown as string[]).find((c) =>
        c.startsWith(`${ADMIN_COOKIE_NAME}=`),
      );
      expect(cookie).toBeDefined();
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Path=\//);
      // 관리자 JWT 유효기간 12시간(확정, 2026-09-20) = 43200초.
      expect(cookie).toMatch(/Max-Age=43200/);
    });

    it('[2] 잘못된 비밀번호는 401 ADMIN_LOGIN_FAILED를 반환한다', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/auth/login')
        .send({ username: TEST_USERNAME, password: 'wrong-password' });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        code: 'ADMIN_LOGIN_FAILED',
        message: expect.any(String),
      });
    });

    it('[3] 존재하지 않는 아이디도 동일하게 401 ADMIN_LOGIN_FAILED를 반환한다', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/auth/login')
        .send({ username: 'no-such-admin', password: 'whatever' });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('ADMIN_LOGIN_FAILED');
    });

    it('[4] 필수 필드가 없으면 400 VALIDATION_ERROR를 반환한다', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/auth/login')
        .send({ username: TEST_USERNAME });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /admin/auth/logout (JWT 존재/유효성과 무관하게 항상 쿠키를 지우는 멱등적 로그아웃)', () => {
    function expectCookieCleared(response: request.Response): void {
      expect(response.status).toBe(204);

      const setCookie = response.headers['set-cookie'] as unknown as string[];
      const cookie = setCookie.find((c) => c.startsWith(`${ADMIN_COOKIE_NAME}=`));
      expect(cookie).toBeDefined();
      expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970/);
    }

    it('[5] Cookie 없이 요청해도 204와 Cookie 삭제 응답을 반환한다', async () => {
      const response = await request(app.getHttpServer()).post(
        '/admin/auth/logout',
      );

      expectCookieCleared(response);
    });

    it('[6] 만료된 JWT여도 204와 Cookie 삭제 응답을 반환한다', async () => {
      const expiredToken = jwtService.sign({ sub: adminId }, { expiresIn: -10 });

      const response = await request(app.getHttpServer())
        .post('/admin/auth/logout')
        .set('Cookie', [`${ADMIN_COOKIE_NAME}=${expiredToken}`]);

      expectCookieCleared(response);
    });

    it('[7] 변조된 JWT여도 204와 Cookie 삭제 응답을 반환한다', async () => {
      const validToken = jwtService.sign({ sub: adminId });
      const tamperedToken = `${validToken}tampered`;

      const response = await request(app.getHttpServer())
        .post('/admin/auth/logout')
        .set('Cookie', [`${ADMIN_COOKIE_NAME}=${tamperedToken}`]);

      expectCookieCleared(response);
    });

    it('[8] 유효한 JWT로 로그아웃하면 204와 Cookie 삭제 응답을 반환한다', async () => {
      const validToken = jwtService.sign({ sub: adminId });

      const response = await request(app.getHttpServer())
        .post('/admin/auth/logout')
        .set('Cookie', [`${ADMIN_COOKIE_NAME}=${validToken}`]);

      expectCookieCleared(response);
    });
  });
});

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { configureApp } from '../../../src/common/configure-app';
import {
  ADMIN_LOGIN_RATE_LIMIT_MAX,
  ADMIN_LOGIN_RATE_LIMIT_MESSAGE,
} from '../../../src/admin-auth/admin-auth-rate-limit';

/**
 * POST /admin/auth/login의 rate limit(ThrottlerGuard)이 실제로 동작하는지
 * HTTP 레벨로 검증한다. ThrottlerGuard는 컨트롤러/서비스 로직보다 먼저
 * 실행되므로 실제 관리자 계정 없이도(항상 실패하는 로그인 시도만으로) 검증할
 * 수 있다 — 단, DB 접근(AdminsRepository.findByUsername) 자체는 매 요청마다
 * 일어난다(limit 이내 요청은 정상적으로 401 ADMIN_LOGIN_FAILED가 나온다).
 *
 * 이 스위트는 자신만의 AppModule 인스턴스(= 자신만의 in-memory
 * ThrottlerStorage)를 부팅해서, 같은 라우트를 호출하는 형제 파일
 * (admin-auth.integration.spec.ts)의 로그인 시도 횟수와 섞이지 않는다.
 */
describe('POST /admin/auth/login rate limit', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it(`같은 IP에서 ${ADMIN_LOGIN_RATE_LIMIT_MAX}회까지는 정상 처리되고, 그 다음 요청부터는 429 TOO_MANY_REQUESTS를 반환한다`, async () => {
    const responses: request.Response[] = [];

    for (let i = 0; i < ADMIN_LOGIN_RATE_LIMIT_MAX + 1; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      responses.push(
        await request(app.getHttpServer())
          .post('/admin/auth/login')
          .send({ username: 'rate-limit-test-admin', password: 'wrong-password' }),
      );
    }

    const withinLimit = responses.slice(0, ADMIN_LOGIN_RATE_LIMIT_MAX);
    const overLimit = responses[ADMIN_LOGIN_RATE_LIMIT_MAX];

    for (const response of withinLimit) {
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('ADMIN_LOGIN_FAILED');
    }

    expect(overLimit.status).toBe(429);
    expect(overLimit.body).toEqual({
      code: 'TOO_MANY_REQUESTS',
      message: ADMIN_LOGIN_RATE_LIMIT_MESSAGE,
    });
  });
});

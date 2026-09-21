process.env.FESTIVAL_START_AT = '2000-01-01';
process.env.FESTIVAL_END_AT = '2099-12-31';

import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { AdminAuthModule } from '../../../src/admin-auth/admin-auth.module';
import { configureApp } from '../../../src/common/configure-app';
import { ADMIN_COOKIE_NAME } from '../../../src/admin-auth/admin-cookie';
import {
  ADMIN_LOGIN_RATE_LIMIT_MAX,
  ADMIN_LOGIN_RATE_LIMIT_MESSAGE,
} from '../../../src/admin-auth/admin-auth-rate-limit';

/**
 * `POST /admin/sales/query`의 rate limit(`SalesThrottlerGuard`)이 실제로
 * 동작하는지 HTTP 레벨로 검증한다. `admin-auth-rate-limit.integration.spec.ts`와
 * 동일하게 이 스위트만의 AppModule 인스턴스(= 자신만의 in-memory
 * ThrottlerStorage)를 부팅해서, 같은 라우트를 반복 호출하는
 * `sales.integration.spec.ts`(거기서는 rate limit 자체를 재검증하지 않도록
 * Guard를 override한다)의 시도 횟수와 섞이지 않게 한다.
 *
 * 실제 제한 횟수/기간/메시지는 `SalesThrottlerGuard`가 tracker만 바꿀 뿐
 * `ThrottlerModule`의 단일 default profile(`admin-auth-rate-limit.ts`)을 그대로
 * 쓰므로, 이 상수를 그대로 재사용한다(Sales 전용 숫자를 새로 만들지 않는다).
 */
describe('POST /admin/sales/query rate limit', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  function cookieFor(adminId: string, sessionId: string): string {
    return `${ADMIN_COOKIE_NAME}=${jwtService.sign({ sub: adminId, jti: sessionId })}`;
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    // 로그인 성공 여부와 무관하게(비밀번호는 항상 틀리게) SalesThrottlerGuard가
    // 먼저 걸리는지만 보면 되므로, 실제 관리자 계정을 만들 필요 없이 AdminGuard만
    // 통과하는 JWT를 서명해서 쓴다(admin-auth 통합 테스트와 달리 password
    // 재검증 자체의 성공/실패는 이 스위트의 관심사가 아니다).
    jwtService = moduleFixture.select(AdminAuthModule).get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  it(`같은 adminId에서 ${ADMIN_LOGIN_RATE_LIMIT_MAX}회까지는 정상 처리되고, 그 다음 요청부터는 429 TOO_MANY_REQUESTS를 반환한다`, async () => {
    const cookie = cookieFor('99999999-9999-4999-8999-999999999999', 'rate-limit-test-session-a');
    const responses: request.Response[] = [];

    for (let i = 0; i < ADMIN_LOGIN_RATE_LIMIT_MAX + 1; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      responses.push(
        await request(app.getHttpServer())
          .post('/admin/sales/query')
          .set('Cookie', [cookie])
          .send({ password: 'wrong-password' }),
      );
    }

    const withinLimit = responses.slice(0, ADMIN_LOGIN_RATE_LIMIT_MAX);
    const overLimit = responses[ADMIN_LOGIN_RATE_LIMIT_MAX];

    for (const response of withinLimit) {
      // 존재하지 않는 adminId이므로 비밀번호 검증 자체는 항상 실패한다 — 여기서
      // 확인하려는 것은 "429가 아니라 정상적으로 처리(=핸들러까지 도달)됐는지"다.
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('SALES_PASSWORD_INVALID');
    }

    expect(overLimit.status).toBe(429);
    expect(overLimit.body).toEqual({
      code: 'TOO_MANY_REQUESTS',
      message: ADMIN_LOGIN_RATE_LIMIT_MESSAGE,
    });
  });

  it('같은 IP(테스트 환경 특성상 모든 요청이 동일 IP)라도 adminId가 다르면 카운터가 분리된다(SalesThrottlerGuard, NAT 공유 대응)', async () => {
    // 위 테스트에서 admin A는 이미 카운터를 소진해 429 상태다. 서로 다른
    // adminId를 쓰는 admin B가 (같은 테스트 프로세스=같은 IP에서 보내는데도)
    // 정상적으로 처리되면, tracker가 IP가 아니라 adminId 기준이라는 뜻이다.
    const cookieB = cookieFor('88888888-8888-4888-8888-888888888888', 'rate-limit-test-session-b');

    const response = await request(app.getHttpServer())
      .post('/admin/sales/query')
      .set('Cookie', [cookieB])
      .send({ password: 'wrong-password' });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('SALES_PASSWORD_INVALID');
  });

  it('로그인(/admin/auth/login) rate limit과 별도 카운터를 사용한다', async () => {
    // 로그인 라우트를 여러 번 호출해도 sales/query 카운터에는 영향이 없어야
    // 한다(ThrottlerGuard/SalesThrottlerGuard는 Controller+Handler 단위로
    // 추적한다). 이미 위 테스트에서 admin A의 sales/query 카운터를
    // 소진했으므로, 로그인 요청이 성공(그 자체는 429가 아님)하면 두 카운터가
    // 분리되어 있다는 뜻이다.
    const response = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ username: 'sales-rate-limit-test-unrelated', password: 'x' });

    expect(response.status).not.toBe(429);
  });
});

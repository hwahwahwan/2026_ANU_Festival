import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/common/configure-app';

/**
 * AppModule 전체 + main.ts와 동일한 공통 초기화(configureApp: Cookie 파싱,
 * ValidationPipe, ApiExceptionFilter)만 검증한다. CORS/graceful shutdown/
 * trust proxy처럼 실제 네트워크·배포 환경에서만 의미가 있는 설정은
 * main.ts에만 있고 테스트에는 필요 없다(configure-app.ts 참고).
 * DatabaseService는 Pool을 생성만 하고 실제로 연결하지 않으므로
 * 실제 PostgreSQL 없이도 앱 부팅과 HTTP 응답 계약을 검증할 수 있다.
 */
describe('AppModule (e2e)', () => {
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

  it('컨트롤러가 없는 라우트로 요청하면 404 { code: "NOT_FOUND" } 로 응답한다', async () => {
    const response = await request(app.getHttpServer()).get(
      '/no-such-route',
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      code: 'NOT_FOUND',
      message: expect.any(String),
    });
  });
});

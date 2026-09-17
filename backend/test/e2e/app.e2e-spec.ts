import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ApiExceptionFilter } from '../../src/common/filters/api-exception.filter';

/**
 * 아직 도메인 컨트롤러가 없는 단계이므로, 현재 실제로 부팅되는 것
 * (AppModule 전체 + main.ts와 동일한 전역 Pipe/Filter)만 검증한다.
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

    // main.ts의 bootstrap()과 동일한 전역 Pipe/Filter 구성을 재현한다.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());

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

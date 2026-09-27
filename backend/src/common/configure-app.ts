import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { ApiExceptionFilter } from './filters/api-exception.filter';

/**
 * 실제 서버 부팅(main.ts)과 테스트(e2e/integration)가 공유하는 애플리케이션
 * 초기화 규칙. Cookie 파싱, DTO 검증, 공통 오류 응답 형식은 요청을 처리하는
 * 모든 컨텍스트(운영 서버든 테스트든)에서 동일해야 하므로 한 곳에서 관리한다.
 *
 * CORS(enableCors), graceful shutdown(enableShutdownHooks), trust proxy처럼
 * 실제 네트워크/배포 환경에서만 의미가 있는 설정은 여기 포함하지 않고
 * main.ts에만 둔다 — 테스트는 supertest로 앱에 직접 요청을 보내므로
 * 브라우저 CORS preflight나 리버스 프록시를 거치지 않는다.
 */
export function configureApp(app: INestApplication): void {
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new ApiExceptionFilter());
}

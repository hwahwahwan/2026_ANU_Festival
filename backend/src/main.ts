import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './common/configure-app';
import { SocketIoAdapter } from './realtime/socket-io.adapter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);

  app.enableShutdownHooks();

  // Nginx Reverse Proxy 뒤에서 운영하므로(001_백엔드_공통.md §42), 첫 번째
  // 프록시 hop을 신뢰해 X-Forwarded-For 기준 실제 클라이언트 IP를 사용한다.
  // 이게 없으면 로그인 rate limit(admin-auth-rate-limit.ts)이 모든 요청을
  // 동일한 IP(Nginx)로 묶어서 집계한다.
  app.set('trust proxy', 1);

  configureApp(app);

  app.enableCors({
    origin: configService.get<string>('FRONTEND_ORIGIN'),
    credentials: true,
  });

  app.useWebSocketAdapter(new SocketIoAdapter(app));

  const port = configService.getOrThrow<string>('PORT');
  await app.listen(port);
}

bootstrap();

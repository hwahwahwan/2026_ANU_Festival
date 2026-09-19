import { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';

/**
 * @WebSocketGateway() 데코레이터의 옵션 객체는 클래스 선언 시점(모듈 import 시점)에
 * 평가되므로, 그 시점엔 아직 ConfigModule.forRoot()가 .env를 읽어들이기 전이라
 * process.env를 직접 참조할 수 없다. main.ts에서 app.enableCors()가 ConfigService를
 * 쓰는 것과 동일하게, Socket.IO 서버 생성 시점(Nest 부트스트랩 이후)에 ConfigService로
 * SOCKET_PATH/FRONTEND_ORIGIN을 읽는다.
 */
export class SocketIoAdapter extends IoAdapter {
  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const configService = this.app.get(ConfigService);

    const optionsWithConfig = {
      ...options,
      path: configService.getOrThrow<string>('SOCKET_PATH'),
      cors: {
        origin: configService.get<string>('FRONTEND_ORIGIN'),
        credentials: true,
      },
      // 프론트엔드는 npm의 socket.io-client를 직접 번들하므로, 서버가
      // /socket.io/socket.io.js 클라이언트 번들을 정적으로 서빙할 필요가 없다.
      serveClient: false,
    };

    return super.createIOServer(port, optionsWithConfig as ServerOptions);
  }
}

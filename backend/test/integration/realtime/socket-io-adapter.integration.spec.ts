import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { AdminAuthModule } from '../../../src/admin-auth/admin-auth.module';
import { ADMIN_COOKIE_NAME } from '../../../src/admin-auth/admin-cookie';
import { configureApp } from '../../../src/common/configure-app';
import { SocketIoAdapter } from '../../../src/realtime/socket-io.adapter';

const ADMIN_ID = '66666666-6666-6666-6666-666666666666';

/**
 * .env의 SOCKET_PATH가 socket.io의 내장 기본값(/socket.io)과 우연히 같기 때문에,
 * 기본 경로로만 테스트하면 SocketIoAdapter가 아예 등록되지 않아도(=ConfigService
 * 주입이 깨져도) 통과해버린다. 기본값과 다른 경로로 부팅해 그 경로로만 연결되는지
 * 확인함으로써 adapter의 설정 주입 자체를 검증한다.
 *
 * AppModule은 import되는 순간(=ConfigModule.forRoot()가 데코레이터 인자로
 * 평가되는 순간) 그 시점의 process.env로 SOCKET_PATH를 확정해버리므로, 파일
 * 상단에서 정적으로 import하면 이미 늦다. 이 파일만 process.env.SOCKET_PATH를
 * 먼저 덮어쓴 뒤 require로 지연 로딩한다.
 */
describe('SocketIoAdapter (커스텀 SOCKET_PATH 주입 검증)', () => {
  const CUSTOM_SOCKET_PATH = '/rt-adapter-test';
  const originalSocketPath = process.env.SOCKET_PATH;

  let app: INestApplication;
  let jwtService: JwtService;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.SOCKET_PATH = CUSTOM_SOCKET_PATH;

    const { AppModule } = require('../../../src/app.module') as typeof import('../../../src/app.module');

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    app.useWebSocketAdapter(new SocketIoAdapter(app));
    await app.init();
    await app.listen(0);

    jwtService = moduleFixture.select(AdminAuthModule).get(JwtService);

    expect(
      moduleFixture.get(ConfigService).get<string>('SOCKET_PATH'),
    ).toBe(CUSTOM_SOCKET_PATH);

    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await app.close();
    process.env.SOCKET_PATH = originalSocketPath;
  });

  it('ConfigService가 제공한 커스텀 SOCKET_PATH로만 연결에 성공한다', async () => {
    const token = jwtService.sign({ sub: ADMIN_ID });
    const socket: ClientSocket = io(baseUrl, {
      path: CUSTOM_SOCKET_PATH,
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 2000,
      extraHeaders: { Cookie: `${ADMIN_COOKIE_NAME}=${token}` },
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('connect timeout')),
          2500,
        );
        socket.once('connect', () => {
          clearTimeout(timer);
          resolve();
        });
        socket.once('connect_error', (error: Error) => {
          clearTimeout(timer);
          reject(error);
        });
      });

      expect(socket.connected).toBe(true);
    } finally {
      socket.disconnect();
    }
  });
});

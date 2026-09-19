import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import request from 'supertest';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { AppModule } from '../../../src/app.module';
import { AdminAuthModule } from '../../../src/admin-auth/admin-auth.module';
import { ADMIN_COOKIE_NAME } from '../../../src/admin-auth/admin-cookie';
import { configureApp } from '../../../src/common/configure-app';
import { SocketIoAdapter } from '../../../src/realtime/socket-io.adapter';

/**
 * 003_백엔드2_운영실시간.md §10: 로그아웃 시 현재 브라우저의 관리자 Socket도
 * 즉시 종료한다. AdminAuth(HTTP)와 Realtime(Socket.IO)을 실제로 함께 부팅해서
 * 이 계약을 end-to-end로 검증한다.
 */
const ADMIN_A = '77777777-7777-7777-7777-777777777777';
const ADMIN_B = '88888888-8888-8888-8888-888888888888';
const WAIT_TIMEOUT_MS = 3000;

describe('관리자 로그아웃 → Realtime Socket 종료 (실제 HTTP + Socket.IO)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let baseUrl: string;
  let socketPath: string;
  const clients: ClientSocket[] = [];

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    app.useWebSocketAdapter(new SocketIoAdapter(app));
    await app.init();
    await app.listen(0);

    jwtService = moduleFixture.select(AdminAuthModule).get(JwtService);
    socketPath = moduleFixture.get(ConfigService).get<string>('SOCKET_PATH')!;

    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterEach(() => {
    while (clients.length > 0) {
      clients.pop()?.disconnect();
    }
  });

  afterAll(async () => {
    await app.close();
  });

  function waitForEvent<T = unknown>(
    socket: ClientSocket,
    event: string,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timeout waiting for "${event}"`)),
        WAIT_TIMEOUT_MS,
      );
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  it('유효한 관리자 Cookie로 로그아웃하면 그 관리자의 연결된 Socket이 즉시 끊어진다', async () => {
    const token = jwtService.sign({ sub: ADMIN_A });
    const socket = io(baseUrl, {
      path: socketPath,
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: { Cookie: `${ADMIN_COOKIE_NAME}=${token}` },
    });
    clients.push(socket);
    await waitForEvent(socket, 'connect');

    const disconnected = waitForEvent(socket, 'disconnect');
    await request(app.getHttpServer())
      .post('/admin/auth/logout')
      .set('Cookie', [`${ADMIN_COOKIE_NAME}=${token}`])
      .expect(204);

    await disconnected;

    expect(socket.connected).toBe(false);
  });

  it('한 관리자가 로그아웃해도 다른 관리자의 Socket에는 영향이 없다', async () => {
    const tokenA = jwtService.sign({ sub: ADMIN_A });
    const tokenB = jwtService.sign({ sub: ADMIN_B });

    const socketA = io(baseUrl, {
      path: socketPath,
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: { Cookie: `${ADMIN_COOKIE_NAME}=${tokenA}` },
    });
    const socketB = io(baseUrl, {
      path: socketPath,
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: { Cookie: `${ADMIN_COOKIE_NAME}=${tokenB}` },
    });
    clients.push(socketA, socketB);
    await Promise.all([
      waitForEvent(socketA, 'connect'),
      waitForEvent(socketB, 'connect'),
    ]);

    const aDisconnected = waitForEvent(socketA, 'disconnect');
    await request(app.getHttpServer())
      .post('/admin/auth/logout')
      .set('Cookie', [`${ADMIN_COOKIE_NAME}=${tokenA}`])
      .expect(204);
    await aDisconnected;

    expect(socketA.connected).toBe(false);
    expect(socketB.connected).toBe(true);
  });

  it('Cookie 없이 로그아웃해도 연결된 관리자 Socket에는 영향이 없다 (멱등적 로그아웃 유지)', async () => {
    const token = jwtService.sign({ sub: ADMIN_A });
    const socket = io(baseUrl, {
      path: socketPath,
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: { Cookie: `${ADMIN_COOKIE_NAME}=${token}` },
    });
    clients.push(socket);
    await waitForEvent(socket, 'connect');

    await request(app.getHttpServer())
      .post('/admin/auth/logout')
      .expect(204);

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(socket.connected).toBe(true);
  });
});

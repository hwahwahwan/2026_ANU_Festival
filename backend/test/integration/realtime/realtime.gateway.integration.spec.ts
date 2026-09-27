import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'net';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { AppModule } from '../../../src/app.module';
import { AdminAuthModule } from '../../../src/admin-auth/admin-auth.module';
import { ADMIN_COOKIE_NAME } from '../../../src/admin-auth/admin-cookie';
import { configureApp } from '../../../src/common/configure-app';
import { SocketIoAdapter } from '../../../src/realtime/socket-io.adapter';

/**
 * B1 Orders는 order.created를 실제로 발행하지만(orders.service.ts), Realtime을
 * B1의 완성 여부와 독립적으로 검증하기 위해 여기서는 EventEmitter2에 직접
 * order.created/order.updated를 발생시키는 fake domain event를 사용한다.
 * (요청사항: "테스트에서는 mock/fake event를 발생시켜 Socket.IO 전달을 검증")
 */
const ADMIN_ID = '55555555-5555-5555-5555-555555555555';
const WAIT_TIMEOUT_MS = 3000;

describe('RealtimeGateway (실제 Socket.IO 연결)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let eventEmitter: EventEmitter2;
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
    eventEmitter = moduleFixture.get(EventEmitter2);
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

  function connectWithCookie(cookieHeader?: string): ClientSocket {
    const socket = io(baseUrl, {
      path: socketPath,
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: cookieHeader ? { Cookie: cookieHeader } : undefined,
    });
    clients.push(socket);
    return socket;
  }

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

  it('유효한 관리자 Cookie로 연결하면 정상적으로 연결된다', async () => {
    const token = jwtService.sign({ sub: ADMIN_ID });
    const socket = connectWithCookie(`${ADMIN_COOKIE_NAME}=${token}`);

    await waitForEvent(socket, 'connect');

    expect(socket.connected).toBe(true);
  });

  it('Cookie 없이 연결하면 거부된다', async () => {
    const socket = connectWithCookie(undefined);

    await waitForEvent(socket, 'connect_error');

    expect(socket.connected).toBe(false);
  });

  it('만료된 JWT로 연결하면 거부된다', async () => {
    const expiredToken = jwtService.sign(
      { sub: ADMIN_ID },
      { expiresIn: -10 },
    );
    const socket = connectWithCookie(`${ADMIN_COOKIE_NAME}=${expiredToken}`);

    await waitForEvent(socket, 'connect_error');

    expect(socket.connected).toBe(false);
  });

  it('변조된 JWT로 연결하면 거부된다', async () => {
    const validToken = jwtService.sign({ sub: ADMIN_ID });
    const socket = connectWithCookie(
      `${ADMIN_COOKIE_NAME}=${validToken}tampered`,
    );

    await waitForEvent(socket, 'connect_error');

    expect(socket.connected).toBe(false);
  });

  it('order.created 도메인 이벤트가 발생하면 연결된 관리자가 실시간으로 수신한다', async () => {
    const token = jwtService.sign({ sub: ADMIN_ID });
    const socket = connectWithCookie(`${ADMIN_COOKIE_NAME}=${token}`);
    await waitForEvent(socket, 'connect');

    const received = waitForEvent<{ orderId: string }>(socket, 'order.created');
    eventEmitter.emit('order.created', { orderId: 'order-realtime-test-1' });

    await expect(received).resolves.toEqual({ orderId: 'order-realtime-test-1' });
  });

  it('order.created가 아닌 관계없는 이벤트는 전달되지 않는다', async () => {
    const token = jwtService.sign({ sub: ADMIN_ID });
    const socket = connectWithCookie(`${ADMIN_COOKIE_NAME}=${token}`);
    await waitForEvent(socket, 'connect');

    const receivedEvents: string[] = [];
    socket.onAny((event: string) => receivedEvents.push(event));

    eventEmitter.emit('order.updated', {
      orderId: 'order-realtime-test-2',
      status: 'ACCEPTED',
    });
    eventEmitter.emit('order.created', { orderId: 'order-realtime-test-3' });

    await waitForEvent(socket, 'order.created');

    expect(receivedEvents).toEqual(['order.created']);
  });

  it('JWT 만료 시간이 지나면 연결돼 있던 Socket도 끊어진다', async () => {
    const shortLivedToken = jwtService.sign(
      { sub: ADMIN_ID },
      { expiresIn: 1 },
    );
    const socket = connectWithCookie(`${ADMIN_COOKIE_NAME}=${shortLivedToken}`);
    await waitForEvent(socket, 'connect');

    await waitForEvent(socket, 'disconnect');

    expect(socket.connected).toBe(false);
  }, 8000);
});

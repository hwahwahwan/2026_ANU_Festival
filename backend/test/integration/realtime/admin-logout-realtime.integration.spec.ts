import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { AddressInfo } from 'net';
import request from 'supertest';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { AppModule } from '../../../src/app.module';
import { AdminAuthModule } from '../../../src/admin-auth/admin-auth.module';
import { ADMIN_COOKIE_NAME } from '../../../src/admin-auth/admin-cookie';
import { configureApp } from '../../../src/common/configure-app';
import { SocketIoAdapter } from '../../../src/realtime/socket-io.adapter';
import { DatabaseService } from '../../../src/database/database.service';

/**
 * 003_백엔드2_운영실시간.md §10: 로그아웃 시 현재 브라우저의 관리자 Socket도
 * 즉시 종료한다. AdminAuth(HTTP)와 Realtime(Socket.IO)을 실제로 함께 부팅해서
 * 이 계약을 end-to-end로 검증한다.
 */
const ADMIN_A = '77777777-7777-7777-7777-777777777777';
const ADMIN_B = '88888888-8888-8888-8888-888888888888';
const WAIT_TIMEOUT_MS = 3000;
const TEST_USERNAME = '_admin_logout_realtime_integration_test_admin';
const TEST_PASSWORD = 'admin-logout-realtime-integration-test-password';

describe('관리자 로그아웃 → Realtime Socket 종료 (실제 HTTP + Socket.IO)', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let databaseService: DatabaseService;
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
    databaseService = moduleFixture.get(DatabaseService);

    const passwordHash = await argon2.hash(TEST_PASSWORD);
    await databaseService.query(
      `INSERT INTO admins (username, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [TEST_USERNAME, passwordHash],
    );

    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://localhost:${port}`;
  });

  afterEach(() => {
    while (clients.length > 0) {
      clients.pop()?.disconnect();
    }
  });

  afterAll(async () => {
    await databaseService.query('DELETE FROM admins WHERE username = $1', [
      TEST_USERNAME,
    ]);
    await app.close();
  });

  /** POST /admin/auth/login의 Set-Cookie에서 admin_access_token 쿠키 문자열만 뽑아낸다. */
  function extractAdminCookie(response: request.Response): string {
    const setCookie = response.headers['set-cookie'] as unknown as string[];
    const cookie = setCookie.find((c) => c.startsWith(`${ADMIN_COOKIE_NAME}=`));
    if (!cookie) {
      throw new Error('admin_access_token Set-Cookie가 응답에 없습니다.');
    }
    // supertest가 반환하는 Set-Cookie 전체 문자열(HttpOnly; SameSite=Lax 등 옵션 포함)에서
    // 실제 요청 Cookie 헤더로 재사용할 "name=value" 부분만 남긴다.
    return cookie.split(';')[0];
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

  it('같은 관리자가 다른 기기(다른 로그인 세션)로 로그인한 경우, 한 기기에서만 로그아웃하면 그 기기의 Socket만 끊기고 다른 기기는 연결이 유지된다', async () => {
    // 실제 로그인 흐름과 동일하게 세션마다 다른 jti를 부여해, 같은 adminId라도
    // 서로 다른 로그인 세션(기기)임을 재현한다(003_백엔드2_운영실시간.md §10).
    const tokenDeviceA = jwtService.sign({ sub: ADMIN_A, jti: 'device-a-session' });
    const tokenDeviceB = jwtService.sign({ sub: ADMIN_A, jti: 'device-b-session' });

    const socketDeviceA = io(baseUrl, {
      path: socketPath,
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: { Cookie: `${ADMIN_COOKIE_NAME}=${tokenDeviceA}` },
    });
    const socketDeviceB = io(baseUrl, {
      path: socketPath,
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: { Cookie: `${ADMIN_COOKIE_NAME}=${tokenDeviceB}` },
    });
    clients.push(socketDeviceA, socketDeviceB);
    await Promise.all([
      waitForEvent(socketDeviceA, 'connect'),
      waitForEvent(socketDeviceB, 'connect'),
    ]);

    const deviceADisconnected = waitForEvent(socketDeviceA, 'disconnect');
    await request(app.getHttpServer())
      .post('/admin/auth/logout')
      .set('Cookie', [`${ADMIN_COOKIE_NAME}=${tokenDeviceA}`])
      .expect(204);
    await deviceADisconnected;

    // 다른 기기(session)는 같은 adminId여도 영향받지 않아야 하므로, socket
    // 이벤트 루프가 disconnect를 처리할 시간을 잠깐 준 뒤 연결 상태를 확인한다.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(socketDeviceA.connected).toBe(false);
    expect(socketDeviceB.connected).toBe(true);
  });

  it('실제 POST /admin/auth/login을 2회(같은 계정, 서로 다른 로그인 세션) 호출해 받은 쿠키로 각각 소켓을 연결하면, 한쪽 쿠키로 로그아웃했을 때 그 소켓만 끊기고 다른 소켓은 유지된다', async () => {
    // 수제 토큰(jwtService.sign)이 아니라 실제 로그인 API를 두 번 호출한다 —
    // AdminAuthService.login()이 매번 다른 jti를 실제로 발급하는지까지
    // end-to-end로 검증해, jti 발급 코드가 통째로 빠져도 이 테스트가 실패하도록 한다.
    const loginResponseDeviceA = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
      .expect(204);
    const loginResponseDeviceB = await request(app.getHttpServer())
      .post('/admin/auth/login')
      .send({ username: TEST_USERNAME, password: TEST_PASSWORD })
      .expect(204);

    const cookieDeviceA = extractAdminCookie(loginResponseDeviceA);
    const cookieDeviceB = extractAdminCookie(loginResponseDeviceB);

    const socketDeviceA = io(baseUrl, {
      path: socketPath,
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: { Cookie: cookieDeviceA },
    });
    const socketDeviceB = io(baseUrl, {
      path: socketPath,
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      extraHeaders: { Cookie: cookieDeviceB },
    });
    clients.push(socketDeviceA, socketDeviceB);
    await Promise.all([
      waitForEvent(socketDeviceA, 'connect'),
      waitForEvent(socketDeviceB, 'connect'),
    ]);

    const deviceADisconnected = waitForEvent(socketDeviceA, 'disconnect');
    await request(app.getHttpServer())
      .post('/admin/auth/logout')
      .set('Cookie', [cookieDeviceA])
      .expect(204);
    await deviceADisconnected;

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(socketDeviceA.connected).toBe(false);
    expect(socketDeviceB.connected).toBe(true);
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

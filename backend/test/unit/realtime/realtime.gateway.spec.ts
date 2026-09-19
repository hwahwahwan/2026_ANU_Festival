import { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import { RealtimeGateway } from '../../../src/realtime/realtime.gateway';
import { ADMIN_ROOM } from '../../../src/realtime/realtime.constants';

function createSocket(data: Record<string, unknown>): Socket {
  return {
    data,
    join: jest.fn(),
    disconnect: jest.fn(),
  } as unknown as Socket;
}

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;

  beforeEach(() => {
    gateway = new RealtimeGateway({} as JwtService);
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  it('인증 미들웨어를 통과하지 못한 소켓(adminId 없음)은 admin room에 join하지 않고 연결을 끊는다', () => {
    const socket = createSocket({});

    gateway.handleConnection(socket);

    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('인증된 소켓은 admin room에 join하고 만료 타이머를 등록한다', () => {
    const socket = createSocket({
      adminId: 'admin-1',
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    });

    gateway.handleConnection(socket);

    expect(socket.join).toHaveBeenCalledWith(ADMIN_ROOM);
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(socket.data.expiryTimer).toBeDefined();

    gateway.handleDisconnect(socket);
  });

  it('handleDisconnect는 등록된 만료 타이머를 정리한다', () => {
    const socket = createSocket({
      adminId: 'admin-1',
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    });
    gateway.handleConnection(socket);
    const timer = socket.data.expiryTimer as NodeJS.Timeout;
    const clearSpy = jest.spyOn(global, 'clearTimeout');

    gateway.handleDisconnect(socket);

    expect(clearSpy).toHaveBeenCalledWith(timer);
    clearSpy.mockRestore();
  });

  it('disconnectAdmin은 해당 adminId로 연결된 소켓만 끊고 다른 관리자는 그대로 둔다', () => {
    const matching = createSocket({ adminId: 'admin-1' });
    const other = createSocket({ adminId: 'admin-2' });
    (
      gateway as unknown as {
        server: { sockets: { sockets: Map<string, Socket> } };
      }
    ).server = {
      sockets: {
        sockets: new Map([
          ['socket-1', matching],
          ['socket-2', other],
        ]),
      },
    };

    gateway.disconnectAdmin('admin-1');

    expect(matching.disconnect).toHaveBeenCalledWith(true);
    expect(other.disconnect).not.toHaveBeenCalled();
  });
});

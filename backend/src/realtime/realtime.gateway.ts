import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { ERROR_CODE } from '../common/contracts/api-error';
import { OrderEventMap } from '../common/contracts/order-events';
import { authenticateAdminSocket } from './admin-socket-auth';
import { ADMIN_ROOM } from './realtime.constants';

interface AdminSocketData {
  adminId?: string;
  expiresAt?: number;
  expiryTimer?: NodeJS.Timeout;
}

/**
 * 003_백엔드2_운영실시간.md §25 — Domain Event → OrderEventListener →
 * RealtimeService → RealtimeGateway → Socket.IO. Gateway는 전달 계층이며
 * 주문 비즈니스 로직을 갖지 않는다(§33).
 *
 * path/cors는 여기서 지정하지 않는다 — SocketIoAdapter가 부트스트랩 시점에
 * ConfigService로 SOCKET_PATH/FRONTEND_ORIGIN을 읽어 적용한다(socket-io.adapter.ts).
 */
@WebSocketGateway()
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private server!: Server;

  constructor(private readonly jwtService: JwtService) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      try {
        const admin = authenticateAdminSocket(this.jwtService, socket);
        const data = socket.data as AdminSocketData;
        data.adminId = admin.adminId;
        data.expiresAt = admin.expiresAt;
        next();
      } catch {
        next(new Error(ERROR_CODE.ADMIN_UNAUTHORIZED));
      }
    });
  }

  handleConnection(socket: Socket): void {
    const data = socket.data as AdminSocketData;

    // 인증 미들웨어를 통과한 관리자 소켓만 admin room에 들어간다. 향후
    // Step 7에서 고객 소켓을 같은 namespace에 받게 되더라도, 역할이 확인된
    // 소켓만 join하므로 고객에게 관리자 이벤트가 새어나가지 않는다.
    if (!data.adminId || data.expiresAt === undefined) {
      socket.disconnect(true);
      return;
    }

    void socket.join(ADMIN_ROOM);

    // §29: JWT 만료 시간이 지나면 기존 Socket도 관리자 이벤트를 계속 받지
    // 못하도록 한다. 재연결 시 §32에 따라 재인증한다.
    const delayMs = Math.max(data.expiresAt * 1000 - Date.now(), 0);
    data.expiryTimer = setTimeout(() => {
      socket.disconnect(true);
    }, delayMs);
  }

  handleDisconnect(socket: Socket): void {
    clearTimeout((socket.data as AdminSocketData).expiryTimer);
  }

  emitToAdmins<K extends keyof OrderEventMap>(
    event: K,
    payload: OrderEventMap[K],
  ): void {
    this.server.to(ADMIN_ROOM).emit(event, payload);
  }

  /**
   * 로그아웃한 관리자의 현재 연결된 Socket을 즉시 종료한다(003_백엔드2_운영실시간.md
   * §10). 단일 프로세스라 in-memory socket map을 직접 순회하는 것으로 충분하다.
   */
  disconnectAdmin(adminId: string): void {
    for (const socket of this.server.sockets.sockets.values()) {
      if ((socket.data as AdminSocketData).adminId === adminId) {
        socket.disconnect(true);
      }
    }
  }
}

import { Injectable } from '@nestjs/common';
import { OrderEventMap } from '../common/contracts/order-events';
import { RealtimeGateway } from './realtime.gateway';

/**
 * OrderEventListener와 RealtimeGateway 사이의 얇은 오케스트레이션 계층.
 * 003_백엔드2_운영실시간.md §25 구조도의 RealtimeService.
 */
@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: RealtimeGateway) {}

  notifyOrderCreated(payload: OrderEventMap['order.created']): void {
    this.gateway.emitToAdmins('order.created', payload);
  }

  disconnectAdmin(adminId: string, sessionId: string | undefined): void {
    this.gateway.disconnectAdmin(adminId, sessionId);
  }
}

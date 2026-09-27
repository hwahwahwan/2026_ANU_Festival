import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { OrderEventMap } from '../common/contracts/order-events';
import { RealtimeService } from './realtime.service';

/**
 * Backend 1이 DB COMMIT 이후 발행하는 도메인 이벤트(order-event.publisher.ts)를
 * 구독해 Realtime으로 전달한다. Realtime은 Order DB를 읽거나 쓰지 않는다
 * (003_백엔드2_운영실시간.md §33).
 *
 * 이번 Step 6 범위는 order.created → 관리자 전달까지다(§39 Step 6). order.updated의
 * 고객 room(order:{orderId}) 구독/인증은 Step 7에서 연결한다.
 */
@Injectable()
export class OrderEventListener {
  constructor(private readonly realtimeService: RealtimeService) {}

  @OnEvent('order.created')
  handleOrderCreated(payload: OrderEventMap['order.created']): void {
    this.realtimeService.notifyOrderCreated(payload);
  }
}

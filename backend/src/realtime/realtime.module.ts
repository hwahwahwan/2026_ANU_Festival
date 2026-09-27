import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { OrderEventListener } from './order-event.listener';
import { AdminSessionListener } from './admin-session.listener';

/**
 * 관리자 인증은 AdminAuthModule이 export하는 JwtModule(JwtService)을 그대로
 * 재사용한다 — Realtime 전용 토큰이나 별도 인증 로직을 만들지 않는다.
 * AdminAuthModule → RealtimeModule 방향의 순환 의존을 피하기 위해, 로그아웃
 * 신호는 직접 호출이 아니라 admin.logged_out 이벤트(EventEmitter2)로 받는다.
 */
@Module({
  imports: [AdminAuthModule],
  providers: [
    RealtimeGateway,
    RealtimeService,
    OrderEventListener,
    AdminSessionListener,
  ],
})
export class RealtimeModule {}

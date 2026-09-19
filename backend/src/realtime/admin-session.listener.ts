import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AdminSessionEventMap } from '../common/contracts/admin-session-events';
import { RealtimeService } from './realtime.service';

/**
 * AdminAuthService가 로그아웃 시 발행하는 admin.logged_out을 구독해 해당
 * 관리자의 Socket을 즉시 종료한다(003_백엔드2_운영실시간.md §10).
 */
@Injectable()
export class AdminSessionListener {
  constructor(private readonly realtimeService: RealtimeService) {}

  @OnEvent('admin.logged_out')
  handleAdminLoggedOut(payload: AdminSessionEventMap['admin.logged_out']): void {
    this.realtimeService.disconnectAdmin(payload.adminId);
  }
}

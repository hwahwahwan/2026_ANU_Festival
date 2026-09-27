import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * 기본 `ThrottlerGuard`의 tracker는 요청 IP다. `/admin/sales/query`는
 * `AdminGuard`를 통과한 뒤에만 도달하므로(클래스 레벨 Guard가 먼저 실행되어
 * `request.admin`이 이미 채워져 있다 — `admin-sales.controller.ts` 참고) IP
 * 대신 로그인한 관리자 본인(adminId)을 기준으로 카운터를 센다.
 *
 * 이렇게 하지 않으면 축제 현장처럼 여러 운영자가 같은 Wi-Fi/NAT(=같은 공인
 * IP)을 쓰는 환경에서, 한 운영자의 비밀번호 오타가 같은 IP를 쓰는 다른
 * 운영자의 정상적인 매출 조회까지 429로 막아버릴 수 있다.
 *
 * `/admin/auth/login`은 로그인 전이라 adminId 자체를 알 수 없으므로 이
 * Guard를 적용하지 않는다 — 전역 `ThrottlerModule` 설정이나
 * `admin-auth-rate-limit.ts`(로그인 rate limit)는 그대로 IP 기준을 유지한다.
 */
@Injectable()
export class SalesThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.admin?.adminId ?? req.ip;
  }
}

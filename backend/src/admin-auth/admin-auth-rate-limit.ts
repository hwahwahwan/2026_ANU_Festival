/**
 * POST /admin/auth/login 전용 rate limit 설정값. ThrottlerModule 자체는
 * @nestjs/throttler 특성상 @Global()이라 app.module.ts에서 이 값으로 한 번만
 * 등록하지만(도메인 모듈 안에서 등록하면 나중에 다른 모듈이 또 forRoot()를
 * 호출했을 때 어느 설정이 적용될지 모듈 import 순서에 좌우되는 비결정적
 * 문제가 생긴다), 실제로 이 설정을 사용하는(= @UseGuards(ThrottlerGuard)를
 * 붙인) 라우트는 현재 POST /admin/auth/login 하나뿐이다
 * (admin-auth.controller.ts 참고).
 *
 * IP당 ADMIN_LOGIN_RATE_LIMIT_MAX회 / ADMIN_LOGIN_RATE_LIMIT_TTL_MS.
 * 운영자 수가 적은 축제 행사 규모에 맞춘 최소한의 방어이며,
 * @nestjs/throttler의 기본 in-memory storage를 사용한다
 * (별도 Redis 등 외부 인프라를 추가하지 않는다).
 */
export const ADMIN_LOGIN_RATE_LIMIT_TTL_MS = 60_000;
export const ADMIN_LOGIN_RATE_LIMIT_MAX = 10;

export const ADMIN_LOGIN_RATE_LIMIT_MESSAGE =
  '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';

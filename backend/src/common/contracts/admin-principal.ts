export interface AdminJwtPayload {
  sub: string;
  /**
   * 로그인할 때마다 새로 발급되는 세션(기기) 식별자(JWT 표준 `jti` 클레임,
   * `crypto.randomUUID()`). 같은 adminId로 여러 기기/탭에서 로그인해도 세션마다
   * 값이 달라, 로그아웃 시 "그 로그아웃 요청을 보낸 바로 그 세션의 Socket만"
   * 종료하는 데 사용한다(003_백엔드2_운영실시간.md §10, 확정 2026-09-20).
   * 서버가 세션 목록을 별도로 저장하지는 않는다 — JWT 자체에 실려 있는 값을
   * 그대로 비교할 뿐이다.
   */
  jti: string;
}

export interface AuthenticatedAdmin {
  adminId: string;
  expiresAt: number;
  /**
   * AdminJwtPayload.jti를 그대로 옮긴 값. HTTP AdminGuard는 이 값을 사용하지
   * 않고, Socket 인증(admin-socket-auth.ts)과 로그아웃 시 Socket 매칭에서만
   * 사용한다. jti가 없는 토큰(이 필드 추가 이전에 발급된 토큰 등)은 undefined다.
   */
  sessionId: string | undefined;
}

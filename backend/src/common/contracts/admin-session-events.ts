/**
 * AdminAuth(로그아웃)와 Realtime(Socket 강제 종료) 사이의 계약. order-events.ts와
 * 달리 두 쪽 다 Backend 2 내부 도메인이므로 별도 Publisher 인터페이스 없이
 * EventEmitter2를 직접 사용하되, 이벤트 이름/payload 타입은 여기 한 곳에서만
 * 정의한다(003_백엔드2_운영실시간.md §10).
 */
export interface AdminSessionEventMap {
  'admin.logged_out': {
    adminId: string;
  };
}

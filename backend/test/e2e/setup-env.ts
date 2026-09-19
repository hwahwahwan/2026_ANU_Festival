// AppModule을 import하는 순간 ConfigModule.forRoot()의 validateEnv가 동기적으로
// 실행되므로, 필수 환경변수는 스펙 파일의 import가 평가되기 전(setupFiles 단계)에
// 미리 채워둔다. 실제 .env로 이미 값이 있다면 덮어쓰지 않는다.
process.env.PORT ??= '3001';
process.env.DATABASE_URL ??= 'postgres://localhost:5432/festival_test';
process.env.ADMIN_JWT_SECRET ??= 'e2e-test-admin-jwt-secret-with-enough-length';
process.env.FRONTEND_ORIGIN ??= 'http://localhost:3000';
process.env.COOKIE_SECURE ??= 'false';
process.env.COOKIE_SAME_SITE ??= 'lax';
process.env.SOCKET_PATH ??= '/socket.io';

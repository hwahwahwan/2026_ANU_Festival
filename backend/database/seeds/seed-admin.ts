import 'dotenv/config';
import * as argon2 from 'argon2';
import { Pool } from 'pg';

/**
 * 관리자 계정 1건을 생성한다. 이미 같은 username이 있으면 아무 것도 하지 않는다
 * (재실행 시 비밀번호를 초기값으로 되돌리지 않는다, 001_백엔드_공통.md §48).
 */
async function main(): Promise<void> {
  const username = process.env.ADMIN_SEED_USERNAME;
  const password = process.env.ADMIN_SEED_PASSWORD;

  if (!username || !password) {
    throw new Error(
      'ADMIN_SEED_USERNAME, ADMIN_SEED_PASSWORD 환경변수가 필요합니다.',
    );
  }

  const passwordHash = await argon2.hash(password);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const result = await pool.query(
      `INSERT INTO admins (username, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (username) DO NOTHING
       RETURNING id`,
      [username, passwordHash],
    );

    if (result.rowCount === 0) {
      console.log(`skipped: admin "${username}" already exists`);
    } else {
      console.log(`created: admin "${username}"`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

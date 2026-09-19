import 'dotenv/config';
import { Pool } from 'pg';

/**
 * 부스 입금 계좌 초기값을 최초 1회 생성한다. 이미 행이 있으면 아무 것도 하지
 * 않는다(재실행 시 관리자가 바꿨을 계좌 정보를 초기값으로 되돌리지 않기
 * 위함, 001_백엔드_공통.md §48). payment_settings는 `id = true`인 행 최대
 * 1개만 허용하는 싱글턴 테이블이다.
 */
async function main(): Promise<void> {
  const bankName = process.env.PAYMENT_SETTINGS_SEED_BANK_NAME;
  const accountNumber = process.env.PAYMENT_SETTINGS_SEED_ACCOUNT_NUMBER;
  const accountHolder = process.env.PAYMENT_SETTINGS_SEED_ACCOUNT_HOLDER;

  if (!bankName || !accountNumber || !accountHolder) {
    throw new Error(
      'PAYMENT_SETTINGS_SEED_BANK_NAME, PAYMENT_SETTINGS_SEED_ACCOUNT_NUMBER, PAYMENT_SETTINGS_SEED_ACCOUNT_HOLDER 환경변수가 필요합니다.',
    );
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const result = await pool.query(
      `INSERT INTO payment_settings (id, bank_name, account_number, account_holder)
       VALUES (true, $1, $2, $3)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [bankName, accountNumber, accountHolder],
    );

    if (result.rowCount === 0) {
      console.log('skipped: payment_settings already configured');
    } else {
      console.log(`created: payment_settings (bank "${bankName}")`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

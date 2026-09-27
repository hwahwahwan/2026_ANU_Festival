import 'dotenv/config';
import { Pool } from 'pg';

/**
 * 고정 메뉴 목록을 최초 1회 생성한다. 메뉴 추가/삭제 API가 없으므로
 * (003_백엔드2_운영실시간.md §11 "메뉴 추가·삭제 기능은 없다") 실제 메뉴
 * 데이터는 이 스크립트로만 넣는다. 이미 같은 name의 메뉴가 있으면 건드리지
 * 않는다 — 운영 중 관리자가 바꿨을 price/is_available을 재실행 시 초기값으로
 * 되돌리지 않기 위함(001_백엔드_공통.md §48).
 */
const MENUS: ReadonlyArray<{ name: string; price: number }> = [
  { name: '기본 크로플', price: 3000 },
  { name: '아이스크림 크로플', price: 4000 },
  { name: '오레오 아이스크림 크로플', price: 4500 },
  { name: '아망추(왕의 망고 냉차)', price: 3500 },
  { name: '김치볶음밥', price: 5900 },
  { name: '일반 콜팝', price: 3500 },
  { name: '뿌링 콜팝', price: 4000 },
  { name: '소프트아이스크림', price: 3000 },
  { name: '김치볶음밥+콜팝 세트', price: 9000 },
  { name: '별자리크로플+망고냉차 세트', price: 7500 },
];

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    for (const menu of MENUS) {
      const result = await pool.query(
        `INSERT INTO menus (name, price)
         SELECT $1, $2
         WHERE NOT EXISTS (SELECT 1 FROM menus WHERE name = $1)
         RETURNING id`,
        [menu.name, menu.price],
      );

      if (result.rowCount === 0) {
        console.log(`skipped: menu "${menu.name}" already exists`);
      } else {
        console.log(`created: menu "${menu.name}" (${menu.price}원)`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

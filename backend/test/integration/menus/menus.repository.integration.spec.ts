import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { validateEnv } from '../../../src/config/env.validation';
import { DatabaseModule } from '../../../src/database/database.module';
import { DatabaseService } from '../../../src/database/database.service';
import { MenusRepository } from '../../../src/menus/menus.repository';

/**
 * 실제 로컬 PostgreSQL(festival DB)의 menus 테이블에 대해 검증한다.
 * 이 테스트가 만든 menu만 정확히 골라서 지운다(테이블 전체 DELETE 금지).
 *
 * 이 파일이 만드는 모든 테스트 menu 이름은 TEST_MENU_NAME_PREFIX로 시작한다.
 * afterEach가 자기가 만든 id만 정확히 지우는 게 기본이지만, 프로세스가
 * 중간에 강제 종료되면(afterEach/afterAll이 아예 못 도는 경우) 그 정리가
 * 못 돌 수 있다 — beforeAll에서 "이 prefix로 시작하는 이름"만 한 번 더
 * 정리해 이전 실행의 잔여물이 남아있어도 이번 실행 전에 치운다. 실제 메뉴
 * 데이터(seed-menus.ts)는 이 prefix를 쓰지 않으므로 영향받지 않는다.
 */
const TEST_MENU_NAME_PREFIX = '_menus_repo_it_';

describe('MenusRepository (실제 PostgreSQL integration)', () => {
  let moduleRef: TestingModule;
  let databaseService: DatabaseService;
  let menusRepository: MenusRepository;
  const createdMenuIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        DatabaseModule,
      ],
      providers: [MenusRepository],
    }).compile();

    databaseService = moduleRef.get(DatabaseService);
    menusRepository = moduleRef.get(MenusRepository);

    await databaseService.query('DELETE FROM menus WHERE name LIKE $1', [
      `${TEST_MENU_NAME_PREFIX}%`,
    ]);
  });

  afterEach(async () => {
    if (createdMenuIds.length === 0) {
      return;
    }
    await databaseService.query('DELETE FROM menus WHERE id = ANY($1::uuid[])', [
      createdMenuIds,
    ]);
    createdMenuIds.length = 0;
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  async function insertMenu(
    overrides: Partial<{ name: string; price: number; isAvailable: boolean }> = {},
  ): Promise<string> {
    const result = await databaseService.query<{ id: string }>(
      `INSERT INTO menus (name, price, is_available) VALUES ($1, $2, $3) RETURNING id`,
      [
        overrides.name ?? `${TEST_MENU_NAME_PREFIX}default`,
        overrides.price ?? 3500,
        overrides.isAvailable ?? true,
      ],
    );
    const id = result.rows[0].id;
    createdMenuIds.push(id);
    return id;
  }

  it('[1] findAll은 실제 menus 테이블 행을 MenuView 형태로 반환한다', async () => {
    const id = await insertMenu({
      name: `${TEST_MENU_NAME_PREFIX}findAll_menu`,
      price: 4000,
      isAvailable: true,
    });

    const menus = await menusRepository.findAll();

    expect(menus).toContainEqual({
      id,
      name: `${TEST_MENU_NAME_PREFIX}findAll_menu`,
      price: 4000,
      isAvailable: true,
    });
  });

  it('[2] findByIdForUpdate는 현재 메뉴 값을 반환한다(Transaction 안에서 사용)', async () => {
    const id = await insertMenu({
      name: `${TEST_MENU_NAME_PREFIX}for_update_menu`,
      price: 3500,
      isAvailable: false,
    });

    await databaseService.withTransaction(async (client) => {
      const current = await menusRepository.findByIdForUpdate(client, id);

      expect(current).toEqual({
        id,
        name: `${TEST_MENU_NAME_PREFIX}for_update_menu`,
        price: 3500,
        isAvailable: false,
      });
    });
  });

  it('[3] 존재하지 않는 id면 findByIdForUpdate는 null을 반환한다', async () => {
    await databaseService.withTransaction(async (client) => {
      const current = await menusRepository.findByIdForUpdate(
        client,
        '11111111-1111-4111-8111-111111111111',
      );

      expect(current).toBeNull();
    });
  });

  it('[4] applyChanges는 주어진 값 그대로 갱신하고 updated_at을 갱신한다', async () => {
    const id = await insertMenu({
      name: `${TEST_MENU_NAME_PREFIX}apply_changes_menu`,
      price: 3000,
      isAvailable: true,
    });

    const before = await databaseService.query<{ updated_at: Date }>(
      'SELECT updated_at FROM menus WHERE id = $1',
      [id],
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    const updated = await databaseService.withTransaction((client) =>
      menusRepository.applyChanges(client, id, { price: 5000, isAvailable: false }),
    );

    expect(updated).toEqual({
      id,
      name: `${TEST_MENU_NAME_PREFIX}apply_changes_menu`,
      price: 5000,
      isAvailable: false,
    });

    const after = await databaseService.query<{ updated_at: Date }>(
      'SELECT updated_at FROM menus WHERE id = $1',
      [id],
    );
    expect(after.rows[0].updated_at.getTime()).toBeGreaterThan(
      before.rows[0].updated_at.getTime(),
    );
  });

  it('[5] applyChanges는 이전과 같은 값(no-op)이어도 updated_at을 갱신한다(L8)', async () => {
    const id = await insertMenu({
      name: `${TEST_MENU_NAME_PREFIX}noop_updated_at_menu`,
      price: 3000,
      isAvailable: true,
    });

    const before = await databaseService.query<{ updated_at: Date }>(
      'SELECT updated_at FROM menus WHERE id = $1',
      [id],
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    // price/isAvailable을 이미 같은 값으로 다시 적용하는 no-op 요청이어도
    // updated_at은 갱신돼야 한다 — 값 비교 없이 항상 UPDATE를 실행하는
    // 구조이므로(L5), updated_at도 그 실행 여부와 일관되게 처리한다.
    await databaseService.withTransaction((client) =>
      menusRepository.applyChanges(client, id, { price: 3000, isAvailable: true }),
    );

    const after = await databaseService.query<{ updated_at: Date }>(
      'SELECT updated_at FROM menus WHERE id = $1',
      [id],
    );
    expect(after.rows[0].updated_at.getTime()).toBeGreaterThan(
      before.rows[0].updated_at.getTime(),
    );
  });

  it('[6] getSnapshotsForOrder는 요청한 id들만 MenuSnapshot으로 반환한다', async () => {
    const idA = await insertMenu({
      name: `${TEST_MENU_NAME_PREFIX}snapshot_a`,
      price: 1000,
      isAvailable: true,
    });
    const idB = await insertMenu({
      name: `${TEST_MENU_NAME_PREFIX}snapshot_b`,
      price: 2000,
      isAvailable: false,
    });
    const idOther = await insertMenu({
      name: `${TEST_MENU_NAME_PREFIX}snapshot_other`,
      price: 9000,
    });

    await databaseService.withTransaction(async (client) => {
      const snapshots = await menusRepository.getSnapshotsForOrder(client, [
        idA,
        idB,
      ]);

      expect(snapshots).toHaveLength(2);
      expect(snapshots).toContainEqual({
        id: idA,
        name: `${TEST_MENU_NAME_PREFIX}snapshot_a`,
        price: 1000,
        isAvailable: true,
      });
      expect(snapshots).toContainEqual({
        id: idB,
        name: `${TEST_MENU_NAME_PREFIX}snapshot_b`,
        price: 2000,
        isAvailable: false,
      });
      expect(snapshots.some((menu) => menu.id === idOther)).toBe(false);
    });
  });

  it('[7] 음수 price는 DB CHECK 제약으로 거부된다', async () => {
    // CHECK 제약으로 INSERT 자체가 거부되어 행이 생기지 않으므로 정리가 필요 없다.
    await expect(
      databaseService.query(
        `INSERT INTO menus (name, price) VALUES ('${TEST_MENU_NAME_PREFIX}bad_price', -1)`,
      ),
    ).rejects.toThrow();
  });

  /**
   * getSnapshotsForOrder가 넘겨받은 PoolClient만 쓰는지(별도 pool.query()로
   * 새지 않는지)를 실제로 증명한다. 같은 Transaction 안에서 아직 COMMIT되지
   * 않은 행을 INSERT한 뒤 그 client로 조회했을 때 보여야 한다 — 구현이
   * DatabaseService.query()(별도 connection)로 바뀌면 이 트랜잭션 밖에서
   * 실행되어 미커밋 행을 보지 못하고 0건이 나와야 한다(회귀 시 실패).
   */
  it('[8] getSnapshotsForOrder는 넘겨받은 PoolClient로만 조회해 같은 Transaction의 미커밋 데이터를 본다', async () => {
    // 이 트랜잭션은 항상 롤백되므로(마지막에 강제로 throw) 행이 커밋되지
    // 않아 정리가 필요 없다.
    const uncommittedName = `${TEST_MENU_NAME_PREFIX}uncommitted_tx_menu`;

    await expect(
      databaseService.withTransaction(async (client) => {
        const insertResult = await client.query<{ id: string }>(
          `INSERT INTO menus (name, price) VALUES ($1, 100) RETURNING id`,
          [uncommittedName],
        );
        const uncommittedId = insertResult.rows[0].id;

        const snapshots = await menusRepository.getSnapshotsForOrder(client, [
          uncommittedId,
        ]);

        expect(snapshots).toEqual([
          {
            id: uncommittedId,
            name: uncommittedName,
            price: 100,
            isAvailable: true,
          },
        ]);

        throw new Error('__rollback_test__');
      }),
    ).rejects.toThrow('__rollback_test__');

    const afterRollback = await databaseService.query(
      'SELECT 1 FROM menus WHERE name = $1',
      [uncommittedName],
    );
    expect(afterRollback.rowCount).toBe(0);
  });
});

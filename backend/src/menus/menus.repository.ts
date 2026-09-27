import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { MenuSnapshot } from '../common/contracts/menu-reader';
import { MenuView } from '../common/contracts/menu-view';

interface MenuRow {
  id: string;
  name: string;
  price: number;
  is_available: boolean;
}

function toView(row: MenuRow): MenuView {
  return {
    id: row.id,
    name: row.name,
    price: row.price,
    isAvailable: row.is_available,
  };
}

@Injectable()
export class MenusRepository {
  constructor(private readonly database: DatabaseService) {}

  async findAll(): Promise<MenuView[]> {
    const result = await this.database.query<MenuRow>(
      'SELECT id, name, price, is_available FROM menus ORDER BY name, id',
    );

    return result.rows.map(toView);
  }

  /**
   * PATCH 처리를 위해 현재 값을 조회하면서 행을 잠근다(FOR UPDATE). MenuHistory에
   * 정확한 "변경 전" 값을 기록하려면 같은 Transaction 안에서 읽은 값과 그 다음의
   * UPDATE가 원자적이어야 한다 — 잠그지 않으면 동시에 들어온 다른 PATCH가
   * 이 사이에 끼어들어 history의 old/new 값이 실제 순서와 어긋날 수 있다.
   */
  async findByIdForUpdate(
    client: PoolClient,
    id: string,
  ): Promise<MenuView | null> {
    const result = await client.query<MenuRow>(
      'SELECT id, name, price, is_available FROM menus WHERE id = $1 FOR UPDATE',
      [id],
    );

    return result.rows[0] ? toView(result.rows[0]) : null;
  }

  /**
   * 호출자(MenusService)가 findByIdForUpdate로 읽은 현재 값과 DTO를 이미
   * 병합해 최종 값을 확정한 뒤 넘긴다 — 여기서는 COALESCE 없이 그대로 SET한다.
   * price/isAvailable이 이전과 같은 no-op 요청이어도 이 SQL은 항상 실제
   * UPDATE 문을 실행한다(L5 — 의도된 동작). updated_at도 그 실행 여부와
   * 일관되게 항상 now()로 갱신한다("값이 실제로 달라졌을 때만"이 아니라
   * "유효한 PATCH 요청이 성공적으로 실행됐을 때" 갱신되는 타임스탬프다).
   * 반드시 findByIdForUpdate와 같은 Transaction(client)에서 호출한다.
   */
  async applyChanges(
    client: PoolClient,
    id: string,
    changes: { price: number; isAvailable: boolean },
  ): Promise<MenuView> {
    const result = await client.query<MenuRow>(
      `UPDATE menus
         SET price = $2,
             is_available = $3,
             updated_at = now()
       WHERE id = $1
       RETURNING id, name, price, is_available`,
      [id, changes.price, changes.isAvailable],
    );

    return toView(result.rows[0]);
  }

  /**
   * 001_백엔드_공통.md §26: 넘겨받은 PoolClient로만 조회하고, 주문
   * Transaction이 끝날 때까지 조회한 메뉴 행의 변경과 주문 snapshot 사이의
   * 일관성을 유지하기 위해 FOR SHARE로 잠근다(잠금 순서 고정을 위한 ORDER BY id).
   */
  async getSnapshotsForOrder(
    client: PoolClient,
    menuIds: readonly string[],
  ): Promise<MenuSnapshot[]> {
    const result = await client.query<MenuRow>(
      `SELECT id, name, price, is_available
         FROM menus
        WHERE id = ANY($1::uuid[])
        ORDER BY id
          FOR SHARE`,
      [menuIds],
    );

    return result.rows.map(toView);
  }
}

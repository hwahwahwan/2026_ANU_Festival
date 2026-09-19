import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface CreateMenuHistoryData {
  menuId: string;
  adminId: string;
  oldPrice: number;
  newPrice: number;
  oldIsAvailable: boolean;
  newIsAvailable: boolean;
}

@Injectable()
export class MenuHistoryRepository {
  async create(client: PoolClient, data: CreateMenuHistoryData): Promise<void> {
    await client.query(
      `INSERT INTO menu_history
         (menu_id, admin_id, old_price, new_price, old_is_available, new_is_available)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        data.menuId,
        data.adminId,
        data.oldPrice,
        data.newPrice,
        data.oldIsAvailable,
        data.newIsAvailable,
      ],
    );
  }
}

import { PoolClient } from 'pg';

export interface MenuSnapshot {
  id: string;
  name: string;
  price: number;
  isAvailable: boolean;
}

export interface MenuReader {
  getSnapshotsForOrder(
    client: PoolClient,
    menuIds: readonly string[],
  ): Promise<MenuSnapshot[]>;
}

export const MENU_READER = Symbol('MENU_READER');

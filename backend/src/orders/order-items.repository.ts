import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface OrderItemRow {
  id: string;
  order_id: string;
  menu_id: string;
  menu_name: string;
  unit_price: number;
  quantity: number;
}

export interface CreateOrderItemData {
  menuId: string;
  menuName: string;
  unitPrice: number;
  quantity: number;
}

@Injectable()
export class OrderItemsRepository {
  async createMany(
    client: PoolClient,
    orderId: string,
    items: readonly CreateOrderItemData[],
  ): Promise<OrderItemRow[]> {
    const rows: OrderItemRow[] = [];

    for (const item of items) {
      const result = await client.query<OrderItemRow>(
        `INSERT INTO order_items
           (order_id, menu_id, menu_name, unit_price, quantity)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, order_id, menu_id, menu_name, unit_price, quantity`,
        [orderId, item.menuId, item.menuName, item.unitPrice, item.quantity],
      );

      rows.push(result.rows[0]);
    }

    return rows;
  }
}

import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { Queryable } from '../database/database.types';
import { OrderStatus } from '../common/contracts/order-status';
import {
  OrderHistoryAction,
  OrderHistoryActorType,
} from './constants/order-history-action.constants';

export interface OrderHistoryRow {
  id: string;
  order_id: string;
  action: OrderHistoryAction;
  from_status: OrderStatus | null;
  to_status: OrderStatus | null;
  actor_type: OrderHistoryActorType;
  actor_id: string | null;
  occurred_at: Date;
  reason: string | null;
  metadata: unknown | null;
}

export interface CreateOrderHistoryData {
  orderId: string;
  action: OrderHistoryAction;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  actorType: OrderHistoryActorType;
  actorId: string | null;
  reason?: string | null;
  metadata?: unknown | null;
}

@Injectable()
export class OrderHistoryRepository {
  /**
   * 상태 변경/생성과 반드시 같은 Transaction 안에서 호출한다(§21 원자성).
   * 그래서 client를 직접 받는다(Queryable이 아니라 PoolClient).
   */
  async create(
    client: PoolClient,
    data: CreateOrderHistoryData,
  ): Promise<OrderHistoryRow> {
    const result = await client.query<OrderHistoryRow>(
      `INSERT INTO order_history
         (order_id, action, from_status, to_status, actor_type, actor_id, reason, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, order_id, action, from_status, to_status, actor_type,
         actor_id, occurred_at, reason, metadata`,
      [
        data.orderId,
        data.action,
        data.fromStatus,
        data.toStatus,
        data.actorType,
        data.actorId,
        data.reason ?? null,
        data.metadata != null ? JSON.stringify(data.metadata) : null,
      ],
    );

    return result.rows[0];
  }

  async findByOrderId(db: Queryable, orderId: string): Promise<OrderHistoryRow[]> {
    const result = await db.query<OrderHistoryRow>(
      `SELECT id, order_id, action, from_status, to_status, actor_type,
         actor_id, occurred_at, reason, metadata
       FROM order_history
       WHERE order_id = $1
       ORDER BY occurred_at ASC, id ASC`,
      [orderId],
    );

    return result.rows;
  }
}

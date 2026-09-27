import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { Queryable } from '../database/database.types';

export interface OrderRefundRow {
  id: string;
  order_id: string;
  refund_request_id: string;
  amount: number;
  processed_at: Date;
  processed_by: string;
  reason: string | null;
}

export interface CreateOrderRefundData {
  orderId: string;
  refundRequestId: string;
  amount: number;
  processedBy: string;
  reason: string | null;
}

@Injectable()
export class OrderRefundsRepository {
  /**
   * order_refunds.order_id UNIQUE 제약이 "주문당 최대 1건" 정책의 최종
   * 방어선이다. 동시에 같은 주문에 두 번 환불이 들어오면 하나는 이 제약
   * 위반(23505)으로 실패하므로, 반드시 orders.service.ts의 create()와 같은
   * "실패 시 재조회" 패턴으로 호출해야 한다.
   */
  async create(client: PoolClient, data: CreateOrderRefundData): Promise<OrderRefundRow> {
    const result = await client.query<OrderRefundRow>(
      `INSERT INTO order_refunds
         (order_id, refund_request_id, amount, processed_by, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, order_id, refund_request_id, amount, processed_at, processed_by, reason`,
      [data.orderId, data.refundRequestId, data.amount, data.processedBy, data.reason],
    );

    return result.rows[0];
  }

  async findByOrderId(db: Queryable, orderId: string): Promise<OrderRefundRow | null> {
    const result = await db.query<OrderRefundRow>(
      `SELECT id, order_id, refund_request_id, amount, processed_at, processed_by, reason
       FROM order_refunds
       WHERE order_id = $1`,
      [orderId],
    );

    return result.rows[0] ?? null;
  }

  /**
   * refund_request_id는 테이블 전역 UNIQUE라, 같은 키가 "다른 주문"에
   * 재사용된 경우를 구분하기 위해 필요하다(orders.service.ts#refund 참고).
   */
  async findByRefundRequestId(
    db: Queryable,
    refundRequestId: string,
  ): Promise<OrderRefundRow | null> {
    const result = await db.query<OrderRefundRow>(
      `SELECT id, order_id, refund_request_id, amount, processed_at, processed_by, reason
       FROM order_refunds
       WHERE refund_request_id = $1`,
      [refundRequestId],
    );

    return result.rows[0] ?? null;
  }
}

import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { Queryable } from '../database/database.types';
import { OrderStatus } from '../common/contracts/order-status';

export interface OrderRow {
  id: string;
  order_number: string;
  order_request_id: string;
  request_fingerprint: string;
  customer_name: string;
  customer_phone: string;
  status: OrderStatus;
  total_price: number;
  payment_confirmed_at: Date | null;
  created_at: Date;
}

export interface CreateOrderData {
  orderNumber: string;
  orderRequestId: string;
  requestFingerprint: string;
  customerName: string;
  customerPhone: string;
  totalPrice: number;
}

const ORDER_ROW_COLUMNS = `
  id, order_number, order_request_id, request_fingerprint, customer_name,
  customer_phone, status, total_price, payment_confirmed_at, created_at
`;

@Injectable()
export class OrdersRepository {
  async create(client: PoolClient, data: CreateOrderData): Promise<OrderRow> {
    const result = await client.query<OrderRow>(
      `INSERT INTO orders
         (order_number, order_request_id, request_fingerprint, customer_name, customer_phone, total_price)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${ORDER_ROW_COLUMNS}`,
      [
        data.orderNumber,
        data.orderRequestId,
        data.requestFingerprint,
        data.customerName,
        data.customerPhone,
        data.totalPrice,
      ],
    );

    return result.rows[0];
  }

  async findByCustomerNameAndOrderNumber(
    db: Queryable,
    customerName: string,
    orderNumber: string,
  ): Promise<OrderRow | null> {
    const result = await db.query<OrderRow>(
      `SELECT ${ORDER_ROW_COLUMNS}
       FROM orders
       WHERE customer_name = $1 AND order_number = $2`,
      [customerName, orderNumber],
    );

    return result.rows[0] ?? null;
  }

  async findByOrderRequestId(
    db: Queryable,
    orderRequestId: string,
  ): Promise<OrderRow | null> {
    const result = await db.query<OrderRow>(
      `SELECT ${ORDER_ROW_COLUMNS}
       FROM orders
       WHERE order_request_id = $1`,
      [orderRequestId],
    );

    return result.rows[0] ?? null;
  }

  async findById(db: Queryable, id: string): Promise<OrderRow | null> {
    const result = await db.query<OrderRow>(
      `SELECT ${ORDER_ROW_COLUMNS}
       FROM orders
       WHERE id = $1`,
      [id],
    );

    return result.rows[0] ?? null;
  }

  /**
   * 상태 전이 검증 + UPDATE 사이에 다른 트랜잭션이 끼어들지 못하도록 행을
   * 잠근다(§19 Row Lock). 그래서 client를 직접 받는다(Queryable이 아니라
   * PoolClient) — 이 락은 같은 Transaction 안에서만 유효하다.
   */
  async findByIdForUpdate(client: PoolClient, id: string): Promise<OrderRow | null> {
    const result = await client.query<OrderRow>(
      `SELECT ${ORDER_ROW_COLUMNS}
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [id],
    );

    return result.rows[0] ?? null;
  }

  /**
   * findByIdForUpdate로 이미 행을 잠그고 상태를 검증한 뒤에만 호출한다.
   * toStatus가 'ACCEPTED'면 payment_confirmed_at을 서버 시각으로 함께 기록한다.
   */
  async updateStatus(
    client: PoolClient,
    id: string,
    toStatus: OrderStatus,
  ): Promise<OrderRow> {
    const result = await client.query<OrderRow>(
      `UPDATE orders
       SET status = $1,
           payment_confirmed_at = CASE
             WHEN $1 = 'ACCEPTED' THEN now()
             ELSE payment_confirmed_at
           END
       WHERE id = $2
       RETURNING ${ORDER_ROW_COLUMNS}`,
      [toStatus, id],
    );

    return result.rows[0];
  }

  /**
   * 최신 생성순(created_at DESC, id DESC) keyset pagination.
   * before가 주어지면 그 id가 가리키는 행보다 "뒤"(더 과거)에 오는 행만
   * 가져온다. 경계값(created_at, id)을 인자로 직접 받지 않고 이 서브쿼리로
   * DB에서 다시 읽는 이유: cursor는 id만 인코딩하고(admin-order-cursor.util.ts
   * 참고), created_at을 JS Date로 왕복시키며 마이크로초가 잘리는 정밀도
   * 손실을 피하기 위함이다. before.id가 가리키는 행이 이미 삭제됐거나
   * 존재하지 않으면 서브쿼리가 0행이 되어 비교가 NULL로 평가되고, 그 결과
   * 이 호출은 빈 배열을 반환한다(의도된 동작).
   */
  async findPage(
    db: Queryable,
    limit: number,
    before?: { id: string },
  ): Promise<OrderRow[]> {
    if (before) {
      const result = await db.query<OrderRow>(
        `SELECT ${ORDER_ROW_COLUMNS}
         FROM orders
         WHERE (created_at, id) < (
           SELECT created_at, id FROM orders WHERE id = $1
         )
         ORDER BY created_at DESC, id DESC
         LIMIT $2`,
        [before.id, limit],
      );

      return result.rows;
    }

    const result = await db.query<OrderRow>(
      `SELECT ${ORDER_ROW_COLUMNS}
       FROM orders
       ORDER BY created_at DESC, id DESC
       LIMIT $1`,
      [limit],
    );

    return result.rows;
  }
}

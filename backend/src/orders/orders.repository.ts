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
}

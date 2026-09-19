import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { OrderStatus } from '../common/contracts/order-status';

export interface OrderRow {
  id: string;
  order_number: string;
  order_request_id: string;
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
  customerName: string;
  customerPhone: string;
  totalPrice: number;
}

@Injectable()
export class OrdersRepository {
  async create(client: PoolClient, data: CreateOrderData): Promise<OrderRow> {
    const result = await client.query<OrderRow>(
      `INSERT INTO orders
         (order_number, order_request_id, customer_name, customer_phone, total_price)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING
         id, order_number, order_request_id, customer_name, customer_phone,
         status, total_price, payment_confirmed_at, created_at`,
      [
        data.orderNumber,
        data.orderRequestId,
        data.customerName,
        data.customerPhone,
        data.totalPrice,
      ],
    );

    return result.rows[0];
  }
}

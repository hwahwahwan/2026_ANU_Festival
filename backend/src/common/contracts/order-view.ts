import { OrderStatus } from './order-status';

export interface OrderItemView {
  menuId: string;
  menuName: string;
  unitPrice: number;
  quantity: number;
}

export interface OrderView {
  id: string;
  orderNumber: string;
  customerName: string;
  status: OrderStatus;
  items: OrderItemView[];
  totalPrice: number;
  createdAt: string;
  paymentConfirmedAt: string | null;
}

/**
 * 관리자는 미수령 고객에게 직접 연락해야 하므로 customerPhone을 포함한다.
 * 고객용 OrderView에는 없다(§1-11).
 */
export type AdminOrderView = OrderView & {
  customerPhone: string;
};

export interface AdminOrderListView {
  items: AdminOrderView[];
  nextCursor: string | null;
}

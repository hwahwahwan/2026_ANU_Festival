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

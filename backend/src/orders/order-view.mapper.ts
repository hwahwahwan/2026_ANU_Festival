import { OrderView } from '../common/contracts/order-view';
import { OrderRow } from './orders.repository';
import { OrderItemRow } from './order-items.repository';

export function toOrderView(order: OrderRow, items: OrderItemRow[]): OrderView {
  return {
    id: order.id,
    orderNumber: order.order_number,
    customerName: order.customer_name,
    status: order.status,
    items: items.map((item) => ({
      menuId: item.menu_id,
      menuName: item.menu_name,
      unitPrice: item.unit_price,
      quantity: item.quantity,
    })),
    totalPrice: order.total_price,
    createdAt: order.created_at.toISOString(),
    paymentConfirmedAt: order.payment_confirmed_at
      ? order.payment_confirmed_at.toISOString()
      : null,
  };
}

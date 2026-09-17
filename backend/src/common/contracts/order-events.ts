import { OrderStatus } from './order-status';

export interface OrderEventMap {
  'order.created': {
    orderId: string;
  };

  'order.updated': {
    orderId: string;
    status: OrderStatus;
  };
}

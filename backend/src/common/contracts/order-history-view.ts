import { OrderStatus } from './order-status';

export interface OrderHistoryView {
  id: string;
  action: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  actorType: 'CUSTOMER' | 'ADMIN';
  actorId: string | null;
  occurredAt: string;
  reason: string | null;
  metadata: unknown | null;
}

import { OrderHistoryView } from '../common/contracts/order-history-view';
import { OrderHistoryRow } from './order-history.repository';

export function toOrderHistoryView(row: OrderHistoryRow): OrderHistoryView {
  return {
    id: row.id,
    action: row.action,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actorType: row.actor_type,
    actorId: row.actor_id,
    occurredAt: row.occurred_at.toISOString(),
    reason: row.reason,
    metadata: row.metadata,
  };
}

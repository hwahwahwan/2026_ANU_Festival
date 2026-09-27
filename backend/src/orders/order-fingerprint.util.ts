import { createHash } from 'crypto';
import { OrderItemInput } from './merge-order-items.util';

export interface RequestFingerprintInput {
  customerName: string;
  customerPhone: string;
  items: readonly OrderItemInput[];
}

/**
 * 이름/전화번호가 다르면 "같은 사람의 재시도"가 아니라 "다른 사람의 주문"일 수
 * 있으므로 fingerprint에 포함한다 — 다르면 IDEMPOTENCY_CONFLICT로 처리된다.
 *
 * 가격은 포함하지 않는다(§13) — 메뉴 가격이 바뀌어도 같은 주문 재시도로 인식돼야 한다.
 * items는 호출 전에 mergeOrderItems로 중복 menuId를 합산한 상태여야 하며,
 * menuId, quantity 순으로 정렬해 배열 순서 차이가 같은 내용을 다른 요청으로
 * 오인하지 않도록 한다.
 */
export function computeRequestFingerprint(input: RequestFingerprintInput): string {
  const normalizedItems = input.items
    .map((item) => ({ menuId: item.menuId, quantity: item.quantity }))
    .sort((a, b) => a.menuId.localeCompare(b.menuId) || a.quantity - b.quantity);

  const payload = {
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    items: normalizedItems,
  };

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

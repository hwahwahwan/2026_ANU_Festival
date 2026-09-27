export interface OrderItemInput {
  menuId: string;
  quantity: number;
}

/**
 * 같은 menuId가 요청에 중복되면 quantity를 합산해 한 줄로 만든다.
 * (§13 "중복 menuId를 합산할지 오류 처리할지" 결정: 합산)
 * 이 결과가 fingerprint 계산과 order_items 저장 양쪽에 그대로 쓰여야
 * "합산 전/후 표현 차이"로 같은 주문이 다른 요청으로 오인되지 않는다.
 */
export function mergeOrderItems(items: readonly OrderItemInput[]): OrderItemInput[] {
  const quantityByMenuId = new Map<string, number>();

  for (const item of items) {
    quantityByMenuId.set(
      item.menuId,
      (quantityByMenuId.get(item.menuId) ?? 0) + item.quantity,
    );
  }

  return Array.from(quantityByMenuId, ([menuId, quantity]) => ({ menuId, quantity }));
}

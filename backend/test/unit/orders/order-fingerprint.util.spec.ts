import { computeRequestFingerprint } from '../../../src/orders/order-fingerprint.util';

const CUSTOMER = { customerName: '홍길동', customerPhone: '010-1234-5678' };

describe('computeRequestFingerprint', () => {
  it('items 배열 순서만 다르면 동일한 fingerprint를 반환한다', () => {
    const a = computeRequestFingerprint({
      ...CUSTOMER,
      items: [
        { menuId: 'menu-a', quantity: 2 },
        { menuId: 'menu-b', quantity: 1 },
      ],
    });
    const b = computeRequestFingerprint({
      ...CUSTOMER,
      items: [
        { menuId: 'menu-b', quantity: 1 },
        { menuId: 'menu-a', quantity: 2 },
      ],
    });

    expect(a).toBe(b);
  });

  it('수량이 다르면 다른 fingerprint를 반환한다', () => {
    const a = computeRequestFingerprint({
      ...CUSTOMER,
      items: [{ menuId: 'menu-a', quantity: 2 }],
    });
    const b = computeRequestFingerprint({
      ...CUSTOMER,
      items: [{ menuId: 'menu-a', quantity: 3 }],
    });

    expect(a).not.toBe(b);
  });

  it('메뉴 구성이 다르면 다른 fingerprint를 반환한다', () => {
    const a = computeRequestFingerprint({
      ...CUSTOMER,
      items: [{ menuId: 'menu-a', quantity: 1 }],
    });
    const b = computeRequestFingerprint({
      ...CUSTOMER,
      items: [{ menuId: 'menu-b', quantity: 1 }],
    });

    expect(a).not.toBe(b);
  });

  it('동일한 menuId가 중복돼도 등장 순서와 무관하게 같은 fingerprint를 반환한다', () => {
    const a = computeRequestFingerprint({
      ...CUSTOMER,
      items: [
        { menuId: 'menu-a', quantity: 2 },
        { menuId: 'menu-a', quantity: 3 },
      ],
    });
    const b = computeRequestFingerprint({
      ...CUSTOMER,
      items: [
        { menuId: 'menu-a', quantity: 3 },
        { menuId: 'menu-a', quantity: 2 },
      ],
    });

    expect(a).toBe(b);
  });

  it('가격은 fingerprint 계산에 영향을 주지 않는다 (입력 타입에 가격 필드가 없음)', () => {
    const withoutPrice = computeRequestFingerprint({
      ...CUSTOMER,
      items: [{ menuId: 'menu-a', quantity: 1 }],
    });
    const stillWithoutPrice = computeRequestFingerprint({
      ...CUSTOMER,
      items: [{ menuId: 'menu-a', quantity: 1 }],
    });

    expect(withoutPrice).toBe(stillWithoutPrice);
  });

  it('같은 items라도 customerName이 다르면 다른 fingerprint를 반환한다', () => {
    const items = [{ menuId: 'menu-a', quantity: 1 }];
    const a = computeRequestFingerprint({ ...CUSTOMER, items });
    const b = computeRequestFingerprint({ ...CUSTOMER, customerName: '다른사람', items });

    expect(a).not.toBe(b);
  });

  it('같은 items라도 customerPhone이 다르면 다른 fingerprint를 반환한다', () => {
    const items = [{ menuId: 'menu-a', quantity: 1 }];
    const a = computeRequestFingerprint({ ...CUSTOMER, items });
    const b = computeRequestFingerprint({
      ...CUSTOMER,
      customerPhone: '010-9999-9999',
      items,
    });

    expect(a).not.toBe(b);
  });
});

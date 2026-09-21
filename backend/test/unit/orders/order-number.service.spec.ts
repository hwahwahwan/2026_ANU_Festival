import { OrderNumberService } from '../../../src/orders/order-number.service';

function createClientStub(lastNumber: number) {
  return {
    query: jest.fn().mockResolvedValue({ rows: [{ last_number: lastNumber }] }),
  };
}

describe('OrderNumberService', () => {
  it('KST 기준 MMDD-XXXX 형식으로 주문번호를 만든다 (4자리 0-padding)', async () => {
    const service = new OrderNumberService();
    const client = createClientStub(1);

    const orderNumber = await service.issue(
      client as never,
      new Date('2026-09-18T01:00:00Z'), // UTC 01:00 = KST 10:00, 9/18
    );

    expect(orderNumber).toBe('0918-0001');
  });

  it('자정 부근에도 UTC가 아니라 KST 날짜를 기준으로 한다', async () => {
    const service = new OrderNumberService();
    const client = createClientStub(42);

    // UTC 2026-09-17 15:30 = KST 2026-09-18 00:30
    const orderNumber = await service.issue(
      client as never,
      new Date('2026-09-17T15:30:00Z'),
    );

    expect(orderNumber).toBe('0918-0042');
  });

  it('order_daily_counters에 대해 order_date UPSERT 쿼리를 실행한다', async () => {
    const service = new OrderNumberService();
    const client = createClientStub(1);

    await service.issue(client as never, new Date('2026-09-18T01:00:00Z'));

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (order_date)'),
      ['2026-09-18'],
    );
  });

  it('last_number가 4자리를 넘으면 padStart 없이 그대로 이어붙인다', async () => {
    const service = new OrderNumberService();
    const client = createClientStub(12345);

    const orderNumber = await service.issue(
      client as never,
      new Date('2026-09-18T01:00:00Z'),
    );

    expect(orderNumber).toBe('0918-12345');
  });
});

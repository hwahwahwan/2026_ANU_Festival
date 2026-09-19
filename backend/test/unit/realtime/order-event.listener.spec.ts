import { OrderEventListener } from '../../../src/realtime/order-event.listener';
import { RealtimeService } from '../../../src/realtime/realtime.service';

describe('OrderEventListener', () => {
  it('order.created 이벤트를 받으면 RealtimeService에 그대로 위임한다', () => {
    const realtimeService = {
      notifyOrderCreated: jest.fn(),
    } as unknown as RealtimeService;
    const listener = new OrderEventListener(realtimeService);
    const payload = { orderId: 'order-1' };

    listener.handleOrderCreated(payload);

    expect(realtimeService.notifyOrderCreated).toHaveBeenCalledWith(payload);
  });
});

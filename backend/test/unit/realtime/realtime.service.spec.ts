import { RealtimeService } from '../../../src/realtime/realtime.service';
import { RealtimeGateway } from '../../../src/realtime/realtime.gateway';

describe('RealtimeService', () => {
  it('notifyOrderCreated는 Gateway로 order.created를 admin에게 전달한다', () => {
    const gateway = { emitToAdmins: jest.fn() } as unknown as RealtimeGateway;
    const service = new RealtimeService(gateway);
    const payload = { orderId: 'order-1' };

    service.notifyOrderCreated(payload);

    expect(gateway.emitToAdmins).toHaveBeenCalledWith('order.created', payload);
  });

  it('disconnectAdmin은 adminId와 sessionId를 그대로 Gateway에 위임한다', () => {
    const gateway = { disconnectAdmin: jest.fn() } as unknown as RealtimeGateway;
    const service = new RealtimeService(gateway);

    service.disconnectAdmin('admin-1', 'session-1');

    expect(gateway.disconnectAdmin).toHaveBeenCalledWith('admin-1', 'session-1');
  });
});

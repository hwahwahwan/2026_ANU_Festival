import { AdminSessionListener } from '../../../src/realtime/admin-session.listener';
import { RealtimeService } from '../../../src/realtime/realtime.service';

describe('AdminSessionListener', () => {
  it('admin.logged_out 이벤트를 받으면 adminId와 sessionId를 RealtimeService.disconnectAdmin에 그대로 위임한다', () => {
    const realtimeService = {
      disconnectAdmin: jest.fn(),
    } as unknown as RealtimeService;
    const listener = new AdminSessionListener(realtimeService);

    listener.handleAdminLoggedOut({ adminId: 'admin-1', sessionId: 'session-1' });

    expect(realtimeService.disconnectAdmin).toHaveBeenCalledWith(
      'admin-1',
      'session-1',
    );
  });
});

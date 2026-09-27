import { SalesThrottlerGuard } from '../../../src/sales/sales-throttler.guard';

/**
 * `getTracker()`는 `ThrottlerGuard`에서 `protected`이므로 `as any`로 캐스팅해
 * 직접 호출한다. 생성자 인자(options/storageService/reflector)는 `getTracker()`
 * 내부에서 전혀 쓰이지 않으므로 더미 값으로 충분하다 — 실제 rate limit
 * 동작(횟수 제한, 429 응답)은 `sales-rate-limit.integration.spec.ts`가 실제
 * HTTP로 검증한다. 이 테스트는 "tracker 계산 규칙" 자체만 좁게 검증한다.
 */
function createGuard(): SalesThrottlerGuard {
  return new SalesThrottlerGuard({} as never, {} as never, {} as never);
}

async function getTracker(
  guard: SalesThrottlerGuard,
  req: Record<string, unknown>,
): Promise<string> {
  return (guard as unknown as { getTracker: (req: Record<string, unknown>) => Promise<string> }).getTracker(
    req,
  );
}

describe('SalesThrottlerGuard.getTracker', () => {
  it('req.admin.adminId가 있으면 IP 대신 adminId를 tracker로 사용한다', async () => {
    const guard = createGuard();

    const tracker = await getTracker(guard, {
      ip: '1.2.3.4',
      admin: { adminId: 'admin-a' },
    });

    expect(tracker).toBe('admin-a');
  });

  it('req.admin이 없으면(예: AdminGuard 이전 단계) IP로 fallback한다', async () => {
    const guard = createGuard();

    const tracker = await getTracker(guard, { ip: '1.2.3.4' });

    expect(tracker).toBe('1.2.3.4');
  });

  it('같은 IP라도 adminId가 다르면 서로 다른 tracker(=서로 다른 카운터)를 반환한다', async () => {
    const guard = createGuard();
    const sharedIp = '1.2.3.4';

    const trackerA = await getTracker(guard, { ip: sharedIp, admin: { adminId: 'admin-a' } });
    const trackerB = await getTracker(guard, { ip: sharedIp, admin: { adminId: 'admin-b' } });

    expect(trackerA).not.toBe(trackerB);
  });

  it('같은 adminId면 IP가 달라도 같은 tracker(=합산되는 카운터)를 반환한다', async () => {
    const guard = createGuard();

    const trackerFromOffice = await getTracker(guard, {
      ip: '1.2.3.4',
      admin: { adminId: 'admin-a' },
    });
    const trackerFromMobile = await getTracker(guard, {
      ip: '9.9.9.9',
      admin: { adminId: 'admin-a' },
    });

    expect(trackerFromOffice).toBe(trackerFromMobile);
  });
});

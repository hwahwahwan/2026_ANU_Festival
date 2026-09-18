import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { MenuReader, MenuSnapshot } from '../common/contracts/menu-reader';

/**
 * Backend 2의 실제 MenusModule이 나오기 전까지만 쓰는 임시 가짜 MenuReader.
 * 진짜 Menu 도메인 구현이 생기면 이 파일과 fixture-menu.module.ts, 그리고
 * app.module.ts의 FixtureMenuModule import를 함께 제거한다.
 */
export const FIXTURE_MENUS: MenuSnapshot[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: '아망추',
    price: 3500,
    isAvailable: true,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: '크로플',
    price: 4000,
    isAvailable: true,
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: '오레오 크로플',
    price: 4500,
    isAvailable: false,
  },
];

@Injectable()
export class FixtureMenuReader implements MenuReader {
  constructor() {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'FixtureMenuReader는 개발용 임시 구현이라 production에서 사용할 수 없습니다. ' +
          '실제 MenusModule로 교체하세요.',
      );
    }
  }

  async getSnapshotsForOrder(
    _client: PoolClient,
    menuIds: readonly string[],
  ): Promise<MenuSnapshot[]> {
    const idSet = new Set(menuIds);
    return FIXTURE_MENUS.filter((menu) => idSet.has(menu.id));
  }
}

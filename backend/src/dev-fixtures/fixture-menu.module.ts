import { Module } from '@nestjs/common';
import { MENU_READER } from '../common/contracts/menu-reader';
import { FixtureMenuReader } from './fixture-menu-reader';

/**
 * 임시 모듈. 실제 MenusModule이 나오면 OrdersModule의 imports에서
 * 이 모듈을 지우고 실제 MenusModule로 교체한다.
 * 일부러 @Global을 쓰지 않는다 — OrdersModule이 이 모듈을 명시적으로
 * import해야만 MENU_READER를 받도록 해서, 교체를 깜빡하면
 * (실제 MenusModule을 연결 안 했는데 이 fixture도 안 지웠으면 몰라도)
 * 최소한 "아무도 연결 안 함" 상태에서는 부팅 자체가 실패하게 만든다.
 */
@Module({
  providers: [
    {
      provide: MENU_READER,
      useClass: FixtureMenuReader,
    },
  ],
  exports: [MENU_READER],
})
export class FixtureMenuModule {}

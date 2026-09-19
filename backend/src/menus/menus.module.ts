import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { MENU_READER } from '../common/contracts/menu-reader';
import { MenusController } from './menus.controller';
import { AdminMenusController } from './admin-menus.controller';
import { MenusService } from './menus.service';
import { MenusRepository } from './menus.repository';
import { MenuHistoryRepository } from './menu-history.repository';

@Module({
  imports: [AdminAuthModule],
  controllers: [MenusController, AdminMenusController],
  providers: [
    MenusService,
    MenusRepository,
    MenuHistoryRepository,
    { provide: MENU_READER, useExisting: MenusService },
  ],
  exports: [MENU_READER],
})
export class MenusModule {}

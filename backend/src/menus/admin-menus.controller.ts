import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../admin-auth/admin.guard';
import { CurrentAdmin } from '../common/decorators/current-admin.decorator';
import { AuthenticatedAdmin } from '../common/contracts/admin-principal';
import { MenuView } from '../common/contracts/menu-view';
import { MenusService } from './menus.service';
import { UpdateMenuDto } from './dto/update-menu.dto';

/**
 * AdminGuard를 개별 메서드가 아니라 클래스 전체에 건다 — 이 컨트롤러의 모든
 * 라우트는 관리자 전용이므로, 나중에 라우트가 추가돼도 개별로 @UseGuards를
 * 붙이는 걸 깜빡해 인증이 누락되는 사고를 구조적으로 막는다.
 */
@Controller('admin/menus')
@UseGuards(AdminGuard)
export class AdminMenusController {
  constructor(private readonly menusService: MenusService) {}

  @Get()
  findAll(): Promise<MenuView[]> {
    return this.menusService.findAll();
  }

  @Patch(':menuId')
  update(
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Body() dto: UpdateMenuDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ): Promise<MenuView> {
    return this.menusService.update(menuId, dto, admin.adminId);
  }
}

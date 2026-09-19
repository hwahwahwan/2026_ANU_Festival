import { Controller, Get } from '@nestjs/common';
import { MenuView } from '../common/contracts/menu-view';
import { MenusService } from './menus.service';

@Controller('menus')
export class MenusController {
  constructor(private readonly menusService: MenusService) {}

  @Get()
  findAll(): Promise<MenuView[]> {
    return this.menusService.findAll();
  }
}

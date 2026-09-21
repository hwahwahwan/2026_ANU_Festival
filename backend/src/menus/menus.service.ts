import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { ERROR_CODE } from '../common/contracts/api-error';
import { ApiException } from '../common/filters/api.exception';
import { MenuReader, MenuSnapshot } from '../common/contracts/menu-reader';
import { MenuView } from '../common/contracts/menu-view';
import { MenusRepository } from './menus.repository';
import { MenuHistoryRepository } from './menu-history.repository';
import { UpdateMenuDto } from './dto/update-menu.dto';

/**
 * 001_백엔드_공통.md §25: MENU_READER는 MenusRepository가 아니라
 * MenusService에 바인딩한다(다른 도메인은 Repository가 아닌 Service를
 * 통해서만 접근). getSnapshotsForOrder는 실제 조회를 Repository에 위임한다.
 */
@Injectable()
export class MenusService implements MenuReader {
  constructor(
    private readonly database: DatabaseService,
    private readonly menusRepository: MenusRepository,
    private readonly menuHistoryRepository: MenuHistoryRepository,
  ) {}

  findAll(): Promise<MenuView[]> {
    return this.menusRepository.findAll();
  }

  getSnapshotsForOrder(
    client: PoolClient,
    menuIds: readonly string[],
  ): Promise<MenuSnapshot[]> {
    return this.menusRepository.getSnapshotsForOrder(client, menuIds);
  }

  /**
   * 현재 값 조회(잠금) → 새 값 확정 → UPDATE → 실제로 값이 바뀐 경우에만
   * MenuHistory 기록, 이 네 단계를 하나의 Transaction으로 묶는다. History
   * INSERT가 실패하면(예: FK 위반) 방금 실행한 menus UPDATE도 함께 rollback된다.
   */
  async update(
    menuId: string,
    dto: UpdateMenuDto,
    adminId: string,
  ): Promise<MenuView> {
    if (dto.price === undefined && dto.isAvailable === undefined) {
      throw new ApiException(
        ERROR_CODE.VALIDATION_ERROR,
        'price 또는 isAvailable 중 최소 하나는 필요합니다.',
      );
    }

    return this.database.withTransaction(async (client) => {
      const current = await this.menusRepository.findByIdForUpdate(
        client,
        menuId,
      );

      if (!current) {
        throw new ApiException(ERROR_CODE.NOT_FOUND, '메뉴를 찾을 수 없습니다.');
      }

      const newPrice = dto.price ?? current.price;
      const newIsAvailable = dto.isAvailable ?? current.isAvailable;

      const updated = await this.menusRepository.applyChanges(client, menuId, {
        price: newPrice,
        isAvailable: newIsAvailable,
      });

      const changed =
        newPrice !== current.price || newIsAvailable !== current.isAvailable;

      if (changed) {
        await this.menuHistoryRepository.create(client, {
          menuId,
          adminId,
          oldPrice: current.price,
          newPrice,
          oldIsAvailable: current.isAvailable,
          newIsAvailable,
        });
      }

      return updated;
    });
  }
}

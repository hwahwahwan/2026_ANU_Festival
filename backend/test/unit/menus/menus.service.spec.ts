import { MenusService } from '../../../src/menus/menus.service';
import { DatabaseService } from '../../../src/database/database.service';
import { MenusRepository } from '../../../src/menus/menus.repository';
import { MenuHistoryRepository } from '../../../src/menus/menu-history.repository';
import { ApiException } from '../../../src/common/filters/api.exception';
import { ERROR_CODE } from '../../../src/common/contracts/api-error';
import { MenuView } from '../../../src/common/contracts/menu-view';

const MENU: MenuView = {
  id: '11111111-1111-1111-1111-111111111111',
  name: '아망추',
  price: 3500,
  isAvailable: true,
};

const ADMIN_ID = '22222222-2222-2222-2222-222222222222';
const FAKE_CLIENT = {} as never;

function createHarness(current: MenuView | null = MENU) {
  const database = {
    withTransaction: jest.fn((work: (client: unknown) => Promise<unknown>) =>
      work(FAKE_CLIENT),
    ),
  } as unknown as jest.Mocked<DatabaseService>;

  const menusRepository = {
    findAll: jest.fn(),
    findByIdForUpdate: jest.fn().mockResolvedValue(current),
    applyChanges: jest.fn(),
    getSnapshotsForOrder: jest.fn(),
  } as unknown as jest.Mocked<MenusRepository>;

  const menuHistoryRepository = {
    create: jest.fn(),
  } as unknown as jest.Mocked<MenuHistoryRepository>;

  const service = new MenusService(database, menusRepository, menuHistoryRepository);

  return { service, database, menusRepository, menuHistoryRepository };
}

describe('MenusService.findAll', () => {
  it('MenusRepository.findAll 결과를 그대로 반환한다', async () => {
    const { service, menusRepository } = createHarness();
    menusRepository.findAll.mockResolvedValue([MENU]);

    const result = await service.findAll();

    expect(result).toEqual([MENU]);
  });
});

describe('MenusService.getSnapshotsForOrder', () => {
  it('전달받은 client와 menuIds를 그대로 MenusRepository에 위임한다(001_백엔드_공통.md §25)', async () => {
    const { service, menusRepository } = createHarness();
    menusRepository.getSnapshotsForOrder.mockResolvedValue([
      { id: MENU.id, name: MENU.name, price: MENU.price, isAvailable: MENU.isAvailable },
    ]);

    const result = await service.getSnapshotsForOrder(FAKE_CLIENT, [MENU.id]);

    expect(menusRepository.getSnapshotsForOrder).toHaveBeenCalledWith(FAKE_CLIENT, [
      MENU.id,
    ]);
    expect(result).toEqual([
      { id: MENU.id, name: MENU.name, price: MENU.price, isAvailable: MENU.isAvailable },
    ]);
  });
});

describe('MenusService.update', () => {
  it('price와 isAvailable이 모두 없으면 VALIDATION_ERROR를 던지고 Transaction을 열지 않는다', async () => {
    const { service, database } = createHarness();

    await expect(service.update(MENU.id, {}, ADMIN_ID)).rejects.toMatchObject(
      new ApiException(
        ERROR_CODE.VALIDATION_ERROR,
        'price 또는 isAvailable 중 최소 하나는 필요합니다.',
      ),
    );
    expect(database.withTransaction).not.toHaveBeenCalled();
  });

  it('존재하지 않는 메뉴ID면 NOT_FOUND를 던지고 applyChanges/history를 호출하지 않는다', async () => {
    const { service, menusRepository, menuHistoryRepository } = createHarness(null);

    await expect(
      service.update(MENU.id, { price: 4000 }, ADMIN_ID),
    ).rejects.toMatchObject(
      new ApiException(ERROR_CODE.NOT_FOUND, '메뉴를 찾을 수 없습니다.'),
    );
    expect(menusRepository.applyChanges).not.toHaveBeenCalled();
    expect(menuHistoryRepository.create).not.toHaveBeenCalled();
  });

  it('price만 주어지면 isAvailable은 현재 값을 그대로 유지해 applyChanges에 전달한다', async () => {
    const { service, menusRepository } = createHarness(MENU);
    const updated = { ...MENU, price: 4000 };
    menusRepository.applyChanges.mockResolvedValue(updated);

    const result = await service.update(MENU.id, { price: 4000 }, ADMIN_ID);

    expect(menusRepository.applyChanges).toHaveBeenCalledWith(FAKE_CLIENT, MENU.id, {
      price: 4000,
      isAvailable: MENU.isAvailable,
    });
    expect(result).toEqual(updated);
  });

  it('isAvailable만 주어지면 price는 현재 값을 그대로 유지해 applyChanges에 전달한다', async () => {
    const { service, menusRepository } = createHarness(MENU);
    const updated = { ...MENU, isAvailable: false };
    menusRepository.applyChanges.mockResolvedValue(updated);

    const result = await service.update(MENU.id, { isAvailable: false }, ADMIN_ID);

    expect(menusRepository.applyChanges).toHaveBeenCalledWith(FAKE_CLIENT, MENU.id, {
      price: MENU.price,
      isAvailable: false,
    });
    expect(result).toEqual(updated);
  });

  it('실제로 값이 바뀌면 MenuHistory에 변경 전/후 값과 adminId를 기록한다', async () => {
    const { service, menusRepository, menuHistoryRepository } = createHarness(MENU);
    menusRepository.applyChanges.mockResolvedValue({
      ...MENU,
      price: 4000,
      isAvailable: false,
    });

    await service.update(MENU.id, { price: 4000, isAvailable: false }, ADMIN_ID);

    expect(menuHistoryRepository.create).toHaveBeenCalledTimes(1);
    expect(menuHistoryRepository.create).toHaveBeenCalledWith(FAKE_CLIENT, {
      menuId: MENU.id,
      adminId: ADMIN_ID,
      oldPrice: MENU.price,
      newPrice: 4000,
      oldIsAvailable: MENU.isAvailable,
      newIsAvailable: false,
    });
  });

  it('price/isAvailable을 동시에 바꿔도 history는 한 건만 기록한다(필드별로 쪼개지 않음)', async () => {
    const { service, menusRepository, menuHistoryRepository } = createHarness(MENU);
    menusRepository.applyChanges.mockResolvedValue({
      ...MENU,
      price: 4000,
      isAvailable: false,
    });

    await service.update(MENU.id, { price: 4000, isAvailable: false }, ADMIN_ID);

    expect(menuHistoryRepository.create).toHaveBeenCalledTimes(1);
  });

  it('보낸 값이 현재 값과 같은 no-op 요청이면 200에 해당하는 결과는 반환하되 history는 기록하지 않는다', async () => {
    const { service, menusRepository, menuHistoryRepository } = createHarness(MENU);
    menusRepository.applyChanges.mockResolvedValue(MENU);

    const result = await service.update(MENU.id, { price: MENU.price }, ADMIN_ID);

    expect(result).toEqual(MENU);
    expect(menuHistoryRepository.create).not.toHaveBeenCalled();
  });
});

import { PaymentSettingsService } from '../../../src/payment-settings/payment-settings.service';
import { DatabaseService } from '../../../src/database/database.service';
import { PaymentSettingsRepository } from '../../../src/payment-settings/payment-settings.repository';
import { PaymentSettingsHistoryRepository } from '../../../src/payment-settings/payment-settings-history.repository';
import { ApiException } from '../../../src/common/filters/api.exception';
import { ERROR_CODE } from '../../../src/common/contracts/api-error';
import { PaymentSettingsView } from '../../../src/common/contracts/payment-settings-view';

const SETTINGS: PaymentSettingsView = {
  bankName: '신한은행',
  accountNumber: '0110123456789',
  accountHolder: '홍길동',
};

const ADMIN_ID = '22222222-2222-2222-2222-222222222222';
const FAKE_CLIENT = {} as never;

function createHarness(current: PaymentSettingsView | null = SETTINGS) {
  const database = {
    withTransaction: jest.fn((work: (client: unknown) => Promise<unknown>) =>
      work(FAKE_CLIENT),
    ),
  } as unknown as jest.Mocked<DatabaseService>;

  const paymentSettingsRepository = {
    findCurrent: jest.fn(),
    findCurrentForUpdate: jest.fn().mockResolvedValue(current),
    applyChanges: jest.fn(),
  } as unknown as jest.Mocked<PaymentSettingsRepository>;

  const paymentSettingsHistoryRepository = {
    create: jest.fn(),
  } as unknown as jest.Mocked<PaymentSettingsHistoryRepository>;

  const service = new PaymentSettingsService(
    database,
    paymentSettingsRepository,
    paymentSettingsHistoryRepository,
  );

  return { service, database, paymentSettingsRepository, paymentSettingsHistoryRepository };
}

describe('PaymentSettingsService.getCurrent', () => {
  it('Repository가 반환한 현재값을 그대로 반환한다', async () => {
    const { service, paymentSettingsRepository } = createHarness();
    paymentSettingsRepository.findCurrent.mockResolvedValue(SETTINGS);

    const result = await service.getCurrent();

    expect(result).toEqual(SETTINGS);
  });

  it('아직 설정된 계좌 정보가 없으면 NOT_FOUND를 던진다', async () => {
    const { service, paymentSettingsRepository } = createHarness();
    paymentSettingsRepository.findCurrent.mockResolvedValue(null);

    await expect(service.getCurrent()).rejects.toMatchObject(
      new ApiException(ERROR_CODE.NOT_FOUND, '계좌 정보가 아직 설정되지 않았습니다.'),
    );
  });
});

describe('PaymentSettingsService.update', () => {
  const dto = {
    bankName: '국민은행',
    accountNumber: '004567890123',
    accountHolder: '김철수',
  };

  it('DTO를 그대로 Repository.applyChanges에 위임하고 결과를 반환한다', async () => {
    const { service, paymentSettingsRepository } = createHarness(SETTINGS);
    const updated = { ...SETTINGS, ...dto };
    paymentSettingsRepository.applyChanges.mockResolvedValue(updated);

    const result = await service.update(dto, ADMIN_ID);

    expect(paymentSettingsRepository.applyChanges).toHaveBeenCalledWith(
      FAKE_CLIENT,
      dto,
    );
    expect(result).toEqual(updated);
  });

  it('Transaction 안에서 findCurrentForUpdate와 applyChanges를 같은 client로 호출한다', async () => {
    const { service, paymentSettingsRepository, database } = createHarness(SETTINGS);
    paymentSettingsRepository.applyChanges.mockResolvedValue({ ...SETTINGS, ...dto });

    await service.update(dto, ADMIN_ID);

    expect(database.withTransaction).toHaveBeenCalledTimes(1);
    expect(paymentSettingsRepository.findCurrentForUpdate).toHaveBeenCalledWith(
      FAKE_CLIENT,
    );
  });

  it('이전 값이 없으면(최초 설정) History를 기록하지 않는다', async () => {
    const { service, paymentSettingsRepository, paymentSettingsHistoryRepository } =
      createHarness(null);
    paymentSettingsRepository.applyChanges.mockResolvedValue({ ...SETTINGS, ...dto });

    await service.update(dto, ADMIN_ID);

    expect(paymentSettingsHistoryRepository.create).not.toHaveBeenCalled();
  });

  it('실제로 값이 바뀌면 History에 변경 전/후 값과 adminId를 기록한다', async () => {
    const { service, paymentSettingsRepository, paymentSettingsHistoryRepository } =
      createHarness(SETTINGS);
    const updated = { ...SETTINGS, ...dto };
    paymentSettingsRepository.applyChanges.mockResolvedValue(updated);

    await service.update(dto, ADMIN_ID);

    expect(paymentSettingsHistoryRepository.create).toHaveBeenCalledTimes(1);
    expect(paymentSettingsHistoryRepository.create).toHaveBeenCalledWith(FAKE_CLIENT, {
      adminId: ADMIN_ID,
      oldBankName: SETTINGS.bankName,
      newBankName: updated.bankName,
      oldAccountNumber: SETTINGS.accountNumber,
      newAccountNumber: updated.accountNumber,
      oldAccountHolder: SETTINGS.accountHolder,
      newAccountHolder: updated.accountHolder,
    });
  });

  it('여러 필드를 동시에 바꿔도 History는 한 건만 기록한다(필드별로 쪼개지 않음)', async () => {
    const { service, paymentSettingsRepository, paymentSettingsHistoryRepository } =
      createHarness(SETTINGS);
    paymentSettingsRepository.applyChanges.mockResolvedValue({ ...SETTINGS, ...dto });

    await service.update(dto, ADMIN_ID);

    expect(paymentSettingsHistoryRepository.create).toHaveBeenCalledTimes(1);
  });

  it('보낸 값이 현재 값과 같은 no-op 요청이면 결과는 반환하되 History는 기록하지 않는다', async () => {
    const { service, paymentSettingsRepository, paymentSettingsHistoryRepository } =
      createHarness(SETTINGS);
    paymentSettingsRepository.applyChanges.mockResolvedValue(SETTINGS);

    const result = await service.update(SETTINGS, ADMIN_ID);

    expect(result).toEqual(SETTINGS);
    expect(paymentSettingsHistoryRepository.create).not.toHaveBeenCalled();
  });
});

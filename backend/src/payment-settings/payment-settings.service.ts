import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ERROR_CODE } from '../common/contracts/api-error';
import { ApiException } from '../common/filters/api.exception';
import { PaymentSettingsView } from '../common/contracts/payment-settings-view';
import { PaymentSettingsRepository } from './payment-settings.repository';
import { PaymentSettingsHistoryRepository } from './payment-settings-history.repository';
import { UpdatePaymentSettingsDto } from './dto/update-payment-settings.dto';

@Injectable()
export class PaymentSettingsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly paymentSettingsRepository: PaymentSettingsRepository,
    private readonly paymentSettingsHistoryRepository: PaymentSettingsHistoryRepository,
  ) {}

  async getCurrent(): Promise<PaymentSettingsView> {
    const current = await this.paymentSettingsRepository.findCurrent();

    if (!current) {
      throw new ApiException(
        ERROR_CODE.NOT_FOUND,
        '계좌 정보가 아직 설정되지 않았습니다.',
      );
    }

    return current;
  }

  /**
   * 현재 값 조회(잠금) → upsert → 실제로 값이 바뀐 경우에만 History 기록,
   * 이 과정을 하나의 Transaction으로 묶는다(menus.service.ts의 update()와
   * 동일한 구조). History INSERT가 실패하면(예: adminId FK 위반) 방금 실행한
   * upsert도 함께 rollback된다.
   *
   * 이전 행이 아예 없던 경우(최초 설정)는 "변경 전" 값이 존재하지 않으므로
   * History를 남기지 않는다 — 스키마의 old_* 컬럼이 NOT NULL이라 비교할
   * "이전 값"이 없는 상태를 표현할 수 없고, 최초 seed와 마찬가지로 "무(無)
   * 에서 설정"은 값의 변경이 아니라 값의 생성으로 본다.
   */
  async update(
    dto: UpdatePaymentSettingsDto,
    adminId: string,
  ): Promise<PaymentSettingsView> {
    return this.database.withTransaction(async (client) => {
      const current = await this.paymentSettingsRepository.findCurrentForUpdate(
        client,
      );

      const updated = await this.paymentSettingsRepository.applyChanges(client, {
        bankName: dto.bankName,
        accountNumber: dto.accountNumber,
        accountHolder: dto.accountHolder,
      });

      if (current) {
        const changed =
          current.bankName !== updated.bankName ||
          current.accountNumber !== updated.accountNumber ||
          current.accountHolder !== updated.accountHolder;

        if (changed) {
          await this.paymentSettingsHistoryRepository.create(client, {
            adminId,
            oldBankName: current.bankName,
            newBankName: updated.bankName,
            oldAccountNumber: current.accountNumber,
            newAccountNumber: updated.accountNumber,
            oldAccountHolder: current.accountHolder,
            newAccountHolder: updated.accountHolder,
          });
        }
      }

      return updated;
    });
  }
}

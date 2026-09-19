import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { PaymentSettingsView } from '../common/contracts/payment-settings-view';

interface PaymentSettingsRow {
  bank_name: string;
  account_number: string;
  account_holder: string;
}

function toView(row: PaymentSettingsRow): PaymentSettingsView {
  return {
    bankName: row.bank_name,
    accountNumber: row.account_number,
    accountHolder: row.account_holder,
  };
}

/**
 * payment_settings는 현재값 한 건만 유지하는 싱글턴 테이블이다
 * (`id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id)`로 행이 최대 1개만
 * 존재하도록 DB 레벨에서 강제한다).
 */
@Injectable()
export class PaymentSettingsRepository {
  constructor(private readonly database: DatabaseService) {}

  /** 공개/관리자 GET 전용 — Transaction 없이 단일 Query로 충분하다. */
  async findCurrent(): Promise<PaymentSettingsView | null> {
    const result = await this.database.query<PaymentSettingsRow>(
      'SELECT bank_name, account_number, account_holder FROM payment_settings WHERE id = true',
    );

    return result.rows[0] ? toView(result.rows[0]) : null;
  }

  /**
   * PATCH 처리를 위해 현재 값을 조회하면서 행을 잠근다(FOR UPDATE). History에
   * 정확한 "변경 전" 값을 기록하려면 같은 Transaction 안에서 읽은 값과 그
   * 다음의 upsert가 원자적이어야 한다(menus.repository.ts의
   * findByIdForUpdate와 동일한 이유). 행이 아직 없으면(최초 설정 전) 잠글
   * 대상이 없으므로 null을 반환한다 — 이 경우 두 관리자가 동시에 최초
   * 등록을 시도하는 극히 드문 경합까지는 이 잠금으로 막지 못한다(각자 다른
   * 트랜잭션이 서로 다른 "이전 값 없음" 스냅샷을 볼 수 있음). 반드시
   * applyChanges와 같은 Transaction(client)에서 호출한다.
   */
  async findCurrentForUpdate(client: PoolClient): Promise<PaymentSettingsView | null> {
    const result = await client.query<PaymentSettingsRow>(
      'SELECT bank_name, account_number, account_holder FROM payment_settings WHERE id = true FOR UPDATE',
    );

    return result.rows[0] ? toView(result.rows[0]) : null;
  }

  /**
   * 최초 등록과 갱신을 하나의 upsert로 처리한다. 반드시
   * findCurrentForUpdate와 같은 Transaction(client)에서 호출한다.
   */
  async applyChanges(
    client: PoolClient,
    data: { bankName: string; accountNumber: string; accountHolder: string },
  ): Promise<PaymentSettingsView> {
    const result = await client.query<PaymentSettingsRow>(
      `INSERT INTO payment_settings (id, bank_name, account_number, account_holder, updated_at)
       VALUES (true, $1, $2, $3, now())
       ON CONFLICT (id) DO UPDATE
         SET bank_name = EXCLUDED.bank_name,
             account_number = EXCLUDED.account_number,
             account_holder = EXCLUDED.account_holder,
             updated_at = now()
       RETURNING bank_name, account_number, account_holder`,
      [data.bankName, data.accountNumber, data.accountHolder],
    );

    return toView(result.rows[0]);
  }
}

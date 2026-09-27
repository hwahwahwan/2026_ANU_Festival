import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';

export interface CreatePaymentSettingsHistoryData {
  adminId: string;
  oldBankName: string;
  newBankName: string;
  oldAccountNumber: string;
  newAccountNumber: string;
  oldAccountHolder: string;
  newAccountHolder: string;
}

@Injectable()
export class PaymentSettingsHistoryRepository {
  async create(
    client: PoolClient,
    data: CreatePaymentSettingsHistoryData,
  ): Promise<void> {
    await client.query(
      `INSERT INTO payment_settings_history
         (admin_id, old_bank_name, new_bank_name,
          old_account_number, new_account_number,
          old_account_holder, new_account_holder)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        data.adminId,
        data.oldBankName,
        data.newBankName,
        data.oldAccountNumber,
        data.newAccountNumber,
        data.oldAccountHolder,
        data.newAccountHolder,
      ],
    );
  }
}

CREATE TABLE payment_settings_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES admins(id),
  old_bank_name TEXT NOT NULL,
  new_bank_name TEXT NOT NULL,
  old_account_number VARCHAR NOT NULL,
  new_account_number VARCHAR NOT NULL,
  old_account_holder TEXT NOT NULL,
  new_account_holder TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

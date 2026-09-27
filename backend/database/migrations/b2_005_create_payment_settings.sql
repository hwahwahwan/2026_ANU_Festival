CREATE TABLE payment_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  bank_name TEXT NOT NULL,
  account_number VARCHAR NOT NULL,
  account_holder TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

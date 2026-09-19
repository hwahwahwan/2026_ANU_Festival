CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE,
  order_request_id UUID NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PAYMENT_PENDING'
    CHECK (status IN (
      'PAYMENT_PENDING',
      'ACCEPTED',
      'COOKING',
      'READY',
      'COMPLETED',
      'CANCELLED'
    )),
  total_price INTEGER NOT NULL CHECK (total_price >= 0),
  payment_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

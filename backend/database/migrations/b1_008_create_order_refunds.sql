CREATE TABLE order_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id),
  refund_request_id UUID NOT NULL UNIQUE,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_by UUID NOT NULL,
  reason TEXT
);

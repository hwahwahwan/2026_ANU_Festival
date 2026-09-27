ALTER TABLE orders
  ADD COLUMN request_fingerprint TEXT NOT NULL DEFAULT '';

ALTER TABLE orders
  ALTER COLUMN request_fingerprint DROP DEFAULT;

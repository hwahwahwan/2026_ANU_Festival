CREATE TABLE menus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  is_available BOOLEAN NOT NULL DEFAULT true
);

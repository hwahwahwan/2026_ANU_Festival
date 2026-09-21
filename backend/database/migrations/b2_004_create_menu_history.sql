CREATE TABLE menu_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id UUID NOT NULL REFERENCES menus(id),
  admin_id UUID NOT NULL REFERENCES admins(id),
  old_price INTEGER NOT NULL CHECK (old_price >= 0),
  new_price INTEGER NOT NULL CHECK (new_price >= 0),
  old_is_available BOOLEAN NOT NULL,
  new_is_available BOOLEAN NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_menu_history_menu_id ON menu_history(menu_id);

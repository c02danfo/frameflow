-- Init SQL för inventory-artyx
-- Kör denna fil mot din lokala PostgreSQL (t.ex. psql -f init.sql)

-- Skapa users-tabell
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Skapa items-tabell
CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  sku VARCHAR(100) UNIQUE,
  name TEXT NOT NULL,
  category VARCHAR(100),
  unit VARCHAR(20),
  purchase_price NUMERIC(12,2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Skapa stock_locations-tabell
CREATE TABLE IF NOT EXISTS stock_locations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL
);

-- Skapa stock_levels-tabell
CREATE TABLE IF NOT EXISTS stock_levels (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES stock_locations(id) ON DELETE CASCADE,
  quantity NUMERIC DEFAULT 0,
  UNIQUE(item_id, location_id)
);

-- Litet exempel på initial data
INSERT INTO stock_locations (name) VALUES ('Huvudlager') ON CONFLICT DO NOTHING;

-- Migration: lägg till quantity och sales_price om de saknas
ALTER TABLE items ADD COLUMN IF NOT EXISTS quantity NUMERIC DEFAULT 0;
ALTER TABLE items ADD COLUMN IF NOT EXISTS sales_price NUMERIC(12,2);
ALTER TABLE items ADD COLUMN IF NOT EXISTS supplier TEXT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS price_group VARCHAR(100);

-- Migration: lägg till multi-unit support (Option 3)
ALTER TABLE items ADD COLUMN IF NOT EXISTS stock_unit VARCHAR(50);
ALTER TABLE items ADD COLUMN IF NOT EXISTS sales_unit VARCHAR(50);
ALTER TABLE items ADD COLUMN IF NOT EXISTS unit_size NUMERIC(10,4);
ALTER TABLE items ADD COLUMN IF NOT EXISTS unit_dimensions JSONB;

-- Migration: lägg till color attribute
ALTER TABLE items ADD COLUMN IF NOT EXISTS color VARCHAR(100);

-- Migration: lägg till barcode och relaterade kolumner
ALTER TABLE items ADD COLUMN IF NOT EXISTS barcode VARCHAR(100);
ALTER TABLE items ADD COLUMN IF NOT EXISTS barcode_type VARCHAR(50);
ALTER TABLE items ADD COLUMN IF NOT EXISTS supplier_item_number VARCHAR(100);
ALTER TABLE items ADD COLUMN IF NOT EXISTS stock_value NUMERIC(12,2);

-- Price groups
CREATE TABLE IF NOT EXISTS price_groups (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  markup_percentage NUMERIC(10,2) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Skapa unique index för barcode (tillåt NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_barcode_unique
  ON items(barcode) WHERE barcode IS NOT NULL;

-- Item images table for product photos
CREATE TABLE IF NOT EXISTS item_images (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  original_filename VARCHAR(255),
  display_order INTEGER DEFAULT 0,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_images_item_id ON item_images(item_id);

-- Helper tabell för kategori-prefix och SKU-räknare
CREATE TABLE IF NOT EXISTS category_prefixes (
  category        TEXT PRIMARY KEY,
  prefix          CHAR(4) NOT NULL UNIQUE,
  next_seq        INTEGER NOT NULL DEFAULT 1
);

-- Funktion: härleda prefix från kategori (4 tecken, uppercase)
CREATE OR REPLACE FUNCTION derive_prefix(cat TEXT)
RETURNS CHAR(4) AS $$
DECLARE
  pfx CHAR(4);
BEGIN
  IF cat IS NULL OR btrim(cat) = '' THEN
    RETURN 'GENR';
  END IF;
  pfx := upper(substr(btrim(cat), 1, 4));
  pfx := rpad(pfx, 4, 'X');
  RETURN pfx;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Funktion: hämta eller skapa prefix-rad och konsumera sekvens (concurrency-safe)
CREATE OR REPLACE FUNCTION consume_prefix_seq(cat TEXT)
RETURNS TABLE(prefix CHAR(4), seq INT) AS $$
DECLARE
  p CHAR(4);
BEGIN
  p := derive_prefix(cat);

  -- Säkerställ att rad finns
  INSERT INTO category_prefixes(category, prefix)
  VALUES (cat, p)
  ON CONFLICT (category) DO NOTHING;

  -- Lås rad och konsumera sekvens
  UPDATE category_prefixes cp
  SET next_seq = next_seq + 1
  WHERE cp.category = cat
  RETURNING cp.prefix, cp.next_seq - 1 INTO prefix, seq;

  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Trigger-funktion: generera SKU vid INSERT om saknas; förhindra SKU-ändringar vid UPDATE
CREATE OR REPLACE FUNCTION trg_items_sku_manage()
RETURNS TRIGGER AS $$
DECLARE
  gen_prefix CHAR(4);
  gen_seq INT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Generera SKU om det saknas
    IF NEW.sku IS NULL OR btrim(NEW.sku) = '' THEN
      SELECT prefix, seq INTO gen_prefix, gen_seq FROM consume_prefix_seq(NEW.category);
      NEW.sku := gen_prefix || '-' || lpad(gen_seq::text, 4, '0');
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- SKU är immutable - förhindra ändringar
    IF NEW.sku IS DISTINCT FROM OLD.sku THEN
      RAISE EXCEPTION 'SKU är immutable och kan inte ändras';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Skapa trigger
DROP TRIGGER IF EXISTS trg_items_sku_manage ON items;
CREATE TRIGGER trg_items_sku_manage
BEFORE INSERT OR UPDATE ON items
FOR EACH ROW
EXECUTE FUNCTION trg_items_sku_manage();
-- Session table för express-session med connect-pg-simple
CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);

-- Insert default admin user for inventory-artyx
-- Password hash för "admin123": $2b$10$rBV2uYhZEzQQfFQ6hN6EYeGKZ.TxLvH2h6yR8pN8LhXnN9Wq5xK5i
INSERT INTO users (name, email, password_hash, role) 
VALUES ('Admin User', 'admin@inventory.local', '$2b$10$rBV2uYhZEzQQfFQ6hN6EYeGKZ.TxLvH2h6yR8pN8LhXnN9Wq5xK5i', 'admin')
ON CONFLICT (email) DO NOTHING;
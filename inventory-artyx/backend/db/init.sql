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

-- ============================================================================
-- SERVICES TABLE
-- För tjänster som glasbyte, montage, specialarbete, etc.
-- ============================================================================

CREATE TABLE IF NOT EXISTS services (
  id SERIAL PRIMARY KEY,
  sku VARCHAR(100) UNIQUE,
  name TEXT NOT NULL,
  category VARCHAR(100), -- 'Glasbyte', 'Montage', 'Reparation', 'Specialarbete', etc.
  description TEXT,
  
  -- === PRISSÄTTNING (stödjer flera modeller) ===
  pricing_model VARCHAR(50) NOT NULL DEFAULT 'fixed', 
    -- 'fixed', 'hourly', 'per_unit', 'base_plus_hourly'
  
  -- Fast pris (används för 'fixed' och som bas i 'base_plus_hourly')
  base_price NUMERIC(12,2),
  
  -- Timpris (används för 'hourly' och 'base_plus_hourly')
  hourly_rate NUMERIC(12,2),
  
  -- Per enhet (används för 'per_unit')
  price_per_unit NUMERIC(12,2),
  unit_type VARCHAR(50), -- 'cm', 'dm2', 'sqm', 'piece', etc.
  
  -- === TIDSESTIMERING (standard-värden) ===
  default_duration_minutes INTEGER, -- Standard tid för tjänsten
  min_duration_minutes INTEGER, -- Minsta förväntade tid
  max_duration_minutes INTEGER, -- Längsta förväntade tid
  
  -- === KOMPLEXITET & RESURSER ===
  difficulty_level VARCHAR(50), -- 'easy', 'medium', 'hard', 'expert'
  requires_specialist BOOLEAN DEFAULT false,
  requires_equipment TEXT, -- T.ex. "Pressmaskin, Lödkolv"
  
  -- === KOSTNADSKALKYL (intern) ===
  internal_cost_per_hour NUMERIC(12,2), -- Din interna kostnad
  
  -- === METADATA ===
  is_active BOOLEAN DEFAULT true,
  is_billable BOOLEAN DEFAULT true, -- Vissa tjänster kanske är gratis
  requires_approval BOOLEAN DEFAULT false,
  notes TEXT, -- Kundsynliga anteckningar
  internal_notes TEXT, -- Interna anteckningar
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_services_category ON services(category);
CREATE INDEX IF NOT EXISTS idx_services_active ON services(is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_services_sku_unique ON services(sku) WHERE sku IS NOT NULL;

-- ============================================================================
-- SKU GENERATION FOR SERVICES
-- ============================================================================

CREATE TABLE IF NOT EXISTS service_category_prefixes (
  category TEXT PRIMARY KEY,
  prefix CHAR(4) NOT NULL UNIQUE,
  next_seq INTEGER NOT NULL DEFAULT 1
);

-- Funktion: härleda service prefix från kategori
CREATE OR REPLACE FUNCTION derive_service_prefix(cat TEXT)
RETURNS CHAR(4) AS $$
DECLARE
  pfx CHAR(4);
BEGIN
  IF cat IS NULL OR btrim(cat) = '' THEN
    RETURN 'SERV';
  END IF;
  pfx := upper(substr(btrim(cat), 1, 4));
  pfx := rpad(pfx, 4, 'X');
  RETURN pfx;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Funktion: konsumera service prefix sekvens
CREATE OR REPLACE FUNCTION consume_service_prefix_seq(cat TEXT)
RETURNS TABLE(prefix CHAR(4), seq INT) AS $$
DECLARE
  p CHAR(4);
  result_prefix CHAR(4);
  result_seq INT;
BEGIN
  p := derive_service_prefix(cat);
  
  INSERT INTO service_category_prefixes(category, prefix)
  VALUES (cat, p)
  ON CONFLICT (category) DO NOTHING;
  
  UPDATE service_category_prefixes scp
  SET next_seq = next_seq + 1
  WHERE scp.category = cat
  RETURNING scp.prefix, scp.next_seq - 1 INTO result_prefix, result_seq;
  
  prefix := result_prefix;
  seq := result_seq;
  RETURN NEXT;
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Trigger-funktion: SKU-hantering för services
CREATE OR REPLACE FUNCTION trg_services_sku_manage()
RETURNS TRIGGER AS $$
DECLARE
  gen_prefix CHAR(4);
  gen_seq INT;
  effective_category TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.sku IS NULL OR btrim(NEW.sku) = '' THEN
      -- Use category or default to 'Service' if NULL
      effective_category := COALESCE(NEW.category, 'Service');
      
      SELECT prefix, seq INTO gen_prefix, gen_seq FROM consume_service_prefix_seq(effective_category) LIMIT 1;
      IF gen_prefix IS NOT NULL THEN
        NEW.sku := gen_prefix || '-' || lpad(gen_seq::text, 4, '0');
      END IF;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Allow setting SKU from NULL/empty to a value, but prevent other changes
    IF (OLD.sku IS NOT NULL AND btrim(OLD.sku) != '') AND NEW.sku IS DISTINCT FROM OLD.sku THEN
      RAISE EXCEPTION 'SKU är immutable och kan inte ändras';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_services_sku_manage ON services;
DROP TRIGGER IF EXISTS aaa_services_sku_manage ON services;
CREATE TRIGGER aaa_services_sku_manage
BEFORE INSERT OR UPDATE ON services
FOR EACH ROW
EXECUTE FUNCTION trg_services_sku_manage();

-- ============================================================================
-- ORDER LINE ITEMS
-- Kombinerar både items (produkter) och services (tjänster) i orders
-- ============================================================================

CREATE TABLE IF NOT EXISTS order_line_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL, -- Refererar till orders i framing-app
  
  -- Referens till antingen item ELLER service
  item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  line_type VARCHAR(20) NOT NULL, -- 'item' or 'service'
  
  -- Beskrivning (kan överskriva från service/item)
  description TEXT,
  
  -- === PRISSÄTTNING ===
  pricing_model VARCHAR(50), -- Kopierad från service
  quantity NUMERIC(10,2) NOT NULL DEFAULT 1, -- Antal (timmar, cm, st, etc.)
  unit_price NUMERIC(12,2) NOT NULL, -- Pris per enhet
  
  -- === TID (endast för services) ===
  estimated_minutes INTEGER, -- Kopierad från service.default_duration_minutes
  actual_minutes INTEGER, -- Verklig tid (fylls i efter arbete)
  
  -- === BERÄKNAT PRIS ===
  subtotal NUMERIC(12,2) NOT NULL, -- unit_price * quantity
  discount_amount NUMERIC(12,2) DEFAULT 0,
  total_price NUMERIC(12,2) NOT NULL, -- subtotal - discount
  
  -- === METADATA ===
  notes TEXT, -- Kundsynliga anteckningar
  internal_notes TEXT, -- Interna anteckningar
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'in_progress', 'completed', 'cancelled'
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  CONSTRAINT check_item_or_service CHECK (
    (item_id IS NOT NULL AND service_id IS NULL AND line_type = 'item') OR
    (item_id IS NULL AND service_id IS NOT NULL AND line_type = 'service')
  )
);

CREATE INDEX IF NOT EXISTS idx_order_line_items_order ON order_line_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_line_items_item ON order_line_items(item_id);
CREATE INDEX IF NOT EXISTS idx_order_line_items_service ON order_line_items(service_id);

-- ============================================================================
-- DEFAULT SERVICES DATA
-- ============================================================================

INSERT INTO services (name, category, description, pricing_model, base_price, default_duration_minutes, difficulty_level, is_active) VALUES
('Glasbyte', 'Glasbyte', 'Byte av glas i befintlig ram', 'fixed', 200.00, 30, 'easy', true),
('Byte av ram', 'Byte av ram', 'Demontering och montering av ny ram', 'fixed', 300.00, 45, 'medium', true),
('Specialmontage', 'Montage', 'Specialmontage för komplexa ramar', 'hourly', NULL, 120, 'hard', true),
('Montage av canvasdukt', 'Montage', 'Montering av canvasdukt på kilram', 'fixed', 400.00, 60, 'medium', true),
('Passepartout-skärning', 'Passepartout', 'Skärning av passepartout efter mått', 'per_unit', NULL, 20, 'easy', true),
('Ramrestaurering', 'Reparation', 'Restaurering av skadad ram', 'base_plus_hourly', 300.00, 180, 'expert', true)
ON CONFLICT (sku) DO NOTHING;

-- Uppdatera hourly_rate och price_per_unit för de tjänster som behöver det
UPDATE services SET hourly_rate = 500.00 WHERE name = 'Specialmontage';
UPDATE services SET price_per_unit = 15.00, unit_type = 'cm' WHERE name = 'Passepartout-skärning';
UPDATE services SET hourly_rate = 400.00 WHERE name = 'Ramrestaurering';
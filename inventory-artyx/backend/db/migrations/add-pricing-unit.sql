-- Add pricing_unit column to items table
-- This enables per-unit pricing for materials (per piece, per meter, per square meter)

-- Add the column with default 'st' (piece)
ALTER TABLE items ADD COLUMN IF NOT EXISTS pricing_unit VARCHAR(20) DEFAULT 'st';

-- Set pricing_unit based on category patterns
UPDATE items SET pricing_unit = 'm' WHERE category ILIKE '%list%';
UPDATE items SET pricing_unit = 'm2' WHERE category ILIKE '%glas%' OR category ILIKE '%kartong%';

-- Add check constraint to ensure valid values
ALTER TABLE items ADD CONSTRAINT check_pricing_unit 
  CHECK (pricing_unit IN ('st', 'm', 'm2', 'kg', 'l'));

COMMENT ON COLUMN items.pricing_unit IS 'Pricing unit: st (piece), m (meter), m2 (square meter), kg (kilogram), l (liter)';

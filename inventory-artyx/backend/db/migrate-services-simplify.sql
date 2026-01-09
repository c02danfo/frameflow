-- Migration: Simplify services table and add barcode
-- Ta bort onödiga kolumner
ALTER TABLE services DROP COLUMN IF EXISTS min_duration_minutes;
ALTER TABLE services DROP COLUMN IF EXISTS max_duration_minutes;
ALTER TABLE services DROP COLUMN IF EXISTS requires_specialist;
ALTER TABLE services DROP COLUMN IF EXISTS requires_equipment;
ALTER TABLE services DROP COLUMN IF EXISTS is_active;
ALTER TABLE services DROP COLUMN IF EXISTS is_billable;
ALTER TABLE services DROP COLUMN IF EXISTS notes;

-- Lägg till barcode-kolumner
ALTER TABLE services ADD COLUMN IF NOT EXISTS barcode VARCHAR(100);
ALTER TABLE services ADD COLUMN IF NOT EXISTS barcode_type VARCHAR(50) DEFAULT 'CODE128';

-- Skapa index för barcode
CREATE UNIQUE INDEX IF NOT EXISTS idx_services_barcode_unique ON services(barcode) WHERE barcode IS NOT NULL;

-- Funktion för att auto-generera barcode från SKU
CREATE OR REPLACE FUNCTION trg_services_barcode_generate()
RETURNS TRIGGER AS $$
BEGIN
  -- Om barcode är tom och SKU finns, generera barcode baserat på SKU
  IF (NEW.barcode IS NULL OR btrim(NEW.barcode) = '') AND NEW.sku IS NOT NULL THEN
    NEW.barcode := NEW.sku;
    IF NEW.barcode_type IS NULL THEN
      NEW.barcode_type := 'CODE128';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Skapa trigger för barcode-generering
DROP TRIGGER IF EXISTS trg_services_barcode_generate ON services;
CREATE TRIGGER trg_services_barcode_generate
BEFORE INSERT OR UPDATE ON services
FOR EACH ROW
EXECUTE FUNCTION trg_services_barcode_generate();

-- Generera barcodes för befintliga tjänster
UPDATE services SET barcode = sku WHERE barcode IS NULL AND sku IS NOT NULL;
UPDATE services SET barcode_type = 'CODE128' WHERE barcode IS NOT NULL AND barcode_type IS NULL;

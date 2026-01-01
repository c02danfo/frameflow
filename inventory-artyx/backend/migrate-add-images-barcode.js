// Migration: Add images, supplier item number, and barcode support
const db = require('./src/db');

async function runMigration() {
  try {
    console.log('🚀 Starting migration: Add images, supplier_item_number, barcode, and SKU generation...');
    
    // Add new columns to items table
    console.log('Adding columns to items table...');
    await db.query(`
      ALTER TABLE items 
      ADD COLUMN IF NOT EXISTS supplier_item_number VARCHAR(100),
      ADD COLUMN IF NOT EXISTS barcode VARCHAR(50),
      ADD COLUMN IF NOT EXISTS barcode_type VARCHAR(20) DEFAULT 'CODE128'
    `);

    // SKU rule: first 3 letters of category + '-' + 4 digits (per prefix counter)
    // Example: category "Ramlist" -> RAM-0001
    console.log('Ensuring SKU generation trigger exists...');

    await db.query(`
      CREATE TABLE IF NOT EXISTS sku_counters (
        prefix TEXT PRIMARY KEY,
        last_value INTEGER NOT NULL
      );
    `);

    await db.query(`
      CREATE OR REPLACE FUNCTION gen_item_sku(cat TEXT)
      RETURNS TEXT
      LANGUAGE plpgsql
      AS $$
      DECLARE
        pfx TEXT;
        n   INTEGER;
      BEGIN
        -- Keep letters (including ÅÄÖ), remove non-letters, uppercase
        pfx := upper(regexp_replace(coalesce(cat, ''), '[^A-Za-zÅÄÖåäö]', '', 'g'));
        pfx := left(pfx, 3);

        IF pfx IS NULL OR pfx = '' THEN
          pfx := 'UNK';
        END IF;

        IF length(pfx) < 3 THEN
          pfx := rpad(pfx, 3, 'X');
        END IF;

        INSERT INTO sku_counters(prefix, last_value)
        VALUES (pfx, 1)
        ON CONFLICT (prefix)
        DO UPDATE SET last_value = sku_counters.last_value + 1
        RETURNING last_value INTO n;

        RETURN pfx || '-' || lpad(n::text, 4, '0');
      END;
      $$;
    `);

    await db.query(`
      CREATE OR REPLACE FUNCTION trg_items_set_sku()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW.sku IS NULL OR NEW.sku = '' THEN
          NEW.sku := gen_item_sku(NEW.category);
        END IF;
        RETURN NEW;
      END;
      $$;
    `);

    await db.query(`DROP TRIGGER IF EXISTS items_set_sku ON items;`);
    await db.query(`
      CREATE TRIGGER items_set_sku
      BEFORE INSERT ON items
      FOR EACH ROW
      EXECUTE FUNCTION trg_items_set_sku();
    `);
    
    // Create indexes
    console.log('Creating indexes...');
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_items_supplier_item_number ON items(supplier_item_number);
    `);
    
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_items_barcode ON items(barcode) WHERE barcode IS NOT NULL AND barcode <> '';
    `);

    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_items_sku_unique ON items(sku) WHERE sku IS NOT NULL AND sku <> '';
    `);
    
    // Create item_images table
    console.log('Creating item_images table...');
    await db.query(`
      CREATE TABLE IF NOT EXISTS item_images (
        id SERIAL PRIMARY KEY,
        item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
        filename VARCHAR(255) NOT NULL,
        display_order INTEGER DEFAULT 0,
        is_primary BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_item_images_item_id ON item_images(item_id);
    `);
    
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_item_images_display_order ON item_images(item_id, display_order);
    `);
    
    console.log('✅ Migration completed successfully!');
    console.log('\nNotes:');
    console.log('- SKU is now generated on INSERT if omitted/blank (e.g. RAM-0001)');
    console.log('- Barcode is unique when non-empty');
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration error:', err);
    process.exit(1);
  }
}

runMigration();

// Migration script to update database schema
const db = require('./src/db');

async function runMigrations() {
  try {
    console.log('Running migrations...');
    
    // Add missing columns
    await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS quantity NUMERIC DEFAULT 0`);
    console.log('✓ Added quantity column');
    
    await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS sales_price NUMERIC(12,2)`);
    console.log('✓ Added sales_price column');
    
    await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS supplier TEXT`);
    console.log('✓ Added supplier column');
    
    await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS price_group VARCHAR(100)`);
    console.log('✓ Added price_group column');
    
    await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS stock_unit VARCHAR(50)`);
    console.log('✓ Added stock_unit column');
    
    await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS sales_unit VARCHAR(50)`);
    console.log('✓ Added sales_unit column');
    
    await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS unit_size NUMERIC(10,4)`);
    console.log('✓ Added unit_size column');
    
    await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS unit_dimensions JSONB`);
    console.log('✓ Added unit_dimensions column');
    
    await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS color VARCHAR(100)`);
    console.log('✓ Added color column');
    
    console.log('\n✅ All migrations completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration error:', err);
    process.exit(1);
  }
}

runMigrations();

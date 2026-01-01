// Migration script to create price_groups table
const db = require('./src/db');

async function runMigrations() {
  try {
    console.log('Creating price_groups table...');
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS price_groups (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        markup_percentage NUMERIC(10,2) NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    console.log('✓ Created price_groups table');
    
    // Add some example price groups
    await db.query(`
      INSERT INTO price_groups (name, markup_percentage, description) 
      VALUES 
        ('A', 200, 'Standard markup - 200%'),
        ('B', 225, 'Premium markup - 225%'),
        ('C', 250, 'High-end markup - 250%')
      ON CONFLICT (name) DO NOTHING
    `);
    console.log('✓ Added example price groups');
    
    console.log('\n✅ Price groups migration completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration error:', err);
    process.exit(1);
  }
}

runMigrations();

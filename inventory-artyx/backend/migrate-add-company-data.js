const { Pool } = require('pg');
require('dotenv').config({ path: '../.env' });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE
});

async function migrate() {
  try {
    console.log('🔄 Adding company_data table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS company_data (
          id INTEGER PRIMARY KEY,
          display_name TEXT,
          legal_name TEXT,
          email TEXT,
          phone TEXT,
          website TEXT,
          address_line1 TEXT,
          address_line2 TEXT,
          postal_code TEXT,
          city TEXT,
          region TEXT,
          country TEXT,
          tax_id TEXT,
          company_id TEXT,
          locale TEXT DEFAULT 'en-US',
          currency TEXT DEFAULT 'USD',
          timezone TEXT DEFAULT 'UTC',
          vat_rate_percentage DECIMAL(5,2) DEFAULT 25.00,
          logo_path TEXT,
          settings JSONB DEFAULT '{}'::jsonb,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO company_data (id)
      VALUES (1)
      ON CONFLICT (id) DO NOTHING;
    `);
    console.log('✅ company_data table created successfully');
  } catch (err) {
    console.error('❌ Migration error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'inventory_artyx',
});

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'db', 'init.sql'), 'utf8');
  
  try {
    await pool.query(sql);
    console.log('✅ Migration completed successfully');
    console.log('   - category_prefixes table created');
    console.log('   - derive_prefix() function created');
    console.log('   - consume_prefix_seq() function created');
    console.log('   - trg_items_sku_manage() trigger created');
    console.log('   - SKU will now auto-generate on INSERT');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();

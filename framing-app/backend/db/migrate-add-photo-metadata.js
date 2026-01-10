const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({
  host: process.env.FRAMING_DB_HOST || process.env.DB_HOST || 'localhost',
  port: process.env.FRAMING_DB_PORT || process.env.DB_PORT || 5433,
  database: process.env.FRAMING_DB_NAME || process.env.DB_NAME || 'frameflow_framing',
  user: process.env.FRAMING_DB_USER || process.env.DB_USER || 'framing_user',
  password: process.env.FRAMING_DB_PASSWORD || process.env.DB_PASSWORD || 'framing123'
});

async function migrate() {
  const client = await pool.connect();
  
  try {
    console.log('Starting migration: Add metadata column to frame_orders...');
    
    // Add metadata column if it doesn't exist
    await client.query(`
      ALTER TABLE frame_orders 
      ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
    `);
    
    console.log('✓ Added metadata column to frame_orders');
    
    // Create index for better JSONB query performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_frame_orders_metadata 
      ON frame_orders USING gin(metadata);
    `);
    
    console.log('✓ Created GIN index on metadata column');
    console.log('Migration completed successfully!');
    
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});

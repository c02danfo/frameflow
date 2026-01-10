const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pool = new Pool({
  host: process.env.FRAMING_DB_HOST || process.env.DB_HOST,
  port: process.env.FRAMING_DB_PORT || process.env.DB_PORT,
  database: process.env.FRAMING_DB_NAME || process.env.DB_NAME,
  user: process.env.FRAMING_DB_USER || process.env.DB_USER,
  password: process.env.FRAMING_DB_PASSWORD || process.env.DB_PASSWORD,
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Starting migration: Create frame_order_items and frame_order_templates tables...');
    
    await client.query('BEGIN');
    
    // Create frame_order_items table
    await client.query(`
      CREATE TABLE IF NOT EXISTS frame_order_items (
        id SERIAL PRIMARY KEY,
        frame_order_id INTEGER NOT NULL REFERENCES frame_orders(id) ON DELETE CASCADE,
        item_type VARCHAR(50) NOT NULL, -- 'frame', 'glass', 'passepartout', 'backing', 'labor'
        item_id INTEGER, -- Reference to inventory item (can be null for custom items)
        item_name VARCHAR(255),
        item_sku VARCHAR(50),
        quantity DECIMAL(10,2) DEFAULT 1,
        unit VARCHAR(20), -- 'meter', 'sqm', 'piece', 'hour'
        unit_price DECIMAL(10,2),
        total_cost DECIMAL(10,2),
        metadata JSONB DEFAULT '{}'::jsonb, -- Flexible data: pp edges, time, notes, etc.
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    console.log('✓ Created frame_order_items table');
    
    // Create frame_order_templates table
    await client.query(`
      CREATE TABLE IF NOT EXISTS frame_order_templates (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        items JSONB DEFAULT '[]'::jsonb, -- Array of template items
        default_passepartout_edges JSONB DEFAULT '{}'::jsonb, -- Default PP edges
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    console.log('✓ Created frame_order_templates table');
    
    // Create indexes for performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_frame_order_items_frame_order_id 
      ON frame_order_items(frame_order_id);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_frame_order_items_item_type 
      ON frame_order_items(item_type);
    `);
    
    console.log('✓ Created indexes');
    
    await client.query('COMMIT');
    
    console.log('✓ Migration completed successfully!');
    console.log('  - frame_order_items: Stores flexible list of items per order');
    console.log('  - frame_order_templates: Stores reusable templates');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(console.error);

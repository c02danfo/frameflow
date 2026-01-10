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
    console.log('Starting migration: Update order status values...');
    
    // Uppdatera befintliga statusvärden
    await client.query(`
      UPDATE customer_orders 
      SET status = CASE 
        WHEN status = 'draft' THEN 'Offert'
        WHEN status = 'confirmed' THEN 'Ej påbörjad'
        ELSE status
      END
    `);
    
    console.log('✓ Migration completed successfully!');
    console.log('  - Updated existing status values');
    console.log('  - New status values: Offert, Ej påbörjad, Påbörjad, Klart, Utlämnad');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(console.error);

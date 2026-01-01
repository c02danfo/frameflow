require('dotenv').config();
const { Client } = require('pg');

async function migrate() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  await client.connect();
  console.log('Kör migration: lägger till arbete (labor) på frame_orders...');

  const sql = `
    ALTER TABLE IF EXISTS frame_orders
      ADD COLUMN IF NOT EXISTS labor_item_id INTEGER,
      ADD COLUMN IF NOT EXISTS labor_item_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS labor_item_sku VARCHAR(50),
      ADD COLUMN IF NOT EXISTS labor_price DECIMAL(10,2),
      ADD COLUMN IF NOT EXISTS labor_cost DECIMAL(10,2);
  `;

  try {
    await client.query(sql);
    console.log('✓ Migration klar');
  } catch (e) {
    console.error('Fel vid migration:', e.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

migrate();

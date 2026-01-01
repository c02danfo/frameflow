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
  console.log('Kör migration: lägger till motiv- och passepartout-kolumner (mm)...');

  const sql = `
    ALTER TABLE IF EXISTS frame_orders
      ADD COLUMN IF NOT EXISTS motiv_width_mm DECIMAL(10,2),
      ADD COLUMN IF NOT EXISTS motiv_height_mm DECIMAL(10,2),
      ADD COLUMN IF NOT EXISTS pp_left_mm DECIMAL(10,2),
      ADD COLUMN IF NOT EXISTS pp_right_mm DECIMAL(10,2),
      ADD COLUMN IF NOT EXISTS pp_top_mm DECIMAL(10,2),
      ADD COLUMN IF NOT EXISTS pp_bottom_mm DECIMAL(10,2),
      ADD COLUMN IF NOT EXISTS circumference_mm DECIMAL(10,2),
      ADD COLUMN IF NOT EXISTS outer_area_sqm DECIMAL(10,4),
      ADD COLUMN IF NOT EXISTS passepartout2_item_id INTEGER,
      ADD COLUMN IF NOT EXISTS passepartout2_item_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS passepartout2_item_sku VARCHAR(50),
      ADD COLUMN IF NOT EXISTS passepartout2_price_per_sqm DECIMAL(10,2),
      ADD COLUMN IF NOT EXISTS pp2_left_mm DECIMAL(10,2),
      ADD COLUMN IF NOT EXISTS pp2_right_mm DECIMAL(10,2),
      ADD COLUMN IF NOT EXISTS pp2_top_mm DECIMAL(10,2),
      ADD COLUMN IF NOT EXISTS pp2_bottom_mm DECIMAL(10,2),
      ADD COLUMN IF NOT EXISTS passepartout2_area_sqm DECIMAL(10,4),
      ADD COLUMN IF NOT EXISTS passepartout2_cost DECIMAL(10,2),
      ADD COLUMN IF NOT EXISTS manual_simple_price_per_meter DECIMAL(10,2);
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

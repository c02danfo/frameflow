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
  console.log('Kör migration: lägger till antal på frame_orders...');

  try {
    await client.query(`ALTER TABLE IF EXISTS frame_orders ADD COLUMN IF NOT EXISTS antal INTEGER;`);
    await client.query(`UPDATE frame_orders SET antal = 1 WHERE antal IS NULL;`);
    await client.query(`ALTER TABLE IF EXISTS frame_orders ALTER COLUMN antal SET DEFAULT 1;`);
    await client.query(`ALTER TABLE IF EXISTS frame_orders ALTER COLUMN antal SET NOT NULL;`);
    console.log('✓ Migration klar');
  } catch (e) {
    console.error('Fel vid migration:', e.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

migrate();

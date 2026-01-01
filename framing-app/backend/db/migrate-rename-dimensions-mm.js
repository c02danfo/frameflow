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
  console.log('Kör migration: byter kolumnnamn *_cm -> *_mm (värden är mm)...');

  const renames = [
    ['width_cm', 'width_mm'],
    ['height_cm', 'height_mm'],

    ['motiv_width_cm', 'motiv_width_mm'],
    ['motiv_height_cm', 'motiv_height_mm'],

    ['pp_left_cm', 'pp_left_mm'],
    ['pp_right_cm', 'pp_right_mm'],
    ['pp_top_cm', 'pp_top_mm'],
    ['pp_bottom_cm', 'pp_bottom_mm'],

    // OBS: detta fält har historiskt varit mm trots namnet _cm
    ['circumference_cm', 'circumference_mm'],

    ['passepartout_width_cm', 'passepartout_width_mm'],

    ['pp2_left_cm', 'pp2_left_mm'],
    ['pp2_right_cm', 'pp2_right_mm'],
    ['pp2_top_cm', 'pp2_top_mm'],
    ['pp2_bottom_cm', 'pp2_bottom_mm'],
  ];

  const sql = `
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT old_name, new_name
    FROM (VALUES
      ${renames.map(([oldName, newName]) => `('${oldName}', '${newName}')`).join(',\n      ')}
    ) AS t(old_name, new_name)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'frame_orders'
        AND column_name = r.old_name
    ) AND NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'frame_orders'
        AND column_name = r.new_name
    ) THEN
      EXECUTE format('ALTER TABLE frame_orders RENAME COLUMN %I TO %I', r.old_name, r.new_name);
    END IF;
  END LOOP;
END $$;
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

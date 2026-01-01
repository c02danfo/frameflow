// Migrationsskript för att fixa ambiguous prefix column reference
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Uppdaterar consume_prefix_seq-funktionen...');
    
    await client.query(`
      CREATE OR REPLACE FUNCTION consume_prefix_seq(cat TEXT)
      RETURNS TABLE(prefix CHAR(4), seq INT) AS $$
      DECLARE
        p CHAR(4);
      BEGIN
        p := derive_prefix(cat);

        -- Säkerställ att rad finns
        INSERT INTO category_prefixes(category, prefix)
        VALUES (cat, p)
        ON CONFLICT (category) DO NOTHING;

        -- Lås rad och konsumera sekvens (cp-alias för tydlighet)
        UPDATE category_prefixes cp
        SET next_seq = next_seq + 1
        WHERE cp.category = cat
        RETURNING cp.prefix, cp.next_seq - 1 INTO prefix, seq;

        RETURN NEXT;
        RETURN;
      END;
      $$ LANGUAGE plpgsql;
    `);
    
    console.log('✅ Funktionen uppdaterad!');
  } catch (err) {
    console.error('❌ Migration misslyckades:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function initDatabase() {
  // Anslut till postgres för att skapa databas
  const adminClient = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: 'postgres', // anslut till postgres-databasen
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  });

  try {
    await adminClient.connect();
    console.log('Ansluten till PostgreSQL server...');

    // Kolla om framing_app finns
    const checkDb = await adminClient.query(
      "SELECT 1 FROM pg_database WHERE datname = 'framing_app'"
    );

    if (checkDb.rows.length === 0) {
      console.log('Skapar databas framing_app...');
      await adminClient.query('CREATE DATABASE framing_app');
      console.log('✓ Databas skapad');
    } else {
      console.log('Databas framing_app finns redan');
    }

    await adminClient.end();

    // Anslut till framing_app och kör init.sql
    const framingClient = new Client({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: 'framing_app',
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD
    });

    await framingClient.connect();
    console.log('Ansluten till framing_app...');

    // Läs och kör init.sql
    const initSql = fs.readFileSync(
      path.join(__dirname, 'db', 'init.sql'),
      'utf8'
    );

    console.log('Kör init.sql...');
    await framingClient.query(initSql);
    console.log('✓ Tabeller skapade');

    await framingClient.end();
    console.log('\n✅ Databasinitiering klar!');
    console.log('Standardinloggning: admin / admin123');
  } catch (error) {
    console.error('Fel vid databasinitiering:', error);
    process.exit(1);
  }
}

initDatabase();

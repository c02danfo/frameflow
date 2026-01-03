// backend/src/db.js
const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;
const connectTimeout = Number(process.env.DB_CONNECT_TIMEOUT_MS) || 5000;

// Main database pool (inventory_artyx)
const pool = connectionString
  ? new Pool({ connectionString, connectionTimeoutMillis: connectTimeout })
  : new Pool({
      host: process.env.INVENTORY_DB_HOST || process.env.DB_HOST || 'localhost',
      port: Number(process.env.INVENTORY_DB_PORT || process.env.DB_PORT) || 5434,
      user: process.env.INVENTORY_DB_USER || process.env.DB_USER,
      password: process.env.INVENTORY_DB_PASSWORD || process.env.DB_PASSWORD,
      database: process.env.INVENTORY_DB_NAME || process.env.DB_NAME,
      connectionTimeoutMillis: connectTimeout,
    });

pool.on('connect', () => {
  console.log('✅ Ansluten till PostgreSQL (inventory)');
});

pool.on('error', (err) => {
  console.error('❌ Fel i PostgreSQL-poolen:', err);
});

// Auth database pool - used for shared session storage
const authPool = new Pool({
  host: process.env.AUTH_DB_HOST || 'auth-db',
  port: Number(process.env.AUTH_DB_PORT) || 5432,
  user: process.env.AUTH_DB_USER || 'auth_user',
  password: process.env.AUTH_DB_PASSWORD || 'auth123',
  database: process.env.AUTH_DB_NAME || 'frameflow_auth',
  connectionTimeoutMillis: connectTimeout,
});

authPool.on('connect', () => {
  console.log('✅ Ansluten till Auth PostgreSQL');
});

authPool.on('error', (err) => {
  console.error('❌ Fel i Auth PostgreSQL-poolen:', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  authPool
};

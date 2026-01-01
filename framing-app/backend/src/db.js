const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Main framing app database
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 5000,
  idleTimeoutMillis: 10000,
  max: 5,
  // Allow app to start even if DB is unreachable (graceful degradation for local dev)
});

pool.on('error', (err) => {
  console.error('Database pool error (continuing):', err.message || err);
});

// Inventory database pool (read-only)
const inventoryPool = new Pool({
  host: process.env.INVENTORY_DB_HOST,
  port: process.env.INVENTORY_DB_PORT,
  database: process.env.INVENTORY_DB_NAME,
  user: process.env.INVENTORY_DB_USER,
  password: process.env.INVENTORY_DB_PASSWORD,
  connectionTimeoutMillis: Number(process.env.INVENTORY_DB_CONNECT_TIMEOUT_MS) || 5000,
  idleTimeoutMillis: 10000,
  max: 5,
});

inventoryPool.on('error', (err) => {
  console.error('Inventory pool error (continuing):', err.message || err);
});

// Auth database pool - used for shared session storage
const authPool = new Pool({
  host: process.env.AUTH_DB_HOST || 'auth-db',
  port: Number(process.env.AUTH_DB_PORT) || 5432,
  user: process.env.AUTH_DB_USER || 'auth_user',
  password: process.env.AUTH_DB_PASSWORD || 'auth123',
  database: process.env.AUTH_DB_NAME || 'frameflow_auth',
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 5000,
});

authPool.on('error', (err) => {
  console.error('Auth pool error (continuing):', err.message || err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  inventoryQuery: (text, params) => inventoryPool.query(text, params),
  inventoryPool,
  authPool
};

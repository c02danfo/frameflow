const { Pool } = require('pg');

// Connect to auth database for sessions and user data
const pool = new Pool({
  host: process.env.AUTH_DB_HOST || 'auth-db',
  port: process.env.AUTH_DB_PORT || 5432,
  user: process.env.AUTH_DB_USER || 'auth_user',
  password: process.env.AUTH_DB_PASSWORD || 'auth123',
  database: process.env.AUTH_DB_NAME || 'frameflow_auth'
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool: pool
};

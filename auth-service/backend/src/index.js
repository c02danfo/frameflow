const path = require('path');
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const { Pool } = require('pg');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');

// Load environment variables from ../.env
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3005;

// Behind reverse proxy (Caddy) to allow secure cookies when used externally
app.set('trust proxy', 1);

// Database pool
const pool = new Pool({
    host: process.env.AUTH_DB_HOST || 'localhost',
    port: process.env.AUTH_DB_PORT || 5432,
    user: process.env.AUTH_DB_USER || 'auth_user',
    password: process.env.AUTH_DB_PASSWORD || 'password',
    database: process.env.AUTH_DB_NAME || 'frameflow_auth'
});

// Middleware
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
    console.log(`[auth-service] ${req.method} ${req.url}`);
    next();
});

// Session setup - pgSession must be created WITH express-session
const pgSession = require('connect-pg-simple')(session);
app.use(session({
    store: new pgSession({ 
        pool: pool,
        tableName: 'session'
    }),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    }
}));

// Store pool in app for auth routes
app.locals.db = { pool, query: (text, params) => pool.query(text, params) };

// Extract tenant from subdomain
app.use((req, res, next) => {
    const host = req.hostname;
    const parts = host.split('.');
    
    console.log(`[auth-service] Hostname: ${host}, Parts: ${parts.length}`);

    if (parts.length > 2) {
        req.tenant = parts[0]; // e.g., "demo" from demo.frameflowapp.com
    } else {
        req.tenant = 'demo'; // default tenant
    }
    
    next();
});

// Routes
app.use('/auth', authRoutes);
app.use('/users', userRoutes);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'auth-service' });
});

app.listen(PORT, () => {
    console.log(`Auth Service running on http://localhost:${PORT}`);
});

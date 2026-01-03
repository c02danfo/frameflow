// Huvudfil för Express-server
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const envPath = path.join(__dirname, '..', '.env');

// Force only PORT/HOST from inventory's own .env to avoid cross-terminal env contamination
// (but do not override other env vars like DB creds that may be set intentionally in Docker/production)
try {
  if (fs.existsSync(envPath)) {
    const parsed = dotenv.parse(fs.readFileSync(envPath));
    if (parsed.PORT) process.env.PORT = parsed.PORT;
    if (parsed.HOST) process.env.HOST = parsed.HOST;
  }
} catch (e) {
  // ignore .env parse errors here; dotenv.config below will surface if needed
}

dotenv.config({ path: envPath });
const express = require('express');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const { createSessionMiddleware } = require('../../../shared/middleware/sessionSetup');
const db = require('./db');
const itemsRouter = require('./routes/items');
const priceGroupsRouter = require('./routes/price-groups');
const { requireAuth } = require('./utils/authServiceMiddleware');

const app = express();
const PORT = process.env.PORT || 3015;
const HOST = process.env.HOST || '::';

// Request logging
app.use((req, res, next) => {
  console.log(`[inventory] ${req.method} ${req.url}`);
  next();
});

// Behind reverse proxy (Caddy) to allow secure cookies
app.set('trust proxy', 1);

// Views - use shared design-system
app.set('views', [
  path.join(__dirname, 'views'),
  path.join(__dirname, '..', 'public', 'design-system', 'components')
]);
app.set('view engine', 'ejs');

// Middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/design-system', express.static(path.join(__dirname, '..', 'public', 'design-system')));
// Backwards-compatible aliases
app.use('/css', express.static(path.join(__dirname, '..', 'public', 'design-system', 'css')));
app.use('/js', express.static(path.join(__dirname, '..', 'public', 'design-system', 'js')));

// Session middleware (shared) - use auth-db for sessions
app.use(createSessionMiddleware({
  session,
  connectPgSimple,
  pool: db.authPool,
  secret: process.env.SESSION_SECRET
}));

// Helper: compute service base URLs from environment
const getServiceBaseUrls = () => {
  const domain = process.env.DOMAIN || 'frameflowapp.com';
  const isLocal = domain === 'localhost' || domain.includes('127.0.0.1');
  
  if (isLocal) {
    // Local development: use specific ports
    return {
      dashboardBaseUrl: `http://localhost:${process.env.DASHBOARD_PORT || 3010}`,
      framingBaseUrl: `http://localhost:${process.env.FRAMING_PORT || 3011}`,
      inventoryBaseUrl: `http://localhost:${process.env.INVENTORY_PORT || 3015}`,
      authBaseUrl: `http://localhost:${process.env.AUTH_PORT || 3005}`
    };
  } else {
    // Production: use subdomains
    return {
      dashboardBaseUrl: `https://frameflowapp.com`,
      framingBaseUrl: `https://framing.${domain}`,
      inventoryBaseUrl: `https://inventory.${domain}`,
      authBaseUrl: `https://frameflowapp.com`
    };
  }
};

// Hjälpare: rendera vy inuti shared layout
app.use((req, res, next) => {
  res.renderWithLayout = (view, data = {}) => {
    const serviceUrls = getServiceBaseUrls();
    const viewData = Object.assign({}, data, {
      user: req.session && req.session.user ? req.session.user : null,
      domain: process.env.DOMAIN || 'frameflowapp.com',
      ...serviceUrls
    });
    req.app.render(view, viewData, (err, html) => {
      if (err) return next(err);
      res.render('layout', Object.assign({}, viewData, { body: html }));
    });
  };
  next();
});

// Protected routes - all require auth
app.use('/items', requireAuth, itemsRouter);
app.use('/price-groups', requireAuth, priceGroupsRouter);

app.get('/', requireAuth, (req, res) => {
  res.redirect('/items');
});

// Felhantering enklast möjligt
app.use((err, req, res, next) => {
  console.error(err);

  const dbConnectCodes = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ETIMEDOUT', 'ENETUNREACH']);
  if (err && dbConnectCodes.has(err.code)) {
    const host = process.env.DB_HOST || '(unset)';
    const port = process.env.DB_PORT || '(unset)';
    const hint =
      "Databasen verkar inte vara nåbar. Om du kör lokalt: starta Docker Desktop och kör `cd inventory-artyx && docker compose up -d inventory-db`.";
    return res
      .status(503)
      .type('text')
      .send(`Database connection failed (${err.code}) to ${host}:${port}. ${hint}`);
  }

  if (process.env.NODE_ENV !== 'production' && err?.stack) {
    return res.status(500).type('text').send(err.stack);
  }

  res.status(500).send('Server error');
});

app.listen(PORT, HOST, () => {
  console.log(`Server körs: http://localhost:${PORT}`);
});

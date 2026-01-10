const express = require('express');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const { createSessionMiddleware } = require('../../../shared/middleware/sessionSetup');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const envPath = path.join(__dirname, '..', '.env');
try {
  if (fs.existsSync(envPath)) {
    const parsed = dotenv.parse(fs.readFileSync(envPath));
    if (parsed.PORT) process.env.PORT = parsed.PORT;
  }
} catch (e) {
  // ignore .env parse errors here
}

dotenv.config({ path: envPath });

const db = require('./db');
const customerRoutes = require('./routes/customers');
const orderRoutes = require('./routes/orders');
const companyDataRoutes = require('./routes/company-data');
const templateRoutes = require('./routes/templates');
const { requireAuth } = require('./utils/authServiceMiddleware');

const app = express();
const PORT = process.env.PORT || 3011;

// Request logging
app.use((req, res, next) => {
  console.log(`[framing] ${req.method} ${req.url}`);
  next();
});

// Behind reverse proxy (Caddy) to allow secure cookies
app.set('trust proxy', 1);

// View engine setup - include shared design-system components
app.set('view engine', 'ejs');
app.set('views', [
  path.join(__dirname, 'views'),
  path.join(__dirname, '..', 'public', 'design-system', 'components')
]);

// Static files - include design-system
app.use('/design-system', express.static(path.join(__dirname, '..', 'public', 'design-system')));
app.use('/css', express.static(path.join(__dirname, '..', 'public', 'design-system', 'css')));
app.use('/js', express.static(path.join(__dirname, '..', 'public', 'design-system', 'js')));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files (company logo etc.)
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Session setup - use auth-db for shared sessions
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

// Custom renderWithLayout middleware - pass auth user to all views
app.use((req, res, next) => {
  res.renderWithLayout = function(view, data = {}) {
    // Lägg till session data till alla views
    const serviceUrls = getServiceBaseUrls();
    const viewData = Object.assign({}, data, {
      user: req.session.user || null,
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

// All routes require authentication
app.use('/customers', requireAuth, customerRoutes);
app.use('/orders', requireAuth, orderRoutes);
app.use('/company-data', requireAuth, companyDataRoutes);
app.use('/templates', requireAuth, templateRoutes);

// Root redirect
app.get('/', requireAuth, (req, res) => {
  res.redirect('/orders');
});

// Start server
(async () => {
  try {
    app.listen(PORT, () => {
      console.log(`Framing App running on http://localhost:${PORT}`);
    }).on('error', (err) => {
      console.error('Server startup error:', err);
      process.exit(1);
    });
  } catch (err) {
    console.error('Unexpected startup error:', err);
    process.exit(1);
  }
})();

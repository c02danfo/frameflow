const express = require('express');
const session = require('express-session');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const db = require('./db');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');

const app = express();
const PORT = process.env.PORT || 3010;

// Request logging
app.use((req, res, next) => {
  console.log(`[dashboard] ${req.method} ${req.url}`);
  next();
});

// Behind reverse proxy (Caddy) to allow secure cookies
app.set('trust proxy', 1);

// View engine setup - include shared design-system components (mounted at /app/public/design-system)
app.set('view engine', 'ejs');
app.set('views', [
  path.join(__dirname, 'views'),
  path.join(__dirname, '../public/design-system/components')
]);

// Static files - design-system mounted at /design-system for layout asset paths
const designSystemPath = path.join(__dirname, '../public/design-system');
app.use('/design-system', express.static(designSystemPath));
// Backwards-compatible aliases used by login page
app.use('/css', express.static(path.join(designSystemPath, 'css')));
app.use('/js', express.static(path.join(designSystemPath, 'js')));

// Layout helper: render view inside shared layout
app.use((req, res, next) => {
  res.renderWithLayout = (view, data = {}) => {
    // Ensure user and domain are always available for the layout/navbar
    const viewData = Object.assign({
      user: req.session?.user || null,
      domain: process.env.DOMAIN || 'frameflowapp.com'
    }, data);

    req.app.render(view, viewData, (err, html) => {
      if (err) return next(err);
      res.render('layout', Object.assign({}, viewData, { body: html }));
    });
  };
  next();
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session setup - use auth-db for shared sessions
const pgSession = require('connect-pg-simple')(session);
const cookieDomain = (process.env.DOMAIN || 'frameflowapp.com').replace(/^(?!\.)/, '.');
app.use(session({
  store: new pgSession({
    pool: db.pool,
    tableName: 'session'
  }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    domain: cookieDomain  // Share cookies across subdomains
  }
}));

// Routes
app.use('/auth', authRoutes);
app.use('/dashboard', dashboardRoutes);

// Root redirect
app.get('/', (req, res) => {
  if (req.session.user) {
    res.redirect('/dashboard');
  } else {
    res.renderWithLayout('landing', { 
      title: 'FrameFlow - The Operating System for Modern Framers',
      domain: process.env.DOMAIN || 'frameflowapp.com'
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Dashboard running on http://localhost:${PORT}`);
}).on('error', (err) => {
  console.error('Server error:', err);
  process.exit(1);
});

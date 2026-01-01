# OnlineApps Codebase - AI Agent Instructions

## Architecture Overview

This is a **centralized dashboard monorepo** hosting three Node.js/Express applications behind a Caddy reverse proxy:

1. **dashboard-app** (port 3010) - Central authentication + app launcher
2. **inventory-artyx** (port 3015) - Inventory management with price groups  
3. **framing-app** (port 3011) - Order & framing management system

**Authentication Model**: Single Sign-On (SSO) via centralized auth-service. Users log in once at `frameflowapp.com/auth/login`, and the session cookie (domain: `.frameflowapp.com`) is shared across all subdomains. Apps validate this shared session instead of having their own login systems.

### Key Architectural Patterns

- **Monorepo structure**: Each app is self-contained in its own directory with dedicated `backend/`, `docker-compose.yml`, and `Dockerfile`
- **Reverse proxy**: Caddy handles routing (see [caddy/Caddyfile.production](caddy/Caddyfile.production))
- **Centralized auth**: auth-service (port 3005) validates credentials, dashboard-app provides login UI
- **Shared session**: Session cookie with domain `.frameflowapp.com` stored in PostgreSQL (auth-db)
- **Database per service**: Each app connects to its own PostgreSQL instance
  - auth-db (port 5432) - users, sessions
  - inventory-db (port 5432) - items, price_groups
  - framing-db (port 5432) - orders, customers
- **Shared dependencies**: Root [package.json](package.json) includes common packages (express, pg, ejs, dotenv) but each app also has its own `backend/package.json`

## Development Workflows

### Running Applications

Use the production Docker Compose file from project root:
```bash
cd /OnlineApps
docker compose -f docker-compose.production.yml up -d
```

Individual app rebuild:
```bash
docker compose -f docker-compose.production.yml up -d --build dashboard-app
docker compose -f docker-compose.production.yml up -d --build inventory-app
docker compose -f docker-compose.production.yml up -d --build framing-app
```

### Database Migrations

**Important**: Database schemas live in `backend/db/init.sql` for each app. These run automatically on first container startup.

For schema changes after initial setup, use migration scripts:
- [inventory-artyx/backend/migrate-price-groups.js](inventory-artyx/backend/migrate-price-groups.js) - Example of adding price_groups table
- Run migrations: `cd inventory-artyx/backend && node migrate-price-groups.js`

To reset a database completely (⚠️ destroys data):
```bash
docker compose -f docker-compose.production.yml down
docker volume rm onlineapps_inventory-db-data  # adjust volume name per app
docker compose -f docker-compose.production.yml up -d
```

## Authentication & Session Flow

### auth-service (Centralized Auth Backend)

Located in `auth-service/backend/`:
- **Endpoint**: `POST /auth/login` validates credentials against `users` table in auth-db
- **Returns**: JWT token + user object on success
- **Port**: 3005 (internal Docker network only)
- **Database**: Connects to auth-db PostgreSQL

### dashboard-app (Login UI)

Located in `dashboard-app/backend/src/`:
- **Login route**: `/auth/login` (GET shows form, POST calls auth-service)
- **Session middleware**: express-session with PostgreSQL store (connect-pg-simple)
- **Cookie config**: 
  ```javascript
  cookie: {
    domain: '.frameflowapp.com',  // Shared across subdomains
    httpOnly: true,
    secure: true,  // HTTPS only in production
    maxAge: 30 * 24 * 60 * 60 * 1000  // 30 days
  }
  ```
- **User object**: Stored in `req.session.user` with fields: `id`, `email`, `firstName`, `lastName`, `role`, `permissions[]`

### inventory-artyx & framing-app (Session Validation Only)

**No local authentication** - relies entirely on shared session:

```javascript
// middleware uses shared/middleware/sessionSetup.js
const { requireAuth } = require('./utils/authServiceMiddleware');

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    const domain = process.env.DOMAIN || 'frameflowapp.com';
    return res.redirect(`https://${domain}/auth/login?returnTo=` + encodeURIComponent(req.originalUrl));
  }
  next();
}

// Apply to all routes
app.use('/items', requireAuth, itemsRouter);
```

**Session store config** (reads cookie set by dashboard-app):
```javascript
const { createSessionMiddleware } = require('../../../shared/middleware/sessionSetup');

app.use(createSessionMiddleware({
  session,
  connectPgSimple,
  pool: db.authPool,  // Connect to auth-db
  secret: process.env.SESSION_SECRET  // Must match dashboard-app
}));
```

## Project-Specific Conventions

### View Rendering Pattern

All apps use a **custom layout wrapper** instead of standard EJS layouts:

```javascript
// Set in middleware (index.js)
res.renderWithLayout = (view, data = {}) => {
  const viewData = Object.assign({}, data, {
    user: req.session.user || null,
    domain: process.env.DOMAIN || 'frameflowapp.com'
  });
  req.app.render(view, viewData, (err, html) => {
    if (err) return next(err);
    res.render('layout', Object.assign({}, viewData, { body: html }));
  });
};

// Used in routes
res.renderWithLayout('items/index', { items: result.rows });
```

This pattern is consistent across dashboard-app, inventory-artyx, and framing-app. Views are in `backend/src/views/`.

### Session Management

All apps use **PostgreSQL-backed sessions** with `express-session` and `connect-pg-simple`:

```javascript
// Shared middleware in shared/middleware/sessionSetup.js
const { createSessionMiddleware } = require('../../../shared/middleware/sessionSetup');

app.use(createSessionMiddleware({
  session,
  connectPgSimple,
  pool: db.authPool,  // All apps connect to auth-db for sessions
  secret: process.env.SESSION_SECRET  // MUST be same across all apps
}));

// Access session data
req.session.user = userData;
const currentUser = req.session.user;
```

Session data persists across app restarts. Sessions are stored in the `session` table in auth-db (auto-created by init.sql).

### Database Query Patterns

All apps use raw SQL with `pg` (no ORM). Connection is established in `backend/src/db.js`:

```javascript
const { Pool } = require('pg');
const pool = new Pool({ /* env vars */ });
module.exports = { query: (text, params) => pool.query(text, params) };
```

Common patterns:
- Use parameterized queries: `db.query('SELECT * FROM items WHERE id = $1', [id])`
- Check `rows.length` before accessing results
- Transaction example in [timestamp-app/backend/src/routes/admin.js](timestamp-app/backend/src/routes/admin.js#L180-L190)

### Price Group Auto-Calculation (inventory-artyx)

When creating/editing items with a price_group, sales_price is **auto-calculated** if not provided:

```javascript
if (price_group && purchase_price && !sales_price) {
  const markup = await db.query('SELECT markup_percentage FROM price_groups WHERE name = $1', [price_group]);
  sales_price = purchase_price * (markup / 100.0);
}
```

**Batch Update Flow**: When updating a price group's markup:
1. Admin edits price group and changes markup percentage
2. Checkbox asks: "Uppdatera alla artiklar i gruppen nu?"
3. If checked, backend runs transaction:
   ```javascript
   BEGIN;
   UPDATE price_groups SET markup_percentage = X WHERE id = Y;
   UPDATE items SET sales_price = purchase_price * (X / 100.0) 
     WHERE price_group = 'name' AND purchase_price IS NOT NULL;
   COMMIT;
   ```
4. All items in that price group get recalculated atomically

See [inventory-artyx/backend/src/routes/price-groups.js](inventory-artyx/backend/src/routes/price-groups.js) and [inventory-artyx/TECH_DEBT.md](inventory-artyx/TECH_DEBT.md).

### SKU Generation (inventory-artyx)

SKUs are auto-generated as `4-digit-number + 2-letters` (e.g., `0123AB`):

```javascript
function generateSKU() {
  const numbers = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return `${numbers}${letters[Math.floor(Math.random() * 26)]}${letters[Math.floor(Math.random() * 26)]}`;
}
```

## Critical Dependencies & Integration Points

## Language & Localization

**Code is in Swedish** - variable names, comments, UI text, and database column names use Swedish terminology:
- `arbetare` (worker), `tidsstämpel` (timestamp), `prisgrupp` (price group), etc.
- Keep this convention when adding new features

## Collaboration Style (User Preference)

When responding to user requests in this repo:

- Start by briefly summarizing the user's request/intent in Swedish.
- Ask 1–3 clarifying questions when requirements are ambiguous or when a wrong assumption could cause rework. If the ambiguity is minor, it's OK to proceed with the simplest reasonable interpretation and clearly state the assumption.
- Propose small, high-value improvements (optional) that are consistent with the existing design/system and do not expand scope unexpectedly. If an improvement is outside the explicit request, always ask “ska jag göra det också?” before implementing it.
- Prefer concise back-and-forth over long monologues; keep progress updates short and actionable.

## Common Pitfalls

1. **Session secret mismatch**: All apps MUST use same SESSION_SECRET env var for shared sessions to work
2. **Cookie domain**: Must be `.frameflowapp.com` (note the leading dot) for subdomain cookie sharing
3. **Database connections**: 
   - dashboard-app → auth-db (users, sessions)
   - inventory-artyx → inventory-db (items) + auth-db (sessions)
   - framing-app → framing-db (orders) + inventory-db (items lookup) + auth-db (sessions)
4. **Caddy routing**: Update [caddy/Caddyfile.production](caddy/Caddyfile.production) when adding new subdomains
5. **No local auth in inventory/framing**: They only validate session, never create/destroy sessions
6. **Docker network**: All containers must be on `frameflow-network` for service discovery (e.g., caddy→dashboard-app)

## Testing & Debugging

- No automated tests currently exist
- Manual testing via browser at production URLs
- Check Docker logs: `docker compose -f docker-compose.production.yml logs -f [service]`
- Session debugging: Check auth-db `session` table for active sessions
- Database access: `docker exec -it frameflow-auth-db psql -U auth_user -d frameflow_auth`

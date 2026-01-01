const fetch = require('node-fetch');

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3005';

/**
 * Middleware: Require authenticated user
 */
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  next();
}

/**
 * Middleware: Require specific permission
 */
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const hasPermission = req.session.user.permissions?.includes(permission);
    if (!hasPermission) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

/**
 * Helper: Call auth-service API with error handling
 */
async function authServiceCall(endpoint, method = 'GET', body = null) {
  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) {
      options.body = JSON.stringify(body);
    }
    const response = await fetch(`${AUTH_SERVICE_URL}${endpoint}`, options);
    const data = await response.json();
    return { status: response.status, data };
  } catch (error) {
    console.error(`Auth service call error: ${endpoint}`, error);
    return { status: 500, error: 'Auth service unavailable' };
  }
}

module.exports = {
  requireAuth,
  requirePermission,
  authServiceCall
};

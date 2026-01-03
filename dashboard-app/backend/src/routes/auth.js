const express = require('express');
const fetch = require('node-fetch');
const { authServiceCall } = require('../utils/authServiceMiddleware');

const router = express.Router();

// Resolve auth-service base URL for local vs production
const domain = process.env.DOMAIN || 'frameflowapp.com';
const isLocal = domain === 'localhost' || domain.includes('127.0.0.1');
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || (
  isLocal
    ? `http://localhost:${process.env.AUTH_PORT || 3005}`
    : 'http://auth-service:3005'
);

// Login page
router.get('/login', (req, res) => {
  // Use shared layout so navbar receives environment-aware URLs
  res.renderWithLayout('auth/login', { 
    error: req.query.error,
    returnTo: req.query.returnTo || ''
  });
});

// Login handler - call auth-service
router.post('/login', async (req, res) => {
  const { email, password, returnTo } = req.body;

  try {
    console.info(`[dashboard] login attempt for email="${email}"`);
    // Call centralized auth-service
    const response = await fetch(`${AUTH_SERVICE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const result = await response.json();

    console.info('[dashboard] auth-service status', response.status, 'body', result);

    if (!response.ok || !result.success) {
      const errorMsg = encodeURIComponent('Fel e-post eller lösenord');
      const returnParam = returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : '';
      return res.redirect(`/auth/login?error=${errorMsg}${returnParam}`);
    }

    // Store user in session
    req.session.user = result.user;
    req.session.token = result.token;

    // Redirect to dashboard or returnTo URL
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.redirect('/auth/login?error=Ett fel uppstod vid inloggning');
      }
      
      if (returnTo && returnTo.startsWith('http')) {
        console.info(`[dashboard] Redirecting back to: ${returnTo}`);
        res.redirect(returnTo);
      } else {
        res.redirect('/dashboard');
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.redirect('/auth/login?error=Ett fel uppstod vid inloggning');
  }
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.clearCookie('connect.sid', { 
      domain: `.${process.env.DOMAIN || 'frameflowapp.com'}`,
      path: '/' 
    });
    res.redirect('/');
  });
});

module.exports = router;

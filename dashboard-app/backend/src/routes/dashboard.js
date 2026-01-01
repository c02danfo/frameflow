const express = require('express');
const { requireAuth } = require('../utils/authServiceMiddleware');

const router = express.Router();

// Dashboard landing page with app cards
router.get('/', requireAuth, (req, res, next) => {
  const user = req.session.user;
  
  // Determine which apps user has access to
  const apps = [];
  
  if (user.permissions?.includes('inventory:read')) {
    apps.push({
      name: 'Lager & Artiklar',
      description: 'Hantera sortiment, priser och lagersaldon.',
      icon: '📦',
      url: `https://inventory.${process.env.DOMAIN || 'frameflowapp.com'}`
    });
  }
  
  if (user.permissions?.includes('framing:read')) {
    apps.push({
      name: 'Inramning & Order',
      description: 'Skapa arbetsordrar och hantera inramningar.',
      icon: '🖼️',
      url: `https://framing.${process.env.DOMAIN || 'frameflowapp.com'}`
    });
  }

  res.renderWithLayout('dashboard/home', { 
    user,
    apps,
    domain: process.env.DOMAIN || 'frameflowapp.com',
    title: 'FrameFlow dashboard'
  });
});

module.exports = router;

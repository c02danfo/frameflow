/**
 * Auth middleware - kräver inloggad användare
 */
function requireAuth(req, res, next) {
  const user = req.session && req.session.user;
  if (!user) {
    return res.redirect('/auth/login');
  }

  // Backwards compatibility for code that checks userId
  if (!req.session.userId && user.id) {
    req.session.userId = user.id;
  }

  next();
}

module.exports = {
  requireAuth
};

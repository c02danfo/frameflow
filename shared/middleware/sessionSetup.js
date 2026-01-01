function createSessionMiddleware({ session, connectPgSimple, pool, secret }) {
  const PgSession = connectPgSimple(session);
  
  // Get domain from env, with fallback
  const domain = process.env.DOMAIN || 'frameflowapp.com';
  // Convert domain to cookie domain (e.g., frameflowapp.com -> .frameflowapp.com for subdomain sharing)
  // Ensure we always have a leading dot for cross-subdomain cookies
  const cookieDomain = domain.startsWith('.') ? domain : '.' + domain;
  
  console.log(`[session] Setting cookie domain to: ${cookieDomain}`);

  return session({
    store: new PgSession({
      pool,
      tableName: 'session'
    }),
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      domain: cookieDomain  // Share cookies across subdomains
    }
  });
}

module.exports = { createSessionMiddleware };

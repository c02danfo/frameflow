function createSessionMiddleware({ session, connectPgSimple, pool, secret }) {
  const PgSession = connectPgSimple(session);
  
  const domain = process.env.DOMAIN || 'frameflowapp.com';
  const isLocal = domain === 'localhost' || domain === '127.0.0.1' || domain.endsWith('.localhost');
  const cookieDomain = isLocal
    ? undefined
    : domain.startsWith('.')
      ? domain
      : `.${domain}`;
  
  console.log(`[session] Setting cookie domain to: ${cookieDomain || 'host-default'}`);

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
      ...(cookieDomain ? { domain: cookieDomain } : {})
    }
  });
}

module.exports = { createSessionMiddleware };

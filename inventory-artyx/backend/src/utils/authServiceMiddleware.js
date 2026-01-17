/**
 * Auth Middleware for FrameFlow Apps
 * Integrates with centralized auth-service
 */

const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production';
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3005';

// Require user to be authenticated via JWT or session
const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.user) {
        const domain = process.env.DOMAIN || 'frameflowapp.com';
        const isLocal = domain === 'localhost' || domain.includes('127.0.0.1');
        
        // For local dev, use http://localhost:PORT
        // For production, use https://domain
        const protocol = isLocal ? 'http' : 'https';
        const host = isLocal ? req.get('host') : domain;
        const loginUrl = isLocal ? `http://localhost:3010/auth/login` : `https://${domain}/auth/login`;
        
        const returnTo = encodeURIComponent(`${protocol}://${host}${req.originalUrl}`);
        return res.redirect(`${loginUrl}?returnTo=${returnTo}`);
    }
    next();
};

// Optional: Check specific permissions
const requirePermission = (permission) => {
    return (req, res, next) => {
        if (!req.session || !req.session.user) {
            const domain = process.env.DOMAIN || 'frameflowapp.com';
            const isLocal = domain === 'localhost' || domain.includes('127.0.0.1');
            
            const protocol = isLocal ? 'http' : 'https';
            const host = isLocal ? req.get('host') : domain;
            const loginUrl = isLocal ? `http://localhost:3010/auth/login` : `https://${domain}/auth/login`;
            
            const returnTo = encodeURIComponent(`${protocol}://${host}${req.originalUrl}`);
            return res.redirect(`${loginUrl}?returnTo=${returnTo}`);
        }
        
        const userPermissions = req.session.user.permissions || [];
        if (!userPermissions.includes(permission)) {
            return res.status(403).json({ error: 'Permission denied' });
        }
        
        next();
    };
};

// Make authenticated requests to auth-service
async function authServiceCall(endpoint, options = {}) {
    const token = global.authToken; // Would be set after login
    
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };
    
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    try {
        const response = await fetch(`${AUTH_SERVICE_URL}${endpoint}`, {
            headers,
            ...options
        });
        
        if (!response.ok) {
            throw new Error(`Auth service error: ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('Auth service call failed:', error);
        throw error;
    }
}

module.exports = {
    requireAuth,
    requirePermission,
    authServiceCall,
    AUTH_SERVICE_URL
};

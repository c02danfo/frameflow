const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production';

// POST /auth/login
router.post('/login', async (req, res) => {
    try {
        let { email, password } = req.body;
        const tenant = req.tenant;
        const db = req.app.locals.db;

        if (email) email = email.trim().toLowerCase();

        console.log(`[auth-service] Login attempt: email=${email}, tenant=${tenant}, passwordLength=${password ? password.length : 0}`);

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Get tenant ID
        let tenantResult = await db.query(
            'SELECT id FROM tenants WHERE slug = $1',
            [tenant]
        );

        // Fallback to demo tenant if not found (useful for internal service calls)
        if (tenantResult.rows.length === 0) {
            console.log(`[auth-service] Tenant '${tenant}' not found, falling back to 'demo'`);
            tenantResult = await db.query(
                'SELECT id FROM tenants WHERE slug = $1',
                ['demo']
            );
        }

        if (tenantResult.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid tenant' });
        }

        const tenantId = tenantResult.rows[0].id;

        // Get user
        const userResult = await db.query(
            `SELECT u.id, u.email, u.password_hash, u.first_name, u.last_name
             FROM users u
             WHERE u.tenant_id = $1 AND u.email = $2 AND u.is_active = true`,
            [tenantId, email]
        );

        if (userResult.rows.length === 0) {
            console.log(`[auth-service] User not found: email=${email}, tenantId=${tenantId}`);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = userResult.rows[0];

        // Verify password
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            console.log(`[auth-service] Password mismatch for user: ${email}`);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        console.log(`[auth-service] Login successful: ${email}`);

        // Get user roles and permissions
        const rolesResult = await db.query(
            `SELECT r.id, r.name, array_agg(p.name) as permissions
             FROM user_roles ur
             JOIN roles r ON ur.role_id = r.id
             LEFT JOIN role_permissions rp ON r.id = rp.role_id
             LEFT JOIN permissions p ON rp.permission_id = p.id
             WHERE ur.user_id = $1
             GROUP BY r.id, r.name`,
            [user.id]
        );

        const roles = rolesResult.rows.map(r => ({
            name: r.name,
            permissions: r.permissions.filter(p => p !== null)
        }));

        // Generate JWT
        const token = jwt.sign(
            {
                userId: user.id,
                email: user.email,
                tenant: tenant,
                tenantId: tenantId,
                roles: roles.map(r => r.name),
                permissions: Array.from(new Set(roles.flatMap(r => r.permissions)))
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        // Set session
        req.session.user = {
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            tenant: tenant,
            tenantId: tenantId,
            roles: roles,
            token: token
        };

        res.json({
            success: true,
            token: token,
            user: req.session.user
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Login failed' });
    }
});

// GET /auth/me
router.get('/me', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    res.json(req.session.user);
});

// POST /auth/logout
router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.json({ success: true });
    });
});

module.exports = router;

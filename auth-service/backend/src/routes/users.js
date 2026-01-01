const express = require('express');
const bcrypt = require('bcrypt');

const router = express.Router();

// Middleware: require auth
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
};

// GET /users - list users in tenant
router.get('/', requireAuth, async (req, res) => {
    try {
        const db = req.app.locals.db;
        const result = await db.query(
            `SELECT u.id, u.email, u.first_name, u.last_name, u.is_active, u.created_at,
                    array_agg(r.name) as roles
             FROM users u
             LEFT JOIN user_roles ur ON u.id = ur.user_id
             LEFT JOIN roles r ON ur.role_id = r.id
             WHERE u.tenant_id = $1
             GROUP BY u.id
             ORDER BY u.created_at DESC`,
            [req.session.user.tenantId]
        );

        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// POST /users - create user (admin only)
router.post('/', requireAuth, async (req, res) => {
    try {
        const { email, password, firstName, lastName, roleIds } = req.body;
        const tenantId = req.session.user.tenantId;
        const db = req.app.locals.db;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // Create user
        const userResult = await db.query(
            `INSERT INTO users (tenant_id, email, password_hash, first_name, last_name)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, email, first_name, last_name`,
            [tenantId, email, passwordHash, firstName || '', lastName || '']
        );

        const user = userResult.rows[0];

        // Assign roles if provided
        if (roleIds && Array.isArray(roleIds)) {
            for (const roleId of roleIds) {
                await db.query(
                    `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)
                     ON CONFLICT DO NOTHING`,
                    [user.id, roleId]
                );
            }
        }

        res.status(201).json({ success: true, user });
    } catch (err) {
        console.error('Error creating user:', err);
        res.status(500).json({ error: 'Failed to create user' });
    }
});

// PUT /users/:userId - update user
router.put('/:userId', requireAuth, async (req, res) => {
    try {
        const { userId } = req.params;
        const { firstName, lastName, isActive } = req.body;
        const tenantId = req.session.user.tenantId;
        const db = req.app.locals.db;

        await db.query(
            `UPDATE users 
             SET first_name = COALESCE($1, first_name),
                 last_name = COALESCE($2, last_name),
                 is_active = COALESCE($3, is_active)
             WHERE id = $4 AND tenant_id = $5`,
            [firstName, lastName, isActive, userId, tenantId]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Error updating user:', err);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

module.exports = router;

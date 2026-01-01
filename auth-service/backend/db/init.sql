-- Auth Service Database Schema
-- Centraliserad för alla tenants

-- Tenants (companies/customers)
CREATE TABLE IF NOT EXISTS tenants (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(50) UNIQUE NOT NULL,  -- "company1", "company2" (för subdomäner)
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users (global, knutna till tenant)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, email)
);

-- Roles (admin, user, viewer osv)
CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, name)
);

-- Permissions (inventory:read, framing:write osv)
CREATE TABLE IF NOT EXISTS permissions (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    module VARCHAR(50)  -- 'inventory', 'framing', 'dashboard'
);

-- Role-Permission mapping
CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY(role_id, permission_id)
);

-- User-Role mapping
CREATE TABLE IF NOT EXISTS user_roles (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY(user_id, role_id)
);

-- Sessions (för backend sessions)
CREATE TABLE IF NOT EXISTS session (
    sid VARCHAR PRIMARY KEY,
    sess JSONB NOT NULL,
    expire TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS IDX_session_expire on session (expire);

-- Initial permissions
INSERT INTO permissions (name, module, description) VALUES
    ('inventory:read', 'inventory', 'View inventory items'),
    ('inventory:write', 'inventory', 'Create/edit inventory items'),
    ('inventory:delete', 'inventory', 'Delete inventory items'),
    ('framing:read', 'framing', 'View framing orders'),
    ('framing:write', 'framing', 'Create/edit framing orders'),
    ('framing:delete', 'framing', 'Delete framing orders'),
    ('users:manage', 'dashboard', 'Manage users'),
    ('admin', 'dashboard', 'Full system access')
ON CONFLICT (name) DO NOTHING;

-- Create default admin role
INSERT INTO tenants (slug, name) VALUES ('demo', 'Demo Company') ON CONFLICT DO NOTHING;

DO $$
DECLARE
    tenant_id INT;
    admin_role_id INT;
    admin_perm_id INT;
BEGIN
    SELECT id INTO tenant_id FROM tenants WHERE slug = 'demo';
    
    INSERT INTO roles (tenant_id, name, description)
    VALUES (tenant_id, 'admin', 'Administrator with full access')
    ON CONFLICT DO NOTHING
    RETURNING id INTO admin_role_id;
    
    SELECT id INTO admin_role_id FROM roles WHERE tenant_id = tenant_id AND name = 'admin';
    SELECT id INTO admin_perm_id FROM permissions WHERE name = 'admin';
    
    INSERT INTO role_permissions (role_id, permission_id)
    VALUES (admin_role_id, admin_perm_id)
    ON CONFLICT DO NOTHING;
END $$;

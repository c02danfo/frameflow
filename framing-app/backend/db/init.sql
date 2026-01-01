-- Framing App Database Schema

-- Users (enkel login)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Customers
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Customer Orders
CREATE TABLE IF NOT EXISTS customer_orders (
    id SERIAL PRIMARY KEY,
    order_number VARCHAR(20) UNIQUE NOT NULL, -- YYYY-NNNN
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    delivery_date DATE,
    status VARCHAR(50) DEFAULT 'draft', -- draft, confirmed, completed, cancelled
    total_price_excl_moms DECIMAL(10,2) DEFAULT 0,
    total_price_incl_moms DECIMAL(10,2) DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Company Data (singleton: id=1)
-- English terminology for international use
CREATE TABLE IF NOT EXISTS company_data (
    id INTEGER PRIMARY KEY,

    display_name TEXT,
    legal_name TEXT,

    email TEXT,
    phone TEXT,
    website TEXT,

    address_line1 TEXT,
    address_line2 TEXT,
    postal_code TEXT,
    city TEXT,
    region TEXT,
    country TEXT,

    tax_id TEXT,
    company_id TEXT,

    locale TEXT DEFAULT 'en-US',
    currency TEXT DEFAULT 'USD',
    timezone TEXT DEFAULT 'UTC',

    vat_rate_percentage DECIMAL(5,2) DEFAULT 25.00,

    logo_path TEXT,
    settings JSONB DEFAULT '{}'::jsonb,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO company_data (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- Frame Orders (ramorder under en customer order)
CREATE TABLE IF NOT EXISTS frame_orders (
    id SERIAL PRIMARY KEY,
    customer_order_id INTEGER NOT NULL REFERENCES customer_orders(id) ON DELETE CASCADE,

    -- Antal
    antal INTEGER NOT NULL DEFAULT 1,

    -- Motiv (text)
    motiv TEXT,
    
    -- Dimensioner
    width_mm DECIMAL(10,2) NOT NULL,
    height_mm DECIMAL(10,2) NOT NULL,
    
    -- Material från inventory (locked vid confirm)
    frame_item_id INTEGER, -- referens till items.id i inventory_artyx
    frame_item_name VARCHAR(255), -- locked namn
    frame_item_sku VARCHAR(50), -- locked SKU
    frame_price_per_meter DECIMAL(10,2), -- locked pris
    
    glass_item_id INTEGER,
    glass_item_name VARCHAR(255),
    glass_item_sku VARCHAR(50),
    glass_price_per_sqm DECIMAL(10,2),
    
    backing_item_id INTEGER,
    backing_item_name VARCHAR(255),
    backing_item_sku VARCHAR(50),
    backing_price_per_sqm DECIMAL(10,2),
    
    passepartout_item_id INTEGER,
    passepartout_item_name VARCHAR(255),
    passepartout_item_sku VARCHAR(50),
    passepartout_price_per_sqm DECIMAL(10,2),
    passepartout_width_mm DECIMAL(10,2) DEFAULT 50, -- bredd på passepartout-kant (mm)

    -- Arbete
    labor_item_id INTEGER,
    labor_item_name VARCHAR(255),
    labor_item_sku VARCHAR(50),
    labor_price DECIMAL(10,2),
    
    -- Beräkningsmetod
    calculation_method VARCHAR(20) DEFAULT 'simple', -- 'simple' eller 'standard'

    -- Motiv + passepartout-kanter (mm)
    motiv_width_mm DECIMAL(10,2),
    motiv_height_mm DECIMAL(10,2),
    pp_left_mm DECIMAL(10,2),
    pp_right_mm DECIMAL(10,2),
    pp_top_mm DECIMAL(10,2),
    pp_bottom_mm DECIMAL(10,2),

    circumference_mm DECIMAL(10,2),
    outer_area_sqm DECIMAL(10,4),

    -- Passepartout 2
    passepartout2_item_id INTEGER,
    passepartout2_item_name VARCHAR(255),
    passepartout2_item_sku VARCHAR(50),
    passepartout2_price_per_sqm DECIMAL(10,2),
    pp2_left_mm DECIMAL(10,2),
    pp2_right_mm DECIMAL(10,2),
    pp2_top_mm DECIMAL(10,2),
    pp2_bottom_mm DECIMAL(10,2),
    passepartout2_area_sqm DECIMAL(10,4),
    passepartout2_cost DECIMAL(10,2),
    manual_simple_price_per_meter DECIMAL(10,2),
    
    -- Calculated prices (locked)
    frame_length_meters DECIMAL(10,2),
    frame_cost DECIMAL(10,2),
    glass_area_sqm DECIMAL(10,2),
    glass_cost DECIMAL(10,2),
    backing_area_sqm DECIMAL(10,2),
    backing_cost DECIMAL(10,2),
    passepartout_area_sqm DECIMAL(10,2),
    passepartout_cost DECIMAL(10,2),

    labor_cost DECIMAL(10,2),
    
    total_cost_excl_moms DECIMAL(10,2),
    total_cost_incl_moms DECIMAL(10,2),
    
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Backward-compatible schema upgrade (för befintliga DB som skapats innan vissa kolumner fanns)
ALTER TABLE IF EXISTS frame_orders
    ADD COLUMN IF NOT EXISTS motiv TEXT;

-- Backward-compatible schema upgrade (company_data)
CREATE TABLE IF NOT EXISTS company_data (
    id INTEGER PRIMARY KEY,
    display_name TEXT,
    legal_name TEXT,
    email TEXT,
    phone TEXT,
    website TEXT,
    address_line1 TEXT,
    address_line2 TEXT,
    postal_code TEXT,
    city TEXT,
    region TEXT,
    country TEXT,
    tax_id TEXT,
    company_id TEXT,
    locale TEXT DEFAULT 'en-US',
    currency TEXT DEFAULT 'USD',
    timezone TEXT DEFAULT 'UTC',
    vat_rate_percentage DECIMAL(5,2) DEFAULT 25.00,
    logo_path TEXT,
    settings JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO company_data (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- Session table (för express-session)
CREATE TABLE IF NOT EXISTS session (
    sid VARCHAR NOT NULL PRIMARY KEY,
    sess JSON NOT NULL,
    expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);

-- Indexes för prestanda
CREATE INDEX IF NOT EXISTS idx_customer_orders_customer_id ON customer_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_orders_order_number ON customer_orders(order_number);
CREATE INDEX IF NOT EXISTS idx_frame_orders_customer_order_id ON frame_orders(customer_order_id);

-- Default admin user (username: admin, password: admin123)
-- Hash för bcrypt: $2b$10$... (genereras vid första körningen)
INSERT INTO users (username, password_hash) 
VALUES ('admin', '$2b$10$rBV2uYhZEzQQfFQ6hN6EYeGKZ.TxLvH2h6yR8pN8LhXnN9Wq5xK5i')
ON CONFLICT (username) DO NOTHING;

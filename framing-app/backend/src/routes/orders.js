const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { generateOrderNumber } = require('../services/orderNumberGenerator');
const { calculateFrameOrderPrice } = require('../services/priceCalculator');
const inventoryAdapter = require('../services/inventoryAdapter');
const { requireAuth } = require('../utils/authMiddleware');
const { streamOrderPdf } = require('../utils/pdf/orderPdf');
const { streamOrderExcel } = require('../utils/excel/orderExcel');

const router = express.Router();

const STATUS_OPTIONS = ['Offert', 'Ej påbörjad', 'Påbörjad', 'Klart', 'Utlämnad'];

function sanitizeString(value) {
  return (value || '').toString().trim();
}

function sanitizeDate(value) {
  const str = sanitizeString(value);
  if (!str) {
    return null;
  }
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? null : str;
}

function parseOrderFilters(query = {}) {
  return {
    q: sanitizeString(query.q),
    status: sanitizeString(query.status),
    dateFrom: sanitizeDate(query.dateFrom),
    dateTo: sanitizeDate(query.dateTo)
  };
}

function buildOrdersWhereClause(filters) {
  const conditions = [];
  const params = [];
  let idx = 1;

  if (filters.q) {
    conditions.push(`(co.order_number ILIKE $${idx} OR c.name ILIKE $${idx})`);
    params.push(`%${filters.q}%`);
    idx += 1;
  }

  if (filters.status) {
    conditions.push(`co.status = $${idx}`);
    params.push(filters.status);
    idx += 1;
  }

  if (filters.dateFrom) {
    conditions.push(`co.order_date >= $${idx}`);
    params.push(filters.dateFrom);
    idx += 1;
  }

  if (filters.dateTo) {
    conditions.push(`co.order_date <= $${idx}`);
    params.push(filters.dateTo);
    idx += 1;
  }

  return {
    whereSql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params
  };
}

// Configure multer for photo uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const orderId = req.params.id;
    const uploadDir = path.join(__dirname, '../../uploads/frame-orders', orderId);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const category = file.fieldname === 'beforeImages' ? 'before' : 'after';
    const ext = path.extname(file.originalname);
    cb(null, `${category}_${timestamp}_${Math.random().toString(36).substr(2, 9)}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max per file
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = allowedTypes.test(file.mimetype);
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Endast bildfiler tillåtna (JPEG, PNG, GIF, WebP)'));
  }
});

// Lista alla ordrar
router.get('/', requireAuth, async (req, res) => {
  try {
    const filters = parseOrderFilters(req.query);
    const { whereSql, params } = buildOrdersWhereClause(filters);

    const result = await db.query(`
      SELECT co.*, c.name as customer_name,
             COUNT(fo.id) as article_count
      FROM customer_orders co
      JOIN customers c ON co.customer_id = c.id
      LEFT JOIN frame_orders fo ON co.id = fo.customer_order_id
      ${whereSql}
      GROUP BY co.id, c.name
      ORDER BY co.order_date DESC NULLS LAST, co.order_number DESC
    `, params);
    
    res.renderWithLayout('orders/index', {
      orders: result.rows,
      query: filters,
      statusOptions: STATUS_OPTIONS
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).send('Kunde inte hämta ordrar');
  }
});

// Ny order - visa formulär
router.get('/new', async (req, res) => {
  try {
    const customersResult = await db.query('SELECT * FROM customers ORDER BY name');
    
    res.renderWithLayout('orders/new', {
      customers: customersResult.rows,
      error: null
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Kunde inte ladda formulär');
  }
});

// Skapa ny order
router.post('/', async (req, res) => {
  const { customer_id, order_date, delivery_date, notes } = req.body;
  
  try {
    const orderNumber = await generateOrderNumber();
    
    const result = await db.query(`
      INSERT INTO customer_orders 
      (order_number, customer_id, order_date, delivery_date, notes, status)
      VALUES ($1, $2, $3, $4, $5, 'Offert')
      RETURNING id
    `, [orderNumber, customer_id, order_date || null, delivery_date || null, notes || null]);
    
    const orderId = result.rows[0].id;
    res.redirect(`/orders/${orderId}`);
  } catch (error) {
    console.error('Error creating order:', error);
    const customersResult = await db.query('SELECT * FROM customers ORDER BY name');
    res.renderWithLayout('orders/new', {
      customers: customersResult.rows,
      error: 'Kunde inte skapa order'
    });
  }
});

// Uppdatera order status - MÅSTE komma före /:id
router.post('/:id/update-status', async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['Offert', 'Ej påbörjad', 'Påbörjad', 'Klart', 'Utlämnad'];
    
    if (!validStatuses.includes(status)) {
      return res.status(400).send('Ogiltig status');
    }
    
    await db.query(
      'UPDATE customer_orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [status, req.params.id]
    );
    res.redirect(`/orders/${req.params.id}`);
  } catch (error) {
    console.error('Error updating order status:', error);
    res.status(500).send('Kunde inte uppdatera status');
  }
});

// Bekräfta order (ändra status från draft till confirmed) - MÅSTE komma före /:id
router.post('/:id/confirm', async (req, res) => {
  try {
    await db.query(
      'UPDATE customer_orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      ['confirmed', req.params.id]
    );
    res.redirect(`/orders/${req.params.id}`);
  } catch (error) {
    console.error('Error confirming order:', error);
    res.status(500).send('Kunde inte bekräfta order');
  }
});

// Radera order (tillåt alla utom Utlämnad) - MÅSTE komma före /:id
router.post('/:id/delete', async (req, res) => {
  try {
    const orderId = req.params.id;

    // Verifiera att order finns och inte är utlämnad
    const orderResult = await db.query('SELECT status FROM customer_orders WHERE id = $1', [orderId]);
    if (orderResult.rows.length === 0) {
      return res.status(404).send('Order inte funnen');
    }

    const currentStatus = orderResult.rows[0].status;
    if (currentStatus === 'Utlämnad') {
      return res.status(403).send('Order med status ' + currentStatus + ' kan inte raderas. Ändra status först.');
    }

    // Radera ramordrar först (cascade)
    await db.query('DELETE FROM frame_orders WHERE customer_order_id = $1', [orderId]);

    // Radera order
    await db.query('DELETE FROM customer_orders WHERE id = $1', [orderId]);

    res.redirect('/orders');
  } catch (error) {
    console.error('Error deleting order:', error);
    res.status(500).send('Kunde inte radera order');
  }
});

// Visa order med ramordrar - Denna är generic och måste komma EFTER specifika routes
router.get('/:id', async (req, res) => {
  try {
    const orderResult = await db.query(`
      SELECT co.*, c.name as customer_name, c.email, c.phone
      FROM customer_orders co
      JOIN customers c ON co.customer_id = c.id
      WHERE co.id = $1
    `, [req.params.id]);
    
    if (orderResult.rows.length === 0) {
      return res.status(404).send('Order hittades inte');
    }
    
    const frameOrdersResult = await db.query(
      'SELECT * FROM frame_orders WHERE customer_order_id = $1 ORDER BY created_at',
      [req.params.id]
    );
    
    res.renderWithLayout('orders/view', {
      order: orderResult.rows[0],
      frameOrders: frameOrdersResult.rows
    });
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).send('Kunde inte hämta order');
  }
});

// Lägg till ramorder - visa formulär
router.get('/:id/frames/new', async (req, res) => {
  try {
    const orderResult = await db.query(
      'SELECT * FROM customer_orders WHERE id = $1',
      [req.params.id]
    );
    
    if (orderResult.rows.length === 0) {
      return res.status(404).send('Order hittades inte');
    }
    
    // Hämta material från inventory
    const frames = await inventoryAdapter.getFrames();
    const glasses = await inventoryAdapter.getGlass();
    const passepartouts = await inventoryAdapter.getPassepartouts();
    const services = await inventoryAdapter.getServices();
    
    // Hämta templates (tillfälligt tom array tills vi implementerar templates fullt ut)
    const templatesResult = await db.query('SELECT * FROM frame_order_templates ORDER BY name');
    
    res.renderWithLayout('orders/frame-new', {
      order: orderResult.rows[0],
      frames,
      glasses,
      passepartouts,
      services,
      templates: templatesResult.rows,
      error: null
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Kunde inte ladda formulär');
  }
});

// Skapa ramorder (med prisuträkning) - NYA SYSTEMET
router.post('/:id/frames', upload.fields([
  { name: 'beforeImages', maxCount: 3 },
  { name: 'afterImages', maxCount: 3 }
]), (req, res, next) => {
  // Debug: log what we received
  console.log('Request body:', Object.keys(req.body));
  console.log('itemsData:', req.body.itemsData);
  next();
}, async (req, res) => {
  const orderId = req.params.id;
  const {
    motiv,
    antal,
    calculation_method,
    simple_price_per_meter,
    notes,
    itemsData,
    saveAsTemplate,
    templateName
  } = req.body;
  
  const client = await db.getClient();
  
  try {
    await client.query('BEGIN');
    
    const antalInt = Math.max(1, parseInt(antal, 10) || 1);
    
    // Parse items från JSON
    const items = itemsData ? JSON.parse(itemsData) : [];
    
    if (items.length === 0) {
      throw new Error('Minst en artikel eller tjänst måste läggas till');
    }
    
    // Handle photo uploads
    const photoMetadata = {};
    if (req.files) {
      if (req.files.beforeImages) {
        photoMetadata.before_images = req.files.beforeImages.map(f => f.filename);
      }
      if (req.files.afterImages) {
        photoMetadata.after_images = req.files.afterImages.map(f => f.filename);
      }
    }
    
    // Hämta dimensioner
    const motivBreddMm = parseFloat(req.body.motiv_bredd_mm) || 0;
    const motivHojdMm = parseFloat(req.body.motiv_hojd_mm) || 0;
    const ppVansterMm = parseFloat(req.body.pp_vanster_mm) || 0;
    const ppHogerMm = parseFloat(req.body.pp_hoger_mm) || 0;
    const ppToppMm = parseFloat(req.body.pp_topp_mm) || 0;
    const ppBottenMm = parseFloat(req.body.pp_botten_mm) || 0;
    
    const outerWidthMm = motivBreddMm + ppVansterMm + ppHogerMm;
    const outerHeightMm = motivHojdMm + ppToppMm + ppBottenMm;
    const circumferenceMm = 2 * outerWidthMm + 2 * outerHeightMm;
    const outerAreaSqm = (outerWidthMm / 1000) * (outerHeightMm / 1000);
    const perimeterMeters = circumferenceMm / 1000;
    
    // Beräkna totalkostnad från items
    let totalCostExclMoms = 0;
    
    for (const item of items) {
      let itemQuantity = parseFloat(item.quantity) || 0;
      
      // Auto-beräkna kvantitet baserat på typ
      if (item.type === 'frame') {
        itemQuantity = perimeterMeters * antalInt;
      } else if (item.type === 'glass' || item.type === 'passepartout') {
        itemQuantity = outerAreaSqm * antalInt;
      }
      
      const unitPrice = parseFloat(item.unit_price) || 0;
      const itemCost = itemQuantity * unitPrice;
      totalCostExclMoms += itemCost;
    }
    
    const totalCostInclMoms = totalCostExclMoms * 1.25;
    
    // Skapa frame_order
    const frameOrderResult = await client.query(
      `INSERT INTO frame_orders (
        customer_order_id, motiv, antal,
        width_mm, height_mm, calculation_method,
        motiv_width_mm, motiv_height_mm,
        pp_left_mm, pp_right_mm, pp_top_mm, pp_bottom_mm,
        circumference_mm, outer_area_sqm,
        manual_simple_price_per_meter,
        total_cost_excl_moms, total_cost_incl_moms,
        notes, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING id`,
      [
        orderId,
        motiv || null,
        antalInt,
        outerWidthMm,
        outerHeightMm,
        calculation_method || 'simple',
        motivBreddMm,
        motivHojdMm,
        ppVansterMm,
        ppHogerMm,
        ppToppMm,
        ppBottenMm,
        circumferenceMm,
        outerAreaSqm,
        simple_price_per_meter || null,
        totalCostExclMoms,
        totalCostInclMoms,
        notes || null,
        JSON.stringify(photoMetadata)
      ]
    );
    
    const frameOrderId = frameOrderResult.rows[0].id;
    
    // Spara items till frame_order_items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let itemQuantity = parseFloat(item.quantity) || 0;
      let unit = 'piece';
      
      // Auto-beräkna kvantitet och unit baserat på typ
      if (item.type === 'frame') {
        itemQuantity = perimeterMeters * antalInt;
        unit = 'meter';
      } else if (item.type === 'glass' || item.type === 'passepartout') {
        itemQuantity = outerAreaSqm * antalInt;
        unit = 'sqm';
      } else if (item.type === 'labor') {
        // Services use manual quantity (e.g. hours or fixed count)
        unit = 'hour';
      }
      
      const unitPrice = parseFloat(item.unit_price) || 0;
      const totalCost = itemQuantity * unitPrice;
      
      await client.query(
        `INSERT INTO frame_order_items (
          frame_order_id, item_type, item_id,
          item_name, item_sku,
          quantity, unit, unit_price, total_cost,
          metadata, sort_order
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          frameOrderId,
          item.type,
          item.item_id || null,
          item.item_name || null,
          item.item_sku || null,
          itemQuantity,
          unit,
          unitPrice,
          totalCost,
          JSON.stringify(item.metadata || {}),
          i
        ]
      );
    }
    
    // Spara som mall om requested
    if (saveAsTemplate && templateName) {
      const ppEdges = {
        left: ppVansterMm,
        right: ppHogerMm,
        top: ppToppMm,
        bottom: ppBottenMm
      };
      
      const templateItems = items.map(item => ({
        type: item.type,
        item_id: item.item_id,
        item_name: item.item_name,
        item_sku: item.item_sku,
        unit_price: item.unit_price,
        metadata: item.metadata
      }));
      
      await client.query(
        `INSERT INTO frame_order_templates (name, items, default_passepartout_edges)
         VALUES ($1, $2, $3)`,
        [templateName, JSON.stringify(templateItems), JSON.stringify(ppEdges)]
      );
    }
    
    await client.query('COMMIT');
    
    // Uppdatera total på customer_order
    await updateOrderTotal(orderId);
    
    res.redirect(`/orders/${orderId}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating frame order:', error);
    res.status(500).send('Kunde inte skapa artikel: ' + error.message);
  } finally {
    client.release();
  }
});

// Visa edit-formulär för ramorder
router.get('/:orderId/frames/:frameId/edit', async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const frameId = req.params.frameId;

    // Hämta order
    const orderResult = await db.query('SELECT * FROM customer_orders WHERE id = $1', [orderId]);
    if (orderResult.rows.length === 0) {
      return res.status(404).send('Order inte funnen');
    }
    const order = orderResult.rows[0];

    // Endast ordrar som inte är utlämnade kan redigeras
    if (order.status === 'Utlämnad') {
      return res.status(403).send('Utlämnade ordrar kan inte redigeras. Ändra status först.');
    }

    // Hämta ramorder
    const frameResult = await db.query('SELECT * FROM frame_orders WHERE id = $1 AND customer_order_id = $2', [frameId, orderId]);
    if (frameResult.rows.length === 0) {
      return res.status(404).send('Ramorder inte funnen');
    }
    const frame = frameResult.rows[0];

    // Hämta frame_order_items för detta frame
    const itemsResult = await db.query(
      'SELECT * FROM frame_order_items WHERE frame_order_id = $1 ORDER BY sort_order',
      [frameId]
    );
    const frameItems = itemsResult.rows;

    // Hämta materiallistor från inventory
    const frames = await inventoryAdapter.getFrames();
    const glasses = await inventoryAdapter.getGlass();
    const passepartouts = await inventoryAdapter.getPassepartouts();
    const services = await inventoryAdapter.getServices();
    
    // Hämta templates (samma som vid new)
    const templatesResult = await db.query('SELECT * FROM frame_order_templates ORDER BY name');

    res.renderWithLayout('orders/frame-new', {
      order,
      frame,
      frameItems,
      frames,
      glasses,
      passepartouts,
      services,
      templates: templatesResult.rows,
      isEdit: true,
      error: null
    });
  } catch (error) {
    console.error('Error loading edit form:', error.message);
    console.error('Error details:', error);
    res.status(500).send('Kunde inte ladda formulär: ' + error.message);
  }
});

// Uppdatera ramorder
router.post('/:orderId/frames/:frameId/edit', upload.fields([
  { name: 'beforeImages', maxCount: 3 },
  { name: 'afterImages', maxCount: 3 }
]), async (req, res) => {
  const orderId = req.params.orderId;
  const frameId = req.params.frameId;
  
  // Debug logging
  console.log('POST edit - Request body keys:', Object.keys(req.body));
  console.log('POST edit - itemsData:', req.body.itemsData);
  console.log('POST edit - motiv_bredd_mm:', req.body.motiv_bredd_mm);
  console.log('POST edit - antal:', req.body.antal);
  
  const {
    motiv,
    antal,
    calculation_method,
    simple_price_per_meter,
    notes,
    itemsData,
    saveAsTemplate,
    templateName
  } = req.body;

  const client = await db.getClient();

  try {
    await client.query('BEGIN');
    
    // Verifiera att ordern inte är utlämnad
    const orderCheck = await client.query('SELECT status FROM customer_orders WHERE id = $1', [orderId]);
    if (orderCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).send('Order inte funnen');
    }
    if (orderCheck.rows[0].status === 'Utlämnad') {
      await client.query('ROLLBACK');
      return res.status(403).send('Utlämnade ordrar kan inte redigeras. Ändra status först.');
    }

    const antalInt = Math.max(1, parseInt(antal, 10) || 1);
    
    // Parse items från JSON
    const items = itemsData ? JSON.parse(itemsData) : [];
    
    // Hämta dimensioner
    const motivBreddMm = parseFloat(req.body.motiv_bredd_mm) || 0;
    const motivHojdMm = parseFloat(req.body.motiv_hojd_mm) || 0;
    const ppVansterMm = parseFloat(req.body.pp_vanster_mm) || 0;
    const ppHogerMm = parseFloat(req.body.pp_hoger_mm) || 0;
    const ppToppMm = parseFloat(req.body.pp_topp_mm) || 0;
    const ppBottenMm = parseFloat(req.body.pp_botten_mm) || 0;
    
    const outerWidthMm = motivBreddMm + ppVansterMm + ppHogerMm;
    const outerHeightMm = motivHojdMm + ppToppMm + ppBottenMm;
    const circumferenceMm = 2 * outerWidthMm + 2 * outerHeightMm;
    const outerAreaSqm = (outerWidthMm / 1000) * (outerHeightMm / 1000);
    const perimeterMeters = circumferenceMm / 1000;
    
    // Beräkna totalkostnad från items
    let totalCostExclMoms = 0;
    
    for (const item of items) {
      let itemQuantity = parseFloat(item.quantity) || 0;
      
      // Auto-beräkna kvantitet baserat på typ
      if (item.type === 'frame') {
        itemQuantity = perimeterMeters * antalInt;
      } else if (item.type === 'glass' || item.type === 'passepartout') {
        itemQuantity = outerAreaSqm * antalInt;
      }
      
      const unitPrice = parseFloat(item.unit_price) || 0;
      const itemCost = itemQuantity * unitPrice;
      totalCostExclMoms += itemCost;
    }
    
    const totalCostInclMoms = totalCostExclMoms * 1.25;
    
    // Uppdatera frame_order
    await client.query(
      `UPDATE frame_orders SET
        motiv = $1,
        antal = $2,
        width_mm = $3,
        height_mm = $4,
        calculation_method = $5,
        motiv_width_mm = $6,
        motiv_height_mm = $7,
        pp_left_mm = $8,
        pp_right_mm = $9,
        pp_top_mm = $10,
        pp_bottom_mm = $11,
        circumference_mm = $12,
        outer_area_sqm = $13,
        manual_simple_price_per_meter = $14,
        total_cost_excl_moms = $15,
        total_cost_incl_moms = $16,
        notes = $17,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $18`,
      [
        motiv || null,
        antalInt,
        outerWidthMm,
        outerHeightMm,
        calculation_method || 'simple',
        motivBreddMm,
        motivHojdMm,
        ppVansterMm,
        ppHogerMm,
        ppToppMm,
        ppBottenMm,
        circumferenceMm,
        outerAreaSqm,
        simple_price_per_meter || null,
        totalCostExclMoms,
        totalCostInclMoms,
        notes || null,
        frameId
      ]
    );
    
    // Radera gamla items
    await client.query('DELETE FROM frame_order_items WHERE frame_order_id = $1', [frameId]);
    
    // Spara nya items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let itemQuantity = parseFloat(item.quantity) || 0;
      let unit = 'piece';
      
      // Auto-beräkna kvantitet och unit baserat på typ
      if (item.type === 'frame') {
        itemQuantity = perimeterMeters * antalInt;
        unit = 'meter';
      } else if (item.type === 'glass' || item.type === 'passepartout') {
        itemQuantity = outerAreaSqm * antalInt;
        unit = 'sqm';
      } else if (item.type === 'labor') {
        unit = 'hour';
      }
      
      const unitPrice = parseFloat(item.unit_price) || 0;
      const totalCost = itemQuantity * unitPrice;
      
      await client.query(
        `INSERT INTO frame_order_items (
          frame_order_id, item_type, item_id,
          item_name, item_sku,
          quantity, unit, unit_price, total_cost,
          metadata, sort_order
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          frameId,
          item.type,
          item.item_id || null,
          item.item_name || null,
          item.item_sku || null,
          itemQuantity,
          unit,
          unitPrice,
          totalCost,
          JSON.stringify(item.metadata || {}),
          i
        ]
      );
    }
    
    // Spara som mall om requested
    if (saveAsTemplate && templateName) {
      console.log('Saving template:', templateName);
      console.log('saveAsTemplate value:', saveAsTemplate);
      console.log('templateName value:', templateName);
      console.log('Items to save in template:', items.length);
      
      const templateItems = items
        .filter(it => ['frame', 'glass', 'passepartout', 'labor', 'cardboard', 'backing'].includes(it.type))
        .map(item => ({
          type: item.type,
          item_id: item.item_id,
          item_name: item.item_name,
          item_sku: item.item_sku,
          unit_price: item.unit_price,
          metadata: item.metadata
        }));
      
      console.log('Filtered template items:', templateItems);
      
      await client.query(
        `INSERT INTO frame_order_templates (name, items, default_passepartout_edges)
         VALUES ($1, $2, $3)`,
        [templateName, JSON.stringify(templateItems), null]
      );
      
      console.log('Template saved successfully');
    }
    
    await client.query('COMMIT');
    
    // Uppdatera total på customer_order
    await updateOrderTotal(orderId);

    res.redirect(`/orders/${orderId}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating frame order:', error);
    res.status(500).send('Kunde inte uppdatera ramorder: ' + error.message);
  } finally {
    client.release();
  }
});

// Radera ramorder
router.post('/:orderId/frames/:frameId/delete', async (req, res) => {
  try {
    const orderId = req.params.orderId;
    const frameId = req.params.frameId;

    const orderResult = await db.query('SELECT status FROM customer_orders WHERE id = $1', [orderId]);
    if (orderResult.rows.length === 0) {
      return res.status(404).send('Order inte funnen');
    }

    const currentStatus = orderResult.rows[0].status;
    if (currentStatus === 'Utlämnad') {
      return res.status(403).send('Ramordrar kan inte raderas när orderstatus är ' + currentStatus + '. Ändra status först.');
    }

    await db.query('DELETE FROM frame_orders WHERE id = $1', [frameId]);
    await updateOrderTotal(orderId);
    res.redirect(`/orders/${orderId}`);
  } catch (error) {
    console.error('Error deleting frame order:', error);
    res.status(500).send('Kunde inte radera ramorder');
  }
});

async function fetchOrderWithFrames(orderId) {
  const orderResult = await db.query(`
    SELECT co.*, c.name as customer_name, c.email, c.phone, c.address
    FROM customer_orders co
    JOIN customers c ON co.customer_id = c.id
    WHERE co.id = $1
  `, [orderId]);

  if (orderResult.rows.length === 0) {
    return null;
  }

  const frameOrdersResult = await db.query(
    'SELECT * FROM frame_orders WHERE customer_order_id = $1 ORDER BY created_at',
    [orderId]
  );

  return {
    order: orderResult.rows[0],
    frameOrders: frameOrdersResult.rows
  };
}

async function fetchCompanyData() {
  try {
    const result = await db.query('SELECT * FROM company_data WHERE id = 1');
    return result.rows[0] || null;
  } catch (err) {
    console.error('Error fetching company data:', err);
    return null;
  }
}

// Exportera RAMORDER som PDF
router.get('/:id/pdf', async (req, res) => {
  try {
    console.log(`[PDF] ramorder orderId=${req.params.id}`);
    const data = await fetchOrderWithFrames(req.params.id);
    if (!data) return res.status(404).send('Order hittades inte');
    const company = await fetchCompanyData();
    streamOrderPdf(res, data.order, data.frameOrders, { documentType: 'ramorder', company });
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).send('Kunde inte generera PDF');
  }
});

// Exportera OFFERT som PDF
router.get('/:id/offert/pdf', async (req, res) => {
  try {
    console.log(`[PDF] offert orderId=${req.params.id}`);
    const data = await fetchOrderWithFrames(req.params.id);
    if (!data) return res.status(404).send('Order hittades inte');
    const company = await fetchCompanyData();
    streamOrderPdf(res, data.order, data.frameOrders, { documentType: 'offert', company });
  } catch (error) {
    console.error('Error generating offert PDF:', error);
    res.status(500).send('Kunde inte generera PDF');
  }
});

// Exportera ARBETSORDER som PDF
router.get('/:id/arbetsorder/pdf', async (req, res) => {
  try {
    console.log(`[PDF] arbetsorder orderId=${req.params.id}`);
    const data = await fetchOrderWithFrames(req.params.id);
    if (!data) return res.status(404).send('Order hittades inte');
    const company = await fetchCompanyData();
    streamOrderPdf(res, data.order, data.frameOrders, { documentType: 'arbetsorder', company });
  } catch (error) {
    console.error('Error generating arbetsorder PDF:', error);
    res.status(500).send('Kunde inte generera PDF');
  }
});

// Exportera KVITTO som PDF
router.get('/:id/kvitto/pdf', async (req, res) => {
  try {
    console.log(`[PDF] kvitto orderId=${req.params.id}`);
    const data = await fetchOrderWithFrames(req.params.id);
    if (!data) return res.status(404).send('Order hittades inte');
    const company = await fetchCompanyData();
    streamOrderPdf(res, data.order, data.frameOrders, { documentType: 'kvitto', company });
  } catch (error) {
    console.error('Error generating kvitto PDF:', error);
    res.status(500).send('Kunde inte generera PDF');
  }
});

// Exportera order som Excel
router.get('/:id/excel', async (req, res) => {
  try {
    console.log(`[Excel] orderId=${req.params.id}`);
    const data = await fetchOrderWithFrames(req.params.id);
    if (!data) return res.status(404).send('Order hittades inte');
    const company = await fetchCompanyData();
    await streamOrderExcel(res, data.order, data.frameOrders, { company });
  } catch (error) {
    console.error('Error generating Excel:', error);
    res.status(500).send('Kunde inte generera Excel');
  }
});

// API endpoint för live prisberäkning (används av frontend)
router.post('/api/calculate-price', async (req, res) => {
  try {
    console.log('=== CALCULATE PRICE API ===');
    console.log('Body:', req.body);
    
    const {
      antal,
      calculation_method,
      simple_price_per_meter,
      frame_item_id,
      glass_item_id,
      labor_item_id,
      passepartout_item_id,
      passepartout2_item_id
    } = req.body;

    const normalizedMethodRaw = (calculation_method ?? 'simple').toString().trim().toLowerCase();
    const normalizedMethod = normalizedMethodRaw === 'standard' ? 'standard' : 'simple';

    const parsedSimplePrice = parseFloat(simple_price_per_meter);
    const simplePricePerMeter = Number.isFinite(parsedSimplePrice)
      ? parsedSimplePrice
      : (normalizedMethod === 'simple' ? 250 : null);

    // Acceptera både *_mm (nya) och *_cm (legacy) från formulär/frontend
    const motivBreddMm = req.body.motiv_bredd_mm ?? req.body.motiv_bredd_cm;
    const motivHojdMm = req.body.motiv_hojd_mm ?? req.body.motiv_hojd_cm;
    const ppVansterMm = req.body.pp_vanster_mm ?? req.body.pp_vanster_cm;
    const ppHogerMm = req.body.pp_hoger_mm ?? req.body.pp_hoger_cm;
    const ppToppMm = req.body.pp_topp_mm ?? req.body.pp_topp_cm;
    const ppBottenMm = req.body.pp_botten_mm ?? req.body.pp_botten_cm;
    const widthMm = req.body.width_mm ?? req.body.width_cm;
    const heightMm = req.body.height_mm ?? req.body.height_cm;
    const passepartoutWidthMm = req.body.passepartout_width_mm ?? req.body.passepartout_width_cm;
    const pp2VansterMm = req.body.pp2_vanster_mm ?? req.body.pp2_vanster_cm;
    const pp2HogerMm = req.body.pp2_hoger_mm ?? req.body.pp2_hoger_cm;
    const pp2ToppMm = req.body.pp2_topp_mm ?? req.body.pp2_topp_cm;
    const pp2BottenMm = req.body.pp2_botten_mm ?? req.body.pp2_botten_cm;
    
    // Hämta material från inventory
    const frameMaterial = frame_item_id ? await inventoryAdapter.getMaterialById(frame_item_id) : null;
    const glassMaterial = glass_item_id ? await inventoryAdapter.getMaterialById(glass_item_id) : null;
    const laborMaterial = labor_item_id ? await inventoryAdapter.getMaterialById(labor_item_id) : null;
    const passepartoutMaterial = passepartout_item_id ? await inventoryAdapter.getMaterialById(passepartout_item_id) : null;
    const passepartout2Material = passepartout2_item_id ? await inventoryAdapter.getMaterialById(passepartout2_item_id) : null;

    const antalInt = Math.max(1, parseInt(antal, 10) || 1);
    
    const frameOrderData = {
      antal: antalInt,
      width_mm: widthMm ? parseFloat(widthMm) : null,
      height_mm: heightMm ? parseFloat(heightMm) : null,
      motiv_width_mm: motivBreddMm ? parseFloat(motivBreddMm) : null,
      motiv_height_mm: motivHojdMm ? parseFloat(motivHojdMm) : null,
      pp_left_mm: ppVansterMm ? parseFloat(ppVansterMm) : null,
      pp_right_mm: ppHogerMm ? parseFloat(ppHogerMm) : null,
      pp_top_mm: ppToppMm ? parseFloat(ppToppMm) : null,
      pp_bottom_mm: ppBottenMm ? parseFloat(ppBottenMm) : null,
      calculation_method: normalizedMethod,
      simple_price_per_meter: simplePricePerMeter,
      frame_price_per_meter: frameMaterial ? frameMaterial.sales_price : null,
      glass_price_per_sqm: glassMaterial ? glassMaterial.sales_price : null,
      labor_price: laborMaterial ? laborMaterial.sales_price : null,
      backing_price_per_sqm: null,
      passepartout_price_per_sqm: passepartoutMaterial ? passepartoutMaterial.sales_price : null,
      passepartout_width_mm: passepartoutWidthMm ? parseFloat(passepartoutWidthMm) : 50,
      passepartout2_price_per_sqm: passepartout2Material ? passepartout2Material.sales_price : null,
      pp2_left_mm: pp2VansterMm ? parseFloat(pp2VansterMm) : null,
      pp2_right_mm: pp2HogerMm ? parseFloat(pp2HogerMm) : null,
      pp2_top_mm: pp2ToppMm ? parseFloat(pp2ToppMm) : null,
      pp2_bottom_mm: pp2BottenMm ? parseFloat(pp2BottenMm) : null
    };
    
    console.log('Calculation method:', normalizedMethod);
    console.log('Simple price per meter:', simplePricePerMeter);
    console.log('Frame order data:', frameOrderData);
    
    const priceCalc = calculateFrameOrderPrice(frameOrderData);
    console.log('Price calculation result:', priceCalc);
    
    res.json(priceCalc);
  } catch (error) {
    console.error('Error calculating price:', error);
    res.status(500).json({ error: 'Kunde inte beräkna pris' });
  }
});

// Hjälpfunktion: Uppdatera total på customer_order baserat på frame_orders
async function updateOrderTotal(orderId) {
  const result = await db.query(
    'SELECT SUM(total_cost_excl_moms) as total_excl, SUM(total_cost_incl_moms) as total_incl FROM frame_orders WHERE customer_order_id = $1',
    [orderId]
  );
  
  const totalExcl = result.rows[0].total_excl || 0;
  const totalIncl = result.rows[0].total_incl || 0;
  
  await db.query(
    'UPDATE customer_orders SET total_price_excl_moms = $1, total_price_incl_moms = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
    [totalExcl, totalIncl, orderId]
  );
}

module.exports = router;

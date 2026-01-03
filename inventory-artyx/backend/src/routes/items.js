const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');
const bwipjs = require('bwip-js');
const QRCode = require('qrcode');
const { processImage, deleteItemImages, deleteImage, UPLOADS_DIR } = require('../utils/imageUtils');
const { parse: parseCsv } = require('csv-parse/sync');

function escapeCsv(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[\n\r",]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function parseListFilters(query) {
  const q = (query.q || '').toString().trim();
  const category = (query.category || '').toString().trim();
  const supplier = (query.supplier || '').toString().trim();
  const priceGroup = (query.priceGroup || '').toString().trim();
  const inStock = (query.inStock || '').toString() === '1';

  const qtyMinRaw = (query.qtyMin ?? '').toString().trim();
  const qtyMaxRaw = (query.qtyMax ?? '').toString().trim();
  const qtyMin = qtyMinRaw === '' ? null : Number(qtyMinRaw);
  const qtyMax = qtyMaxRaw === '' ? null : Number(qtyMaxRaw);

  const sortKey = (query.sort || 'id').toString();
  const dir = (query.dir || 'desc').toString().toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  return {
    q,
    category,
    supplier,
    priceGroup,
    inStock,
    qtyMinRaw,
    qtyMaxRaw,
    qtyMin,
    qtyMax,
    sortKey,
    dir,
  };
}

function buildItemsWhereClause(filters) {
  const where = [];
  const params = [];
  let p = 1;

  if (filters.q) {
    where.push(`(
      CAST(i.id AS TEXT) ILIKE $${p}
      OR i.sku ILIKE $${p}
      OR i.name ILIKE $${p}
      OR i.category ILIKE $${p}
      OR i.supplier ILIKE $${p}
      OR i.color ILIKE $${p}
      OR i.price_group ILIKE $${p}
      OR i.supplier_item_number ILIKE $${p}
      OR i.barcode ILIKE $${p}
    )`);
    params.push(`%${filters.q}%`);
    p++;
  }

  if (filters.category) {
    where.push(`i.category = $${p}`);
    params.push(filters.category);
    p++;
  }

  if (filters.supplier) {
    where.push(`i.supplier = $${p}`);
    params.push(filters.supplier);
    p++;
  }

  if (filters.priceGroup) {
    where.push(`i.price_group = $${p}`);
    params.push(filters.priceGroup);
    p++;
  }

  if (filters.inStock) {
    where.push(`COALESCE(i.quantity, 0) > 0`);
  }

  if (filters.qtyMin !== null && !Number.isNaN(filters.qtyMin)) {
    where.push(`COALESCE(i.quantity, 0) >= $${p}`);
    params.push(filters.qtyMin);
    p++;
  }

  if (filters.qtyMax !== null && !Number.isNaN(filters.qtyMax)) {
    where.push(`COALESCE(i.quantity, 0) <= $${p}`);
    params.push(filters.qtyMax);
    p++;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { whereSql, params };
}

// Configure multer for file uploads
const upload = multer({
  dest: 'uploads/temp/',
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WEBP) are allowed'));
    }
  }
});

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

const CLEAR_TOKEN = '__CLEAR__';

function normalizeHeader(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function parseImportCsv(csvText) {
  const baseOptions = {
    columns: (headers) => headers.map(normalizeHeader),
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    trim: true,
    relax_quotes: true, // More lenient with quote handling
  };

  // Detect delimiter from the first line (header)
  // Remove BOM if present
  const textNoBom = csvText.replace(/^\uFEFF/, '');
  const firstLine = textNoBom.split(/\r?\n/)[0] || '';
  
  // Count delimiters to determine which is more likely
  const commaCounts = (firstLine.match(/,/g) || []).length;
  const semiCounts = (firstLine.match(/;/g) || []).length;
  
  // Use semicolon if it appears more than commas
  const delimiter = semiCounts > commaCounts ? ';' : ',';
  
  return parseCsv(csvText, { ...baseOptions, delimiter });
}

function isClearToken(value) {
  if (value === null || value === undefined) return false;
  return String(value).trim().toUpperCase() === CLEAR_TOKEN;
}

function isEmpty(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function parseNumberOrNull(value) {
  if (isClearToken(value)) return null;
  if (isEmpty(value)) return undefined;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

function parseTextOrNull(value) {
  if (isClearToken(value)) return null;
  if (isEmpty(value)) return undefined;
  return String(value).trim();
}

function parseJsonOrNull(value) {
  if (isClearToken(value)) return null;
  if (isEmpty(value)) return undefined;
  try {
    return JSON.parse(String(value));
  } catch {
    return undefined;
  }
}

// Hjälpfunktion: generera EAN-13 barcode (sista siffran är checksum)
function generateBarcode() {
  // Generate 12 random digits
  let digits = '';
  for (let i = 0; i < 12; i++) {
    digits += Math.floor(Math.random() * 10);
  }
  
  // Calculate EAN-13 checksum
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(digits[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const checksum = (10 - (sum % 10)) % 10;
  
  return digits + checksum;
}

// Note: SKU is now auto-generated by DB trigger (trg_items_sku_manage)
// based on category prefix from category_prefixes table

// GET /items - lista alla artiklar
router.get('/', async (req, res, next) => {
  try {
    const {
      q,
      category,
      supplier,
      priceGroup,
      inStock,
      qtyMinRaw,
      qtyMaxRaw,
      qtyMin,
      qtyMax,
      sortKey,
      dir,
    } = parseListFilters(req.query);

    const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
    const pageSizeRaw = parseInt(req.query.pageSize || '100', 10) || 100;
    const pageSize = Math.min(Math.max(pageSizeRaw, 10), 500);

    const SORT_MAP = {
      id: 'i.id',
      sku: 'i.sku',
      category: 'i.category',
      name: 'i.name',
      color: 'i.color',
      supplier: 'i.supplier',
      unit_size: 'i.unit_size',
      purchase: 'i.purchase_price',
      sales: 'i.sales_price',
      sales_unit: 'i.sales_unit',
      price_group: 'i.price_group',
      qty: 'i.quantity',
      stock_unit: 'i.stock_unit',
      stock_value: '(COALESCE(i.quantity,0) * COALESCE(i.purchase_price,0))',
    };
    const sortCol = SORT_MAP[sortKey] || SORT_MAP.id;

    const { whereSql, params } = buildItemsWhereClause({
      q,
      category,
      supplier,
      priceGroup,
      inStock,
      qtyMin,
      qtyMax,
    });

    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total FROM items i ${whereSql}`,
      params
    );
    const total = countResult.rows[0]?.total ?? 0;

    const offset = (page - 1) * pageSize;
    const p = params.length + 1;
    // Check if images table exists to avoid errors in environments without item_images
    const imgTableReg = await db.query("SELECT to_regclass('public.item_images') AS reg");
    const hasImagesTable = !!imgTableReg.rows[0]?.reg;

    const dataSql = hasImagesTable
      ? `
        SELECT
          i.*,
          img.filename as primary_image
        FROM items i
        LEFT JOIN item_images img ON i.id = img.item_id AND img.is_primary = true
        ${whereSql}
        ORDER BY ${sortCol} ${dir}, i.id ASC
        LIMIT $${p} OFFSET $${p + 1}
      `
      : `
        SELECT
          i.*
        FROM items i
        ${whereSql}
        ORDER BY ${sortCol} ${dir}, i.id ASC
        LIMIT $${p} OFFSET $${p + 1}
      `;

    const result = await db.query(dataSql, params.concat([pageSize, offset]));
    const pageCount = Math.max(1, Math.ceil(total / pageSize));

    const [categoriesResult, suppliersResult, priceGroupsResult] = await Promise.all([
      db.query(`SELECT DISTINCT category FROM items WHERE category IS NOT NULL AND category <> '' ORDER BY category`),
      db.query(`SELECT DISTINCT supplier FROM items WHERE supplier IS NOT NULL AND supplier <> '' ORDER BY supplier`),
      db.query(`SELECT DISTINCT price_group FROM items WHERE price_group IS NOT NULL AND price_group <> '' ORDER BY price_group`),
    ]);

    res.renderWithLayout('items/index-tailwind', {
      items: result.rows,
      query: {
        q,
        category,
        supplier,
        priceGroup,
        inStock: inStock ? '1' : '',
        qtyMin: qtyMinRaw,
        qtyMax: qtyMaxRaw,
        sort: sortKey,
        dir: dir.toLowerCase(),
        page,
        pageSize,
      },
      paging: { total, page, pageSize, pageCount },
      facets: {
        categories: categoriesResult.rows.map((r) => r.category),
        suppliers: suppliersResult.rows.map((r) => r.supplier),
        priceGroups: priceGroupsResult.rows.map((r) => r.price_group),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /items/export.csv - export filtered/sorted items as CSV
router.get('/export.csv', async (req, res, next) => {
  try {
    const filters = parseListFilters(req.query);

    const SORT_MAP = {
      id: 'i.id',
      sku: 'i.sku',
      category: 'i.category',
      name: 'i.name',
      color: 'i.color',
      supplier: 'i.supplier',
      unit_size: 'i.unit_size',
      purchase: 'i.purchase_price',
      sales: 'i.sales_price',
      sales_unit: 'i.sales_unit',
      price_group: 'i.price_group',
      qty: 'i.quantity',
      stock_unit: 'i.stock_unit',
      stock_value: '(COALESCE(i.quantity,0) * COALESCE(i.purchase_price,0))',
    };
    const sortCol = SORT_MAP[filters.sortKey] || SORT_MAP.id;

    const { whereSql, params } = buildItemsWhereClause({
      q: filters.q,
      category: filters.category,
      supplier: filters.supplier,
      priceGroup: filters.priceGroup,
      inStock: filters.inStock,
      qtyMin: filters.qtyMin,
      qtyMax: filters.qtyMax,
    });

    const sql = `
      SELECT
        i.id,
        i.sku,
        i.barcode,
        i.category,
        i.name,
        i.color,
        i.supplier,
        i.supplier_item_number,
        i.purchase_price,
        i.sales_price,
        i.sales_unit,
        i.price_group,
        i.quantity,
        i.stock_unit,
        i.unit_size,
        i.unit_dimensions,
        i.barcode_type,
        (COALESCE(i.quantity,0) * COALESCE(i.purchase_price,0)) AS stock_value
      FROM items i
      ${whereSql}
      ORDER BY ${sortCol} ${filters.dir}, i.id ASC
    `;

    const result = await db.query(sql, params);

    const headers = [
      'id',
      'sku',
      'barcode',
      'category',
      'name',
      'color',
      'supplier',
      'supplier_item_number',
      'purchase_price',
      'sales_price',
      'sales_unit',
      'price_group',
      'quantity',
      'stock_unit',
      'unit_size',
      'unit_dimensions',
      'barcode_type',
      'stock_value',
    ];

    const rows = result.rows.map((r) =>
      headers
        .map((h) => {
          const v = r[h];
          if (h === 'unit_dimensions' && v && typeof v === 'object') return escapeCsv(JSON.stringify(v));
          return escapeCsv(v);
        })
        .join(',')
    );

    const csv = `\uFEFF${headers.join(',')}\n${rows.join('\n')}\n`;
    const filename = `items-export-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// POST /items/import - import items from CSV (match on barcode)
router.get('/import', (req, res) => {
  // Import is handled via POST (multipart upload) from the Items page.
  res.redirect('/items');
});

router.post('/import', importUpload.single('file'), async (req, res, next) => {
  const report = {
    syncMode: (req.body.sync || '').toString() === '1',
    clearToken: CLEAR_TOKEN,
    total: 0,
    created: 0,
    updated: 0,
    errors: [],
  };

  try {
    if (!req.file || !req.file.buffer) {
      report.errors.push({ row: 0, barcode: '', message: 'No file uploaded' });
      return res.status(400).renderWithLayout('items/import-result', { report });
    }

    // Preflight: ensure required columns exist in DB
    const colsResult = await db.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'items'`
    );
    const colSet = new Set(colsResult.rows.map((r) => r.column_name));
    if (!colSet.has('barcode')) {
      report.errors.push({
        row: 0,
        barcode: '',
        message:
          "Database saknar kolumnen 'barcode' i items. Kör migreringarna (t.ex. backend/migrate-add-images-barcode.js) och försök igen.",
      });
      return res.status(500).renderWithLayout('items/import-result', { report });
    }

    const syncMode = report.syncMode;
    const csvText = req.file.buffer.toString('utf8');

    let records;
    try {
      records = parseImportCsv(csvText);
    } catch (e) {
      report.errors.push({
        row: 0,
        barcode: '',
        message: `CSV parsing failed: ${e && e.message ? e.message : String(e)}`,
      });
      return res.status(400).renderWithLayout('items/import-result', { report });
    }

    const allowed = {
      barcode: { col: 'barcode', kind: 'text' },
      category: { col: 'category', kind: 'text' },
      name: { col: 'name', kind: 'text' },
      color: { col: 'color', kind: 'text' },
      supplier: { col: 'supplier', kind: 'text' },
      supplier_item_number: { col: 'supplier_item_number', kind: 'text' },
      purchase_price: { col: 'purchase_price', kind: 'number' },
      sales_price: { col: 'sales_price', kind: 'number' },
      sales_unit: { col: 'sales_unit', kind: 'text' },
      price_group: { col: 'price_group', kind: 'text' },
      quantity: { col: 'quantity', kind: 'number' },
      stock_unit: { col: 'stock_unit', kind: 'text' },
      unit_size: { col: 'unit_size', kind: 'number' },
      unit_dimensions: { col: 'unit_dimensions', kind: 'json' },
      barcode_type: { col: 'barcode_type', kind: 'text' },
      unit: { col: 'unit', kind: 'text' },
      notes: { col: 'notes', kind: 'text' },
    };

    report.total = records.length;

    for (let idx = 0; idx < records.length; idx++) {
      const rowNumber = idx + 2; // header is line 1
      const row = records[idx] || {};

      try {
        // Parse identifiers (barcode and sku for matching)
        const barcodeRaw = row.barcode;
        const barcode = parseTextOrNull(barcodeRaw);
        const skuRaw = row.sku;
        const sku = parseTextOrNull(skuRaw);

        // Matching priority: 1) barcode, 2) sku, 3) new insert
        let existing = null;
        let matchType = null;
        
        if (barcode) {
          const res = await db.query('SELECT * FROM items WHERE barcode = $1', [barcode]);
          if (res.rows.length > 0) {
            existing = res.rows[0];
            matchType = 'barcode';
          }
        }
        
        if (!existing && sku) {
          const res = await db.query('SELECT * FROM items WHERE sku = $1', [sku]);
          if (res.rows.length > 0) {
            existing = res.rows[0];
            matchType = 'sku';
          }
        }
        
        const exists = existing !== null;

        // Build update/insert payload
        const payload = {};
        for (const [key, meta] of Object.entries(allowed)) {
          if (key === 'barcode') continue; // handled separately
          if (!(key in row)) {
            // In sync mode, absent columns should not be touched.
            continue;
          }

          // Skip columns that don't exist in this DB schema
          if (meta.col && !colSet.has(meta.col)) {
            continue;
          }

          const raw = row[key];
          let value;
          if (meta.kind === 'number') value = parseNumberOrNull(raw);
          else if (meta.kind === 'json') value = parseJsonOrNull(raw);
          else value = parseTextOrNull(raw);

          if (syncMode) {
            // sync mode: if field present in CSV but empty -> clear
            if (value === undefined && isEmpty(raw)) value = null;
          }

          if (value !== undefined) {
            payload[meta.col] = value;
          }
        }

        if (exists) {
          // UPDATE path: use partial_update strategy (only non-empty values)
          const updatePayload = {};
          
          for (const [key, meta] of Object.entries(allowed)) {
            if (key === 'barcode') continue; // barcode handled separately
            if (!(key in row)) continue;
            if (meta.col && !colSet.has(meta.col)) continue;
            
            const raw = row[key];
            let value;
            if (meta.kind === 'number') value = parseNumberOrNull(raw);
            else if (meta.kind === 'json') value = parseJsonOrNull(raw);
            else value = parseTextOrNull(raw);
            
            // partial_update: only update if value is present (not undefined/empty)
            if (value !== undefined) {
              updatePayload[meta.col] = value;
            }
          }
          
          // Special handling: update barcode only if provided and different
          if (barcode && barcode !== existing.barcode) {
            // Check for barcode uniqueness
            const conflict = await db.query(
              'SELECT id FROM items WHERE barcode = $1 AND id != $2',
              [barcode, existing.id]
            );
            if (conflict.rows.length > 0) {
              throw new Error('barcode already exists on another item');
            }
            updatePayload.barcode = barcode;
          }
          
          const cols = Object.keys(updatePayload);
          if (cols.length === 0) {
            // nothing to update
            continue;
          }

          const sets = cols.map((c, i) => `${c} = $${i + 1}`);
          const values = cols.map((c) => updatePayload[c]);
          values.push(existing.id);

          await db.query(
            `UPDATE items SET ${sets.join(', ')} WHERE id = $${cols.length + 1}`,
            values
          );
          report.updated++;
        } else {
          // INSERT path: category and name required
          const category = parseTextOrNull(row.category);
          const name = parseTextOrNull(row.name);

          if (!category) {
            throw new Error('category is required for new items (needed for SKU generation)');
          }
          if (!name) {
            throw new Error('name is required for new items');
          }

          // Build insert payload. Do NOT provide id; sku will be auto-generated by trigger
          const insertPayload = {
            category,
            name,
            ...payload,
          };
          
          // Add barcode if provided (otherwise leave NULL for now)
          if (barcode) {
            // Check barcode uniqueness
            const conflict = await db.query('SELECT id FROM items WHERE barcode = $1', [barcode]);
            if (conflict.rows.length > 0) {
              throw new Error('barcode already exists');
            }
            insertPayload.barcode = barcode;
          }

          const cols = Object.keys(insertPayload);
          const placeholders = cols.map((_, i) => `$${i + 1}`);
          const values = cols.map((c) => insertPayload[c]);

          const result = await db.query(
            `INSERT INTO items (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id, sku`,
            values
          );
          
          // If no barcode was provided, optionally auto-generate internal barcode
          if (!barcode && result.rows[0]) {
            const newSku = result.rows[0].sku;
            const internalBarcode = `INT-${newSku}`;
            await db.query(
              `UPDATE items SET barcode = $1, barcode_type = 'CODE128' WHERE id = $2`,
              [internalBarcode, result.rows[0].id]
            );
          }
          
          report.created++;
        }
      } catch (e) {
        report.errors.push({
          row: rowNumber,
          barcode: row.barcode || '',
          message: e && e.message ? e.message : String(e),
        });
      }
    }

    res.renderWithLayout('items/import-result', { report });
  } catch (err) {
    report.errors.push({ row: 0, barcode: '', message: err && err.message ? err.message : String(err) });
    res.status(500).renderWithLayout('items/import-result', { report });
  }
});

// GET /items/new - visa formulär för ny artikel
router.get('/new', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT DISTINCT category FROM items WHERE category IS NOT NULL ORDER BY category`
    );
    const categories = result.rows.map(row => row.category);
    const pgResult = await db.query(
      `SELECT * FROM price_groups ORDER BY name`
    );
    const price_groups = pgResult.rows;
    const suppResult = await db.query(
      `SELECT DISTINCT supplier FROM items WHERE supplier IS NOT NULL ORDER BY supplier`
    );
    const suppliers = suppResult.rows.map(r => r.supplier);
    res.renderWithLayout('items/new', { categories, price_groups, suppliers });
  } catch (err) {
    next(err);
  }
});

// GET /items/:id/edit - visa formulär för att redigera artikel
router.get('/:id/edit', async (req, res, next) => {
  try {
    const itemResult = await db.query('SELECT * FROM items WHERE id = $1', [req.params.id]);
    if (itemResult.rows.length === 0) {
      return res.status(404).send('Artikel inte funnen');
    }
    const catResult = await db.query(
      `SELECT DISTINCT category FROM items WHERE category IS NOT NULL ORDER BY category`
    );
    const categories = catResult.rows.map(row => row.category);
    const pgResult = await db.query(
      `SELECT * FROM price_groups ORDER BY name`
    );
    const price_groups = pgResult.rows;
    const suppResult = await db.query(
      `SELECT DISTINCT supplier FROM items WHERE supplier IS NOT NULL ORDER BY supplier`
    );
    const suppliers = suppResult.rows.map(r => r.supplier);
    
    // Get images for this item
    const imagesResult = await db.query(
      'SELECT * FROM item_images WHERE item_id = $1 ORDER BY display_order, id',
      [req.params.id]
    );
    
    res.renderWithLayout('items/edit', { 
      item: itemResult.rows[0], 
      categories, 
      price_groups, 
      suppliers,
      images: imagesResult.rows
    });
  } catch (err) {
    next(err);
  }
});

// POST /items - skapa ny artikel (with image upload support)
router.post('/', upload.array('images', 5), async (req, res, next) => {
  try {
    let { name, category, unit, purchase_price, sales_price, price_group, supplier, supplier_item_number, stock_unit, sales_unit, unit_size, dim_width, dim_height, dim_length, dim_thickness, dim_unit, color } = req.body;
    // Note: sku will be auto-generated by DB trigger based on category
    // barcode will be auto-generated as INT-{sku} if not provided
    
    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).send('Name is required');
    }
    if (!category || !category.trim()) {
      return res.status(400).send('Category is required for SKU generation');
    }
    
    // Auto-calculate sales price if price_group is set and purchase_price is provided
    if (price_group && purchase_price && !sales_price) {
      const pgResult = await db.query(
        `SELECT markup_percentage FROM price_groups WHERE name = $1`,
        [price_group]
      );
      if (pgResult.rows.length > 0) {
        const markup = pgResult.rows[0].markup_percentage;
        sales_price = parseFloat(purchase_price) * (markup / 100.0);
      }
    }
    
    // Build unit_dimensions JSON if any dimensions provided
    let unit_dimensions = null;
    if (dim_width || dim_height || dim_length || dim_thickness) {
      unit_dimensions = {};
      if (dim_width) unit_dimensions.width = parseFloat(dim_width);
      if (dim_height) unit_dimensions.height = parseFloat(dim_height);
      if (dim_length) unit_dimensions.length = parseFloat(dim_length);
      if (dim_thickness) unit_dimensions.thickness = parseFloat(dim_thickness);
      if (dim_unit) unit_dimensions.unit = dim_unit;
    }
    
    // Insert without sku/barcode - DB trigger will generate them
    const result = await db.query(
      `INSERT INTO items (name, category, unit, purchase_price, sales_price, price_group, supplier, supplier_item_number, stock_unit, sales_unit, unit_size, unit_dimensions, color) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id, sku`,
      [name.trim(), category.trim(), unit || null, purchase_price || null, sales_price || null, price_group || null, supplier || null, supplier_item_number || null, stock_unit || null, sales_unit || null, unit_size || null, unit_dimensions ? JSON.stringify(unit_dimensions) : null, color || null]
    );
    
    // Auto-generate internal barcode based on SKU
    const newId = result.rows[0].id;
    const newSku = result.rows[0].sku;
    const internalBarcode = `INT-${newSku}`;
    await db.query(
      `UPDATE items SET barcode = $1, barcode_type = 'CODE128' WHERE id = $2`,
      [internalBarcode, newId]
    );
    
    // Process uploaded images if any
    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        try {
          const processedImage = await processImage(file, newId);
          const isPrimary = i === 0; // First image is primary
          await db.query(
            `INSERT INTO item_images (item_id, filename, original_filename, mime_type, file_size, is_primary) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [newId, processedImage.filename, processedImage.originalName, processedImage.mimeType, processedImage.size, isPrimary]
          );
        } catch (imgErr) {
          console.error('Error processing image:', imgErr);
        }
      }
    }
    
    // Redirect to items list with success message
    res.redirect(`/items?success=created&id=${newId}`);
  } catch (err) {
    next(err);
  }
});

// POST /items/:id - uppdatera artikel
router.post('/:id', async (req, res, next) => {
  try {
    let { name, category, unit, purchase_price, sales_price, price_group, supplier, supplier_item_number, quantity, add_quantity, stock_unit, sales_unit, unit_size, dim_width, dim_height, dim_length, dim_thickness, dim_unit, color } = req.body;

    // Get current item to check if purchase_price changed
    const currentItem = await db.query('SELECT purchase_price, price_group FROM items WHERE id = $1', [req.params.id]);
    const oldPurchasePrice = currentItem.rows[0]?.purchase_price;
    const oldPriceGroup = currentItem.rows[0]?.price_group;
    
    // Auto-calculate sales price if purchase_price changed and price_group is set
    if (price_group && purchase_price) {
      if (parseFloat(purchase_price) !== parseFloat(oldPurchasePrice) || !sales_price || price_group !== oldPriceGroup) {
        const pgResult = await db.query(
          `SELECT markup_percentage FROM price_groups WHERE name = $1`,
          [price_group]
        );
        if (pgResult.rows.length > 0) {
          const markup = pgResult.rows[0].markup_percentage;
          sales_price = parseFloat(purchase_price) * (markup / 100.0);
        }
      }
    }

    // Beräkna ny mängd: befintlig + tillagd
    const addQty = add_quantity ? parseFloat(add_quantity) : 0;
    const currentQty = quantity ? parseFloat(quantity) : 0;
    const newQuantity = currentQty + addQty;
    
    // Build unit_dimensions JSON if any dimensions provided
    let unit_dimensions = null;
    if (dim_width || dim_height || dim_length || dim_thickness) {
      unit_dimensions = {};
      if (dim_width) unit_dimensions.width = parseFloat(dim_width);
      if (dim_height) unit_dimensions.height = parseFloat(dim_height);
      if (dim_length) unit_dimensions.length = parseFloat(dim_length);
      if (dim_thickness) unit_dimensions.thickness = parseFloat(dim_thickness);
      if (dim_unit) unit_dimensions.unit = dim_unit;
    }

    await db.query(
      `UPDATE items SET name = $1, category = $2, unit = $3, purchase_price = $4, sales_price = $5, price_group = $6, supplier = $7, supplier_item_number = $8, quantity = $9, stock_unit = $10, sales_unit = $11, unit_size = $12, unit_dimensions = $13, color = $14 WHERE id = $15`,
      [name, category || null, unit || null, purchase_price || null, sales_price || null, price_group || null, supplier || null, supplier_item_number || null, newQuantity, stock_unit || null, sales_unit || null, unit_size || null, unit_dimensions ? JSON.stringify(unit_dimensions) : null, color || null, req.params.id]
    );
    res.redirect('/items');
  } catch (err) {
    next(err);
  }
});

// DELETE /items/:id - ta bort artikel
router.post('/:id/delete', async (req, res, next) => {
  try {
    // Delete associated images from filesystem
    deleteItemImages(req.params.id);
    
    // Delete from database (CASCADE will delete item_images records)
    await db.query('DELETE FROM items WHERE id = $1', [req.params.id]);
    res.redirect('/items');
  } catch (err) {
    next(err);
  }
});

// GET /items/:id/view - view item details
router.get('/:id/view', async (req, res, next) => {
  try {
    const itemResult = await db.query('SELECT * FROM items WHERE id = $1', [req.params.id]);
    if (itemResult.rows.length === 0) {
      return res.status(404).send('Artikel inte funnen');
    }
    
    const imagesResult = await db.query(
      'SELECT * FROM item_images WHERE item_id = $1 ORDER BY display_order, id',
      [req.params.id]
    );
    
    res.renderWithLayout('items/view', {
      item: itemResult.rows[0],
      images: imagesResult.rows
    });
  } catch (err) {
    next(err);
  }
});

// POST /items/:id/upload-images - upload images for an item
router.post('/:id/upload-images', upload.array('images', 5), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.redirect(`/items/${req.params.id}/edit?error=no_files`);
    }
    
    // Get current image count
    const countResult = await db.query(
      'SELECT COUNT(*) as count FROM item_images WHERE item_id = $1',
      [req.params.id]
    );
    let currentCount = parseInt(countResult.rows[0].count);
    
    // Check if adding these would exceed limit
    if (currentCount + req.files.length > 5) {
      return res.redirect(`/items/${req.params.id}/edit?error=too_many_images`);
    }
    
    // Process and save each image
    for (let i = 0; i < req.files.length; i++) {
      const displayOrder = currentCount + i + 1;
      const filename = await processImage(req.files[i], req.params.id, displayOrder);
      
      await db.query(
        'INSERT INTO item_images (item_id, filename, display_order, is_primary) VALUES ($1, $2, $3, $4)',
        [req.params.id, filename, displayOrder, currentCount === 0 && i === 0]
      );
    }
    
    res.redirect(`/items/${req.params.id}/edit?success=images_uploaded`);
  } catch (err) {
    next(err);
  }
});

// POST /items/:id/set-primary/:imageId - set image as primary
router.post('/:id/set-primary/:imageId', async (req, res, next) => {
  try {
    // First, unset all primary flags for this item
    await db.query(
      'UPDATE item_images SET is_primary = false WHERE item_id = $1',
      [req.params.id]
    );
    
    // Then set the selected image as primary
    await db.query(
      'UPDATE item_images SET is_primary = true WHERE id = $1 AND item_id = $2',
      [req.params.imageId, req.params.id]
    );
    
    res.redirect(`/items/${req.params.id}/edit`);
  } catch (err) {
    next(err);
  }
});

// POST /items/:id/delete-image/:imageId - delete an image
router.post('/:id/delete-image/:imageId', async (req, res, next) => {
  try {
    const imageResult = await db.query(
      'SELECT filename FROM item_images WHERE id = $1 AND item_id = $2',
      [req.params.imageId, req.params.id]
    );
    
    if (imageResult.rows.length > 0) {
      await deleteImage(req.params.id, imageResult.rows[0].filename);
      await db.query('DELETE FROM item_images WHERE id = $1', [req.params.imageId]);
    }
    
    res.redirect(`/items/${req.params.id}/edit`);
  } catch (err) {
    next(err);
  }
});

// GET /items/:id/image/:filename - serve item image
router.get('/:id/image/:filename', (req, res, next) => {
  try {
    const imagePath = path.join(UPLOADS_DIR, req.params.id, req.params.filename);
    res.sendFile(imagePath);
  } catch (err) {
    next(err);
  }
});

// GET /items/:id/barcode.png - generate barcode image
router.get('/:id/barcode.png', async (req, res, next) => {
  try {
    const result = await db.query('SELECT barcode FROM items WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0 || !result.rows[0].barcode) {
      return res.status(404).send('Barcode not found');
    }
    
    const png = await bwipjs.toBuffer({
      bcid: 'code128',
      text: result.rows[0].barcode,
      scale: 3,
      height: 10,
      includetext: true,
      textxalign: 'center'
    });
    
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  } catch (err) {
    next(err);
  }
});

// GET /items/:id/qrcode.png - generate QR code based on SKU
router.get('/:id/qrcode.png', async (req, res, next) => {
  try {
    const result = await db.query('SELECT sku FROM items WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).send('Item not found');
    }
    
    // Generate QR code containing SKU (or URL to item)
    const qrData = result.rows[0].sku;
    // Alternative: const qrData = `https://inventory.artyx.se/items/${req.params.id}/view`;
    
    const qrCodeBuffer = await QRCode.toBuffer(qrData, {
      width: 300,
      margin: 2,
      errorCorrectionLevel: 'M'
    });
    
    res.setHeader('Content-Type', 'image/png');
    res.send(qrCodeBuffer);
  } catch (err) {
    next(err);
  }
});

// GET /items/:id/print-label - print barcode label
router.get('/:id/print-label', async (req, res, next) => {
  try {
    const result = await db.query('SELECT id, name, sku, barcode FROM items WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).send('Item not found');
    }
    
    const item = result.rows[0];
    res.renderWithLayout('items/print-label', { item });
  } catch (err) {
    next(err);
  }
});

// DEBUG: GET /items/:id/barcode-debug - check barcode in database
router.get('/:id/barcode-debug', async (req, res, next) => {
  try {
    const result = await db.query('SELECT id, name, sku, barcode, barcode_type FROM items WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.json({ error: 'Item not found', id: req.params.id });
    }
    
    const item = result.rows[0];
    res.json({
      item_id: item.id,
      name: item.name,
      sku: item.sku,
      barcode: item.barcode,
      barcode_type: item.barcode_type,
      barcode_exists: !!item.barcode,
      barcode_length: item.barcode ? item.barcode.length : 0
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

module.exports = router;

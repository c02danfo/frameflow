const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'company-data');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safe = String(file.originalname || 'logo')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(-120);
    cb(null, `${Date.now()}-${safe}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file?.mimetype && file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Only image uploads are allowed (PNG/JPG/WebP/GIF).'));
  }
});

async function getCompanyData() {
  const result = await db.query('SELECT * FROM company_data WHERE id = 1');
  return result.rows[0] || null;
}

router.get('/', async (req, res) => {
  try {
    const company = await getCompanyData();
    res.renderWithLayout('company-data/edit', { company, error: null });
  } catch (err) {
    console.error('Error loading company-data:', err);
    res.status(500).send('Could not load company data');
  }
});

router.post('/', upload.single('logo'), async (req, res) => {
  try {
    const body = req.body || {};
    const logoPath = req.file ? `/uploads/company-data/${req.file.filename}` : null;

    const normalizeOptionalString = (value) => {
      if (value == null) return null;
      const trimmed = String(value).trim();
      return trimmed === '' ? null : trimmed;
    };

    const vatInput = body.vat_rate_percentage;
    const vatRate =
      vatInput != null && String(vatInput).trim() !== ''
        ? Number(String(vatInput).replace(',', '.'))
        : null;

    const normalizedVatRate = Number.isFinite(vatRate)
      ? Math.max(0, Math.min(100, vatRate))
      : null;

    const locale = normalizeOptionalString(body.locale);
    const timezone = normalizeOptionalString(body.timezone);
    const currencyRaw = normalizeOptionalString(body.currency);
    const currency = currencyRaw ? currencyRaw.toUpperCase() : null;

    await db.query(
      `
      UPDATE company_data
      SET
        display_name = $1,
        legal_name = $2,
        email = $3,
        phone = $4,
        website = $5,
        address_line1 = $6,
        address_line2 = $7,
        postal_code = $8,
        city = $9,
        region = $10,
        country = $11,
        tax_id = $12,
        company_id = $13,
        locale = $14,
        currency = $15,
        timezone = $16,
        vat_rate_percentage = COALESCE($17, vat_rate_percentage),
        logo_path = COALESCE($18, logo_path),
        updated_at = NOW()
      WHERE id = 1
      `,
      [
        body.display_name || null,
        body.legal_name || null,
        body.email || null,
        body.phone || null,
        body.website || null,
        body.address_line1 || null,
        body.address_line2 || null,
        body.postal_code || null,
        body.city || null,
        body.region || null,
        body.country || null,
        body.tax_id || null,
        body.company_id || null,
        locale,
        currency,
        timezone,
        normalizedVatRate,
        logoPath
      ]
    );

    res.redirect('/company-data');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Error saving company-data:', err);

    try {
      const company = await getCompanyData();
      res.status(400).renderWithLayout('company-data/edit', {
        company,
        error: message
      });
    } catch (loadErr) {
      console.error('Error reloading company-data after save failure:', loadErr);
      res.status(500).send('Could not save company data');
    }
  }
});

module.exports = router;

const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { calculateFrameOrderPrice, MOMS_PERCENTAGE } = require('../../services/priceCalculator');

function formatDateOnly(d, locale = 'sv-SE', timeZone = null) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d || '');
  const options = timeZone ? { timeZone } : undefined;
  return dt.toLocaleDateString(locale || 'sv-SE', options);
}

function formatDateOnlySE(d) {
  return formatDateOnly(d, 'sv-SE', null);
}

function formatMoney(amount, locale = 'sv-SE', currency = 'SEK') {
  const n = Number(amount || 0);
  try {
    return new Intl.NumberFormat(locale || 'sv-SE', {
      style: 'currency',
      currency: currency || 'SEK',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(n);
  } catch (_e) {
    return new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' kr';
  }
}

function outerDimsMm(row) {
  // 1) om width_mm/height_mm finns: använd dem
  const w = Number(row.width_mm || 0);
  const h = Number(row.height_mm || 0);
  if (w > 0 && h > 0) return { w, h };

  // 2) annars beräkna från motiv + pp
  const mw = Number(row.motiv_width_mm || 0);
  const mh = Number(row.motiv_height_mm || 0);
  const pl = Number(row.pp_left_mm || 0);
  const pr = Number(row.pp_right_mm || 0);
  const pt = Number(row.pp_top_mm || 0);
  const pb = Number(row.pp_bottom_mm || 0);
  return { w: mw + pl + pr, h: mh + pt + pb };
}

function normalizeFrameOrderForCalc(row) {
  // priceCalculator förväntar sig simple_price_per_meter, men vi lagrar ofta manual_simple_price_per_meter.
  const normalized = { ...row };
  if (normalized.simple_price_per_meter == null && normalized.manual_simple_price_per_meter != null) {
    normalized.simple_price_per_meter = normalized.manual_simple_price_per_meter;
  }
  return normalized;
}

function materialShort(row) {
  // Kompakt materialtext (utan priser).
  // Prioritera item_name om det finns, annars fall back till sku, annars tomt.
  const pick = (label, name, sku) => {
    const n = (name || '').trim();
    const s = (sku || '').trim();
    if (!n && !s) return null;
    return n ? `${label}:${n}` : `${label}:${s}`;
  };

  const parts = [
    pick('Ram', row.frame_item_name, row.frame_item_sku),
    pick('Glas', row.glass_item_name, row.glass_item_sku),
    pick('PP', row.passepartout_item_name, row.passepartout_item_sku),
    pick('PP2', row.passepartout2_item_name, row.passepartout2_item_sku),
    pick('Bak', row.backing_item_name, row.backing_item_sku),
    pick('Arb', row.labor_item_name, row.labor_item_sku),
  ].filter(Boolean);

  // Om du vill ännu kortare: return parts.map(p => p.split(':')[0]).join(', ');
  return parts.join('; ');
}

function getPdfMeta(documentType, orderNumber) {
  const type = (documentType ?? 'ramorder').toString().trim().toLowerCase();

  if (type === 'offert') return { title: 'OFFERT', filename: `offert-${orderNumber}.pdf` };
  if (type === 'arbetsorder') return { title: 'ARBETSORDER', filename: `arbetsorder-${orderNumber}.pdf` };

  return { title: 'ORDERBEKRÄFTELSE', filename: `order-${orderNumber}.pdf` };
}

function drawDivider(doc, left, right) {
  doc.save();
  doc.lineWidth(1);
  doc.moveTo(left, doc.y).lineTo(right, doc.y).stroke();
  doc.restore();
}

function buildCompanyLines(company) {
  if (!company) return [];

  const parts = [];
  const push = (v) => {
    const s = (v ?? '').toString().trim();
    if (s) parts.push(s);
  };

  push(company.legal_name);
  push(company.address_line1);
  push(company.address_line2);

  const zipCity = [company.postal_code, company.city].filter(Boolean).join(' ');
  push(zipCity);

  const regionCountry = [company.region, company.country].filter(Boolean).join(', ');
  push(regionCountry);

  const contact = [company.email, company.phone, company.website].filter(Boolean).join(' | ');
  push(contact);

  const idLine = [
    company.company_id ? `Company ID: ${company.company_id}` : null,
    company.tax_id ? `Tax ID: ${company.tax_id}` : null
  ].filter(Boolean).join(' | ');
  push(idLine);

  return parts;
}

function resolveCompanyLogoPath(logoPath) {
  if (!logoPath) return null;
  const p = String(logoPath);
  const marker = '/uploads/company-data/';
  if (!p.startsWith(marker)) return null;
  const filename = p.slice(marker.length);
  if (!filename) return null;

  // orderPdf.js: backend/src/utils/pdf -> backend/uploads/company-data
  return path.join(__dirname, '..', '..', '..', 'uploads', 'company-data', filename);
}

function streamOrderPdf(res, order, frameOrders, options = {}) {
  const { documentType = 'ramorder', company = null } = options;
  const { title, filename } = getPdfMeta(documentType, order.order_number);

  const locale = company?.locale || 'sv-SE';
  const timeZone = company?.timezone || null;
  const currency = company?.currency || 'SEK';
  const vatRatePctRaw = Number(company?.vat_rate_percentage);
  const vatRatePct = Number.isFinite(vatRatePctRaw) ? vatRatePctRaw : Number(MOMS_PERCENTAGE || 25);
  const vatMultiplier = 1 + (vatRatePct / 100.0);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  doc.pipe(res);

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;

  const ensureSpace = (minSpace = 80) => {
    const bottom = doc.page.height - doc.page.margins.bottom;
    if (doc.y + minSpace > bottom) {
      doc.addPage();
      doc.y = doc.page.margins.top;
    }
  };

  // =========================================================
  // HEADER (minimalistisk, placeholders för företag)
  // =========================================================
  const companyTitle = (company?.display_name || company?.legal_name || '').toString().trim();
  doc.font('Helvetica-Bold').fontSize(16).text(companyTitle || '<Företagsnamn>', left, 45, { align: 'left' });
  doc.font('Helvetica').fontSize(9);

  // Optional logo (right side)
  const logoFsPath = resolveCompanyLogoPath(company?.logo_path);
  if (logoFsPath && fs.existsSync(logoFsPath)) {
    try {
      const maxW = 120;
      const maxH = 60;
      const x = right - maxW;
      const y = 40;
      doc.image(logoFsPath, x, y, { fit: [maxW, maxH], align: 'right', valign: 'top' });
    } catch (err) {
      console.warn('Could not render company logo in PDF:', err?.message || err);
    }
  }

  const companyLines = buildCompanyLines(company);
  if (companyLines.length > 0) {
    companyLines.forEach((line) => doc.text(line, { align: 'left' }));
  } else {
    // fallback placeholders if company_data is empty
    ['<Adressrad 1>', '<Postnr Ort>', '<E-post | Telefon | Webb>', '<Org.nr/Tax ID>'].forEach((line) => doc.text(line, { align: 'left' }));
  }

  doc.moveDown(0.8);

  doc.font('Helvetica-Bold').fontSize(22).text(title, { align: 'left' });
  doc.moveDown(0.5);
  drawDivider(doc, left, right);
  doc.moveDown(0.8);

  // =========================================================
  // META + KUND (vänsterställd, datum utan tid)
  // =========================================================
  doc.font('Helvetica-Bold').fontSize(9).text('ORDERINFORMATION', { align: 'left' });
  doc.font('Helvetica').fontSize(10);

  const createdAt = order.created_at || order.order_date || order.date || new Date();
  doc.text(`Ordernummer: ${order.order_number || order.id || ''}`, { align: 'left' });
  doc.text(`Datum: ${formatDateOnly(createdAt, locale, timeZone)}`, { align: 'left' });
  if (order.status) doc.text(`Status: ${order.status}`, { align: 'left' });

  doc.moveDown(0.6);

  doc.font('Helvetica-Bold').fontSize(9).text('KUND', { align: 'left' });
  doc.font('Helvetica').fontSize(10);

  const customerName = order.customer_name || order.customerName;
  const customerEmail = order.email || order.customer_email;
  const customerPhone = order.phone || order.customer_phone;
  const customerAddress = order.address || order.customer_address;

  if (customerName) doc.text(customerName, { align: 'left' });
  if (customerEmail) doc.text(customerEmail, { align: 'left' });
  if (customerPhone) doc.text(customerPhone, { align: 'left' });
  if (customerAddress) doc.text(customerAddress, { align: 'left' });
  if (order.customer_zip || order.customer_city) {
    doc.text([order.customer_zip, order.customer_city].filter(Boolean).join(' '), { align: 'left' });
  }

  doc.moveDown(0.8);
  drawDivider(doc, left, right);
  doc.moveDown(0.8);

  // =========================================================
  // KOMPAKT TABELL
  // =========================================================
  doc.font('Helvetica-Bold').fontSize(10).text('SPECIFIKATION', { align: 'left' });
  doc.moveDown(0.4);

  // Kolumner (kompakt)
  const colRow = left;          // Rad
  const colQty = left + 30;     // Antal
  const colSize = left + 75;    // Storlek
  const colMat = left + 170;    // Material
  const colSum = right - 110;   // Summa

  const headerY = doc.y;
  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('#', colRow, headerY);
  doc.text('Antal', colQty, headerY);
  doc.text('Storlek (mm)', colSize, headerY);
  doc.text('Material', colMat, headerY, { width: colSum - colMat - 10 });
  doc.text('Summa inkl moms', colSum, headerY, { width: 110, align: 'left' });

  doc.moveTo(left, headerY + 12).lineTo(right, headerY + 12).stroke();

  doc.font('Helvetica').fontSize(9);
  let y = headerY + 18;

  let totalInclMoms = 0;

  const rowHeight = 14;

  const redrawTableHeader = () => {
    const hy = doc.y;
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('#', colRow, hy);
    doc.text('Antal', colQty, hy);
    doc.text('Storlek (mm)', colSize, hy);
    doc.text('Material', colMat, hy, { width: colSum - colMat - 10 });
    doc.text('Summa inkl moms', colSum, hy, { width: 110, align: 'left' });
    doc.moveTo(left, hy + 12).lineTo(right, hy + 12).stroke();
    doc.font('Helvetica').fontSize(9);
    y = hy + 18;
  };

  (frameOrders || []).forEach((row, idx) => {
    // Beräkna summa inkl moms per ramorder
    const rowForCalc = normalizeFrameOrderForCalc(row);
    const price = calculateFrameOrderPrice(rowForCalc);

    // Prefer to compute incl moms from excl moms using company VAT rate.
    const calcExcl = Number(price.total_cost_excl_moms);
    const lockedExcl = Number(row.total_cost_excl_moms);
    const baseExcl = (Number.isFinite(calcExcl) && calcExcl !== 0)
      ? calcExcl
      : (Number.isFinite(lockedExcl) && lockedExcl !== 0 ? lockedExcl : null);

    let rowIncl = baseExcl != null
      ? baseExcl * vatMultiplier
      : Number(price.total_cost_incl_moms || 0);

    const lockedIncl = Number(row.total_cost_incl_moms);
    if ((!Number.isFinite(rowIncl) || rowIncl === 0) && Number.isFinite(lockedIncl) && lockedIncl !== 0) {
      rowIncl = lockedIncl;
    }

    totalInclMoms += Number.isFinite(rowIncl) ? rowIncl : 0;

    const qty = Math.max(1, parseInt(row.antal, 10) || 1);
    const { w, h } = outerDimsMm(row);
    const sizeText = w > 0 && h > 0 ? `${Math.round(w)}×${Math.round(h)}` : '-';
    const materialText = materialShort(row) || '-';

    // Mät hur många rader materialtexten tar
    const matWidth = (colSum - 10) - colMat;
    const matHeight = doc.heightOfString(materialText, { width: matWidth, align: 'left' });

    const needed = Math.max(rowHeight, matHeight);
    const bottom = doc.page.height - doc.page.margins.bottom;

    // sidbrytning vid behov
    if (y + needed + 30 > bottom) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      redrawTableHeader();
    }

    // Skriv rad
    doc.text(String(idx + 1), colRow, y);
    doc.text(String(qty), colQty, y);
    doc.text(sizeText, colSize, y);
    doc.text(materialText, colMat, y, { width: matWidth, align: 'left' });
    doc.text(formatMoney(rowIncl, locale, currency), colSum, y, { width: 110, align: 'left' });

    // tunn radlinje
    const lineY = y + needed + 2;
    doc.save();
    doc.lineWidth(0.5);
    doc.moveTo(left, lineY).lineTo(right, lineY).stroke();
    doc.restore();

    y = lineY + 4;
  });

  // =========================================================
  // TOTAL (längst ned)
  // =========================================================
  ensureSpace(70);
  doc.moveDown(0.6);

  doc.font('Helvetica-Bold').fontSize(11).text('TOTALT', left, doc.y, { align: 'left' });
  doc.font('Helvetica').fontSize(11).text(`Totalt inkl. moms: ${formatMoney(totalInclMoms, locale, currency)}`, { align: 'left' });

  // (valfritt) exkl moms diskret — avstängt
  void MOMS_PERCENTAGE;

  // Footer (datum utan tid, vänsterställd)
  doc.font('Helvetica').fontSize(8);
  doc.text(`Dokument skapat: ${formatDateOnly(new Date(), locale, timeZone)}`, left, doc.page.height - 50, { align: 'left' });

  doc.end();
}

module.exports = {
  streamOrderPdf,
  getPdfMeta,
};

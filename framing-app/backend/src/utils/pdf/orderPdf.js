const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { calculateFrameOrderPrice, MOMS_PERCENTAGE } = require('../../services/priceCalculator');

function safeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

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
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(n);
  } catch (_e) {
    return new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n) + ' kr';
  }
}

function resolveOpenSansTtf(weight) {
  // PDFKit requires TTF/OTF. @expo-google-fonts provides TTFs.
  // Weight: 400 (Regular) or 700 (Bold)
  const file = weight >= 700 ? 'OpenSans_700Bold.ttf' : 'OpenSans_400Regular.ttf';
  try {
    return require.resolve(`@expo-google-fonts/open-sans/${file}`);
  } catch (_e) {
    return null;
  }
}

function registerFonts(doc) {
  const regularPath = resolveOpenSansTtf(400);
  const boldPath = resolveOpenSansTtf(700);

  if (regularPath && fs.existsSync(regularPath)) {
    doc.registerFont('OpenSans', regularPath);
  }

  if (boldPath && fs.existsSync(boldPath)) {
    doc.registerFont('OpenSans-Bold', boldPath);
  }

  const regular = regularPath ? 'OpenSans' : 'Helvetica';
  const bold = boldPath ? 'OpenSans-Bold' : 'Helvetica-Bold';
  return { regular, bold };
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
  if (type === 'kvitto') return { title: 'KVITTO', filename: `kvitto-${orderNumber}.pdf` };

  return { title: 'ORDERBEKRÄFTELSE', filename: `order-${orderNumber}.pdf` };
}

function drawDivider(doc, left, right) {
  doc.save();
  doc.lineWidth(0.5);
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

/*   const idLine = [
    company.company_id ? `Company ID: ${company.company_id}` : null,
    company.tax_id ? `Tax ID: ${company.tax_id}` : null
  ].filter(Boolean).join(' | ');
  push(idLine); */

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

  const fonts = registerFonts(doc);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  doc.pipe(res);

  const pageWidth = safeNumber(doc.page?.width, 595.28);
  const pageHeight = safeNumber(doc.page?.height, 841.89);
  const marginLeft = safeNumber(doc.page?.margins?.left, 50);
  const marginRight = safeNumber(doc.page?.margins?.right, 50);
  const marginTop = safeNumber(doc.page?.margins?.top, 50);
  const marginBottom = safeNumber(doc.page?.margins?.bottom, 50);

  const left = marginLeft;
  const right = pageWidth - marginRight;

  const ensureSpace = (minSpace = 80) => {
    const bottom = pageHeight - marginBottom;
    const y = safeNumber(doc.y, marginTop);
    if (y + minSpace > bottom) {
      doc.addPage();
      doc.y = marginTop;
    }
  };

// =========================================================
// HEADER (titel + logo på samma rad, tunn linje under, tvåkolumns info)
// =========================================================

const headerTopY = marginTop;
const titleFontSize = 14;

// Titel (vänster) + Logo (höger) på samma rad
doc.font(fonts.bold).fontSize(titleFontSize);
doc.text(title, left, headerTopY, { align: 'left' });

let logoBoxHeight = 0;
const logoFsPath = resolveCompanyLogoPath(company?.logo_path);
if (logoFsPath && fs.existsSync(logoFsPath)) {
  try {
    const maxW = 110;
    const maxH = 24;
    const x = right - maxW;
    const y = headerTopY;
    doc.image(logoFsPath, x, y, { fit: [maxW, maxH], align: 'right', valign: 'top' });
    logoBoxHeight = maxH;
  } catch (err) {
    console.warn('Could not render company logo in PDF:', err?.message || err);
  }
}
doc.moveDown(0.5);
// Tunn linje under titel+logo
const headerRowHeight = Math.max(titleFontSize + 2, logoBoxHeight);
const dividerY = headerTopY + headerRowHeight + 6;
drawDivider(doc, left, right, dividerY);
doc.moveDown(0.5);
// Tvåkolumns info: företag (vänster), orderinfo (höger)
const infoTopY = dividerY + 10;
const fullWidth = right - left;
const leftWidth = Math.max(220, Math.floor(fullWidth * 0.58));
const gap = 12;
const rightX = left + leftWidth + gap;
const rightWidth = Math.max(140, right - rightX);

const companyTitle = (company?.display_name || company?.legal_name || '').toString().trim();
doc.font(fonts.bold).fontSize(11);
doc.text(companyTitle || '<Företagsnamn>', left, infoTopY, { width: leftWidth, align: 'left' });

doc.font(fonts.regular).fontSize(8);
const companyLines = buildCompanyLines(company);
const infoLines = (companyLines.length > 0)
  ? companyLines.slice(1).filter(Boolean)
  : ['<Adressrad 1>', '<Postnr Ort>', '<E-post | Telefon | Webb>'];

let cy = infoTopY + 14;
infoLines.forEach((line) => {
  doc.text(String(line), left, cy, { width: leftWidth, align: 'left' });
  cy = doc.y;
});

const createdAt = order.created_at || order.order_date || order.date || new Date();
doc.font(fonts.bold).fontSize(9);
doc.text(`Ordernummer: ${order.order_number || order.id || ''}`, rightX, infoTopY, { width: rightWidth, align: 'right' });
doc.font(fonts.regular).fontSize(8);
doc.text(`Datum: ${formatDateOnly(createdAt, locale, timeZone)}`, rightX, infoTopY + 14, { width: rightWidth, align: 'right' });
if (order.status) {
  doc.text(`Status: ${order.status}`, rightX, infoTopY + 28, { width: rightWidth, align: 'right' });
}

// Synka y till understa punkten av de två kolumnerna
const bottomLeftY = cy;
const bottomRightY = safeNumber(doc.y, infoTopY + 44);
doc.y = Math.max(bottomLeftY, bottomRightY) + 12;

// =========================================================
// KUND (vänsterställd)
// =========================================================
doc.moveDown(0.8);

doc.font(fonts.bold).fontSize(9);
doc.text('KUND', left, doc.y, { align: 'left' });

doc.font(fonts.regular).fontSize(8);

const customerName = order.customer_name || order.customerName;
const customerEmail = order.email || order.customer_email;
const customerPhone = order.phone || order.customer_phone;
const customerAddress = order.address || order.customer_address;

if (customerName) doc.text(customerName, left, doc.y, { align: 'left' });
if (customerEmail) doc.text(customerEmail, left, doc.y, { align: 'left' });
if (customerPhone) doc.text(customerPhone, left, doc.y, { align: 'left' });
if (customerAddress) doc.text(customerAddress, left, doc.y, { align: 'left' });
if (order.customer_zip || order.customer_city) {
  doc.text([order.customer_zip, order.customer_city].filter(Boolean).join(' '), left, doc.y, { align: 'left' });
}



doc.moveDown(1.0);
drawDivider(doc, left, right);
doc.moveDown(1.0);

  // =========================================================
  // KOMPAKT TABELL
  // =========================================================
  doc.y = safeNumber(doc.y, marginTop);
  doc.x = left;
  doc.font(fonts.bold).fontSize(8);
  //doc.text('SPECIFIKATION', left, safeNumber(doc.y, marginTop), { align: 'left' });
 // doc.moveDown(0.4);

  // Kolumner (kompakt)
  const colRow = left;          // Rad
  const colQty = left + 30;     // Antal
  const colSize = left + 75;    // Storlek
  const colMat = left + 170;    // Material
  const colSum = Math.max(colMat + 120, safeNumber(right - 110, colMat + 120));   // Summa

  const headerY = safeNumber(doc.y, marginTop);
  doc.font(fonts.bold).fontSize(8);
  doc.text('#', colRow, headerY);
  doc.text('Antal', colQty, headerY);
  doc.text('Storlek (mm)', colSize, headerY);
  doc.text('Material', colMat, headerY, { width: Math.max(60, (colSum - colMat - 10)) });
  doc.text('Summa inkl moms', colSum, headerY, { width: 110, align: 'left' });

  doc.moveTo(left, headerY + 12).lineTo(right, headerY + 12).stroke();

  doc.font(fonts.regular).fontSize(8);
  let y = headerY + 18;

  let totalInclMoms = 0;
  let totalExclMoms = 0;

  const rowHeight = 14;

  const redrawTableHeader = () => {
    const hy = safeNumber(doc.y, marginTop);
    doc.font(fonts.bold).fontSize(8);
    doc.text('#', colRow, hy);
    doc.text('Antal', colQty, hy);
    doc.text('Storlek (mm)', colSize, hy);
    doc.text('Material', colMat, hy, { width: Math.max(60, (colSum - colMat - 10)) });
    doc.text('Summa inkl moms', colSum, hy, { width: 110, align: 'right' });
    doc.moveTo(left, hy + 12).lineTo(right, hy + 12).stroke();
    doc.font(fonts.regular).fontSize(8);
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

    const rowExcl = baseExcl != null
      ? baseExcl
      : (Number.isFinite(rowIncl) ? (rowIncl / vatMultiplier) : 0);

    totalExclMoms += Number.isFinite(rowExcl) ? rowExcl : 0;

    const qty = Math.max(1, parseInt(row.antal, 10) || 1);
    const { w, h } = outerDimsMm(row);
    const sizeText = w > 0 && h > 0 ? `${Math.round(w)}×${Math.round(h)}` : '-';
    const materialText = materialShort(row) || '-';

    // Mät hur många rader materialtexten tar
    const matWidth = Math.max(60, safeNumber((colSum - 10) - colMat, 200));
    const matHeight = safeNumber(doc.heightOfString(materialText, { width: matWidth, align: 'left' }), rowHeight);

    const needed = Math.max(rowHeight, matHeight);
    const bottom = pageHeight - marginBottom;

    if (!Number.isFinite(y)) y = safeNumber(doc.y, marginTop);

    // sidbrytning vid behov
    if (y + needed + 30 > bottom) {
      doc.addPage();
      doc.y = marginTop;
      redrawTableHeader();
    }

    // Skriv rad
    doc.text(String(idx + 1), colRow, y);
    doc.text(String(qty), colQty, y);
    doc.text(sizeText, colSize, y);
    doc.text(materialText, colMat, y, { width: matWidth, align: 'left' });
    doc.text(formatMoney(rowIncl, locale, currency), colSum, y, { width: 110, align: 'right' });

    // tunn radlinje
    const lineY = safeNumber(y + needed + 2, safeNumber(doc.y, marginTop) + rowHeight + 2);
    doc.save();
    doc.lineWidth(0.2);
    doc.moveTo(left, lineY).lineTo(right, lineY).stroke();
    doc.restore();

    y = safeNumber(lineY + 4, lineY + rowHeight);
  });

  // =========================================================
  // TOTAL (längst ned)
  // =========================================================
  ensureSpace(10);
  doc.moveDown(0.8);
doc.moveDown(2);

  const totalVat = Math.max(0, totalInclMoms - totalExclMoms);

  doc.font(fonts.bold).fontSize(9).text('TOTALT', left, doc.y, { align: 'right' });
  doc.font(fonts.regular).fontSize(8).text(`Totalt inkl. moms: ${formatMoney(totalInclMoms, locale, currency)}`, { align: 'right' });
  doc.font(fonts.regular).fontSize(8).text(`Varav moms: ${formatMoney(totalVat, locale, currency)}`, { align: 'right' });

  // (valfritt) exkl moms diskret — avstängt
  void MOMS_PERCENTAGE;

  // Footer (datum utan tid, vänsterställd)
  //doc.font('Helvetica').fontSize(8);
  //doc.text(`Dokument skapat: ${formatDateOnly(new Date(), locale, timeZone)}`, left, doc.page.height - 50, { align: 'left' });

  doc.end();
}

module.exports = {
  streamOrderPdf,
  getPdfMeta,
};

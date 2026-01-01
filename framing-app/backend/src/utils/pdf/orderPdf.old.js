const PDFDocument = require('pdfkit');
const { calculateFrameOrderPrice, MOMS_PERCENTAGE } = require('../../services/priceCalculator');

function formatDateSE(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? String(d || '') : dt.toLocaleDateString('sv-SE');
}

function formatTimeSE(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime())
    ? ''
    : dt.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
}

function formatMoneySE(amount) {
  const n = Number(amount || 0);
  return (
    new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) +
    ' kr'
  );
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

function materialLine(label, name, sku) {
  const n = (name || '').trim();
  const s = (sku || '').trim();
  if (!n && !s) return null;
  if (n && s) return `${label}: ${n} (${s})`;
  return `${label}: ${n || s}`;
}

function normalizeFrameOrderForCalc(row) {
  // priceCalculator förväntar sig simple_price_per_meter, men vi lagrar den ofta som manual_simple_price_per_meter.
  const normalized = { ...row };
  if (normalized.simple_price_per_meter == null && normalized.manual_simple_price_per_meter != null) {
    normalized.simple_price_per_meter = normalized.manual_simple_price_per_meter;
  }
  return normalized;
}

function getPdfMeta(documentType, orderNumber) {
  const type = (documentType ?? 'ramorder').toString().trim().toLowerCase();

  if (type === 'offert') {
    return { title: 'OFFERT', filename: `offert-${orderNumber}.pdf` };
  }

  if (type === 'arbetsorder') {
    return { title: 'ARBETSORDER', filename: `arbetsorder-${orderNumber}.pdf` };
  }

  return { title: 'Orderbekräftelse', filename: `order-${orderNumber}.pdf` };
}

function streamOrderPdf(res, order, frameOrders, options = {}) {
  const { documentType = 'ramorder' } = options;
  const { title, filename } = getPdfMeta(documentType, order.order_number);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  doc.pipe(res);

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;

  const ensureSpace = (minSpace = 110) => {
    const bottom = doc.page.height - doc.page.margins.bottom;
    if (doc.y + minSpace > bottom) {
      doc.addPage();
    }
  };

  // Header
  doc.font('Helvetica-Bold').fontSize(18).text(title, left, 45);
  doc.font('Helvetica').fontSize(9).text('Ramverkstad', right - 180, 50, { width: 180, align: 'right' });

  // Order meta
  doc.moveDown(1.2);
  doc.fontSize(10).font('Helvetica');
  doc.text(`Ordernummer: ${order.order_number || order.id || ''}`);
  const createdAt = order.created_at || order.order_date || order.date || new Date();
  doc.text(`Datum: ${formatDateSE(createdAt)} ${formatTimeSE(createdAt)}`.trim());
  doc.text(`Status: ${order.status || ''}`);
  doc.moveDown(0.6);

  // Customer block
  doc.font('Helvetica-Bold').text('Kund');
  doc.font('Helvetica');
  const customerName = order.customer_name || order.customerName;
  const customerEmail = order.email || order.customer_email;
  const customerPhone = order.phone || order.customer_phone;
  const customerAddress = order.address || order.customer_address;
  if (customerName) doc.text(customerName);
  if (customerEmail) doc.text(customerEmail);
  if (customerPhone) doc.text(customerPhone);
  if (customerAddress) doc.text(customerAddress);
  if (order.customer_zip || order.customer_city) {
    doc.text([order.customer_zip, order.customer_city].filter(Boolean).join(' '));
  }
  doc.moveDown(0.8);

  doc.moveTo(left, doc.y).lineTo(right, doc.y).stroke();
  doc.moveDown(0.8);

  // Rader
  doc.font('Helvetica-Bold').fontSize(12).text('Ramordrar');
  doc.moveDown(0.4);

  let totalInclMoms = 0;

  (frameOrders || []).forEach((row, idx) => {
    ensureSpace(140);

    const { w, h } = outerDimsMm(row);
    const qty = Math.max(1, parseInt(row.antal, 10) || 1);

    // Summa (inkl moms) per ramorder via prislogik
    const rowForCalc = normalizeFrameOrderForCalc(row);
    const price = calculateFrameOrderPrice(rowForCalc);
    let rowIncl = Number(price.total_cost_incl_moms || 0);

    // Fallback: använd låst DB-summa om prislogiken inte gav ett rimligt värde
    const lockedIncl = Number(row.total_cost_incl_moms);
    if ((!Number.isFinite(rowIncl) || rowIncl === 0) && Number.isFinite(lockedIncl) && lockedIncl !== 0) {
      rowIncl = lockedIncl;
    }

    totalInclMoms += Number.isFinite(rowIncl) ? rowIncl : 0;

    // Rubrik för ramorder
    doc.font('Helvetica-Bold').fontSize(11).text(`Ramorder ${idx + 1}`);
    doc.font('Helvetica').fontSize(10);

    if (row.motiv) doc.text(`Motiv: ${row.motiv}`);
    doc.text(`Antal: ${qty}`);
    if (w > 0 && h > 0) doc.text(`Dimensioner: ${Math.round(w)} × ${Math.round(h)} mm`);

    // Materiallistning (utan priser)
    const materials = [];
    materials.push(materialLine('Ram', row.frame_item_name, row.frame_item_sku));
    materials.push(materialLine('Glas', row.glass_item_name, row.glass_item_sku));
    materials.push(materialLine('Passepartout', row.passepartout_item_name, row.passepartout_item_sku));
    materials.push(materialLine('Passepartout 2', row.passepartout2_item_name, row.passepartout2_item_sku));
    materials.push(materialLine('Bakstycke', row.backing_item_name, row.backing_item_sku));
    materials.push(materialLine('Arbete', row.labor_item_name, row.labor_item_sku));

    const cleaned = materials.filter(Boolean);
    if (cleaned.length) {
      doc.moveDown(0.2);
      doc.font('Helvetica-Bold').text('Ingående material:');
      doc.font('Helvetica');
      cleaned.forEach(line => doc.text(`• ${line}`));
    }

    // Endast summa per ramorder (inkl moms)
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').text(`Summa inkl. moms: ${formatMoneySE(rowIncl)}`);
    doc.font('Helvetica');

    doc.moveDown(0.6);
    doc.moveTo(left, doc.y).lineTo(right, doc.y).stroke();
    doc.moveDown(0.7);
  });

  // TOTALT längst ned
  ensureSpace(80);
  doc.font('Helvetica-Bold').fontSize(12).text('TOTALT');
  doc.fontSize(11).text(`Totalt inkl. moms: ${formatMoneySE(totalInclMoms)}`);

  // (valfritt) visa även exkl moms här om vi vill använda MOMS_PERCENTAGE
  // const totalExcl = totalInclMoms / (1 + (Number(MOMS_PERCENTAGE) || 25) / 100);
  // doc.font('Helvetica').fontSize(10).text(`Totalt exkl. moms: ${formatMoneySE(totalExcl)}`);
  void MOMS_PERCENTAGE;

  // Footer
  doc.font('Helvetica').fontSize(8);
  doc.text(
    `Rapport genererad: ${new Date().toLocaleString('sv-SE')}`,
    left,
    doc.page.height - 50,
    { width: right - left, align: 'center' }
  );

  doc.end();
}

module.exports = {
  streamOrderPdf,
  getPdfMeta
};

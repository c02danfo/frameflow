const ExcelJS = require('exceljs');
const { calculateFrameOrderPrice, MOMS_PERCENTAGE } = require('../../services/priceCalculator');

function formatDateOnlySE(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d || '');
  return dt.toLocaleDateString('sv-SE');
}

function outerDimsMm(row) {
  const w = Number(row.width_mm || 0);
  const h = Number(row.height_mm || 0);
  if (w > 0 && h > 0) return { w, h };

  const mw = Number(row.motiv_width_mm || 0);
  const mh = Number(row.motiv_height_mm || 0);
  const pl = Number(row.pp_left_mm || 0);
  const pr = Number(row.pp_right_mm || 0);
  const pt = Number(row.pp_top_mm || 0);
  const pb = Number(row.pp_bottom_mm || 0);
  return { w: mw + pl + pr, h: mh + pt + pb };
}

function normalizeFrameOrderForCalc(row) {
  const normalized = { ...row };
  if (normalized.simple_price_per_meter == null && normalized.manual_simple_price_per_meter != null) {
    normalized.simple_price_per_meter = normalized.manual_simple_price_per_meter;
  }
  return normalized;
}

function materialShort(row) {
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

  return parts.join('; ');
}

async function streamOrderExcel(res, order, frameOrders, options = {}) {
  const { company = null } = options;
  
  const currency = company?.currency || 'SEK';
  const vatRatePctRaw = Number(company?.vat_rate_percentage);
  const vatRatePct = Number.isFinite(vatRatePctRaw) ? vatRatePctRaw : Number(MOMS_PERCENTAGE || 25);
  const vatMultiplier = 1 + (vatRatePct / 100.0);

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Order');

  // Header
  worksheet.addRow(['ORDERBEKRÄFTELSE']);
  worksheet.getRow(1).font = { bold: true, size: 14 };
  
  worksheet.addRow([]);
  worksheet.addRow([`Ordernummer: ${order.order_number || order.id}`]);
  worksheet.addRow([`Datum: ${formatDateOnlySE(order.created_at || order.order_date || new Date())}`]);
  worksheet.addRow([`Status: ${order.status || '-'}`]);
  
  worksheet.addRow([]);
  worksheet.addRow(['KUND']);
  worksheet.getRow(7).font = { bold: true };
  
  if (order.customer_name) worksheet.addRow([order.customer_name]);
  if (order.email || order.customer_email) worksheet.addRow([order.email || order.customer_email]);
  if (order.phone || order.customer_phone) worksheet.addRow([order.phone || order.customer_phone]);
  if (order.address || order.customer_address) worksheet.addRow([order.address || order.customer_address]);
  
  worksheet.addRow([]);
  worksheet.addRow([]);
  
  // Tabell header
  const headerRow = worksheet.addRow(['#', 'Antal', 'Storlek (mm)', 'Material', `Summa inkl moms (${currency})`]);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  };

  let totalInclMoms = 0;
  let totalExclMoms = 0;

  // Ramordrar
  (frameOrders || []).forEach((row, idx) => {
    const rowForCalc = normalizeFrameOrderForCalc(row);
    const price = calculateFrameOrderPrice(rowForCalc);

    const calcExcl = Number(price.total_cost_excl_moms);
    const lockedExcl = Number(row.total_cost_excl_moms);
    const baseExcl = (Number.isFinite(calcExcl) && calcExcl !== 0)
      ? calcExcl
      : (Number.isFinite(lockedExcl) && lockedExcl !== 0 ? lockedExcl : null);

    let rowIncl = baseExcl != null ? baseExcl * vatMultiplier : Number(price.total_cost_incl_moms || 0);
    const lockedIncl = Number(row.total_cost_incl_moms);
    if ((!Number.isFinite(rowIncl) || rowIncl === 0) && Number.isFinite(lockedIncl) && lockedIncl !== 0) {
      rowIncl = lockedIncl;
    }

    totalInclMoms += Number.isFinite(rowIncl) ? rowIncl : 0;
    const rowExcl = baseExcl != null ? baseExcl : (Number.isFinite(rowIncl) ? (rowIncl / vatMultiplier) : 0);
    totalExclMoms += Number.isFinite(rowExcl) ? rowExcl : 0;

    const qty = Math.max(1, parseInt(row.antal, 10) || 1);
    const { w, h } = outerDimsMm(row);
    const sizeText = w > 0 && h > 0 ? `${Math.round(w)}×${Math.round(h)}` : '-';
    const materialText = materialShort(row) || '-';

    worksheet.addRow([
      idx + 1,
      qty,
      sizeText,
      materialText,
      rowIncl
    ]);
  });

  worksheet.addRow([]);
  const totalVat = Math.max(0, totalInclMoms - totalExclMoms);
  
  const totalRow = worksheet.addRow(['', '', '', 'TOTALT', totalInclMoms]);
  totalRow.font = { bold: true };
  worksheet.addRow(['', '', '', 'Varav moms', totalVat]);

  // Kolumnbredd
  worksheet.getColumn(1).width = 8;
  worksheet.getColumn(2).width = 10;
  worksheet.getColumn(3).width = 18;
  worksheet.getColumn(4).width = 40;
  worksheet.getColumn(5).width = 20;

  // Nummerformat för summakolumnen
  worksheet.getColumn(5).numFmt = '#,##0.00';

  // ============================================================================
  // NYTT BLAD: ARBETSORDER - Detaljerad information för varje ramorder
  // ============================================================================
  const arbetsorderSheet = workbook.addWorksheet('Arbetsorder');
  
  // Header för arbetsorder-bladet
  const arbetsHeaderRow = arbetsorderSheet.addRow([
    'Motiv',
    'Glas',
    'Passepartout',
    'Ram',
    'Antal',
    'Motiv bredd (mm)',
    'Motiv höjd (mm)',
    'PP vänster (mm)',
    'PP höger (mm)',
    'PP topp (mm)',
    'PP botten (mm)',
    'Total bredd (mm)',
    'Total höjd (mm)'
  ]);
  
  arbetsHeaderRow.font = { bold: true };
  arbetsHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' }
  };

  // Data för varje ramorder
  (frameOrders || []).forEach((row) => {
    const motivWidthMm = Number(row.motiv_width_mm || 0);
    const motivHeightMm = Number(row.motiv_height_mm || 0);
    const ppLeftMm = Number(row.pp_left_mm || 0);
    const ppRightMm = Number(row.pp_right_mm || 0);
    const ppTopMm = Number(row.pp_top_mm || 0);
    const ppBottomMm = Number(row.pp_bottom_mm || 0);
    
    const totalWidthMm = motivWidthMm + ppLeftMm + ppRightMm;
    const totalHeightMm = motivHeightMm + ppTopMm + ppBottomMm;

    arbetsorderSheet.addRow([
      row.motiv || '',
      row.glass_item_name || '',
      row.passepartout_item_name || '',
      row.frame_item_name || '',
      row.antal || 1,
      motivWidthMm || '',
      motivHeightMm || '',
      ppLeftMm || '',
      ppRightMm || '',
      ppTopMm || '',
      ppBottomMm || '',
      totalWidthMm || '',
      totalHeightMm || ''
    ]);
  });

  // Kolumnbredd för arbetsorder-bladet
  arbetsorderSheet.getColumn(1).width = 20; // Motiv
  arbetsorderSheet.getColumn(2).width = 20; // Glas
  arbetsorderSheet.getColumn(3).width = 20; // Passepartout
  arbetsorderSheet.getColumn(4).width = 20; // Ram
  arbetsorderSheet.getColumn(5).width = 10; // Antal
  arbetsorderSheet.getColumn(6).width = 18; // Motiv bredd
  arbetsorderSheet.getColumn(7).width = 18; // Motiv höjd
  arbetsorderSheet.getColumn(8).width = 18; // PP vänster
  arbetsorderSheet.getColumn(9).width = 18; // PP höger
  arbetsorderSheet.getColumn(10).width = 18; // PP topp
  arbetsorderSheet.getColumn(11).width = 18; // PP botten
  arbetsorderSheet.getColumn(12).width = 18; // Total bredd
  arbetsorderSheet.getColumn(13).width = 18; // Total höjd

  // Nummerformat för mm-kolumnerna (visa inga decimaler om värdet är heltal)
  for (let col = 6; col <= 13; col++) {
    arbetsorderSheet.getColumn(col).numFmt = '0.##';
  }
  // ============================================================================
  // SLUT PÅ ARBETSORDER-BLADET
  // ============================================================================

  const filename = `order-${order.order_number}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  await workbook.xlsx.write(res);
  res.end();
}

module.exports = { streamOrderExcel };

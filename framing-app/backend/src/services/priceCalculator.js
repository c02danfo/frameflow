/**
 * Price Calculator Service
 * Beräknar priser för ramorder enligt två metoder: simple och standard
 */

const MOMS_PERCENTAGE = parseFloat(process.env.MOMS_PERCENTAGE || '25');

// Hjälpfunktion: beräkna yttre dimensioner från motiv + passepartout-kanter
// OBS: Alla värden i mm
function computeOuterDimensions(motivWidthMm, motivHeightMm, ppLeftMm, ppRightMm, ppTopMm, ppBottomMm) {
  const mw = parseFloat(motivWidthMm || 0);
  const mh = parseFloat(motivHeightMm || 0);
  const pl = parseFloat(ppLeftMm || 0);
  const pr = parseFloat(ppRightMm || 0);
  const pt = parseFloat(ppTopMm || 0);
  const pb = parseFloat(ppBottomMm || 0);
  const outerWidthMm = mw + pl + pr;
  const outerHeightMm = mh + pt + pb;
  return { outerWidthMm, outerHeightMm };
}

/**
 * Enkel metod: omkrets × pris/meter
 */
function calculateSimpleFrame(widthMm, heightMm, pricePerMeter) {
  const omkretsMm = 2 * (parseFloat(widthMm) + parseFloat(heightMm));
  const lengthMeters = omkretsMm / 1000; // mm till meter
  const cost = lengthMeters * parseFloat(pricePerMeter || 0);
  return { lengthMeters, cost };
}

/**
 * Standard metod: materialförbrukning med 45° snitt
 * Förbrukning per sida: längd + 2 × rambredd + säkerhetsmarginal
 */
function calculateStandardFrameLengthMeters(widthMm, heightMm, frameWidthMm = 0) {
  const w = parseFloat(widthMm);
  const h = parseFloat(heightMm);
  const fw = parseFloat(frameWidthMm);
  const safetyMargin = 0; // mm extra per sida (avstängd)

  // Två horisontella sidor
  const horizontalLength = (w + 2 * fw + safetyMargin) * 2;
  // Två vertikala sidor
  const verticalLength = (h + 2 * fw + safetyMargin) * 2;

  const totalLengthMm = horizontalLength + verticalLength;
  const lengthMetersRaw = totalLengthMm / 1000;
  const lengthMeters = Math.round(lengthMetersRaw * 100) / 100;
  return lengthMeters;
}

function calculateStandardFrame(widthMm, heightMm, pricePerMeter, frameWidthMm = 0) {
  const w = parseFloat(widthMm);
  const h = parseFloat(heightMm);
  const fw = parseFloat(frameWidthMm);
  const safetyMargin = 0; // mm extra per sida (avstängd)
  
  // Två horisontella sidor
  const horizontalLength = (w + 2 * fw + safetyMargin) * 2;
  // Två vertikala sidor
  const verticalLength = (h + 2 * fw + safetyMargin) * 2;
  
  const totalLengthMm = horizontalLength + verticalLength;
  const lengthMetersRaw = totalLengthMm / 1000;
  const costRaw = lengthMetersRaw * parseFloat(pricePerMeter || 0);

  const lengthMeters = Math.round(lengthMetersRaw * 100) / 100;
  const cost = Math.round(costRaw * 100) / 100;
  
  return { lengthMeters, cost };
}

/**
 * Beräkna glasarea (enkel: bredd × höjd)
 */
function calculateGlassArea(widthMm, heightMm) {
  const w = parseFloat(widthMm);
  const h = parseFloat(heightMm);
  const areaSqm = (w / 1000) * (h / 1000); // mm² -> m²
  return areaSqm;
}

/**
 * Beräkna bakskivsarea (samma som glas)
 */
function calculateBackingArea(width, height) {
  return calculateGlassArea(width, height);
}

/**
 * Beräkna passepartout-area (yttre - inre area)
 */
function calculatePassepartoutAreaFromEdges(outerWidthMm, outerHeightMm, ppLeftMm, ppRightMm, ppTopMm, ppBottomMm) {
  const ow = parseFloat(outerWidthMm);
  const oh = parseFloat(outerHeightMm);
  const pl = parseFloat(ppLeftMm || 0);
  const pr = parseFloat(ppRightMm || 0);
  const pt = parseFloat(ppTopMm || 0);
  const pb = parseFloat(ppBottomMm || 0);

  // Yttre area (total)
  const outerArea = (ow / 1000) * (oh / 1000);

  // Inre area (öppningen): ta bort respektive kanter
  const innerWidth = ow - pl - pr;
  const innerHeight = oh - pt - pb;
  const innerArea = (innerWidth / 1000) * (innerHeight / 1000);

  // Passepartout-materialförbrukning = yttre - inre
  const passepartoutArea = outerArea - innerArea;

  return passepartoutArea > 0 ? passepartoutArea : 0;
}

/**
 * Beräkna total kostnad för en ramorder
 */
function calculateFrameOrderPrice(frameOrder) {
  const {
    antal,
    // Antingen direkt yttre mått eller motiv + kanter
    width_mm,
    height_mm,
    motiv_width_mm,
    motiv_height_mm,
    pp_left_mm,
    pp_right_mm,
    pp_top_mm,
    pp_bottom_mm,
    calculation_method,
    frame_price_per_meter, // från material (standard)
    simple_price_per_meter, // manuellt pris/meter (enkel)
    glass_price_per_sqm,
    backing_price_per_sqm,
    passepartout_price_per_sqm,
    passepartout_width_mm
    ,
    // Andra passepartout (valfri)
    passepartout2_price_per_sqm,
    pp2_left_mm,
    pp2_right_mm,
    pp2_top_mm,
    pp2_bottom_mm
    ,
    labor_price
  } = frameOrder;

  const quantity = Math.max(1, parseInt(antal, 10) || 1);
  
  let result = {
    antal: quantity,
    omkrets_mm: 0,
    outer_area_sqm: 0,
    frame_length_meters: 0,
    frame_cost: 0,
    glass_area_sqm: 0,
    glass_cost: 0,
    backing_area_sqm: 0,
    backing_cost: 0,
    passepartout_area_sqm: 0,
    passepartout_cost: 0,
    labor_cost: 0,
    total_cost_excl_moms: 0,
    total_cost_incl_moms: 0
  };
  
  // Avgör yttre mått (mm)
  let owMm = parseFloat(width_mm || 0);
  let ohMm = parseFloat(height_mm || 0);
  if ((!owMm || !ohMm) && (motiv_width_mm && motiv_height_mm)) {
    const dims = computeOuterDimensions(motiv_width_mm, motiv_height_mm, pp_left_mm, pp_right_mm, pp_top_mm, pp_bottom_mm);
    owMm = dims.outerWidthMm;
    ohMm = dims.outerHeightMm;
  }

  // Omkrets (mm) och yttre area (m²)
  result.omkrets_mm = Math.round((2 * owMm + 2 * ohMm) * 100) / 100;
  result.outer_area_sqm = Math.round(((owMm / 1000) * (ohMm / 1000)) * 10000) / 10000; // 4 decimaler

  // ENKEL metod: Använd ENDAST omkrets * pris per meter
  if (calculation_method === 'simple') {
    const meterPrice = simple_price_per_meter ? parseFloat(simple_price_per_meter) : 0;
    // mm -> meter
    const omkrets_meter = result.omkrets_mm / 1000;
    
    result.frame_length_meters = omkrets_meter;
    result.frame_cost = omkrets_meter * meterPrice;

    // Arbete ska INTE beräknas vid Enkel metod
    result.labor_cost = 0;
    
    // Inga andra kostnader vid Enkel metod
    result.glass_area_sqm = 0;
    result.glass_cost = 0;
    result.backing_area_sqm = 0;
    result.backing_cost = 0;
    result.passepartout_area_sqm = 0;
    result.passepartout_cost = 0;
    result.passepartout2_area_sqm = 0;
    result.passepartout2_cost = 0;
    
    // Total = endast ramkostnad
    result.total_cost_excl_moms = result.frame_cost;
  } else {
    // STANDARD metod: Beräkna alla material

    // Längd (m) beräknas alltid i standard (även om ingen ram är vald)
    result.frame_length_meters = calculateStandardFrameLengthMeters(owMm, ohMm);
    
    // Ram
    if (frame_price_per_meter) {
      const frameCalc = calculateStandardFrame(owMm, ohMm, frame_price_per_meter);
      result.frame_length_meters = frameCalc.lengthMeters;
      result.frame_cost = frameCalc.cost;
    }
    
    // Glas
    if (glass_price_per_sqm) {
      result.glass_area_sqm = calculateGlassArea(owMm, ohMm);
      result.glass_cost = result.glass_area_sqm * parseFloat(glass_price_per_sqm);
    }
    
    // Bakskiva
    if (backing_price_per_sqm) {
      result.backing_area_sqm = calculateBackingArea(owMm, ohMm);
      result.backing_cost = result.backing_area_sqm * parseFloat(backing_price_per_sqm);
    }
    
    // Passepartout 1
    if (passepartout_price_per_sqm) {
      if (pp_left_mm || pp_right_mm || pp_top_mm || pp_bottom_mm) {
        result.passepartout_area_sqm = calculatePassepartoutAreaFromEdges(owMm, ohMm, pp_left_mm, pp_right_mm, pp_top_mm, pp_bottom_mm);
      } else if (passepartout_width_mm) {
        // fallback till tidigare modell med enhetlig kant
        result.passepartout_area_sqm = calculatePassepartoutAreaFromEdges(owMm, ohMm, passepartout_width_mm, passepartout_width_mm, passepartout_width_mm, passepartout_width_mm);
      }
      result.passepartout_cost = result.passepartout_area_sqm * parseFloat(passepartout_price_per_sqm);
    }

    // Passepartout 2 (valfri)
    if (passepartout2_price_per_sqm && (pp2_left_mm || pp2_right_mm || pp2_top_mm || pp2_bottom_mm)) {
      const pp2Area = calculatePassepartoutAreaFromEdges(owMm, ohMm, pp2_left_mm, pp2_right_mm, pp2_top_mm, pp2_bottom_mm);
      result.passepartout2_area_sqm = Math.round(pp2Area * 10000) / 10000;
      result.passepartout2_cost = result.passepartout2_area_sqm * parseFloat(passepartout2_price_per_sqm);
    } else {
      result.passepartout2_area_sqm = 0;
      result.passepartout2_cost = 0;
    }

    // Arbete (kr/m) använder samma längd som ram
    if (labor_price) {
      result.labor_cost = result.frame_length_meters * parseFloat(labor_price);
    }
    
    // Total
    result.total_cost_excl_moms = 
      result.frame_cost + 
      result.glass_cost + 
      result.backing_cost + 
      result.passepartout_cost +
      result.passepartout2_cost +
      result.labor_cost;
  }
  
  // Skala kostnader/förbrukning med antal (dimensioner/omkrets hålls per styck)
  if (quantity !== 1) {
    const scaleKeys = [
      'frame_length_meters',
      'frame_cost',
      'glass_area_sqm',
      'glass_cost',
      'backing_area_sqm',
      'backing_cost',
      'passepartout_area_sqm',
      'passepartout_cost',
      'passepartout2_area_sqm',
      'passepartout2_cost',
      'labor_cost'
    ];

    scaleKeys.forEach(key => {
      result[key] = (parseFloat(result[key] || 0) * quantity);
    });

    result.total_cost_excl_moms =
      (result.frame_cost || 0) +
      (result.glass_cost || 0) +
      (result.backing_cost || 0) +
      (result.passepartout_cost || 0) +
      (result.passepartout2_cost || 0) +
      (result.labor_cost || 0);
  }

  result.total_cost_incl_moms = result.total_cost_excl_moms * (1 + MOMS_PERCENTAGE / 100);
  
  // Avrunda alla värden till 2 decimaler
  Object.keys(result).forEach(key => {
    if (key === 'antal') return;
    result[key] = Math.round(result[key] * 100) / 100;
  });
  
  return result;
}

module.exports = {
  calculateSimpleFrame,
  calculateStandardFrame,
  calculateGlassArea,
  calculateBackingArea,
  calculatePassepartoutAreaFromEdges,
  calculateFrameOrderPrice,
  MOMS_PERCENTAGE
};

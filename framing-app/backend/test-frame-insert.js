require('dotenv').config();
const db = require('./src/db');

async function testInsert() {
  try {
    // Test the INSERT with all 51 parameters
    const result = await db.query(`
      INSERT INTO frame_orders (
        customer_order_id,
        width_mm, height_mm, calculation_method,
        motiv_width_mm, motiv_height_mm,
        pp_left_mm, pp_right_mm, pp_top_mm, pp_bottom_mm,
        circumference_mm, outer_area_sqm,
        frame_item_id, frame_item_name, frame_item_sku, frame_price_per_meter,
        glass_item_id, glass_item_name, glass_item_sku, glass_price_per_sqm,
        backing_item_id, backing_item_name, backing_item_sku, backing_price_per_sqm,
        passepartout_item_id, passepartout_item_name, passepartout_item_sku, 
        passepartout_price_per_sqm, passepartout_width_mm,
        passepartout2_item_id, passepartout2_item_name, passepartout2_item_sku, passepartout2_price_per_sqm,
        pp2_left_mm, pp2_right_mm, pp2_top_mm, pp2_bottom_mm,
        manual_simple_price_per_meter,
        frame_length_meters, frame_cost,
        glass_area_sqm, glass_cost,
        backing_area_sqm, backing_cost,
        passepartout_area_sqm, passepartout_cost,
        passepartout2_area_sqm, passepartout2_cost,
        total_cost_excl_moms, total_cost_incl_moms,
        notes
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8, $9, $10,
        $11, $12,
        $13, $14, $15, $16,
        $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26, $27, $28,
        $29, $30, $31, $32,
        $33, $34, $35, $36,
        $37,
        $38, $39,
        $40, $41,
        $42, $43,
        $44, $45,
        $46, $47,
        $48, $49,
        $50, $51
      )
    `, [
      1, // customer_order_id
      400, 500, 'simple', // width, height, method (mm)
      300, 400, // motiv dimensions (mm)
      50, 50, 50, 50, // pp edges (mm)
      1800, 0.2, // circumference (mm), area (m²)
      null, null, null, null, // frame
      null, null, null, null, // glass
      null, null, null, null, // backing
      null, null, null, null, 50, // passepartout width (mm)
      null, null, null, null, // passepartout2
      0, 0, 0, 0, // pp2 edges
      250, // manual_simple_price
      0, 0, // frame
      0, 0, // glass
      0, 0, // backing
      0, 0, // passepartout
      0, 0, // passepartout2
      350, 437.5, // totals
      null // notes
    ]);

    console.log('✓ INSERT successful!');
    console.log('Row count:', result.rowCount);

  } catch (error) {
    console.error('✗ INSERT failed:', error.message);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

testInsert();

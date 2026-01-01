require('dotenv').config();
const db = require('./src/db');

async function checkSchema() {
  try {
    const result = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'frame_orders'
      ORDER BY ordinal_position
    `);

    console.log('\nColumns in frame_orders table:');
    console.log('===============================');
    result.rows.forEach((row, idx) => {
      console.log(`${idx + 1}. ${row.column_name} (${row.data_type})`);
    });
    
    console.log(`\nTotal columns: ${result.rows.length}`);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    process.exit(0);
  }
}

checkSchema();

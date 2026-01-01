// Migration: Generate barcodes for items that don't have one
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER || 'inventory_user',
  password: process.env.DB_PASSWORD || 'inventory_password',
  host: process.env.DB_HOST || '192.168.0.192',
  port: process.env.DB_PORT || 15432,
  database: process.env.DB_NAME || 'inventory_artyx'
});

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

async function migrateBarcode() {
  try {
    console.log('Starting barcode migration...');
    
    // Get all items without barcodes
    const result = await pool.query(
      'SELECT id FROM items WHERE barcode IS NULL ORDER BY id'
    );
    
    console.log(`Found ${result.rows.length} items without barcodes`);
    
    // Generate barcode for each
    for (const item of result.rows) {
      const barcode = generateBarcode();
      await pool.query(
        'UPDATE items SET barcode = $1, barcode_type = $2 WHERE id = $3',
        [barcode, 'CODE128', item.id]
      );
      console.log(`✓ Item ${item.id}: barcode = ${barcode}`);
    }
    
    console.log('✅ Barcode migration completed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration error:', error.message);
    process.exit(1);
  }
}

migrateBarcode();

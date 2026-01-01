const db = require('../db');

/**
 * Generera nästa ordernummer för innevarande år
 * Format: YYYY-NNNN (t.ex. 2025-0001)
 */
async function generateOrderNumber() {
  const currentYear = new Date().getFullYear();
  const prefix = `${currentYear}-`;
  
  // Hitta högsta ordernummer för detta år
  const result = await db.query(
    `SELECT order_number FROM customer_orders 
     WHERE order_number LIKE $1 
     ORDER BY order_number DESC 
     LIMIT 1`,
    [`${prefix}%`]
  );
  
  let nextNumber = 1;
  
  if (result.rows.length > 0) {
    const lastOrderNumber = result.rows[0].order_number;
    const lastNumber = parseInt(lastOrderNumber.split('-')[1], 10);
    nextNumber = lastNumber + 1;
  }
  
  // Padda med nollor till 4 siffror
  const paddedNumber = nextNumber.toString().padStart(4, '0');
  return `${prefix}${paddedNumber}`;
}

module.exports = {
  generateOrderNumber
};

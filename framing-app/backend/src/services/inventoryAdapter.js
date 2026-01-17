const db = require('../db');

/**
 * Inventory Adapter - Läser material från inventory_artyx databasen
 */

// Hämta alla material av en viss kategori
async function getMaterialsByCategory(category) {
  try {
    const result = await db.inventoryQuery(
      'SELECT id, name, sku, category, sales_price FROM items WHERE category = $1 ORDER BY name',
      [category]
    );
    return result.rows;
  } catch (error) {
    console.error(`Error fetching materials for category ${category}:`, error);
    throw error;
  }
}

// Hämta alla material som matchar någon av kategorierna
async function getMaterialsByCategories(categories) {
  try {
    const result = await db.inventoryQuery(
      'SELECT id, name, sku, category, sales_price FROM items WHERE category = ANY($1::text[]) ORDER BY name',
      [categories]
    );
    return result.rows;
  } catch (error) {
    console.error(`Error fetching materials for categories ${categories}:`, error);
    throw error;
  }
}

// Hämta specifikt material by ID
async function getMaterialById(id) {
  try {
    const result = await db.inventoryQuery(
      'SELECT id, name, sku, category, sales_price FROM items WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error(`Error fetching material with id ${id}:`, error);
    throw error;
  }
}

// Hämta alla ramar
async function getFrames() {
  return getMaterialsByCategories(['Frame', 'Ramlist']);
}

// Hämta alla glas
async function getGlass() {
  return getMaterialsByCategories(['Glass', 'Glas']);
}

// Hämta alla bakskivor
async function getBackings() {
  return getMaterialsByCategory('Backing');
}

// Hämta alla passepartouts
async function getPassepartouts() {
  return getMaterialsByCategory('Passepartout');
}

// Hämta alla arbete/arbetskostnader
async function getLabor() {
  return getMaterialsByCategories(['Arbete', 'arbete']);
}

// Hämta alla tjänster från services-tabellen (inventory-artyx)
// Normaliserar till samma shape som items: id, name, sku, sales_price + standard_hours
async function getServices() {
  try {
    const result = await db.inventoryQuery(
      `SELECT
        id,
        name,
        sku,
        category,
        pricing_model,
        unit_type,
        standard_hours,
        COALESCE(
          CASE pricing_model
            WHEN 'fixed' THEN base_price
            WHEN 'hourly' THEN hourly_rate
            WHEN 'per_unit' THEN price_per_unit
            WHEN 'base_plus_hourly' THEN base_price
            ELSE base_price
          END,
          0
        )::numeric(12,2) AS sales_price
      FROM services
      WHERE pricing_model = 'hourly'
      ORDER BY name`,
      []
    );

    return result.rows;
  } catch (error) {
    console.error('Error fetching services:', error);
    throw error;
  }
}

module.exports = {
  getMaterialsByCategory,
  getMaterialsByCategories,
  getMaterialById,
  getFrames,
  getGlass,
  getBackings,
  getPassepartouts,
  getLabor,
  getServices
};

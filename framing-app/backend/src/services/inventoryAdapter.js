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

module.exports = {
  getMaterialsByCategory,
  getMaterialsByCategories,
  getMaterialById,
  getFrames,
  getGlass,
  getBackings,
  getPassepartouts,
  getLabor
};

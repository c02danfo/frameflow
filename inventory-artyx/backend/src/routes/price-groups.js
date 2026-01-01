const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /price-groups - lista alla prisgrupper
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM price_groups ORDER BY name');
    res.renderWithLayout('price-groups/index', { priceGroups: result.rows });
  } catch (err) {
    next(err);
  }
});

// GET /price-groups/new - visa formulär för ny prisgrupp
router.get('/new', async (req, res, next) => {
  try {
    res.renderWithLayout('price-groups/new', {});
  } catch (err) {
    next(err);
  }
});

// POST /price-groups - skapa ny prisgrupp
router.post('/', async (req, res, next) => {
  try {
    const { name, markup_percentage, description } = req.body;
    
    await db.query(
      `INSERT INTO price_groups (name, markup_percentage, description) VALUES ($1, $2, $3)`,
      [name, markup_percentage, description || null]
    );
    res.redirect('/price-groups');
  } catch (err) {
    next(err);
  }
});

// GET /price-groups/:id/edit - visa formulär för att redigera prisgrupp
router.get('/:id/edit', async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM price_groups WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).send('Prisgrupp inte funnen');
    }
    res.renderWithLayout('price-groups/edit', { priceGroup: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// POST /price-groups/:id - uppdatera prisgrupp
router.post('/:id', async (req, res, next) => {
  try {
    const { name, markup_percentage, description, update_items } = req.body;
    
    // Start transaction
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Uppdatera prisgruppen
      await client.query(
        `UPDATE price_groups SET name = $1, markup_percentage = $2, description = $3 WHERE id = $4`,
        [name, markup_percentage, description || null, req.params.id]
      );
      
      // Om användaren valde att uppdatera alla artiklar
      if (update_items === 'true') {
        // Uppdatera alla artiklar som använder denna prisgrupp
        // Beräkna nytt försäljningspris baserat på inköpspris och påslag
        const updateResult = await client.query(
          `UPDATE items 
           SET sales_price = purchase_price * ($1 / 100.0)
           WHERE price_group = $2 AND purchase_price IS NOT NULL`,
          [markup_percentage, name]
        );
        console.log(`Updated ${updateResult.rowCount} items in price group "${name}"`);
      }
      
      await client.query('COMMIT');
      res.redirect('/price-groups');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

// POST /price-groups/:id/delete - ta bort prisgrupp
router.post('/:id/delete', async (req, res, next) => {
  try {
    await db.query('DELETE FROM price_groups WHERE id = $1', [req.params.id]);
    res.redirect('/price-groups');
  } catch (err) {
    next(err);
  }
});

module.exports = router;

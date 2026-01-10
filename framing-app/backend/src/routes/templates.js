const express = require('express');
const router = express.Router();
const db = require('../db');

// Lista alla mallar
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM frame_order_templates ORDER BY name'
    );
    
    res.renderWithLayout('templates/index', {
      templates: result.rows
    });
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).send('Kunde inte hämta mallar');
  }
});

// Hämta en mall (JSON API för att ladda i formulär)
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM frame_order_templates WHERE id = $1',
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Mall inte funnen' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json({ error: 'Kunde inte hämta mall' });
  }
});

// Ta bort mall
router.delete('/:id', async (req, res) => {
  try {
    await db.query(
      'DELETE FROM frame_order_templates WHERE id = $1',
      [req.params.id]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ error: 'Kunde inte ta bort mall' });
  }
});

// Uppdatera mall
router.put('/:id', async (req, res) => {
  const { name, items, default_passepartout_edges } = req.body;
  
  try {
    await db.query(
      `UPDATE frame_order_templates 
       SET name = $1, items = $2, default_passepartout_edges = $3, updated_at = NOW()
       WHERE id = $4`,
      [
        name,
        JSON.stringify(items),
        JSON.stringify(default_passepartout_edges),
        req.params.id
      ]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ error: 'Kunde inte uppdatera mall' });
  }
});

module.exports = router;

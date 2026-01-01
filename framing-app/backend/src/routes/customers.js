const express = require('express');
const db = require('../db');

const router = express.Router();

// Lista alla kunder
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM customers ORDER BY name'
    );
    
    res.renderWithLayout('customers/index', {
      customers: result.rows
    });
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).send('Kunde inte hämta kunder');
  }
});

// Ny kund - visa formulär
router.get('/new', (req, res) => {
  res.renderWithLayout('customers/new', {
    customer: {},
    error: null
  });
});

// Skapa ny kund
router.post('/', async (req, res) => {
  const { name, email, phone, address, notes } = req.body;
  
  try {
    await db.query(
      'INSERT INTO customers (name, email, phone, address, notes) VALUES ($1, $2, $3, $4, $5)',
      [name, email, phone, address, notes]
    );
    
    res.redirect('/customers');
  } catch (error) {
    console.error('Error creating customer:', error);
    res.renderWithLayout('customers/new', {
      customer: req.body,
      error: 'Kunde inte skapa kund'
    });
  }
});

// Visa kund
router.get('/:id', async (req, res) => {
  try {
    const customerResult = await db.query(
      'SELECT * FROM customers WHERE id = $1',
      [req.params.id]
    );
    
    if (customerResult.rows.length === 0) {
      return res.status(404).send('Kund hittades inte');
    }
    
    // Hämta kundens ordrar
    const ordersResult = await db.query(
      'SELECT * FROM customer_orders WHERE customer_id = $1 ORDER BY order_date DESC',
      [req.params.id]
    );
    
    res.renderWithLayout('customers/view', {
      customer: customerResult.rows[0],
      orders: ordersResult.rows
    });
  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).send('Kunde inte hämta kund');
  }
});

// Redigera kund - visa formulär
router.get('/:id/edit', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM customers WHERE id = $1',
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).send('Kund hittades inte');
    }
    
    res.renderWithLayout('customers/edit', {
      customer: result.rows[0],
      error: null
    });
  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).send('Kunde inte hämta kund');
  }
});

// Uppdatera kund
router.post('/:id', async (req, res) => {
  const { name, email, phone, address, notes } = req.body;
  
  try {
    await db.query(
      `UPDATE customers 
       SET name = $1, email = $2, phone = $3, address = $4, notes = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6`,
      [name, email, phone, address, notes, req.params.id]
    );
    
    res.redirect(`/customers/${req.params.id}`);
  } catch (error) {
    console.error('Error updating customer:', error);
    res.renderWithLayout('customers/edit', {
      customer: { ...req.body, id: req.params.id },
      error: 'Kunde inte uppdatera kund'
    });
  }
});

// Radera kund
router.post('/:id/delete', async (req, res) => {
  try {
    await db.query('DELETE FROM customers WHERE id = $1', [req.params.id]);
    res.redirect('/customers');
  } catch (error) {
    console.error('Error deleting customer:', error);
    res.status(500).send('Kunde inte radera kund');
  }
});

module.exports = router;

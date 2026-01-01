# Technical Debt & Future Improvements

## Price Group Management

### Auto-Update Items on Price Group Change
**Status**: ✅ Implemented  
**Location**: `backend/src/routes/price-groups.js`

When updating a price group's markup percentage, the system offers to batch-update all items in that group:

```javascript
// Backend flow:
// 1. Admin updates price group markup
// 2. User is prompted: "Uppdatera alla artiklar i gruppen nu?" (checkbox in form)
// 3. If checked: Runs batch UPDATE in transaction
// 4. All items with that price_group get recalculated sales_price
```

**Implementation**:
- Checkbox in edit form asks user if items should be updated
- POST handler checks `update_items` parameter
- Runs transaction to update price_group + all related items atomically
- Uses formula: `sales_price = purchase_price * (markup_percentage / 100.0)`

**Edge cases handled**:
- Only updates items with non-null purchase_price
- Transaction ensures atomicity (all-or-nothing)
- Filters by price_group name (not ID, since items reference by name)

## Known Limitations

### SKU Collisions
**Status**: ⚠️ Potential Issue

SKUs are randomly generated (4 digits + 2 letters). With ~260,000 possible combinations:
- Low collision risk for small inventories (<10k items)
- Should add uniqueness check + retry logic for scale

**Suggested fix**:
```javascript
async function generateUniqueSKU() {
  for (let i = 0; i < 5; i++) {
    const sku = generateSKU();
    const exists = await db.query('SELECT 1 FROM items WHERE sku = $1', [sku]);
    if (exists.rows.length === 0) return sku;
  }
  throw new Error('Failed to generate unique SKU');
}
```

### No Authentication
**Status**: 🔴 Security Gap

Unlike timestamp-app, inventory-artyx has no login system:
- Anyone with network access can modify inventory
- No audit trail for who made changes
- No role-based permissions

**Suggested approach**:
- Reuse timestamp-app auth pattern (workers + sessions)
- Add `created_by` and `updated_by` columns to items
- Implement audit_log similar to timestamp-app

### No Stock Movement History
**Status**: ℹ️ Feature Gap

`stock_levels` table tracks current quantity but not history:
- Can't see when/why stock changed
- No receiving/transfer/adjustment logs
- Can't track inventory discrepancies

**Suggested fix**: Add `stock_movements` table:
```sql
CREATE TABLE stock_movements (
  id SERIAL PRIMARY KEY,
  item_id INTEGER REFERENCES items(id),
  location_id INTEGER REFERENCES stock_locations(id),
  quantity_change NUMERIC,
  movement_type VARCHAR(50), -- 'receive', 'transfer', 'adjustment', 'sale'
  reference TEXT,
  created_by INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## Dependencies to Update

- `pg` v8.11.0 → v8.16.3 (already updated in root package.json)
- Consider adding `express-validator` for input validation
- Consider `helmet` for security headers

## Performance Considerations

- Add index on `items.price_group` for faster price group queries
- Add index on `items.sku` (currently unique constraint provides this)
- Consider materialized view for price calculations if catalog grows >50k items

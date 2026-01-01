require('dotenv').config();
const db = require('./src/db');

async function createTestData() {
  try {
    console.log('Skapar testdata i inventory_artyx...\n');

    // Kontrollera om items redan finns
    const checkItems = await db.inventoryQuery(
      "SELECT COUNT(*) as count FROM items WHERE category IN ('Frame', 'Glass', 'Backing', 'Passepartout')"
    );

    if (checkItems.rows[0].count > 0) {
      console.log('Testdata existerar redan! Hoppar över...');
      process.exit(0);
    }

    // RAMAR (Frame)
    console.log('Lägger till ramar...');
    await db.inventoryQuery(
      `INSERT INTO items (name, sku, category, purchase_price, sales_price)
       VALUES
       ('Svart träram 3cm', 'FRAME-BLACK-3', 'Frame', 80, 150),
       ('Vit träram 2cm', 'FRAME-WHITE-2', 'Frame', 60, 120),
       ('Naturlig träram 2.5cm', 'FRAME-NAT-2.5', 'Frame', 70, 140),
       ('Mahogny ram 4cm', 'FRAME-MAH-4', 'Frame', 100, 180)
       ON CONFLICT (sku) DO NOTHING`
    );

    // GLAS (Glass)
    console.log('Lägger till glas...');
    await db.inventoryQuery(
      `INSERT INTO items (name, sku, category, purchase_price, sales_price)
       VALUES
       ('Standard glas 2mm', 'GLASS-STD-2', 'Glass', 150, 250),
       ('Antireflexglas 2mm', 'GLASS-AR-2', 'Glass', 250, 450),
       ('UV-skyddande glas 2mm', 'GLASS-UV-2', 'Glass', 200, 380),
       ('Museum glas 2mm', 'GLASS-MUS-2', 'Glass', 350, 650)
       ON CONFLICT (sku) DO NOTHING`
    );

    // BAKSKIVOR (Backing)
    console.log('Lägger till bakskivor...');
    await db.inventoryQuery(
      `INSERT INTO items (name, sku, category, purchase_price, sales_price)
       VALUES
       ('Kartong 2mm', 'BACK-CARD-2', 'Backing', 40, 80),
       ('MDF 3mm', 'BACK-MDF-3', 'Backing', 60, 120),
       ('Hardboard 4mm', 'BACK-HB-4', 'Backing', 80, 150),
       ('Foam board 5mm', 'BACK-FOAM-5', 'Backing', 100, 180)
       ON CONFLICT (sku) DO NOTHING`
    );

    // PASSEPARTOUTS (Passepartout)
    console.log('Lägger till passepartouts...');
    await db.inventoryQuery(
      `INSERT INTO items (name, sku, category, purchase_price, sales_price)
       VALUES
       ('Vit passepartout', 'PP-WHITE', 'Passepartout', 100, 180),
       ('Svart passepartout', 'PP-BLACK', 'Passepartout', 100, 180),
       ('Creme passepartout', 'PP-CREME', 'Passepartout', 110, 200),
       ('Ljusgrå passepartout', 'PP-GRAY', 'Passepartout', 110, 200)
       ON CONFLICT (sku) DO NOTHING`
    );

    console.log('\n✅ Testdata skapad framgångsrikt!');
    console.log('\nLagda items:');
    console.log('  • 4 ramar');
    console.log('  • 4 glastyper');
    console.log('  • 4 bakskivor');
    console.log('  • 4 passepartouts');
    
    process.exit(0);
  } catch (error) {
    console.error('Fel vid skapande av testdata:', error.message);
    process.exit(1);
  }
}

createTestData();

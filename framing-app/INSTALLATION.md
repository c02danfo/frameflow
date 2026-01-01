# INSTALLATIONSGUIDE - Framing App

## Steg 1: Konfigurera databas

Redigera `backend/.env` med rätt databasuppgifter:

```env
# Framing App Database
DB_HOST=192.168.0.192
DB_PORT=15432
DB_NAME=framing_app
DB_USER=inventory_user
DB_PASSWORD=<DITT_LÖSENORD_HÄR>  # Ändra detta!

# Inventory Database (read-only)
INVENTORY_DB_HOST=192.168.0.192
INVENTORY_DB_PORT=15432
INVENTORY_DB_NAME=inventory_artyx
INVENTORY_DB_USER=inventory_user
INVENTORY_DB_PASSWORD=<DITT_LÖSENORD_HÄR>  # Ändra detta!
```

## Steg 2: Skapa databas

Kör init-script:

```bash
cd backend
node init-database.js
```

Detta kommer att:
- Skapa `framing_app` databasen om den inte finns
- Skapa alla tabeller (customers, customer_orders, frame_orders, users, session)
- Skapa standard admin-användare

## Steg 3: Starta applikationen

```bash
npm run dev
```

Applikationen startar på: **http://localhost:3011**

## Standardinloggning

- **Användarnamn**: admin
- **Lösenord**: admin123

## Viktiga noteringar

### Inventory-integration

Applikationen läser material från `inventory_artyx` databasen. Se till att:
1. inventory_artyx databasen är tillgänglig
2. Tabellen `items` finns med kolumnen `category`
3. Det finns items med category: Frame, Glass, Backing, Passepartout

### Material i inventory

För att framing-app ska fungera behöver du lägga till items i inventory-artyx med rätt kategorier:

**Exempel på items som behövs:**

```sql
-- Ramar (Frame)
INSERT INTO items (name, sku, category, sales_price)
VALUES 
  ('Svart träram 3cm', 'FRAME001', 'Frame', 150.00),
  ('Vit träram 2cm', 'FRAME002', 'Frame', 120.00);

-- Glas (Glass)
INSERT INTO items (name, sku, category, sales_price)
VALUES 
  ('Standard glas 2mm', 'GLASS001', 'Glass', 250.00),
  ('Antireflexglas', 'GLASS002', 'Glass', 450.00);

-- Bakskivor (Backing)
INSERT INTO items (name, sku, category, sales_price)
VALUES 
  ('Kartong 2mm', 'BACK001', 'Backing', 80.00),
  ('MDF 3mm', 'BACK002', 'Backing', 120.00);

-- Passepartouts (Passepartout)
INSERT INTO items (name, sku, category, sales_price)
VALUES 
  ('Vit passepartout', 'PP001', 'Passepartout', 180.00),
  ('Svart passepartout', 'PP002', 'Passepartout', 180.00);
```

## Testflöde

1. **Logga in** (admin / admin123)
2. **Skapa kund**: Gå till Kunder → Ny kund
3. **Skapa order**: Gå till Ordrar → Ny order, välj kunden
4. **Lägg till ramorder**: 
   - Fyll i dimensioner (t.ex. 50 × 70 cm)
   - Välj material (ram, glas, bakskiva, passepartout)
   - Se live prisberäkning i högra kolumnen
   - Spara ramorder
5. **Bekräfta order**: När alla ramordrar är tillagda, klicka "Bekräfta order"
6. **Exportera PDF**: Klicka "Exportera PDF" för att få en PDF-rapport

## Prisberäkningsexempel

### Enkel metod (omkrets):
- Dimensioner: 50 × 70 cm
- Ram: 150 kr/m
- Beräkning: 2 × (50 + 70) = 240 cm = 2.4 m
- Kostnad: 2.4 × 150 = **360 kr**

### Standard metod (förbrukning):
- Dimensioner: 50 × 70 cm
- Rambredd: 5 cm
- Horisontell: (50 + 2×5 + 2) × 2 = 124 cm
- Vertikal: (70 + 2×5 + 2) × 2 = 164 cm
- Total: 288 cm = 2.88 m
- Kostnad: 2.88 × 150 = **432 kr**

## Felsökning

### "Password authentication failed"
- Kontrollera att DB_PASSWORD i .env är korrekt
- Testa anslutning med psql: `psql -h 192.168.0.192 -p 15432 -U inventory_user -d postgres`

### "Inga material visas i dropdowns"
- Kolla att inventory_artyx databasen har items med rätt category
- Kör: `SELECT * FROM items WHERE category IN ('Frame', 'Glass', 'Backing', 'Passepartout');`

### Port 3011 redan används
- Ändra PORT i .env till annan port
- Kör: `Get-NetTCPConnection -LocalPort 3011` för att se vad som använder porten

## Docker

Om du vill köra med Docker:

```bash
docker-compose up -d
```

OBS: Du behöver fortfarande skapa databasen manuellt först.

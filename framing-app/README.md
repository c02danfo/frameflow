# Framing App - Inramningssystem

Komplett system för hantering av kundorder och rambeställningar med prisberäkningar.

## Features

- **Kundhantering**: CRUD för kunder med kontaktuppgifter
- **Orderhantering**: Skapa ordrar med automatisk ordernumrering (YYYY-NNNN)
- **Ramordrar**: Lägg till flera ramordrar per order med:
  - Val av dimensioner (bredd × höjd)
  - Val av material (ram, glas, bakskiva, passepartout)
  - Två beräkningsmetoder:
    - **Enkel**: omkrets × pris/meter
    - **Standard**: materialförbrukning med 45° snitt
  - Live prisvisning under ifyllnad
  - Låsta priser vid skapande (historiska ordrar påverkas ej av framtida prisändringar)
- **Inventory-integration**: Läser material från inventory-artyx databasen
- **Momshantering**: 25% moms, visar både exkl/inkl
- **PDF-export**: Exportera ordrar som PDF
- **Login**: Enkel autentisering med PostgreSQL-sessions

## Installation

### 1. Skapa databas

Kör följande SQL för att skapa databasen:

```sql
CREATE DATABASE framing_app;
```

Kör sedan `backend/db/init.sql` för att skapa tabeller.

### 2. Konfigurera

Redigera `backend/.env` med dina databasuppgifter.

### 3. Starta med Docker

```bash
docker-compose up -d
```

Eller direkt med Node.js:

```bash
cd backend
npm install
npm run dev
```

Applikationen körs på: http://localhost:3011

## Standardinloggning

- **Användarnamn**: `admin`
- **Lösenord**: `admin123`

## Teknisk stack

- **Backend**: Node.js, Express
- **Databas**: PostgreSQL (framing_app + inventory_artyx)
- **Sessions**: express-session med connect-pg-simple
- **Views**: EJS + Tailwind CSS
- **PDF**: pdfkit

## Struktur

```
framing-app/
├── backend/
│   ├── db/
│   │   └── init.sql                    # Databasschema
│   ├── src/
│   │   ├── index.js                    # Huvudserver
│   │   ├── db.js                       # Databas-anslutningar
│   │   ├── routes/
│   │   │   ├── auth.js                 # Login/logout
│   │   │   ├── customers.js            # Kundhantering
│   │   │   └── orders.js               # Order + ramorder
│   │   ├── services/
│   │   │   ├── inventoryAdapter.js     # Läs material från inventory
│   │   │   ├── priceCalculator.js      # Prisberäkningar
│   │   │   └── orderNumberGenerator.js # YYYY-NNNN format
│   │   ├── utils/
│   │   │   └── authMiddleware.js       # Autentisering
│   │   └── views/
│   │       ├── layout.ejs
│   │       ├── auth/
│   │       ├── customers/
│   │       └── orders/
│   ├── package.json
│   └── .env
├── Dockerfile
└── docker-compose.yml
```

## API

### Live prisberäkning

```
POST /orders/api/calculate-price
Content-Type: application/json

{
  "width_cm": 50,
  "height_cm": 70,
  "calculation_method": "simple",
  "frame_item_id": 1,
  "glass_item_id": 2,
  "backing_item_id": 3,
  "passepartout_item_id": 4,
  "passepartout_width_cm": 5
}
```

Returnerar:
```json
{
  "frame_length_meters": 2.4,
  "frame_cost": 240,
  "glass_area_sqm": 0.35,
  "glass_cost": 175,
  "backing_area_sqm": 0.35,
  "backing_cost": 70,
  "passepartout_area_sqm": 0.15,
  "passepartout_cost": 45,
  "total_cost_excl_moms": 530,
  "total_cost_incl_moms": 662.5
}
```

## Prisberäkningar

### Enkel metod (omkrets)
```
Längd = 2 × (bredd + höjd) / 100  # meter
Kostnad = Längd × Pris/meter
```

### Standard metod (förbrukning)
```
Horisontell = (bredd + 2×rambredd + 2cm) × 2
Vertikal = (höjd + 2×rambredd + 2cm) × 2
Total längd = (Horisontell + Vertikal) / 100  # meter
Kostnad = Längd × Pris/meter
```

### Glas & Bakskiva
```
Area = (bredd × höjd) / 10000  # m²
Kostnad = Area × Pris/m²
```

### Passepartout
```
Yttre area = (bredd × höjd) / 10000
Inre area = ((bredd - 2×kant) × (höjd - 2×kant)) / 10000
Passepartout area = Yttre - Inre
Kostnad = Area × Pris/m²
```

## Prislåsning

När en ramorder skapas låses:
- Material-namn
- Material-SKU
- Priser (kr/m, kr/m²)
- Beräknade mängder
- Totalkostnader

Detta säkerställer att historiska ordrar aldrig påverkas av framtida prisändringar i inventory-systemet.

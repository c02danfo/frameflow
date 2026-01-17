-- Lägg till standardtid och beskrivning
ALTER TABLE services 
  ADD COLUMN IF NOT EXISTS standard_hours DECIMAL(5,2) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS description TEXT;

-- Uppdatera befintliga tjänster med standardvärde
UPDATE services 
SET standard_hours = 1.0 
WHERE standard_hours IS NULL;

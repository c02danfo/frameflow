-- Fix för ambiguous prefix column reference

CREATE OR REPLACE FUNCTION consume_prefix_seq(cat TEXT)
RETURNS TABLE(prefix CHAR(4), seq INT) AS $$
DECLARE
  p CHAR(4);
BEGIN
  p := derive_prefix(cat);

  -- Säkerställ att rad finns
  INSERT INTO category_prefixes(category, prefix)
  VALUES (cat, p)
  ON CONFLICT (category) DO NOTHING;

  -- Lås rad och konsumera sekvens
  UPDATE category_prefixes cp
  SET next_seq = next_seq + 1
  WHERE cp.category = cat
  RETURNING cp.prefix, cp.next_seq - 1 INTO prefix, seq;

  RETURN;
END;
$$ LANGUAGE plpgsql;

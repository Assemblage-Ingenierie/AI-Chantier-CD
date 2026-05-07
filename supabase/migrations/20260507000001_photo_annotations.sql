-- Persiste les annotations photo (chemins SVG) et l'URL du composite annoté dans Storage
ALTER TABLE aichantier_item_photos
  ADD COLUMN IF NOT EXISTS annotations       JSONB,
  ADD COLUMN IF NOT EXISTS annotated_storage_url TEXT;

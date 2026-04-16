-- Garantit que la colonne plan_annotations existe sur chantier_localisations.
-- La colonne stocke les paths d'annotation (JSON léger, sans l'image exportée).
ALTER TABLE chantier_localisations ADD COLUMN IF NOT EXISTS plan_annotations text;

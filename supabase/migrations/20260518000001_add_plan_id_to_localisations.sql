-- Persiste l'identifiant du plan (clé vers aichantier_chantier_plans) sur chaque localisation.
-- Permet de retrouver le plan assigné après rechargement, même si plan_bg est vide.
ALTER TABLE aichantier_chantier_localisations
  ADD COLUMN IF NOT EXISTS plan_id UUID;

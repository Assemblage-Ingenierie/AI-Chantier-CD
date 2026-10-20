-- Métadonnées d'une observation (jsonb), d'abord pour les DATES DE SUIVI (demande Thibaud,
-- 20/10/2026) : { "dateOuverture": "AAAA-MM-JJ", "dateCloture": "AAAA-MM-JJ" }.
-- Colonne additive et sûre : NULL par défaut, aucune donnée existante modifiée. Les anciennes
-- versions de l'app n'envoient pas cette colonne → leur upsert ne l'écrase pas. Tant qu'elle
-- n'existe pas, l'app retombe sur le chargement / la sauvegarde sans elle (aucun échec).
ALTER TABLE aichantier_localisation_items
  ADD COLUMN IF NOT EXISTS meta jsonb;

-- Statut d'une observation : 'rapport' (défaut, publiée dans le rapport) | 'brouillon'
-- (visible dans l'onglet Visite uniquement, jamais dans le rapport ni l'export PDF).
-- Colonne additive et sûre : les observations existantes restent 'rapport' (comportement
-- inchangé). Les anciennes versions de l'app n'envoient pas cette colonne → leur upsert ne
-- l'écrase pas.
ALTER TABLE aichantier_localisation_items
  ADD COLUMN IF NOT EXISTS statut text NOT NULL DEFAULT 'rapport';

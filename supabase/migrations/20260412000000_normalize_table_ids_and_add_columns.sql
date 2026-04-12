-- ============================================================
-- Migration : normalisation des IDs et colonnes manquantes
-- Convertit bigint → text pour les clés des 3 tables principales
-- Ajoute sort_order, participants, tableau_recap, plan_annotations
-- ============================================================

-- 1. Supprimer les contraintes FK qui bloquent le changement de type
ALTER TABLE chantier_plans        DROP CONSTRAINT IF EXISTS chantier_plans_chantier_id_fkey;
ALTER TABLE chantier_localisations DROP CONSTRAINT IF EXISTS chantier_localisations_chantier_id_fkey;
ALTER TABLE localisation_items    DROP CONSTRAINT IF EXISTS localisation_items_localisation_id_fkey;
ALTER TABLE item_photos            DROP CONSTRAINT IF EXISTS item_photos_item_id_fkey;

-- 2. chantiers.id  bigint → text
ALTER TABLE chantiers ALTER COLUMN id TYPE text USING id::text;

-- 3. chantier_plans : id + chantier_id bigint → text, ajout sort_order
ALTER TABLE chantier_plans ALTER COLUMN id          TYPE text USING id::text;
ALTER TABLE chantier_plans ALTER COLUMN chantier_id TYPE text USING chantier_id::text;
ALTER TABLE chantier_plans ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;

-- 4. chantier_localisations : id + chantier_id bigint → text, ajout sort_order
ALTER TABLE chantier_localisations ALTER COLUMN id          TYPE text USING id::text;
ALTER TABLE chantier_localisations ALTER COLUMN chantier_id TYPE text USING chantier_id::text;
ALTER TABLE chantier_localisations ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;

-- 5. localisation_items : localisation_id bigint → text, ajout plan_annotations + sort_order
ALTER TABLE localisation_items ALTER COLUMN localisation_id TYPE text USING localisation_id::text;
ALTER TABLE localisation_items ADD COLUMN IF NOT EXISTS plan_annotations text;
ALTER TABLE localisation_items ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;

-- 6. item_photos : ajout sort_order (item_id est déjà text)
ALTER TABLE item_photos ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;

-- 7. chantiers : colonnes manquantes participants + tableau_recap
ALTER TABLE chantiers ADD COLUMN IF NOT EXISTS participants  jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE chantiers ADD COLUMN IF NOT EXISTS tableau_recap jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 8. Recréer les contraintes FK avec CASCADE
ALTER TABLE chantier_plans ADD CONSTRAINT chantier_plans_chantier_id_fkey
  FOREIGN KEY (chantier_id) REFERENCES chantiers(id) ON DELETE CASCADE;

ALTER TABLE chantier_localisations ADD CONSTRAINT chantier_localisations_chantier_id_fkey
  FOREIGN KEY (chantier_id) REFERENCES chantiers(id) ON DELETE CASCADE;

ALTER TABLE localisation_items ADD CONSTRAINT localisation_items_localisation_id_fkey
  FOREIGN KEY (localisation_id) REFERENCES chantier_localisations(id) ON DELETE CASCADE;

ALTER TABLE item_photos ADD CONSTRAINT item_photos_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES localisation_items(id) ON DELETE CASCADE;

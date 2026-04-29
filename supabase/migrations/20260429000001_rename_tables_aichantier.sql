-- Renommage des tables avec le préfixe aichantier_.
-- Les FK, index et politiques RLS restent valides (PostgreSQL référence par OID, pas par nom).
ALTER TABLE chantiers               RENAME TO aichantier_chantiers;
ALTER TABLE chantier_plans          RENAME TO aichantier_chantier_plans;
ALTER TABLE chantier_localisations  RENAME TO aichantier_chantier_localisations;
ALTER TABLE localisation_items      RENAME TO aichantier_localisation_items;
ALTER TABLE item_photos             RENAME TO aichantier_item_photos;
ALTER TABLE profiles                RENAME TO aichantier_profiles;

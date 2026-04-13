-- ============================================================
-- Migration : grants + RLS complets pour toutes les tables métier
-- Fixes "sauvegarde distante échouée" causé par des INSERT/UPDATE/DELETE bloqués
-- ============================================================

-- 1. Colonne manquante éventuelle sur chantiers
ALTER TABLE public.chantiers ADD COLUMN IF NOT EXISTS photos_par_ligne int NOT NULL DEFAULT 2;

-- 2. Grants explicites pour le rôle authenticated sur toutes les tables
GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chantiers               TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chantier_plans          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chantier_localisations  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.localisation_items      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_photos             TO authenticated;

-- 3. Activer RLS (idempotent)
ALTER TABLE public.chantiers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chantier_plans         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chantier_localisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.localisation_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_photos            ENABLE ROW LEVEL SECURITY;

-- 4. Supprimer les anciennes politiques pour éviter les doublons
DROP POLICY IF EXISTS "chantiers_select"  ON public.chantiers;
DROP POLICY IF EXISTS "chantiers_insert"  ON public.chantiers;
DROP POLICY IF EXISTS "chantiers_update"  ON public.chantiers;
DROP POLICY IF EXISTS "chantiers_delete"  ON public.chantiers;

DROP POLICY IF EXISTS "plans_select"  ON public.chantier_plans;
DROP POLICY IF EXISTS "plans_insert"  ON public.chantier_plans;
DROP POLICY IF EXISTS "plans_update"  ON public.chantier_plans;
DROP POLICY IF EXISTS "plans_delete"  ON public.chantier_plans;

DROP POLICY IF EXISTS "locs_select"  ON public.chantier_localisations;
DROP POLICY IF EXISTS "locs_insert"  ON public.chantier_localisations;
DROP POLICY IF EXISTS "locs_update"  ON public.chantier_localisations;
DROP POLICY IF EXISTS "locs_delete"  ON public.chantier_localisations;

DROP POLICY IF EXISTS "items_select"  ON public.localisation_items;
DROP POLICY IF EXISTS "items_insert"  ON public.localisation_items;
DROP POLICY IF EXISTS "items_update"  ON public.localisation_items;
DROP POLICY IF EXISTS "items_delete"  ON public.localisation_items;

DROP POLICY IF EXISTS "photos_select"  ON public.item_photos;
DROP POLICY IF EXISTS "photos_insert"  ON public.item_photos;
DROP POLICY IF EXISTS "photos_update"  ON public.item_photos;
DROP POLICY IF EXISTS "photos_delete"  ON public.item_photos;

-- 5. Créer les politiques : tous les utilisateurs authentifiés accèdent à tout
--    (app multi-utilisateurs collaboratifs — adapter si besoin d'isolation par user)

CREATE POLICY "chantiers_select" ON public.chantiers FOR SELECT TO authenticated USING (true);
CREATE POLICY "chantiers_insert" ON public.chantiers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "chantiers_update" ON public.chantiers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "chantiers_delete" ON public.chantiers FOR DELETE TO authenticated USING (true);

CREATE POLICY "plans_select" ON public.chantier_plans FOR SELECT TO authenticated USING (true);
CREATE POLICY "plans_insert" ON public.chantier_plans FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "plans_update" ON public.chantier_plans FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "plans_delete" ON public.chantier_plans FOR DELETE TO authenticated USING (true);

CREATE POLICY "locs_select" ON public.chantier_localisations FOR SELECT TO authenticated USING (true);
CREATE POLICY "locs_insert" ON public.chantier_localisations FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "locs_update" ON public.chantier_localisations FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "locs_delete" ON public.chantier_localisations FOR DELETE TO authenticated USING (true);

CREATE POLICY "items_select" ON public.localisation_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "items_insert" ON public.localisation_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "items_update" ON public.localisation_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "items_delete" ON public.localisation_items FOR DELETE TO authenticated USING (true);

CREATE POLICY "photos_select" ON public.item_photos FOR SELECT TO authenticated USING (true);
CREATE POLICY "photos_insert" ON public.item_photos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "photos_update" ON public.item_photos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "photos_delete" ON public.item_photos FOR DELETE TO authenticated USING (true);

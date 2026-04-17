-- ============================================================
-- Migration : isolation RLS par utilisateur (owner_id)
-- Chaque chantier appartient à l'utilisateur qui l'a créé.
-- ============================================================

-- 1. Ajouter owner_id (nullable pour compatibilité avec les enregistrements existants)
ALTER TABLE public.chantiers ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id);

-- 2. Trigger : auto-set owner_id = auth.uid() sur INSERT si non fourni
CREATE OR REPLACE FUNCTION public.set_chantier_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.owner_id IS NULL THEN
    NEW.owner_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_chantier_owner ON public.chantiers;
CREATE TRIGGER trg_set_chantier_owner
  BEFORE INSERT ON public.chantiers
  FOR EACH ROW EXECUTE FUNCTION public.set_chantier_owner();

-- 3. Index pour les lookups par owner
CREATE INDEX IF NOT EXISTS chantiers_owner_idx ON public.chantiers(owner_id);

-- 4. Recréer les policies chantiers avec filtre owner_id
--    (nullable = projets legacy accessibles à tous les users authentifiés)
DROP POLICY IF EXISTS "chantiers_select" ON public.chantiers;
DROP POLICY IF EXISTS "chantiers_insert" ON public.chantiers;
DROP POLICY IF EXISTS "chantiers_update" ON public.chantiers;
DROP POLICY IF EXISTS "chantiers_delete" ON public.chantiers;

CREATE POLICY "chantiers_select" ON public.chantiers FOR SELECT TO authenticated
  USING (owner_id IS NULL OR owner_id = auth.uid());
CREATE POLICY "chantiers_insert" ON public.chantiers FOR INSERT TO authenticated
  WITH CHECK (owner_id IS NULL OR owner_id = auth.uid());
CREATE POLICY "chantiers_update" ON public.chantiers FOR UPDATE TO authenticated
  USING (owner_id IS NULL OR owner_id = auth.uid())
  WITH CHECK (owner_id IS NULL OR owner_id = auth.uid());
CREATE POLICY "chantiers_delete" ON public.chantiers FOR DELETE TO authenticated
  USING (owner_id IS NULL OR owner_id = auth.uid());

-- 5. Tables enfants : policies via FK vers chantiers (owner check en cascade)
--    chantier_plans
DROP POLICY IF EXISTS "plans_select"  ON public.chantier_plans;
DROP POLICY IF EXISTS "plans_insert"  ON public.chantier_plans;
DROP POLICY IF EXISTS "plans_update"  ON public.chantier_plans;
DROP POLICY IF EXISTS "plans_delete"  ON public.chantier_plans;

CREATE POLICY "plans_select" ON public.chantier_plans FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chantiers c WHERE c.id = chantier_id AND (c.owner_id IS NULL OR c.owner_id = auth.uid())));
CREATE POLICY "plans_insert" ON public.chantier_plans FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.chantiers c WHERE c.id = chantier_id AND (c.owner_id IS NULL OR c.owner_id = auth.uid())));
CREATE POLICY "plans_update" ON public.chantier_plans FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chantiers c WHERE c.id = chantier_id AND (c.owner_id IS NULL OR c.owner_id = auth.uid())));
CREATE POLICY "plans_delete" ON public.chantier_plans FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chantiers c WHERE c.id = chantier_id AND (c.owner_id IS NULL OR c.owner_id = auth.uid())));

--    chantier_localisations
DROP POLICY IF EXISTS "locs_select"  ON public.chantier_localisations;
DROP POLICY IF EXISTS "locs_insert"  ON public.chantier_localisations;
DROP POLICY IF EXISTS "locs_update"  ON public.chantier_localisations;
DROP POLICY IF EXISTS "locs_delete"  ON public.chantier_localisations;

CREATE POLICY "locs_select" ON public.chantier_localisations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chantiers c WHERE c.id = chantier_id AND (c.owner_id IS NULL OR c.owner_id = auth.uid())));
CREATE POLICY "locs_insert" ON public.chantier_localisations FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.chantiers c WHERE c.id = chantier_id AND (c.owner_id IS NULL OR c.owner_id = auth.uid())));
CREATE POLICY "locs_update" ON public.chantier_localisations FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chantiers c WHERE c.id = chantier_id AND (c.owner_id IS NULL OR c.owner_id = auth.uid())));
CREATE POLICY "locs_delete" ON public.chantier_localisations FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chantiers c WHERE c.id = chantier_id AND (c.owner_id IS NULL OR c.owner_id = auth.uid())));

--    localisation_items (via loc → chantier)
DROP POLICY IF EXISTS "items_select"  ON public.localisation_items;
DROP POLICY IF EXISTS "items_insert"  ON public.localisation_items;
DROP POLICY IF EXISTS "items_update"  ON public.localisation_items;
DROP POLICY IF EXISTS "items_delete"  ON public.localisation_items;

CREATE POLICY "items_select" ON public.localisation_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.chantier_localisations l
    JOIN public.chantiers c ON c.id = l.chantier_id
    WHERE l.id = localisation_id AND (c.owner_id IS NULL OR c.owner_id = auth.uid())
  ));
CREATE POLICY "items_insert" ON public.localisation_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.chantier_localisations l
    JOIN public.chantiers c ON c.id = l.chantier_id
    WHERE l.id = localisation_id AND (c.owner_id IS NULL OR c.owner_id = auth.uid())
  ));
CREATE POLICY "items_update" ON public.localisation_items FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.chantier_localisations l
    JOIN public.chantiers c ON c.id = l.chantier_id
    WHERE l.id = localisation_id AND (c.owner_id IS NULL OR c.owner_id = auth.uid())
  ));
CREATE POLICY "items_delete" ON public.localisation_items FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.chantier_localisations l
    JOIN public.chantiers c ON c.id = l.chantier_id
    WHERE l.id = localisation_id AND (c.owner_id IS NULL OR c.owner_id = auth.uid())
  ));

--    item_photos (via item → loc → chantier)
DROP POLICY IF EXISTS "photos_select"  ON public.item_photos;
DROP POLICY IF EXISTS "photos_insert"  ON public.item_photos;
DROP POLICY IF EXISTS "photos_update"  ON public.item_photos;
DROP POLICY IF EXISTS "photos_delete"  ON public.item_photos;

CREATE POLICY "photos_select" ON public.item_photos FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.localisation_items i
    JOIN public.chantier_localisations l ON l.id = i.localisation_id
    JOIN public.chantiers c ON c.id = l.chantier_id
    WHERE i.id = item_id AND (c.owner_id IS NULL OR c.owner_id = auth.uid())
  ));
CREATE POLICY "photos_insert" ON public.item_photos FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.localisation_items i
    JOIN public.chantier_localisations l ON l.id = i.localisation_id
    JOIN public.chantiers c ON c.id = l.chantier_id
    WHERE i.id = item_id AND (c.owner_id IS NULL OR c.owner_id = auth.uid())
  ));
CREATE POLICY "photos_update" ON public.item_photos FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.localisation_items i
    JOIN public.chantier_localisations l ON l.id = i.localisation_id
    JOIN public.chantiers c ON c.id = l.chantier_id
    WHERE i.id = item_id AND (c.owner_id IS NULL OR c.owner_id = auth.uid())
  ));
CREATE POLICY "photos_delete" ON public.item_photos FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.localisation_items i
    JOIN public.chantier_localisations l ON l.id = i.localisation_id
    JOIN public.chantiers c ON c.id = l.chantier_id
    WHERE i.id = item_id AND (c.owner_id IS NULL OR c.owner_id = auth.uid())
  ));

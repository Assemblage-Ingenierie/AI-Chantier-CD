-- Fix 1 : Récursion infinie (42P17) sur aichantier_profiles
-- La fonction aichantier_is_admin() dans les policies déclenchait une boucle :
-- policy → fonction → SELECT aichantier_profiles → policy → ...
-- Solution : policies simples sans appel de fonction + trigger SECURITY DEFINER
--            (les triggers SECURITY DEFINER s'exécutent en tant que postgres/superuser
--             → pas de RLS appliqué sur leur SELECT interne → pas de récursion)

DROP POLICY IF EXISTS "profiles_select" ON public.aichantier_profiles;
DROP POLICY IF EXISTS "profiles_insert" ON public.aichantier_profiles;
DROP POLICY IF EXISTS "profiles_update" ON public.aichantier_profiles;
DROP POLICY IF EXISTS "profiles_delete"  ON public.aichantier_profiles;
DROP FUNCTION IF EXISTS public.aichantier_is_admin();

-- Policies sans appel de fonction (aucun risque de récursion)
CREATE POLICY "profiles_select" ON public.aichantier_profiles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "profiles_insert" ON public.aichantier_profiles
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

-- UPDATE ouvert au niveau RLS ; le trigger ci-dessous applique la vraie restriction
CREATE POLICY "profiles_update" ON public.aichantier_profiles
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "profiles_delete" ON public.aichantier_profiles
  FOR DELETE TO authenticated USING (false);

-- Trigger SECURITY DEFINER : bloque l'auto-promotion et les modifications cross-users
-- SECURITY DEFINER → s'exécute en tant que postgres (superuser) → bypass RLS → pas de récursion
CREATE OR REPLACE FUNCTION public.aichantier_guard_profile_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  updater_role text;
BEGIN
  SELECT role INTO updater_role
  FROM public.aichantier_profiles
  WHERE id = auth.uid();

  -- Un non-admin ne peut modifier que son propre profil
  IF NEW.id != auth.uid() AND updater_role != 'admin' THEN
    RAISE EXCEPTION 'Accès refusé : vous ne pouvez modifier que votre propre profil';
  END IF;

  -- Seuls les admins peuvent changer role ou is_approved (empêche l'auto-promotion)
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.is_approved IS DISTINCT FROM OLD.is_approved)
     AND updater_role != 'admin' THEN
    RAISE EXCEPTION 'Accès refusé : seuls les admins peuvent modifier le rôle ou le statut d''approbation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_update ON public.aichantier_profiles;
CREATE TRIGGER trg_guard_profile_update
  BEFORE UPDATE ON public.aichantier_profiles
  FOR EACH ROW EXECUTE FUNCTION public.aichantier_guard_profile_update();


-- Fix 2 : Bucket "branding" public pour que getPublicUrl() fonctionne sans auth
INSERT INTO storage.buckets (id, name, public)
  VALUES ('branding', 'branding', true)
  ON CONFLICT (id) DO UPDATE SET public = true;

-- Policy : tout le monde (y compris anon) peut lire les logos depuis le bucket branding
DROP POLICY IF EXISTS "branding_public_read" ON storage.objects;
CREATE POLICY "branding_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'branding');

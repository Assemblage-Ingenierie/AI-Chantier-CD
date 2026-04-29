-- RLS sur aichantier_profiles — protège contre l'auto-promotion en admin.
-- Les autres tables métier sont déjà protégées ; profiles était oublié.

ALTER TABLE public.aichantier_profiles ENABLE ROW LEVEL SECURITY;

-- Fonction helper SECURITY DEFINER pour éviter la récursion RLS dans les policies
CREATE OR REPLACE FUNCTION public.aichantier_is_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.aichantier_profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- SELECT : chaque utilisateur voit son propre profil ; les admins voient tout
CREATE POLICY "profiles_select" ON public.aichantier_profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR aichantier_is_admin());

-- INSERT : chaque utilisateur ne peut créer que son propre profil (signup)
CREATE POLICY "profiles_insert" ON public.aichantier_profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- UPDATE : seuls les admins peuvent modifier les profils (empêche l'auto-promotion)
CREATE POLICY "profiles_update" ON public.aichantier_profiles
  FOR UPDATE TO authenticated
  USING (aichantier_is_admin());

-- DELETE : seuls les admins peuvent supprimer des profils
CREATE POLICY "profiles_delete" ON public.aichantier_profiles
  FOR DELETE TO authenticated
  USING (aichantier_is_admin());

-- Fix: récursion infinie dans les policies RLS de aichantier_profiles
-- Les policies _admin faisaient un SELECT sur aichantier_profiles depuis une policy SELECT
-- → remplacées par une fonction SECURITY DEFINER qui bypass le RLS

DROP POLICY IF EXISTS profiles_select_admin ON aichantier_profiles;
DROP POLICY IF EXISTS profiles_select_own   ON aichantier_profiles;
DROP POLICY IF EXISTS profiles_select       ON aichantier_profiles;
DROP POLICY IF EXISTS profiles_update_admin ON aichantier_profiles;
DROP POLICY IF EXISTS profiles_update       ON aichantier_profiles;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM aichantier_profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

CREATE POLICY profiles_select ON aichantier_profiles
  FOR SELECT USING (auth.uid() = id OR is_admin());

CREATE POLICY profiles_update ON aichantier_profiles
  FOR UPDATE USING (auth.uid() = id OR is_admin());

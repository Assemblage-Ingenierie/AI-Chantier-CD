-- ============================================================
-- Migration : contrôle d'unicité des initiales ingénieur
-- ------------------------------------------------------------
-- Les initiales servent de clé de filtre « Mes projets » : deux
-- comptes ne doivent jamais partager les mêmes initiales.
-- La policy profiles_select ne laisse un non-admin voir QUE sa
-- propre fiche → le contrôle passe par une fonction SECURITY
-- DEFINER qui vérifie sans exposer les autres profils.
-- ============================================================

CREATE OR REPLACE FUNCTION public.initials_taken(p_initials text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM aichantier_profiles
    WHERE upper(trim(initials)) = upper(trim(p_initials))
      AND id <> auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.initials_taken(text) TO authenticated;

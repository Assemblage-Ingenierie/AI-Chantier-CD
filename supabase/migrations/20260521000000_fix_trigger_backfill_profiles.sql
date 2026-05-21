-- Répare le trigger de création automatique de profil et comble les profils manquants.
-- Problème : certains utilisateurs Google OAuth n'avaient pas de profil créé automatiquement.

-- 1. Recréer la fonction trigger (robuste : gère INSERT et UPDATE)
CREATE OR REPLACE FUNCTION public.aichantier_handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.aichantier_profiles (id, email, is_approved, role)
  VALUES (NEW.id, COALESCE(NEW.email, NEW.raw_user_meta_data->>'email'), false, 'user')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 2. Trigger sur INSERT (nouveaux comptes email/password)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.aichantier_handle_new_user();

-- 3. Trigger sur UPDATE (Google OAuth : la 1ère connexion peut faire un UPDATE)
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE OF email_confirmed_at, last_sign_in_at ON auth.users
  FOR EACH ROW
  WHEN (OLD.last_sign_in_at IS DISTINCT FROM NEW.last_sign_in_at)
  EXECUTE FUNCTION public.aichantier_handle_new_user();

-- 4. Backfill : créer les profils manquants pour tous les utilisateurs déjà inscrits
INSERT INTO public.aichantier_profiles (id, email, is_approved, role)
SELECT
  u.id,
  COALESCE(u.email, u.raw_user_meta_data->>'email'),
  false,
  'user'
FROM auth.users u
LEFT JOIN public.aichantier_profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

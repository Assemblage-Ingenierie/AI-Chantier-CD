-- Crée automatiquement un profil dans aichantier_profiles dès qu'un nouvel
-- utilisateur s'inscrit via Supabase Auth (email/password, Google, magic link…).
-- Sans ce trigger, le nouveau compte reste invisible pour les admins.

CREATE OR REPLACE FUNCTION public.aichantier_handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.aichantier_profiles (id, email, is_approved, role)
  VALUES (NEW.id, NEW.email, false, 'user')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.aichantier_handle_new_user();

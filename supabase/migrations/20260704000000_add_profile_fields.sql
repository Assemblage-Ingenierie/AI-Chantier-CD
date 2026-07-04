-- Champs de profil utilisateur pour la page « Mon compte ».
-- 100 % ADDITIF : colonnes optionnelles, aucun impact sur l'auth, le trigger de création
-- de profil (aichantier_handle_new_user) ni les policies RLS existantes.
--
-- `full_name` existant est conservé (rétro-compatibilité AdminPanel/participants) ;
-- les nouvelles colonnes le décomposent proprement.

ALTER TABLE public.aichantier_profiles
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name  text,
  ADD COLUMN IF NOT EXISTS job_title  text,
  ADD COLUMN IF NOT EXISTS phone      text,
  ADD COLUMN IF NOT EXISTS initials   text;

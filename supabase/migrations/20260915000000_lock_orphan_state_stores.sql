-- ─────────────────────────────────────────────────────────────────────────────
-- SÉCURITÉ (audit) : verrouiller app_state_store / app_blob_store
--
-- Ces deux tables ne sont PLUS référencées nulle part dans le code (src/ + api/).
-- Elles étaient pourtant lisibles ET écrivables par le rôle `anon` (visiteur NON
-- authentifié) via des policies `USING (true)` / `WITH CHECK (true)` + des GRANT à
-- `anon`. N'importe qui disposant de la clé anon (publique) pouvait donc y lire/écrire.
--
-- Ce correctif RÉVOQUE tout accès et SUPPRIME les policies permissives, SANS supprimer
-- les tables (zéro perte de données — Règle N°2). RLS reste activé et, sans aucune
-- policy, plus personne (anon ni authenticated) n'y accède.
--
-- ⚠️ À APPLIQUER MANUELLEMENT par Thomas (Supabase → SQL Editor, ou `supabase db push`).
--    Rien ne s'applique automatiquement au déploiement Vercel.
--    Si tu confirmes qu'elles sont définitivement inutiles, tu pourras exécuter plus tard :
--       DROP TABLE IF EXISTS public.app_state_store;
--       DROP TABLE IF EXISTS public.app_blob_store;
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Retirer les policies permissives (anon + authenticated, USING true).
DROP POLICY IF EXISTS "app_state_store_select" ON public.app_state_store;
DROP POLICY IF EXISTS "app_state_store_insert" ON public.app_state_store;
DROP POLICY IF EXISTS "app_state_store_update" ON public.app_state_store;
DROP POLICY IF EXISTS "app_blob_store_select"  ON public.app_blob_store;
DROP POLICY IF EXISTS "app_blob_store_insert"  ON public.app_blob_store;
DROP POLICY IF EXISTS "app_blob_store_update"  ON public.app_blob_store;

-- 2) Révoquer les GRANT (surtout ceux accordés à anon).
REVOKE ALL ON public.app_state_store FROM anon, authenticated;
REVOKE ALL ON public.app_blob_store  FROM anon, authenticated;

-- 3) S'assurer que RLS reste activé (deny-all par défaut sans policy).
ALTER TABLE public.app_state_store ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_blob_store  ENABLE ROW LEVEL SECURITY;

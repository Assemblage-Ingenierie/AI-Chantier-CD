-- ─────────────────────────────────────────────────────────────────────────────
-- SÉCURITÉ (audit) : verrouiller app_state_store / app_blob_store SI ELLES EXISTENT
--
-- Ces deux tables ne sont PLUS référencées nulle part dans le code (src/ + api/).
-- Le fichier qui les créait (20260408193000_app_state_store.sql) accordait un accès
-- lecture/écriture au rôle `anon` via des policies `USING (true)`. MAIS en pratique
-- ces tables n'existent PAS dans la base de production (jamais appliquées) → aucune
-- faille réelle. Cette migration est donc un simple filet : elle verrouille les tables
-- UNIQUEMENT si elles existent, et ne fait RIEN sinon (aucune erreur).
--
-- Zéro perte de données (Règle N°2) : on retire seulement les policies + grants, on ne
-- supprime pas les tables. RLS reste activé → deny-all par défaut sans policy.
--
-- ⚠️ À APPLIQUER MANUELLEMENT (Supabase → SQL Editor). Rien ne s'applique au déploiement
--    Vercel. Si les tables n'existent pas, ce script s'exécute sans effet (c'est normal).
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF to_regclass('public.app_state_store') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "app_state_store_select" ON public.app_state_store';
    EXECUTE 'DROP POLICY IF EXISTS "app_state_store_insert" ON public.app_state_store';
    EXECUTE 'DROP POLICY IF EXISTS "app_state_store_update" ON public.app_state_store';
    EXECUTE 'REVOKE ALL ON public.app_state_store FROM anon, authenticated';
    EXECUTE 'ALTER TABLE public.app_state_store ENABLE ROW LEVEL SECURITY';
  END IF;

  IF to_regclass('public.app_blob_store') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "app_blob_store_select" ON public.app_blob_store';
    EXECUTE 'DROP POLICY IF EXISTS "app_blob_store_insert" ON public.app_blob_store';
    EXECUTE 'DROP POLICY IF EXISTS "app_blob_store_update" ON public.app_blob_store';
    EXECUTE 'REVOKE ALL ON public.app_blob_store FROM anon, authenticated';
    EXECUTE 'ALTER TABLE public.app_blob_store ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

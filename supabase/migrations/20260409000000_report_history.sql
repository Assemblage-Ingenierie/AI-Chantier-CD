-- Migration : historique des rapports publies
-- Chaque publication cree une ligne immuable avec un snapshot du chantier.

CREATE TABLE IF NOT EXISTS public.report_history (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  chantier_id  text        NOT NULL,
  chantier_nom text        NOT NULL,
  snapshot     jsonb       NOT NULL,
  published_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS report_history_chantier_idx  ON public.report_history (chantier_id);
CREATE INDEX IF NOT EXISTS report_history_published_idx ON public.report_history (published_at DESC);

ALTER TABLE public.report_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_report_history"  ON public.report_history;
DROP POLICY IF EXISTS "anon_insert_report_history"  ON public.report_history;
DROP POLICY IF EXISTS "auth_select_report_history"  ON public.report_history;
DROP POLICY IF EXISTS "auth_insert_report_history"  ON public.report_history;

CREATE POLICY "anon_select_report_history"  ON public.report_history FOR SELECT TO anon          USING (true);
CREATE POLICY "anon_insert_report_history"  ON public.report_history FOR INSERT TO anon          WITH CHECK (true);
CREATE POLICY "auth_select_report_history"  ON public.report_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_report_history"  ON public.report_history FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================================
-- Migration : pierres tombales SERVEUR des ZONES et OBSERVATIONS supprimées
-- ------------------------------------------------------------
-- Problème (retour Thomas, 12/10/2026) : des zones / observations supprimées
-- réapparaissaient. Le mémo des suppressions n'existait que sur l'appareil où
-- l'on supprimait : un autre appareil (téléphone, PC, collègue) au cache périmé
-- pouvait les renvoyer au serveur à sa prochaine sauvegarde.
--
-- Cette table, partagée par TOUS les appareils et TOUS les utilisateurs qui ont
-- accès aux projets, enregistre les ids supprimés. Le client :
--   - retire ces ids de l'affichage au chargement (une zone/obs supprimée ne
--     peut plus revenir, d'où qu'elle vienne) ;
--   - ne les ré-envoie jamais au serveur.
-- Réversible : « Annuler » / « Restaurer » supprime la ligne correspondante.
--
-- Visibilité alignée sur les zones/observations en production (lecture/écriture
-- pour tout utilisateur authentifié — projets partagés au sein d'Assemblage).
-- Identifiants en TEXT : compatibles avec tous les formats d'id existants.
-- Idempotente : peut être rejouée sans risque.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.aichantier_deleted_entities (
  id          text PRIMARY KEY,                          -- id de la zone ou de l'observation
  kind        text NOT NULL CHECK (kind IN ('loc', 'item')),
  chantier_id text,                                      -- projet concerné (informatif)
  deleted_at  timestamptz NOT NULL DEFAULT now(),
  deleted_by  uuid DEFAULT auth.uid()
);

CREATE INDEX IF NOT EXISTS aichantier_deleted_entities_chantier_idx
  ON public.aichantier_deleted_entities (chantier_id);

ALTER TABLE public.aichantier_deleted_entities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deleted_entities_select" ON public.aichantier_deleted_entities;
DROP POLICY IF EXISTS "deleted_entities_insert" ON public.aichantier_deleted_entities;
DROP POLICY IF EXISTS "deleted_entities_update" ON public.aichantier_deleted_entities;
DROP POLICY IF EXISTS "deleted_entities_delete" ON public.aichantier_deleted_entities;

CREATE POLICY "deleted_entities_select" ON public.aichantier_deleted_entities
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "deleted_entities_insert" ON public.aichantier_deleted_entities
  FOR INSERT TO authenticated WITH CHECK (true);
-- UPDATE nécessaire à l'upsert (rejeu idempotent d'une même suppression).
CREATE POLICY "deleted_entities_update" ON public.aichantier_deleted_entities
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "deleted_entities_delete" ON public.aichantier_deleted_entities
  FOR DELETE TO authenticated USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.aichantier_deleted_entities TO authenticated;

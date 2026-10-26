-- ============================================================
-- Migration : HISTORIQUE DES VERSIONS tenu par la base (filet de sécurité serveur)
-- ------------------------------------------------------------
-- Incident 26/10/2026 (Pavillons-sous-Bois, « Visite DET n°5 ») : le texte tapé sur le PC a été
-- remplacé par l'ancien texte, et 19 photos sur 21 ont disparu de la visite. Aucune copie
-- n'existait côté serveur : seules les sauvegardes de l'appareil pouvaient aider, et elles n'avaient
-- rien.
--
-- Désormais, la BASE copie elle-même l'ancienne version de chaque ligne AVANT toute modification de
-- contenu ou suppression :
--   • observations (aichantier_localisation_items) : titre, commentaire, statut, dates, annotations ;
--   • zones (aichantier_chantier_localisations)    : nom, plan, annotations ;
--   • photos (aichantier_item_photos)              : SUPPRESSIONS (chemin Storage → re-liables) ;
--   • projets (aichantier_chantiers)               : métadonnées des visites (conclusion, participants…).
-- C'est un trigger : aucun appareil, aucune version de l'app, aucun bug client ne peut le
-- contourner. Les clients peuvent LIRE l'historique (restauration), jamais l'écrire ni l'effacer.
--
-- Pensé aussi pour l'édition à plusieurs en direct (à venir) : chaque version porte son auteur
-- (changed_by) et sa date → « qui a changé quoi, quand », annulation ciblée.
--
-- Sûreté : la copie se fait dans un bloc protégé (EXCEPTION) → un incident d'historique ne peut
-- JAMAIS faire échouer la sauvegarde de l'utilisateur. Aucune donnée existante n'est modifiée.
-- Volume : seules les modifications de CONTENU sont copiées (pas les changements d'ordre) ;
-- aichantier_prune_history() (appelée par l'app une fois par jour) amincit les vieilles versions :
-- tout est gardé 3 jours, puis 1 version par heure jusqu'à 30 jours, puis 1 par jour jusqu'à 1 an.
--
-- ⚠️ À APPLIQUER MANUELLEMENT (Supabase → SQL Editor). Idempotente : peut être rejouée sans risque.
-- Tant qu'elle n'est pas appliquée, l'app fonctionne exactement comme avant (section masquée).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.aichantier_history (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name  text        NOT NULL,
  row_id      text        NOT NULL,
  chantier_id text,
  op          text        NOT NULL CHECK (op IN ('UPDATE', 'DELETE')),
  old_row     jsonb       NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  changed_by  uuid        DEFAULT auth.uid()
);

CREATE INDEX IF NOT EXISTS aichantier_history_chantier_idx ON public.aichantier_history (chantier_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS aichantier_history_row_idx      ON public.aichantier_history (table_name, row_id, changed_at DESC);

ALTER TABLE public.aichantier_history ENABLE ROW LEVEL SECURITY;

-- Lecture : alignée sur les projets (partagés entre utilisateurs authentifiés d'Assemblage).
-- AUCUNE policy INSERT / UPDATE / DELETE : seuls le trigger et la purge (SECURITY DEFINER) écrivent.
DROP POLICY IF EXISTS "history_select" ON public.aichantier_history;
CREATE POLICY "history_select" ON public.aichantier_history
  FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.aichantier_history TO authenticated;

CREATE OR REPLACE FUNCTION public.aichantier_log_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_chantier text;
  v_row      jsonb;
BEGIN
  BEGIN
    IF TG_TABLE_NAME = 'aichantier_localisation_items' THEN
      SELECT l.chantier_id::text INTO v_chantier
        FROM public.aichantier_chantier_localisations l WHERE l.id = OLD.localisation_id;
      v_row := to_jsonb(OLD);
    ELSIF TG_TABLE_NAME = 'aichantier_chantier_localisations' THEN
      v_chantier := OLD.chantier_id::text;
      v_row := to_jsonb(OLD) - 'plan_bg' - 'plan_data';
    ELSIF TG_TABLE_NAME = 'aichantier_item_photos' THEN
      SELECT l.chantier_id::text INTO v_chantier
        FROM public.aichantier_localisation_items i
        JOIN public.aichantier_chantier_localisations l ON l.id = i.localisation_id
        WHERE i.id = OLD.item_id;
      v_row := to_jsonb(OLD) - 'data'; -- jamais l'ancien base64 (lourd) : le chemin Storage suffit
    ELSIF TG_TABLE_NAME = 'aichantier_chantiers' THEN
      v_chantier := OLD.id::text;
      v_row := jsonb_build_object('id', OLD.id, 'nom', OLD.nom, 'visites', OLD.visites);
    ELSE
      RETURN NULL;
    END IF;

    INSERT INTO public.aichantier_history (table_name, row_id, chantier_id, op, old_row)
    VALUES (TG_TABLE_NAME, OLD.id::text, v_chantier, TG_OP, v_row);
  EXCEPTION WHEN OTHERS THEN
    -- L'historique ne doit JAMAIS bloquer la sauvegarde de l'utilisateur.
    RAISE WARNING 'aichantier_log_history: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

-- Observations : seulement si le CONTENU change (pas l'ordre / la zone) ou à la suppression.
DROP TRIGGER IF EXISTS trg_history_items_upd ON public.aichantier_localisation_items;
CREATE TRIGGER trg_history_items_upd
  AFTER UPDATE ON public.aichantier_localisation_items
  FOR EACH ROW
  WHEN (OLD.titre IS DISTINCT FROM NEW.titre
     OR OLD.commentaire IS DISTINCT FROM NEW.commentaire
     OR OLD.suivi IS DISTINCT FROM NEW.suivi
     OR OLD.urgence IS DISTINCT FROM NEW.urgence
     OR OLD.plan_annotations::text IS DISTINCT FROM NEW.plan_annotations::text
     OR to_jsonb(OLD) - 'sort_order' - 'localisation_id' - 'plan_annotations' - 'titre' - 'commentaire' - 'suivi' - 'urgence'
        IS DISTINCT FROM to_jsonb(NEW) - 'sort_order' - 'localisation_id' - 'plan_annotations' - 'titre' - 'commentaire' - 'suivi' - 'urgence')
  EXECUTE FUNCTION public.aichantier_log_history();
DROP TRIGGER IF EXISTS trg_history_items_del ON public.aichantier_localisation_items;
CREATE TRIGGER trg_history_items_del
  AFTER DELETE ON public.aichantier_localisation_items
  FOR EACH ROW EXECUTE FUNCTION public.aichantier_log_history();

-- Zones : nom / annotations modifiés, ou suppression.
DROP TRIGGER IF EXISTS trg_history_locs_upd ON public.aichantier_chantier_localisations;
CREATE TRIGGER trg_history_locs_upd
  AFTER UPDATE ON public.aichantier_chantier_localisations
  FOR EACH ROW
  WHEN (OLD.nom IS DISTINCT FROM NEW.nom OR OLD.plan_annotations::text IS DISTINCT FROM NEW.plan_annotations::text)
  EXECUTE FUNCTION public.aichantier_log_history();
DROP TRIGGER IF EXISTS trg_history_locs_del ON public.aichantier_chantier_localisations;
CREATE TRIGGER trg_history_locs_del
  AFTER DELETE ON public.aichantier_chantier_localisations
  FOR EACH ROW EXECUTE FUNCTION public.aichantier_log_history();

-- Photos : suppressions (la ligne effacée garde le chemin du fichier, toujours présent dans Storage).
DROP TRIGGER IF EXISTS trg_history_photos_del ON public.aichantier_item_photos;
CREATE TRIGGER trg_history_photos_del
  AFTER DELETE ON public.aichantier_item_photos
  FOR EACH ROW EXECUTE FUNCTION public.aichantier_log_history();

-- Projets : métadonnées des visites (conclusion, participants, tableau récap…) modifiées, ou suppression.
DROP TRIGGER IF EXISTS trg_history_chantiers_upd ON public.aichantier_chantiers;
CREATE TRIGGER trg_history_chantiers_upd
  AFTER UPDATE ON public.aichantier_chantiers
  FOR EACH ROW
  WHEN (OLD.visites::text IS DISTINCT FROM NEW.visites::text OR OLD.nom IS DISTINCT FROM NEW.nom)
  EXECUTE FUNCTION public.aichantier_log_history();
DROP TRIGGER IF EXISTS trg_history_chantiers_del ON public.aichantier_chantiers;
CREATE TRIGGER trg_history_chantiers_del
  AFTER DELETE ON public.aichantier_chantiers
  FOR EACH ROW EXECUTE FUNCTION public.aichantier_log_history();

-- Amincissement des vieilles versions (appelée par l'app au plus une fois par jour et par appareil).
-- Garde : tout sur 3 jours ; puis la DERNIÈRE version de chaque heure jusqu'à 30 jours ; puis la
-- dernière de chaque jour jusqu'à 1 an. Les suppressions (op = 'DELETE') sont toujours gardées 1 an.
CREATE OR REPLACE FUNCTION public.aichantier_prune_history()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.aichantier_history h
  USING (
    SELECT id, row_number() OVER (
      PARTITION BY table_name, row_id,
        date_trunc(CASE WHEN changed_at < now() - interval '30 days' THEN 'day' ELSE 'hour' END, changed_at)
      ORDER BY changed_at DESC
    ) AS rn
    FROM public.aichantier_history
    WHERE op = 'UPDATE' AND changed_at < now() - interval '3 days'
  ) x
  WHERE h.id = x.id AND x.rn > 1;
  DELETE FROM public.aichantier_history WHERE changed_at < now() - interval '365 days';
END;
$$;
REVOKE ALL ON FUNCTION public.aichantier_prune_history() FROM public;
GRANT EXECUTE ON FUNCTION public.aichantier_prune_history() TO authenticated;

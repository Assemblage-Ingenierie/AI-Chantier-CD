-- ============================================================
-- Migration : index sur les colonnes FK manquantes
-- Accélère les SELECT/DELETE par chantier_id, localisation_id, item_id
-- ============================================================

CREATE INDEX IF NOT EXISTS chantier_plans_chantier_idx
  ON public.chantier_plans(chantier_id);

CREATE INDEX IF NOT EXISTS chantier_locs_chantier_idx
  ON public.chantier_localisations(chantier_id);

CREATE INDEX IF NOT EXISTS chantier_locs_visite_idx
  ON public.chantier_localisations(visite_id);

CREATE INDEX IF NOT EXISTS items_loc_idx
  ON public.localisation_items(localisation_id);

CREATE INDEX IF NOT EXISTS photos_item_idx
  ON public.item_photos(item_id);

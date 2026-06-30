-- ============================================================
-- Migration : tombstones SERVEUR des projets supprimés
-- ------------------------------------------------------------
-- But : empêcher DÉFINITIVEMENT la résurrection d'un projet supprimé.
-- Un appareil avec un cache périmé pouvait ré-uploader un projet déjà
-- supprimé (le tombstone local ne le protégeait que sur cet appareil).
-- Cette table, partagée entre tous les appareils d'un même utilisateur,
-- enregistre les ids supprimés ; le client filtre ces ids au chargement
-- et ne les ré-upserte jamais.
-- Réversible : restaurer un projet (undo) supprime sa ligne tombstone.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.aichantier_deleted_chantiers (
  id         uuid PRIMARY KEY,
  owner_id   uuid REFERENCES auth.users(id),
  deleted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.aichantier_deleted_chantiers ENABLE ROW LEVEL SECURITY;

-- Auto-set owner_id = auth.uid() sur INSERT si non fourni (même pattern que set_chantier_owner)
CREATE OR REPLACE FUNCTION public.set_deleted_chantier_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.owner_id IS NULL THEN
    NEW.owner_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_deleted_chantier_owner ON public.aichantier_deleted_chantiers;
CREATE TRIGGER trg_set_deleted_chantier_owner
  BEFORE INSERT ON public.aichantier_deleted_chantiers
  FOR EACH ROW EXECUTE FUNCTION public.set_deleted_chantier_owner();

-- Policies RLS : un utilisateur ne voit/gère que ses propres tombstones
-- (owner_id NULL toléré pour compat, comme sur aichantier_chantiers).
DROP POLICY IF EXISTS "deleted_chantiers_select" ON public.aichantier_deleted_chantiers;
DROP POLICY IF EXISTS "deleted_chantiers_insert" ON public.aichantier_deleted_chantiers;
DROP POLICY IF EXISTS "deleted_chantiers_delete" ON public.aichantier_deleted_chantiers;

CREATE POLICY "deleted_chantiers_select" ON public.aichantier_deleted_chantiers FOR SELECT TO authenticated
  USING (owner_id IS NULL OR owner_id = auth.uid());
CREATE POLICY "deleted_chantiers_insert" ON public.aichantier_deleted_chantiers FOR INSERT TO authenticated
  WITH CHECK (owner_id IS NULL OR owner_id = auth.uid());
CREATE POLICY "deleted_chantiers_delete" ON public.aichantier_deleted_chantiers FOR DELETE TO authenticated
  USING (owner_id IS NULL OR owner_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.aichantier_deleted_chantiers TO authenticated;

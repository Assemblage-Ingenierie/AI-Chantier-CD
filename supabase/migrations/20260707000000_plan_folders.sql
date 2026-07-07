-- Cases de rangement des plans (« bulles ») dans « Consulter les plans » :
-- l'ingénieur organise ses PDF importés par catégorie (DCE, Coffrage, Ferraillage…),
-- renommables, synchronisées entre appareils.
-- Format : [{ "id": uuid, "nom": "Plans DCE", "bases": ["NomDuPdf", ...] }]
ALTER TABLE aichantier_chantiers ADD COLUMN IF NOT EXISTS plan_folders jsonb;

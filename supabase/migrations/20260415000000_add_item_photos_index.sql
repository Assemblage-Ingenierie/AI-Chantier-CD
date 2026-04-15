-- Index sur item_photos(item_id) pour accélérer les requêtes par projet
-- Sans cet index, chaque query fait un full sequential scan de toute la table
-- ce qui timeout (57014) dès que la table contient des données volumineuses.
CREATE INDEX IF NOT EXISTS item_photos_item_id_idx ON item_photos(item_id);

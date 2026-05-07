-- Supprimer les doublons créés par la fonction de récupération (garde le premier par sort_order)
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY item_id, storage_url ORDER BY sort_order, created_at NULLS LAST) AS rn
  FROM aichantier_item_photos
  WHERE storage_url IS NOT NULL
)
DELETE FROM aichantier_item_photos WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Contrainte d'unicité pour éviter les doublons à l'avenir
ALTER TABLE aichantier_item_photos
  ADD CONSTRAINT uq_item_photos_storage_url UNIQUE (item_id, storage_url);

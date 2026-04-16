-- ============================================================
-- Migration : bucket Storage "photos" + politiques d'accès
-- Fixe le bug "photos disparaissent" causé par des uploads bloqués
-- par l'absence de politiques sur storage.objects.
-- ============================================================

-- 1. Créer le bucket s'il n'existe pas (ou le passer en public si déjà existant)
--    public = true → les URLs publiques fonctionnent sans auth (nécessaire pour <img>)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'photos',
  'photos',
  true,
  10485760,  -- 10 MB max par fichier
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/gif','image/heic','image/heif']
)
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Supprimer les anciennes politiques si elles existent
DROP POLICY IF EXISTS "photos_storage_select" ON storage.objects;
DROP POLICY IF EXISTS "photos_storage_insert" ON storage.objects;
DROP POLICY IF EXISTS "photos_storage_update" ON storage.objects;
DROP POLICY IF EXISTS "photos_storage_delete" ON storage.objects;

-- 3. SELECT public (lecture sans auth — nécessaire pour afficher les images dans le PDF)
CREATE POLICY "photos_storage_select" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'photos');

-- 4. INSERT pour utilisateurs authentifiés (upload de nouvelles photos)
CREATE POLICY "photos_storage_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'photos');

-- 5. UPDATE pour utilisateurs authentifiés (migration base64 → Storage URL)
CREATE POLICY "photos_storage_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'photos');

-- 6. DELETE pour utilisateurs authentifiés (suppression de photos)
CREATE POLICY "photos_storage_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'photos');

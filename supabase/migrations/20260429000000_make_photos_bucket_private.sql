-- Passer le bucket "photos" en privé — les URLs publiques ne fonctionneront plus sans auth.
-- L'accès passe par des signed URLs générées côté client (createSignedUrls, TTL 1h).
UPDATE storage.buckets SET public = false WHERE id = 'photos';

DROP POLICY IF EXISTS "photos_storage_select" ON storage.objects;

CREATE POLICY "photos_storage_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'photos');

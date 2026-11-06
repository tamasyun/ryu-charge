
-- Consolidate bucket-scoped insert policies. The previous RESTRICTIVE
-- room-photos policy unintentionally blocked uploads to review-images
-- by signed-in users because restrictive policies apply to all INSERTs.
DROP POLICY IF EXISTS "Allow uploads 1qk4ih9_0" ON storage.objects;
DROP POLICY IF EXISTS room_photos_storage_insert_guard ON storage.objects;
DROP POLICY IF EXISTS room_photos_storage_insert ON storage.objects;

CREATE POLICY review_images_university_insert
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'review-images'
  AND (storage.foldername(name))[1] = 'reviews'
  AND (SELECT auth.uid()) IS NOT NULL
  AND lower(coalesce((SELECT auth.jwt()) ->> 'email', '')) ~
      '^[^@[:space:]]+@([a-z0-9-]+[.])*u-ryukyu[.]ac[.]jp$'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid())
  )
);

CREATE POLICY room_photos_university_storage_insert
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'room-photos'
  AND (SELECT auth.uid()) IS NOT NULL
  AND lower(coalesce((SELECT auth.jwt()) ->> 'email', '')) ~
      '^[^@[:space:]]+@([a-z0-9-]+[.])*u-ryukyu[.]ac[.]jp$'
  AND EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = (SELECT auth.uid())
  )
  AND EXISTS (
    SELECT 1 FROM public.rooms
    WHERE id = (storage.foldername(name))[1]
  )
);

-- Existing uploaded files are unchanged. The bucket now enforces the
-- same 5 MiB and MIME rules as room-photos for new uploads.
UPDATE storage.buckets
SET file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']::text[]
WHERE id = 'review-images';

-- Review uploads can be removed by their owner to recover failed posts.
CREATE POLICY review_images_storage_delete_own
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'review-images'
  AND owner_id = ((SELECT auth.uid()))::text
);

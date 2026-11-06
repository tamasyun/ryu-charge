
DROP POLICY IF EXISTS room_photos_university_storage_insert ON storage.objects;
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
    SELECT 1 FROM public.rooms AS r
    WHERE r.id = (storage.foldername(storage.objects.name))[1]
  )
);

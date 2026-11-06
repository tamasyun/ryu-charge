
-- Existing app code constructs image URLs through getPublicUrl.
-- Keep submitted public image URLs inside the application's own buckets.
CREATE POLICY review_image_url_guard
ON public.room_reviews AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (
  image_url IS NULL
  OR image_url LIKE
     'https://gpamidyeyyprvahxloyd.supabase.co/storage/v1/object/public/review-images/reviews/%'
);

CREATE POLICY room_photos_reference_guard
ON public.room_photos AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (
  (storage.foldername(storage_path))[1] = room_id
  AND (
    image_url IS NULL
    OR image_url =
       'https://gpamidyeyyprvahxloyd.supabase.co/storage/v1/object/public/room-photos/'
       || storage_path
  )
);

-- Indexes for room-photo listing and owner cleanup.
CREATE INDEX IF NOT EXISTS room_photos_room_id_idx ON public.room_photos(room_id);
CREATE INDEX IF NOT EXISTS room_photos_user_id_idx ON public.room_photos(user_id);

-- Avoid recomputing the session identifier on every row.
ALTER POLICY insert_rooms_authenticated ON public.rooms
WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

ALTER POLICY insert_outlets_authenticated ON public.outlets
WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

ALTER POLICY insert_room_reviews_authenticated ON public.room_reviews
WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

ALTER POLICY "Allow users to delete their own review" ON public.room_reviews
USING ((SELECT auth.uid()) = user_id);

BEGIN;

-- 投稿者・教室・日時・写真の参照は維持し、評価とコメントだけ更新できるようにする。
GRANT UPDATE (rating, comment) ON public.room_reviews TO authenticated;

CREATE POLICY update_own_room_review ON public.room_reviews
  FOR UPDATE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND lower(coalesce((SELECT auth.jwt()) ->> 'email', '')) ~
      '^[^@[:space:]]+@([a-z0-9-]+[.])*u-ryukyu[.]ac[.]jp$'
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()))
  )
  WITH CHECK (user_id = (SELECT auth.uid()));

COMMIT;

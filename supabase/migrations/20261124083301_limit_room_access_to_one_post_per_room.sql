-- 同時に投稿された場合も、教室ごとに最初の1件だけを登録する。
ALTER TABLE public.room_access_posts
  ADD CONSTRAINT room_access_posts_one_per_room UNIQUE (room_id);

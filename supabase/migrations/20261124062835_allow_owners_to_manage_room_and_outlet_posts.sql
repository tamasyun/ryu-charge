BEGIN;

-- 投稿日時の記録がない既存の教室には、この移行から1週間の猶予を設ける。
ALTER TABLE public.rooms
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT statement_timestamp();

-- 投稿日時はDBが設定する。投稿者、ID、所属建物も編集対象に含めない。
REVOKE INSERT ON public.rooms FROM authenticated;
GRANT INSERT (id, building_id, name, floor, location_detail, user_id) ON public.rooms TO authenticated;
GRANT UPDATE (name, floor, location_detail) ON public.rooms TO authenticated;
GRANT UPDATE (room_id, location_detail, ac_ports) ON public.outlets TO authenticated;
GRANT DELETE ON public.rooms, public.outlets TO authenticated;

CREATE POLICY update_own_room_within_week ON public.rooms
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND statement_timestamp() < created_at + interval '168 hours')
  WITH CHECK (user_id = (SELECT auth.uid()) AND statement_timestamp() < created_at + interval '168 hours');

CREATE POLICY delete_own_room_within_week ON public.rooms
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()) AND statement_timestamp() < created_at + interval '168 hours');

CREATE POLICY update_own_outlet ON public.outlets
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY delete_own_outlet ON public.outlets
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- 教室を削除しても関連投稿や画像の参照が失われないようにする。
-- 外部キーで制約し、削除と新規投稿が同時に行われる場合にも適用する。
ALTER TABLE public.outlets
  DROP CONSTRAINT outlets_room_id_fkey,
  ADD CONSTRAINT outlets_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE NO ACTION;
ALTER TABLE public.room_reviews
  DROP CONSTRAINT room_reviews_room_id_fkey,
  ADD CONSTRAINT room_reviews_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE NO ACTION;
ALTER TABLE public.room_photos
  DROP CONSTRAINT room_photos_room_id_fkey,
  ADD CONSTRAINT room_photos_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE NO ACTION;

COMMIT;

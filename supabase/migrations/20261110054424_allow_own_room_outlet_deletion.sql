BEGIN;

GRANT DELETE ON public.rooms, public.outlets TO authenticated;

CREATE POLICY delete_own_rooms ON public.rooms
FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

CREATE POLICY delete_own_outlets ON public.outlets
FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

-- 親のDELETEによるCASCADEは子のRLSを通らないため、削除前に保護する。
-- NULLの投稿者も所有者を確認できないため保護対象に含める。
CREATE FUNCTION public.guard_room_contributions() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.outlets WHERE room_id = OLD.id AND user_id IS DISTINCT FROM (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.room_photos WHERE room_id = OLD.id AND user_id IS DISTINCT FROM (SELECT auth.uid()))
    OR EXISTS (SELECT 1 FROM public.room_reviews WHERE room_id = OLD.id AND user_id IS DISTINCT FROM (SELECT auth.uid()))
  ) THEN
    RAISE EXCEPTION 'room_has_other_contributions' USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_room_contributions() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER guard_room_contributions BEFORE DELETE ON public.rooms
FOR EACH ROW EXECUTE FUNCTION public.guard_room_contributions();

-- DELETEの文スナップショットを作る前に親行をロックする。
-- 別端末からの子のINSERT（FKのKEY SHARE）と直列化し、写真一覧の取りこぼしを防ぐ。
-- 呼出者にUPDATE権限を与えずに行をロックするため、この小さい関数だけを特権化する。
CREATE SCHEMA room_deletion_private;
REVOKE ALL ON SCHEMA room_deletion_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA room_deletion_private TO authenticated;
CREATE FUNCTION room_deletion_private.lock_own_room(p_room_id text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN RETURN false; END IF;
  PERFORM 1 FROM public.rooms
  WHERE id = p_room_id AND user_id = (SELECT auth.uid()) FOR UPDATE;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION room_deletion_private.lock_own_room(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION room_deletion_private.lock_own_room(text) TO authenticated;

-- RETURNINGの評価は子レコードのCASCADEより前に行われる。
-- 同じDELETEの中で削除対象の写真を返し、クライアントでStorage APIを使って回収する。
-- SECURITY INVOKERにより呼出者のRLS・既存のアカウント状態チェックを維持する。
CREATE FUNCTION public.delete_own_room(p_room_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE deleted jsonb;
BEGIN
  IF NOT room_deletion_private.lock_own_room(p_room_id) THEN RETURN NULL; END IF;
  DELETE FROM public.rooms AS r
  WHERE r.id = p_room_id AND r.user_id = (SELECT auth.uid())
  RETURNING jsonb_build_object(
    'id', r.id,
    'room_photos', coalesce((
      SELECT jsonb_agg(jsonb_build_object('storage_path', p.storage_path))
      FROM public.room_photos AS p WHERE p.room_id = r.id
    ), '[]'::jsonb),
    'room_reviews', coalesce((
      SELECT jsonb_agg(jsonb_build_object('image_url', v.image_url))
      FROM public.room_reviews AS v WHERE v.room_id = r.id AND v.image_url IS NOT NULL
    ), '[]'::jsonb)
  ) INTO deleted;
  RETURN deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_own_room(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_own_room(text) TO authenticated;

COMMIT;

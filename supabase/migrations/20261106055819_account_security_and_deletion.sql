-- 未適用。既存のニックネーム・投稿者マイグレーションの後で実行する。
BEGIN;
CREATE SCHEMA IF NOT EXISTS account_private;
REVOKE ALL ON SCHEMA account_private FROM public, anon, authenticated;

CREATE TABLE account_private.initial_passkey_enrollments (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes')
);
CREATE TABLE account_private.account_deletion_proofs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  proof_hash text NOT NULL CHECK (proof_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes')
);
CREATE TABLE account_private.account_deletion_jobs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz NOT NULL DEFAULT '-infinity'
);
ALTER TABLE account_private.initial_passkey_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_private.account_deletion_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_private.account_deletion_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA account_private FROM public, anon, authenticated;

-- 初回メール確認時だけ権利を作る。既存アカウントの再登録や通常ログインでは作らない。
CREATE FUNCTION account_private.mark_initial_passkey_enrollment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL
     AND NOT coalesce(NEW.is_anonymous, false) THEN
    INSERT INTO account_private.initial_passkey_enrollments(user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER mark_initial_passkey_enrollment AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW EXECUTE FUNCTION account_private.mark_initial_passkey_enrollment();

CREATE FUNCTION public.is_active_account() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = (SELECT auth.uid()) AND NOT coalesce(u.is_anonymous, false))
    AND EXISTS (SELECT 1 FROM auth.sessions s WHERE s.user_id = (SELECT auth.uid())
      AND s.id::text = (SELECT auth.jwt()) ->> 'session_id')
    AND NOT EXISTS (SELECT 1 FROM account_private.account_deletion_jobs j WHERE j.user_id = (SELECT auth.uid()));
$$;
REVOKE ALL ON FUNCTION public.is_active_account() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_active_account() TO authenticated;

CREATE FUNCTION public.claim_initial_passkey_enrollment() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE claimed uuid;
BEGIN
  IF NOT public.is_active_account() OR NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid())
  ) THEN RETURN false; END IF;
  DELETE FROM account_private.initial_passkey_enrollments
    WHERE user_id = (SELECT auth.uid()) AND expires_at > now() RETURNING user_id INTO claimed;
  RETURN claimed IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_initial_passkey_enrollment() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_initial_passkey_enrollment() TO authenticated;

CREATE FUNCTION public.issue_account_deletion_proof(p_user_id uuid, p_proof_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO account_private.account_deletion_proofs(user_id, proof_hash)
  VALUES (p_user_id, p_proof_hash)
  ON CONFLICT (user_id) DO UPDATE SET proof_hash = excluded.proof_hash, expires_at = now() + interval '5 minutes';
END;
$$;

CREATE FUNCTION public.account_deletion_status(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM account_private.account_deletion_jobs WHERE user_id = p_user_id);
$$;

-- 投稿・アップロードのトリガーと同じロックを取得し、削除開始時の取りこぼしを防ぐ。
CREATE FUNCTION public.prepare_account_deletion(p_user_id uuid, p_proof_hash text, p_review_files jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE manifest jsonb; job account_private.account_deletion_jobs;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
  IF NOT EXISTS (SELECT 1 FROM account_private.account_deletion_proofs
    WHERE user_id = p_user_id AND proof_hash = p_proof_hash AND expires_at > now()) THEN
    RAISE EXCEPTION 'reauth_required' USING ERRCODE = '28000';
  END IF;
  INSERT INTO account_private.account_deletion_jobs(user_id) VALUES (p_user_id) ON CONFLICT DO NOTHING;
  SELECT * INTO job FROM account_private.account_deletion_jobs WHERE user_id = p_user_id FOR UPDATE;
  IF job.lease_until > now() THEN RAISE EXCEPTION 'deletion_busy' USING ERRCODE = '55P03'; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('bucket_id', f.bucket_id, 'name', f.name)), '[]'::jsonb)
  INTO manifest FROM (
    SELECT item->>'bucket_id' AS bucket_id, item->>'name' AS name FROM jsonb_array_elements(job.files) item
    UNION
    -- 投稿に結び付く前に失敗したアップロード、別バケットの本人写真も含める。
    SELECT bucket_id, name FROM storage.objects WHERE owner_id = p_user_id::text
    UNION
    -- 過去の匿名アップロードは、本人レビューにだけ参照される写真に限定する。
    -- 他ユーザー所有の写真や共有された匿名写真は削除しない。
    SELECT o.bucket_id, o.name FROM storage.objects o
    JOIN jsonb_array_elements(p_review_files) image ON image->>'name' = o.name
    WHERE o.bucket_id = 'review-images' AND o.owner_id IS NULL
      AND EXISTS (SELECT 1 FROM public.room_reviews r WHERE r.user_id = p_user_id AND r.image_url = image->>'url')
      AND NOT EXISTS (SELECT 1 FROM public.room_reviews r WHERE r.user_id IS DISTINCT FROM p_user_id AND r.image_url = image->>'url')
  ) f;
  UPDATE account_private.account_deletion_jobs SET files = manifest, lease_until = now() + interval '2 minutes' WHERE user_id = p_user_id;
  RETURN manifest;
END;
$$;

CREATE FUNCTION public.release_account_deletion_lease(p_user_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE account_private.account_deletion_jobs SET lease_until = '-infinity' WHERE user_id = p_user_id;
$$;

-- 認証ユーザー削除と同じトランザクション内で処理する。外部キーのない既存レビューも明示的に削除。
CREATE FUNCTION account_private.cleanup_deleted_account() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(OLD.id::text, 0));
  IF EXISTS (
    SELECT 1 FROM account_private.account_deletion_jobs j,
      jsonb_array_elements(j.files) f, storage.objects o
    WHERE j.user_id = OLD.id AND o.bucket_id = f->>'bucket_id' AND o.name = f->>'name'
  ) THEN RAISE EXCEPTION 'storage_cleanup_incomplete'; END IF;
  DELETE FROM public.room_reviews WHERE user_id = OLD.id;
  UPDATE public.rooms SET user_id = NULL WHERE user_id = OLD.id;
  UPDATE public.outlets SET user_id = NULL WHERE user_id = OLD.id;
  -- profiles / Authのパスキー・セッション / room_photosは既存のON DELETE CASCADEで削除される。
  RETURN OLD;
END;
$$;
CREATE TRIGGER cleanup_deleted_account BEFORE DELETE ON auth.users
FOR EACH ROW EXECUTE FUNCTION account_private.cleanup_deleted_account();

-- 削除中・削除済みユーザーの未失効JWTでも、プロフィール再作成や追加投稿を認めない。
CREATE FUNCTION account_private.guard_account_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE actor uuid := (SELECT auth.uid());
BEGIN
  IF actor IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 0));
    IF NOT public.is_active_account() THEN RAISE EXCEPTION 'account_unavailable' USING ERRCODE = '42501'; END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['profiles','rooms','outlets','room_reviews'] LOOP
    EXECUTE format('CREATE TRIGGER guard_account_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION account_private.guard_account_write()', target);
  END LOOP;
END;
$$;
CREATE TRIGGER guard_account_write BEFORE INSERT OR UPDATE ON storage.objects
FOR EACH ROW EXECUTE FUNCTION account_private.guard_account_write();

-- 現在の匿名アップロード許可とはANDで組み合わせ、review-imagesへの直接API投稿も保護する。
-- anonにはis_active_accountを直接公開せず、CASEで未認証時の関数評価も避ける。
CREATE POLICY require_active_review_image_owner ON storage.objects AS RESTRICTIVE
FOR INSERT TO public WITH CHECK (
  bucket_id <> 'review-images' OR CASE WHEN (SELECT auth.uid()) IS NULL THEN false ELSE (
    owner_id = (SELECT auth.uid())::text AND public.is_active_account()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()))
    AND lower(coalesce((SELECT auth.jwt())->>'email','')) ~ '^[^@[:space:]]+@([a-z0-9-]+[.])*u-ryukyu[.]ac[.]jp$'
  ) END
);

-- 特権関数はEdge Functionの管理用クライアントだけが実行できる。
REVOKE ALL ON FUNCTION public.issue_account_deletion_proof(uuid,text), public.account_deletion_status(uuid),
  public.prepare_account_deletion(uuid,text,jsonb), public.release_account_deletion_lease(uuid)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_account_deletion_proof(uuid,text), public.account_deletion_status(uuid),
  public.prepare_account_deletion(uuid,text,jsonb), public.release_account_deletion_lease(uuid) TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA account_private FROM public, anon, authenticated;
CREATE INDEX IF NOT EXISTS room_reviews_user_id_idx ON public.room_reviews(user_id);
COMMIT;

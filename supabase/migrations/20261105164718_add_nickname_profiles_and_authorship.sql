-- 既存の rooms / outlets / room_reviews とその読み取り・投稿ポリシーに追加する。
-- 本番適用前に現在のスキーマを確認する。このファイルだけでは空DBを構築できない。
BEGIN;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname text NOT NULL,
  CONSTRAINT profiles_nickname_valid CHECK (
    char_length(nickname) BETWEEN 1 AND 20
    AND nickname !~ '[[:cntrl:]]'
    AND nickname = regexp_replace(nickname, '^[[:space:]　]+|[[:space:]　]+$', '', 'g')
  )
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profiles FROM anon, authenticated;
GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT INSERT (id, nickname), UPDATE (nickname) ON public.profiles TO authenticated;

CREATE POLICY read_public_nicknames ON public.profiles
FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY insert_own_profile ON public.profiles
FOR INSERT TO authenticated WITH CHECK (
  id = (SELECT auth.uid())
  AND lower(coalesce((SELECT auth.jwt()) ->> 'email', '')) ~
    '^[^@[:space:]]+@([a-z0-9-]+[.])*u-ryukyu[.]ac[.]jp$'
);

CREATE POLICY update_own_nickname ON public.profiles
FOR UPDATE TO authenticated
USING (id = (SELECT auth.uid()))
WITH CHECK (id = (SELECT auth.uid()));

-- 過去の教室・コンセントの投稿者は推測しない。追加後の投稿にのみデフォルトを設定する。
ALTER TABLE public.rooms ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.outlets ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.rooms ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.outlets ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.room_reviews ALTER COLUMN user_id SET DEFAULT auth.uid();
CREATE INDEX rooms_user_id_idx ON public.rooms(user_id);
CREATE INDEX outlets_user_id_idx ON public.outlets(user_id);

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outlets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_reviews ENABLE ROW LEVEL SECURITY;

REVOKE INSERT ON public.rooms, public.outlets, public.room_reviews FROM anon;
REVOKE INSERT (room_id, rating, comment, delete_key_hash) ON public.room_reviews FROM anon;

-- 既存の permissive なポリシーとも AND で組み合わせ、投稿者IDの偽装と名前未設定の投稿を防ぐ。
DO $$
DECLARE target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['rooms', 'outlets', 'room_reviews'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS require_university_email_for_insert ON public.%I', target_table);
    EXECUTE format($policy$
      CREATE POLICY require_university_email_for_insert ON public.%I AS RESTRICTIVE
      FOR INSERT TO public WITH CHECK (
        (SELECT auth.uid()) IS NOT NULL
        AND lower(coalesce((SELECT auth.jwt()) ->> 'email', '')) ~
          '^[^@[:space:]]+@([a-z0-9-]+[.])*u-ryukyu[.]ac[.]jp$'
      )
    $policy$, target_table);
    EXECUTE format($policy$
      CREATE POLICY require_own_profile_for_insert ON public.%I AS RESTRICTIVE
      FOR INSERT TO public WITH CHECK (
        user_id = (SELECT auth.uid())
        AND EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()))
      )
    $policy$, target_table);
  END LOOP;
END;
$$;

COMMIT;

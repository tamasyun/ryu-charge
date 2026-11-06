-- 隔離した一時Postgres専用。実プロジェクトに実行しない。
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE TABLE auth.users(id uuid PRIMARY KEY, email_confirmed_at timestamptz, is_anonymous boolean DEFAULT false);
CREATE TABLE auth.sessions(id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users ON DELETE CASCADE);
CREATE TABLE auth.webauthn_credentials(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users ON DELETE CASCADE);
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (auth.jwt()->>'sub')::uuid $$;
GRANT USAGE ON SCHEMA public, auth, storage TO anon, authenticated, service_role;
CREATE TABLE public.rooms(id text PRIMARY KEY, name text);
CREATE TABLE public.outlets(id text PRIMARY KEY, room_id text REFERENCES public.rooms(id));
CREATE TABLE public.room_reviews(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id text REFERENCES public.rooms,
  rating int, comment text, image_url text, user_id uuid, delete_key_hash text);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner_id text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY uploads ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id='review-images');
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rooms, public.outlets, public.room_reviews, storage.objects TO authenticated;
GRANT SELECT, INSERT ON storage.objects TO anon;
CREATE POLICY read_rooms ON public.rooms FOR SELECT TO public USING (true);
CREATE POLICY insert_rooms ON public.rooms FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY read_outlets ON public.outlets FOR SELECT TO public USING (true);
CREATE POLICY insert_outlets ON public.outlets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY read_reviews ON public.room_reviews FOR SELECT TO public USING (true);
CREATE POLICY insert_reviews ON public.room_reviews FOR INSERT TO authenticated WITH CHECK (true);
INSERT INTO auth.users VALUES ('00000000-0000-4000-8000-000000000001', now(), false), ('00000000-0000-4000-8000-000000000003', now(), false);

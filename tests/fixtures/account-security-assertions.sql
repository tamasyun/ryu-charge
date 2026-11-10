CREATE FUNCTION public.test_assert(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %', message; END IF; END; $$;
CREATE FUNCTION public.test_error(statement text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = expected THEN RETURN; END IF;
    RAISE EXCEPTION 'Expected %, received %: %', expected, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'Expected error %, but succeeded: %', expected, statement;
END; $$;

INSERT INTO auth.users VALUES ('00000000-0000-4000-8000-000000000002', NULL, false);
INSERT INTO auth.sessions VALUES
  ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002');
INSERT INTO public.profiles VALUES
  ('00000000-0000-4000-8000-000000000001','既存'),
  ('00000000-0000-4000-8000-000000000002','新規'),
  ('00000000-0000-4000-8000-000000000003','他人');
UPDATE auth.users SET email_confirmed_at=now() WHERE id='00000000-0000-4000-8000-000000000002';
SET request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000002","session_id":"10000000-0000-4000-8000-000000000002","email":"new@ie.u-ryukyu.ac.jp","role":"authenticated"}';
SET ROLE authenticated;
SELECT public.test_assert(public.claim_initial_passkey_enrollment(), 'new signup claims enrollment');
SELECT public.test_assert(NOT public.claim_initial_passkey_enrollment(), 'enrollment cannot repeat');
RESET ROLE;

SET request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000001","session_id":"10000000-0000-4000-8000-000000000001","email":"student@ie.u-ryukyu.ac.jp","role":"authenticated"}';
SET ROLE authenticated;
SELECT public.test_assert(NOT public.claim_initial_passkey_enrollment(), 'legacy signup never auto-enrolls');
UPDATE public.profiles SET nickname='変更後' WHERE id='00000000-0000-4000-8000-000000000001';
UPDATE public.profiles SET nickname='不正変更' WHERE id='00000000-0000-4000-8000-000000000003';
SELECT public.test_assert((SELECT nickname='他人' FROM public.profiles WHERE id='00000000-0000-4000-8000-000000000003'), 'RLS prevents another profile update');
SELECT public.test_error($q$UPDATE public.profiles SET nickname=repeat('あ',21) WHERE id='00000000-0000-4000-8000-000000000001'$q$, '23514');
SELECT public.test_error($q$SELECT public.issue_account_deletion_proof('00000000-0000-4000-8000-000000000003',repeat('a',64))$q$, '42501');
SELECT public.test_error($q$SELECT * FROM account_private.account_deletion_proofs$q$, '42501');
INSERT INTO public.rooms(id,name) VALUES ('room','残す教室');
INSERT INTO public.outlets(id,room_id) VALUES ('outlet','room');
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES ('review-images','reviews/owned.jpg','00000000-0000-4000-8000-000000000001');
RESET ROLE;
SET request.jwt.claims='{}';
SET ROLE anon;
SELECT public.test_error($q$INSERT INTO storage.objects(bucket_id,name) VALUES('review-images','reviews/anonymous.jpg')$q$, '42501');
RESET ROLE;

INSERT INTO public.room_reviews(room_id,user_id,image_url) VALUES
  ('room','00000000-0000-4000-8000-000000000001','https://project.supabase.co/storage/v1/object/public/review-images/reviews/legacy.jpg'),
  ('room','00000000-0000-4000-8000-000000000003','https://project.supabase.co/storage/v1/object/public/review-images/reviews/other.jpg');
INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES
  ('review-images','reviews/legacy.jpg',NULL),
  ('review-images','reviews/other.jpg','00000000-0000-4000-8000-000000000003'),
  ('room-photos','unused-upload.jpg','00000000-0000-4000-8000-000000000001');
INSERT INTO auth.webauthn_credentials(user_id) VALUES ('00000000-0000-4000-8000-000000000001');
SELECT public.issue_account_deletion_proof('00000000-0000-4000-8000-000000000001',repeat('a',64));
UPDATE account_private.account_deletion_proofs SET expires_at=now()-interval '1 second';
SELECT public.test_error($q$SELECT public.prepare_account_deletion('00000000-0000-4000-8000-000000000001',repeat('a',64),'[]')$q$, '28000');
SELECT public.issue_account_deletion_proof('00000000-0000-4000-8000-000000000001',repeat('a',64));
SELECT public.test_error($q$SELECT public.prepare_account_deletion('00000000-0000-4000-8000-000000000001',repeat('b',64),'[]')$q$, '28000');
CREATE TEMP TABLE manifest AS SELECT public.prepare_account_deletion(
  '00000000-0000-4000-8000-000000000001',repeat('a',64),
  '[{"name":"reviews/legacy.jpg","url":"https://project.supabase.co/storage/v1/object/public/review-images/reviews/legacy.jpg"},{"name":"reviews/other.jpg","url":"https://project.supabase.co/storage/v1/object/public/review-images/reviews/other.jpg"}]'::jsonb
) AS files;
SELECT public.test_assert((SELECT jsonb_array_length(files)=3 FROM manifest), 'owned, orphan and legacy photos are included; other user photo excluded');
SELECT public.test_error($q$SELECT public.prepare_account_deletion('00000000-0000-4000-8000-000000000001',repeat('a',64),'[]')$q$, '55P03');
SELECT public.test_error($q$DELETE FROM auth.users WHERE id='00000000-0000-4000-8000-000000000001'$q$, 'P0001');
SELECT public.test_assert(EXISTS(SELECT 1 FROM public.room_reviews WHERE user_id='00000000-0000-4000-8000-000000000001'), 'storage failure preserves reviews and Auth');

SET request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000001","session_id":"10000000-0000-4000-8000-000000000001","email":"student@ie.u-ryukyu.ac.jp","role":"authenticated"}';
SET ROLE authenticated;
SELECT public.test_error($q$INSERT INTO public.rooms(id,name) VALUES('late','投稿禁止')$q$, '42501');
SELECT public.test_error($q$UPDATE public.profiles SET nickname='変更禁止' WHERE id='00000000-0000-4000-8000-000000000001'$q$, '42501');
SELECT public.test_error($q$INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES('review-images','late.jpg','00000000-0000-4000-8000-000000000001')$q$, '42501');
RESET ROLE;
SET request.jwt.claims='{}';
SELECT public.release_account_deletion_lease('00000000-0000-4000-8000-000000000001');
SELECT public.test_assert(jsonb_array_length(public.prepare_account_deletion('00000000-0000-4000-8000-000000000001',repeat('a',64),'[]'))=3, 'retry preserves deletion manifest');
DELETE FROM storage.objects o USING manifest m WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements(m.files) f WHERE o.bucket_id=f->>'bucket_id' AND o.name=f->>'name'
);
DELETE FROM auth.users WHERE id='00000000-0000-4000-8000-000000000001';
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM public.room_reviews WHERE user_id='00000000-0000-4000-8000-000000000001'), 'review without FK is deleted');
SELECT public.test_assert((SELECT user_id IS NULL FROM public.rooms WHERE id='room'), 'room survives and author is removed');
SELECT public.test_assert((SELECT user_id IS NULL FROM public.outlets WHERE id='outlet'), 'outlet survives and author is removed');
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM public.profiles WHERE id='00000000-0000-4000-8000-000000000001'), 'profile cascades');
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM auth.webauthn_credentials WHERE user_id='00000000-0000-4000-8000-000000000001'), 'passkeys cascade');
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM auth.sessions WHERE user_id='00000000-0000-4000-8000-000000000001'), 'sessions cascade');
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM account_private.account_deletion_jobs), 'private deletion data cascades');
SELECT public.test_assert(EXISTS(SELECT 1 FROM storage.objects WHERE name='reviews/other.jpg'), 'other user photo is preserved');
SELECT public.test_assert(EXISTS(SELECT 1 FROM public.room_reviews WHERE user_id='00000000-0000-4000-8000-000000000003'), 'other user review is preserved');

SET request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000001","session_id":"10000000-0000-4000-8000-000000000001","email":"student@ie.u-ryukyu.ac.jp","role":"authenticated"}';
SET ROLE authenticated;
SELECT public.test_error($q$INSERT INTO public.profiles(id,nickname) VALUES('00000000-0000-4000-8000-000000000001','復活禁止')$q$, '42501');
RESET ROLE;

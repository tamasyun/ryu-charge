-- Reviewed against the ryu-charge schema on 2026-10-21.
-- Run as a migration only after checking the current policies and grants.
-- PostgreSQL ORs permissive policies; these restrictive policies are ANDed
-- with every permissive INSERT policy, including ones added in the future.
BEGIN;

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outlets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.room_reviews ENABLE ROW LEVEL SECURITY;

-- Anonymous visitors can read public data but should never insert it.
REVOKE INSERT ON public.rooms, public.outlets, public.room_reviews FROM anon;
REVOKE INSERT (room_id, rating, comment, delete_key_hash)
  ON public.room_reviews FROM anon;

DROP POLICY IF EXISTS "require_university_email_for_insert" ON public.rooms;
CREATE POLICY "require_university_email_for_insert"
ON public.rooms AS RESTRICTIVE
FOR INSERT TO public
WITH CHECK (
  auth.uid() IS NOT NULL
  AND lower(coalesce(auth.jwt() ->> 'email', '')) ~
    '^[^@[:space:]]+@([a-z0-9-]+\.)*u-ryukyu\.ac\.jp$'
);

DROP POLICY IF EXISTS "require_university_email_for_insert" ON public.outlets;
CREATE POLICY "require_university_email_for_insert"
ON public.outlets AS RESTRICTIVE
FOR INSERT TO public
WITH CHECK (
  auth.uid() IS NOT NULL
  AND lower(coalesce(auth.jwt() ->> 'email', '')) ~
    '^[^@[:space:]]+@([a-z0-9-]+\.)*u-ryukyu\.ac\.jp$'
);

DROP POLICY IF EXISTS "require_university_email_for_insert" ON public.room_reviews;
CREATE POLICY "require_university_email_for_insert"
ON public.room_reviews AS RESTRICTIVE
FOR INSERT TO public
WITH CHECK (
  auth.uid() IS NOT NULL
  AND lower(coalesce(auth.jwt() ->> 'email', '')) ~
    '^[^@[:space:]]+@([a-z0-9-]+\.)*u-ryukyu\.ac\.jp$'
);

COMMIT;

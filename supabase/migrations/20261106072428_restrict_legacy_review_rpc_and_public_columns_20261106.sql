
-- The legacy delete-key RPC has no current client callers or key-bearing reviews.
-- Preserve the function for historical recovery, but remove public invocation.
REVOKE EXECUTE ON FUNCTION public.delete_own_room_review(uuid,text)
FROM PUBLIC, anon, authenticated;

-- Retain the existing authenticated INSERT policy and both RESTRICTIVE
-- guards (own user/profile + university email); remove redundant allow-all.
DROP POLICY IF EXISTS "Allow insert on room_reviews" ON public.room_reviews;

-- Replace table-wide public SELECT with just the columns used by the app.
-- In particular, do not expose the legacy delete_key_hash column.
REVOKE SELECT ON TABLE public.room_reviews FROM anon, authenticated;
GRANT SELECT (id, room_id, rating, comment, created_at, image_url, user_id)
ON public.room_reviews TO anon, authenticated;
REVOKE SELECT (delete_key_hash) ON public.room_reviews FROM anon, authenticated;

-- Supabase JS storage.from(bucket).remove(paths) issues the
-- storage.object.delete_many operation. The Storage API must read target
-- object rows before applying the already owner-scoped DELETE policies.
-- Limit SELECT to that operation only; do not grant object listing.
CREATE POLICY photo_objects_owner_select_for_delete_many
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id IN ('review-images', 'room-photos')
  AND owner_id = (SELECT auth.uid())::text
  AND storage.allow_only_operation('storage.object.delete_many')
);

-- 未適用の提案。現在のポリシーを確認してから管理者が別途適用する。
-- Storage APIの削除にはSELECTとDELETEの両方が必要。
-- 自分が所有し、DBから参照されていないファイルだけを回収する。
BEGIN;

CREATE POLICY photo_recovery_select_own ON storage.objects
FOR SELECT TO authenticated
USING (
  owner_id = (SELECT auth.uid())::text
  AND (
    (bucket_id = 'review-images' AND (storage.foldername(name))[1] = 'reviews')
    OR (bucket_id = 'room-photos' AND array_length(storage.foldername(name), 1) = 1)
  )
);

CREATE POLICY photo_recovery_delete_own ON storage.objects
FOR DELETE TO authenticated
USING (
  owner_id = (SELECT auth.uid())::text
  AND (
    (bucket_id = 'review-images' AND (storage.foldername(name))[1] = 'reviews')
    OR (bucket_id = 'room-photos' AND array_length(storage.foldername(name), 1) = 1)
  )
);

-- 既存のpermissiveな所有者DELETEにもANDで適用し、投稿済み画像の削除を防ぐ。
CREATE POLICY photo_recovery_delete_guard ON storage.objects AS RESTRICTIVE
FOR DELETE TO authenticated
USING (
  bucket_id NOT IN ('review-images', 'room-photos')
  OR (
    owner_id = (SELECT auth.uid())::text
    AND (
      (bucket_id = 'room-photos' AND NOT EXISTS (
        SELECT 1 FROM public.room_photos p WHERE p.storage_path = name
      ))
      OR (bucket_id = 'review-images' AND (storage.foldername(name))[1] = 'reviews'
        AND NOT EXISTS (
          SELECT 1 FROM public.room_reviews r
          WHERE right(r.image_url, length('/review-images/' || name)) = '/review-images/' || name
        )
      )
    )
  )
);

-- クライアントを経由しないアップロードにも同じ形式・サイズ制限を掛ける。
UPDATE storage.buckets SET file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
WHERE id = 'review-images';

COMMIT;

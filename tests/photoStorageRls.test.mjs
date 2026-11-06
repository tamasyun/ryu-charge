import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

// 実際の適用済みポリシーを隔離Postgresで実行する。本番画像は削除しない。
test('applied Storage RLS: owner delete_many works, other owners and ordinary listing stay inaccessible', { timeout: 30000 }, async () => {
  const db = new PGlite()
  const owner = '00000000-0000-4000-8000-000000000001'
  const other = '00000000-0000-4000-8000-000000000002'
  try {
    await db.exec(`
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
      CREATE SCHEMA auth; CREATE SCHEMA storage;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (auth.jwt()->>'sub')::uuid $$;
      CREATE FUNCTION storage.foldername(path text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(path,'/'))[1:array_length(string_to_array(path,'/'),1)-1] $$;
      CREATE FUNCTION storage.allow_only_operation(expected_operation text) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT coalesce(regexp_replace(current_setting('storage.operation', true), '^storage[.]', '') = regexp_replace(expected_operation, '^storage[.]', ''), false)
      $$;
      CREATE TABLE public.rooms(id text PRIMARY KEY);
      CREATE TABLE public.profiles(id uuid PRIMARY KEY);
      CREATE TABLE storage.buckets(id text PRIMARY KEY, file_size_limit bigint, allowed_mime_types text[]);
      CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text, owner_id text);
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated;
      GRANT SELECT ON public.rooms,public.profiles TO authenticated;
      GRANT SELECT,INSERT,DELETE ON storage.objects TO anon,authenticated;
      CREATE POLICY room_photos_storage_delete_own ON storage.objects FOR DELETE TO authenticated
        USING(bucket_id='room-photos' AND owner_id=(SELECT auth.uid())::text);
    `)
    for (const file of [
      'supabase/migrations/20261106072239_secure_image_storage_policies_20261106.sql',
      'supabase/migrations/20261106072318_fix_room_photo_insert_folder_reference_20261106.sql',
      'supabase/migrations/20261106191625_photo_storage_owner_select_for_delete_many_20261107.sql',
    ]) await db.exec(await readFile(file, 'utf8'))
    await db.exec(`
      INSERT INTO storage.objects(bucket_id,name,owner_id) VALUES
        ('review-images','reviews/own.webp','${owner}'), ('review-images','reviews/other.webp','${other}'),
        ('room-photos','room-1/own.webp','${owner}'), ('room-photos','room-1/other.webp','${other}');
      SET request.jwt.claims='{"sub":"${owner}","role":"authenticated"}';
      SET ROLE authenticated;
      SET storage.operation='storage.object.list';
    `)
    assert.equal((await db.query('SELECT * FROM storage.objects')).rows.length, 0)
    await db.exec("SET storage.operation='storage.object.get_authenticated_info'")
    assert.equal((await db.query('SELECT * FROM storage.objects')).rows.length, 0)
    await db.exec("SET storage.operation='storage.object.delete_many'")
    assert.deepEqual((await db.query('SELECT DISTINCT owner_id FROM storage.objects')).rows.map(row => row.owner_id), [owner])
    assert.equal((await db.query("DELETE FROM storage.objects WHERE name LIKE '%other.webp' RETURNING name")).rows.length, 0)
    const removed = (await db.query('DELETE FROM storage.objects RETURNING bucket_id,name')).rows
    assert.equal(removed.length, 2)
    assert.ok(removed.every(row => row.name.endsWith('/own.webp')))
    await db.exec('RESET ROLE')
    const remaining = (await db.query('SELECT * FROM storage.objects')).rows
    assert.equal(remaining.length, 2)
    assert.ok(remaining.every(row => row.owner_id === other))
    await db.exec("SET request.jwt.claims='{}'; SET ROLE anon; SET storage.operation='storage.object.delete_many'")
    assert.equal((await db.query('DELETE FROM storage.objects RETURNING name')).rows.length, 0)
    await db.exec(`RESET ROLE; SET request.jwt.claims='{"sub":"${other}","role":"authenticated"}'; SET ROLE authenticated`)
    assert.equal((await db.query('DELETE FROM storage.objects RETURNING name')).rows.length, 2)
  } finally { await db.close() }
})

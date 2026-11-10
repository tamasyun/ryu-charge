import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const owner = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'

test('room/outlet deletion enforces ownership and protects other contributors across cascades', { timeout: 30000 }, async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.uid', true), '')::uuid
      $$;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated;
    `)
    await db.exec(await readFile('supabase/migrations/20261013072322_create_ryu_charge_core_tables.sql', 'utf8'))
    // 本番を読み取りで確認した、既存の投稿者列・FK・公開SELECTを再現する。
    await db.exec(`
      ALTER TABLE public.rooms ADD COLUMN user_id uuid;
      ALTER TABLE public.outlets ADD COLUMN user_id uuid;
      CREATE TABLE public.room_photos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id text REFERENCES public.rooms(id) ON DELETE CASCADE, user_id uuid, storage_path text);
      CREATE TABLE public.room_reviews(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id text REFERENCES public.rooms(id) ON DELETE CASCADE, user_id uuid, image_url text);
      ALTER TABLE public.room_photos ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.room_reviews ENABLE ROW LEVEL SECURITY;
      GRANT SELECT ON public.room_photos, public.room_reviews TO anon, authenticated;
      CREATE POLICY read_photos ON public.room_photos FOR SELECT TO anon, authenticated USING (true);
      CREATE POLICY read_reviews ON public.room_reviews FOR SELECT TO anon, authenticated USING (true);
      -- 既存のアカウント状態トリガーがRPCからも迂回されないことを確認する。
      CREATE FUNCTION public.test_account_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF current_setting('test.account_blocked', true) = 'true' THEN
          RAISE EXCEPTION 'account_unavailable' USING ERRCODE = '42501';
        END IF;
        RETURN OLD;
      END;
      $$;
      CREATE TRIGGER guard_account_write BEFORE DELETE ON public.rooms
      FOR EACH ROW EXECUTE FUNCTION public.test_account_guard();
      INSERT INTO public.buildings VALUES ('building', 'テスト棟', 26, 127);
      INSERT INTO public.rooms(id, building_id, name, user_id) VALUES
        ('own', 'building', '101', '${owner}'), ('other', 'building', '102', '${other}'),
        ('unknown', 'building', '103', NULL), ('empty', 'building', '104', '${owner}');
      INSERT INTO public.outlets(id, room_id, location_detail, user_id) VALUES
        ('own-outlet', 'other', '窓際', '${owner}'), ('other-outlet', 'own', '入口', '${other}'),
        ('unknown-outlet', 'own', '壁際', NULL), ('cascade-outlet', 'own', '前方', '${owner}');
      INSERT INTO public.room_photos(room_id, user_id, storage_path) VALUES ('own', '${owner}', 'own/photo.webp');
      INSERT INTO public.room_reviews(room_id, user_id, image_url) VALUES ('own', '${owner}', 'https://example.com/review.webp');
    `)
    await db.exec(await readFile('supabase/migrations/20261110054424_allow_own_room_outlet_deletion.sql', 'utf8'))
    await db.exec(`SET request.uid='${owner}'; SET ROLE authenticated;`)
    await db.exec("SET test.account_blocked='true';")
    await assert.rejects(db.query("SELECT public.delete_own_room('empty')"), /account_unavailable/)
    await db.exec("SET test.account_blocked='false';")
    assert.equal((await db.query("SELECT room_deletion_private.lock_own_room('other') AS locked")).rows[0].locked, false)
    assert.equal((await db.query("DELETE FROM public.rooms WHERE id IN ('other','unknown') RETURNING id")).rows.length, 0)
    assert.equal((await db.query("DELETE FROM public.outlets WHERE id IN ('other-outlet','unknown-outlet') RETURNING id")).rows.length, 0)
    assert.deepEqual((await db.query("DELETE FROM public.outlets WHERE id = 'own-outlet' RETURNING id")).rows, [{ id: 'own-outlet' }])
    assert.equal((await db.query("SELECT public.delete_own_room('other') AS deleted")).rows[0].deleted, null)
    assert.equal((await db.query("SELECT public.delete_own_room('unknown') AS deleted")).rows[0].deleted, null)
    await assert.rejects(db.query("SELECT public.delete_own_room('own')"), /room_has_other_contributions/)
    // 直接のDELETEでも同じ保護が働き、途中まで削除されない。
    await assert.rejects(db.query("DELETE FROM public.rooms WHERE id = 'own'"), /room_has_other_contributions/)
    assert.equal((await db.query("SELECT * FROM public.room_photos WHERE room_id = 'own'")).rows.length, 1)

    // 他人・投稿者不明の子を1種類ずつ配置して、全て保護されることを確認する。
    await db.exec("RESET ROLE; DELETE FROM public.outlets WHERE id IN ('other-outlet','unknown-outlet');")
    for (const table of ['room_photos', 'room_reviews']) {
      for (const userId of [other, null]) {
        await db.exec(`UPDATE public.${table} SET user_id = ${userId ? `'${userId}'` : 'NULL'} WHERE room_id = 'own'; SET ROLE authenticated;`)
        await assert.rejects(db.query("SELECT public.delete_own_room('own')"), /room_has_other_contributions/)
        await db.exec(`RESET ROLE; UPDATE public.${table} SET user_id = '${owner}' WHERE room_id = 'own';`)
      }
    }
    await db.exec('SET ROLE authenticated;')
    const { deleted } = (await db.query("SELECT public.delete_own_room('own') AS deleted")).rows[0]
    assert.deepEqual(deleted, {
      id: 'own', room_photos: [{ storage_path: 'own/photo.webp' }],
      room_reviews: [{ image_url: 'https://example.com/review.webp' }],
    })
    for (const table of ['outlets', 'room_photos', 'room_reviews']) {
      assert.equal((await db.query(`SELECT * FROM public.${table} WHERE room_id = 'own'`)).rows.length, 0)
    }
    assert.equal((await db.query("SELECT public.delete_own_room('own') AS deleted")).rows[0].deleted, null)
    assert.deepEqual((await db.query("SELECT public.delete_own_room('empty') AS deleted")).rows[0].deleted, { id: 'empty', room_photos: [], room_reviews: [] })
    // anonはRPCも直接DELETEも不可。authenticatedでもJWTのuidなしなら削除0件。
    await db.exec("RESET ROLE; SET request.uid=''; SET ROLE anon;")
    await assert.rejects(db.query("SELECT public.delete_own_room('other')"), /permission denied/)
    await assert.rejects(db.query("SELECT room_deletion_private.lock_own_room('other')"), /permission denied/)
    await assert.rejects(db.query("DELETE FROM public.rooms WHERE id = 'other'"), /permission denied/)
    await assert.rejects(db.query("DELETE FROM public.outlets"), /permission denied/)
    await db.exec('RESET ROLE; SET ROLE authenticated;')
    assert.equal((await db.query("DELETE FROM public.rooms RETURNING id")).rows.length, 0)
  } finally {
    await db.close()
  }
})

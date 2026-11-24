import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('room and outlet mutations enforce ownership, deadline and foreign keys', { timeout: 30000 }, async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      GRANT USAGE ON SCHEMA auth TO authenticated;
      CREATE TABLE auth.users (id uuid PRIMARY KEY);
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
        $$ SELECT current_setting('request.jwt.claims', true)::jsonb $$;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT (auth.jwt()->>'sub')::uuid $$;
      INSERT INTO auth.users VALUES
        ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
    `)
    async function migrate(file) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${file}.sql`, import.meta.url), 'utf8'))
    }
    await migrate('20261013072322_create_ryu_charge_core_tables')
    await migrate('20261013074204_enable_limited_anonymous_room_outlet_submissions')
    await migrate('20261020071712_add_room_reviews_by_room')
    // 本番の既存スキーマで、関連する外部キーと投稿者列を再現する。
    await db.exec(`
      ALTER TABLE public.room_reviews ADD COLUMN user_id uuid, ADD COLUMN delete_key_hash text;
      CREATE TABLE public.room_photos (
        room_id text NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE
      );
    `)
    await migrate('20261105164718_add_nickname_profiles_and_authorship')
    await db.exec(`
      INSERT INTO buildings VALUES ('b', '建物', 26, 127);
      INSERT INTO rooms (id, building_id, name, user_id) VALUES
        ('legacy', 'b', '旧投稿', '00000000-0000-0000-0000-000000000001'),
        ('expired', 'b', '期限切れ', '00000000-0000-0000-0000-000000000001'),
        ('unknown', 'b', '投稿者不明', NULL),
        ('other', 'b', '他人の教室', '00000000-0000-0000-0000-000000000002');
      INSERT INTO profiles VALUES ('00000000-0000-0000-0000-000000000001', '投稿者');
    `)
    await migrate('20261124062835_allow_owners_to_manage_room_and_outlet_posts')
    await db.exec(`
      UPDATE rooms SET created_at = now() - interval '168 hours' WHERE id = 'expired';
      INSERT INTO outlets (id, room_id, location_detail, user_id) VALUES
        ('own', 'expired', '自分の位置', '00000000-0000-0000-0000-000000000001'),
        ('other', 'legacy', '他人の位置', '00000000-0000-0000-0000-000000000002');
      INSERT INTO room_reviews (room_id, rating, comment) VALUES ('expired', 5, 'レビュー');
      INSERT INTO room_photos (room_id) VALUES ('expired');
      SET ROLE anon;
    `)
    assert.equal((await db.query('SELECT id FROM rooms')).rows.length, 4)
    await assert.rejects(db.query("DELETE FROM rooms WHERE id = 'legacy'"), { code: '42501' })
    await db.exec(`
      SET ROLE authenticated;
      SET request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","email":"test@u-ryukyu.ac.jp"}';
    `)

    const room = await db.query("INSERT INTO rooms (id, building_id, name) VALUES ('new', 'b', '新規') RETURNING user_id, created_at")
    assert.equal(room.rows[0].user_id, '00000000-0000-0000-0000-000000000001')
    assert.ok(room.rows[0].created_at instanceof Date)
    await assert.rejects(db.query("INSERT INTO rooms (id, building_id, name, created_at) VALUES ('fake', 'b', '偽装', now())"), { code: '42501' })
    await assert.rejects(db.query("UPDATE rooms SET created_at = now() WHERE id = 'expired'"), { code: '42501' })
    await assert.rejects(db.query("UPDATE outlets SET user_id = null WHERE id = 'own'"), { code: '42501' })
    assert.deepEqual((await db.query("UPDATE rooms SET name = '編集済み' RETURNING id")).rows.map(row => row.id).sort(), ['legacy', 'new'])
    assert.deepEqual((await db.query("DELETE FROM rooms WHERE id IN ('expired', 'other', 'unknown') RETURNING id")).rows, [])
    assert.deepEqual((await db.query("UPDATE outlets SET room_id = 'new', ac_ports = 0 RETURNING id")).rows, [{ id: 'own' }])
    assert.deepEqual((await db.query("DELETE FROM outlets WHERE id = 'other' RETURNING id")).rows, [])

    await assert.rejects(db.query("DELETE FROM rooms WHERE id = 'new'"), { code: '23503' })
    await assert.rejects(db.query("DELETE FROM rooms WHERE id = 'legacy'"), { code: '23503' })
    await db.exec(`
      RESET ROLE;
      UPDATE room_reviews SET room_id = 'new' WHERE room_id = 'expired';
      SET ROLE authenticated;
    `)
    assert.deepEqual((await db.query("DELETE FROM outlets WHERE id = 'own' RETURNING id")).rows, [{ id: 'own' }])
    await assert.rejects(db.query("DELETE FROM rooms WHERE id = 'new'"), { code: '23503' })
    await db.exec(`
      RESET ROLE;
      DELETE FROM room_reviews WHERE room_id = 'new';
      UPDATE room_photos SET room_id = 'new' WHERE room_id = 'expired';
      SET ROLE authenticated;
    `)
    await assert.rejects(db.query("DELETE FROM rooms WHERE id = 'new'"), { code: '23503' })
    await db.exec("RESET ROLE; DELETE FROM room_photos WHERE room_id = 'new'; SET ROLE authenticated;")
    assert.deepEqual((await db.query("DELETE FROM rooms WHERE id = 'new' RETURNING id")).rows, [{ id: 'new' }])
  } finally {
    await db.close()
  }
})

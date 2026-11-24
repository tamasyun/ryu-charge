import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('review updates allow only the author to change the rating and comment', async () => {
  const db = new PGlite()
  const owner = '00000000-0000-0000-0000-000000000001'
  const other = '00000000-0000-0000-0000-000000000002'
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE SCHEMA auth;
      GRANT USAGE ON SCHEMA auth TO authenticated;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
        $$ SELECT current_setting('request.jwt.claims', true)::jsonb $$;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT (auth.jwt()->>'sub')::uuid $$;
      CREATE TABLE public.rooms (id text PRIMARY KEY);
      CREATE TABLE public.profiles (id uuid PRIMARY KEY);
      GRANT SELECT ON public.profiles TO authenticated;
      INSERT INTO rooms VALUES ('room');
      INSERT INTO profiles VALUES ('${owner}'), ('${other}');
    `)
    const migrate = async name => db.exec(await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8'))
    await migrate('20261020071712_add_room_reviews_by_room')
    // 本番の既存列と、任意コメントの扱いを再現する。
    await db.exec(`
      ALTER TABLE room_reviews ADD COLUMN user_id uuid, ADD COLUMN image_url text, ALTER COLUMN comment DROP NOT NULL;
      INSERT INTO room_reviews (room_id, user_id, rating, comment, image_url) VALUES
        ('room', '${owner}', 3, '編集前', '/photo.webp'),
        ('room', '${other}', 3, '他の投稿者', NULL),
        ('room', NULL, 3, '投稿者不明', NULL);
    `)
    await migrate('20261124065512_allow_owners_to_edit_room_reviews')
    await db.exec('SET ROLE anon')
    assert.equal((await db.query('SELECT id FROM room_reviews')).rows.length, 3)
    await assert.rejects(db.query('UPDATE room_reviews SET rating = 4'), { code: '42501' })

    await db.exec('SET ROLE authenticated')
    const setEmail = email => db.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: owner, email })])
    await setEmail('test@example.com')
    assert.deepEqual((await db.query('UPDATE room_reviews SET rating = 4 RETURNING id')).rows, [])

    await setEmail('test@ie.u-ryukyu.ac.jp')
    const { rows } = await db.query('UPDATE room_reviews SET rating = 4, comment = NULL RETURNING user_id, rating, comment, image_url')
    assert.deepEqual(rows, [{ user_id: owner, rating: 4, comment: null, image_url: '/photo.webp' }])
    await assert.rejects(db.query('UPDATE room_reviews SET image_url = NULL'), { code: '42501' })
    await assert.rejects(db.query('UPDATE room_reviews SET user_id = NULL'), { code: '42501' })
    await assert.rejects(db.query('UPDATE room_reviews SET room_id = NULL'), { code: '42501' })
    await assert.rejects(db.query('UPDATE room_reviews SET rating = 0'), { code: '23514' })
    await assert.rejects(db.query("UPDATE room_reviews SET comment = repeat('a', 501)"), { code: '23514' })

    await db.exec(`RESET ROLE; DELETE FROM profiles WHERE id = '${owner}'; SET ROLE authenticated;`)
    assert.deepEqual((await db.query('UPDATE room_reviews SET rating = 5 RETURNING id')).rows, [])
  } finally {
    await db.close()
  }
})

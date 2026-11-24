import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

test('room access keeps the academic catalog read-only and saves schedules and audiences atomically',
  { timeout: 30000 }, async () => {
    const db = new PGlite()
    try {
      for (const file of [
        'tests/fixtures/account-security-bootstrap.sql',
        'supabase/migrations/20261105164718_add_nickname_profiles_and_authorship.sql',
        'supabase/migrations/20261106190542_account_security_and_deletion_feat_auth_security.sql',
        'supabase/migrations/20261124080240_add_room_access_and_academic_units.sql',
        'supabase/migrations/20261124083301_limit_room_access_to_one_post_per_room.sql',
      ]) {
        await db.exec(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'))
      }
      const owner = '00000000-0000-4000-8000-000000000001'
      const other = '00000000-0000-4000-8000-000000000003'
      const sessionId = userId => `1${userId.slice(1)}`
      await db.exec(`
        INSERT INTO rooms (id, name) VALUES ('r1', '101');
        INSERT INTO profiles VALUES ('${owner}', '投稿者'), ('${other}', '別の投稿者');
        INSERT INTO auth.sessions VALUES ('${sessionId(owner)}', '${owner}'), ('${sessionId(other)}', '${other}');
        SET ROLE service_role;
        INSERT INTO academic_units VALUES ('admin-test', 'science', '追加された学科', 4);
        SET ROLE anon;
      `)

      const schedule = "'r1', ARRAY[1,3]::smallint[], '09:00', '17:00'"
      const result = await db.query("SELECT name FROM academic_units WHERE parent_id = 'engineering-department'")
      assert.equal(result.rows.length, 7)
      const regional = await db.query(`
        SELECT parent_id, count(*)::int AS programs FROM academic_units
        WHERE parent_id IN ('regional-day', 'regional-night') GROUP BY parent_id ORDER BY parent_id
      `)
      assert.deepEqual(regional.rows, [
        { parent_id: 'regional-day', programs: 5 },
        { parent_id: 'regional-night', programs: 3 },
      ])
      assert.deepEqual((await db.query("SELECT parent_id FROM academic_units WHERE id = 'advanced-legal-practice'")).rows, [{ parent_id: 'law' }])
      assert.deepEqual((await db.query("SELECT name FROM academic_units WHERE id = 'admin-test'")).rows, [{ name: '追加された学科' }])
      await assert.rejects(db.query(`SELECT save_room_access(${schedule}, ARRAY['engineering'])`), { code: '42501' })

      async function signIn(userId) {
        await db.exec(`
          SET ROLE authenticated;
          SET request.jwt.claims = '{"sub":"${userId}","session_id":"${sessionId(userId)}","email":"test@u-ryukyu.ac.jp"}';
        `)
      }
      await signIn(owner)
      await assert.rejects(db.query("UPDATE academic_units SET name = '変更' WHERE id = 'engineering'"), { code: '42501' })
      await assert.rejects(db.query(`SELECT save_room_access(${schedule}, ARRAY[]::text[])`), { code: '23514' })
      await assert.rejects(db.query(`SELECT save_room_access(${schedule}, ARRAY['missing'])`), { code: '23503' })
      await assert.rejects(db.query(`
        INSERT INTO room_access_posts (room_id, weekdays, starts_at, ends_at)
        VALUES ('r1', ARRAY[1]::smallint[], '09:00', '17:00')
      `), { code: '23514' })
      await assert.rejects(db.query("SELECT save_room_access('r1', ARRAY[0]::smallint[], '09:00', '17:00', ARRAY['engineering'])"), { code: '23514' })
      await assert.rejects(db.query("SELECT save_room_access('r1', ARRAY[1]::smallint[], '17:00', '09:00', ARRAY['engineering'])"), { code: '23514' })
      assert.deepEqual((await db.query('SELECT id FROM room_access_posts')).rows, [])

      const { rows: [{ id }] } = await db.query(`SELECT save_room_access(${schedule}, ARRAY['engineering']) AS id`)
      const selected = () => db.query('SELECT unit_id FROM room_access_audiences WHERE post_id = $1 ORDER BY unit_id', [id])
      assert.deepEqual((await selected()).rows, [{ unit_id: 'engineering' }])
      await assert.rejects(db.query(`SELECT save_room_access(${schedule}, ARRAY['science'])`), { code: '23505', constraint: 'room_access_posts_one_per_room' })
      await assert.rejects(db.query('DELETE FROM room_access_audiences WHERE post_id = $1', [id]), { code: '23514' })
      await assert.rejects(db.query("SELECT save_room_access('r1', ARRAY[3]::smallint[], '00:00', '24:00', ARRAY['missing'], $1)", [id]), { code: '23503' })
      assert.deepEqual((await selected()).rows, [{ unit_id: 'engineering' }])
      assert.deepEqual((await db.query('SELECT weekdays FROM room_access_posts WHERE id = $1', [id])).rows, [{ weekdays: [1, 3] }])

      await signIn(other)
      await assert.rejects(db.query(`SELECT save_room_access(${schedule}, ARRAY['science'])`), { code: '23505', constraint: 'room_access_posts_one_per_room' })
      await assert.rejects(db.query(`SELECT save_room_access(${schedule}, ARRAY['science'], $1)`, [id]), { code: '42501' })
      assert.deepEqual((await db.query('DELETE FROM room_access_posts WHERE id = $1 RETURNING id', [id])).rows, [])
      await assert.rejects(db.query("INSERT INTO room_access_audiences (post_id, unit_id) VALUES ($1, 'science')", [id]), { code: '42501' })
      assert.deepEqual((await db.query('DELETE FROM room_access_audiences WHERE post_id = $1 RETURNING post_id', [id])).rows, [])

      await signIn(owner)
      await db.query("SELECT save_room_access('r1', ARRAY[3]::smallint[], '00:00', '24:00', ARRAY['science', 'computer-science'], $1)", [id])
      await db.exec('SET ROLE anon')
      assert.deepEqual((await selected()).rows, [{ unit_id: 'computer-science' }, { unit_id: 'science' }])
      assert.deepEqual((await db.query('SELECT weekdays, ends_at FROM room_access_posts WHERE id = $1', [id])).rows, [{ weekdays: [3], ends_at: '24:00:00' }])

      await db.exec("RESET ROLE; RESET request.jwt.claims")
      await assert.rejects(db.query("DELETE FROM rooms WHERE id = 'r1'"), { code: '23503' })
      await signIn(owner)
      assert.deepEqual((await db.query('DELETE FROM room_access_posts WHERE id = $1 RETURNING id', [id])).rows, [{ id }])
      assert.deepEqual((await selected()).rows, [])
      await signIn(other)
      await db.query(`SELECT save_room_access(${schedule}, ARRAY['science'])`)
      assert.deepEqual((await db.query('SELECT user_id FROM room_access_posts')).rows, [{ user_id: other }])
    } finally {
      await db.close()
    }
  })

import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

// PostgreSQLをWASMで隔離実行する。外部DBやローカルのSupabaseには接続しない。
test('account security SQL: RLS, once-only enrollment, deletion retries and cascades (PGlite)',
  { timeout: 30000 }, async () => {
    const db = new PGlite()
    try {
      for (const file of [
        'tests/fixtures/account-security-bootstrap.sql',
        'supabase/migrations/20261105164718_add_nickname_profiles_and_authorship.sql',
        'supabase/migrations/20261106190542_account_security_and_deletion_feat_auth_security.sql',
        'tests/fixtures/account-security-assertions.sql',
      ]) {
        try { await db.exec(await readFile(file, 'utf8')) } catch (error) {
          throw new Error(`${file}: ${error.message}\n${error.where ?? ''}`)
        }
      }
    } finally { await db.close() }
  })

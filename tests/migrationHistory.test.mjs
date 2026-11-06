import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkMigrations } from '../scripts/check-migration-history.mjs'

test('migration audit detects SQL drift, missing files, and unapplied local versions without executing SQL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ryu-migrations-'))
  try {
    const applied = [{ version: '20261106072239', name: 'secure', statements: ['SELECT 1;'] }]
    assert.equal((await checkMigrations(applied, dir)).results[0].status, 'missing-local')
    await writeFile(join(dir, '20261106072239_secure.sql'), 'SELECT 1;\n')
    assert.equal((await checkMigrations(applied, dir)).consistent, true)
    await writeFile(join(dir, '20261106072239_secure.sql'), 'SELECT 2;\n')
    assert.equal((await checkMigrations(applied, dir)).results[0].status, 'sql-mismatch')
    await writeFile(join(dir, '20261107000000_future.sql'), 'SELECT 3;\n')
    assert.equal((await checkMigrations(applied, dir)).results.at(-1).status, 'not-applied')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

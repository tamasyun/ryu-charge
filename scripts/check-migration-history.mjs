import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { argumentsFor, isMain, printReport, readOnlyQuery, readSnapshot } from './lib/read-only.mjs'

export const MIGRATIONS_QUERY = 'SELECT version, name, statements FROM supabase_migrations.schema_migrations ORDER BY version;'
const normalize = sql => sql.replace(/\r\n/g, '\n').trim()
const hash = sql => createHash('sha256').update(normalize(sql)).digest('hex')

export async function checkMigrations(applied, directory) {
  if (!Array.isArray(applied) || !applied.length) throw new Error('適用履歴が空または未取得です。')
  const local = new Map()
  for (const file of await readdir(directory)) {
    const match = /^(\d{14})_(.+)\.sql$/.exec(file)
    if (!match) continue
    if (local.has(match[1])) throw new Error(`マイグレーション番号が重複しています: ${match[1]}`)
    local.set(match[1], { name: match[2], file, sql: await readFile(join(directory, file), 'utf8') })
  }
  const versions = new Set(), results = []
  for (const row of applied) {
    if (!/^\d{14}$/.test(row.version) || typeof row.name !== 'string' || !Array.isArray(row.statements) || !row.statements.every(sql => typeof sql === 'string') || !row.statements.length || versions.has(row.version)) throw new Error('適用履歴が不完全・重複しています。')
    versions.add(row.version)
    const file = local.get(row.version), appliedHash = hash(row.statements.join('\n\n'))
    const status = !file ? 'missing-local' : file.name !== row.name ? 'name-mismatch' : hash(file.sql) !== appliedHash ? 'sql-mismatch' : 'match'
    results.push({ version: row.version, name: row.name, file: file?.file ?? null, status, appliedHash, localHash: file ? hash(file.sql) : null })
  }
  for (const [version, file] of local) if (!versions.has(version)) results.push({ version, name: file.name, file: file.file, status: 'not-applied' })
  return {
    mode: 'read-only', scope: 'migration-history-only', generatedAt: new Date().toISOString(),
    notice: '履歴の比較のみです。履歴外の手動DDLや、空DBからの再構築可能性は別途確認が必要です。',
    consistent: results.every(row => row.status === 'match'), applied: applied.length, results,
  }
}

if (isMain(import.meta.url)) {
  try {
    const args = argumentsFor(`適用履歴の番号・名前・SQLを照合するだけの読取専用コマンドです。実行・修復はしません。
node scripts/check-migration-history.mjs --snapshot FILE [--directory DIR] [--output NEW_FILE]
SUPABASE_ACCESS_TOKENを設定後:
node scripts/check-migration-history.mjs --live --project-ref REF [--directory DIR] [--output NEW_FILE]
FILEは[{version,name,statements:[SQL]}]。既定DIRはsupabase/migrations。`, { directory: { type: 'string', default: 'supabase/migrations' } })
    if (args) {
      const applied = args.snapshot ? await readSnapshot(args.snapshot) : await readOnlyQuery(args['project-ref'], MIGRATIONS_QUERY)
      const report = await checkMigrations(applied, args.directory)
      await printReport(report, args.output)
      if (!report.consistent) process.exitCode = 2
    }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}

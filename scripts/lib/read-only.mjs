import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const isMain = url => Boolean(process.argv[1]) && url === pathToFileURL(resolve(process.argv[1])).href

export function argumentsFor(help, extra = {}) {
  const { values } = parseArgs({ options: {
    snapshot: { type: 'string' }, live: { type: 'boolean' },
    'project-ref': { type: 'string' }, output: { type: 'string' }, help: { type: 'boolean' }, ...extra,
  } })
  if (values.help) { console.log(help); return null }
  if (Boolean(values.snapshot) === Boolean(values.live)) throw new Error('--snapshot FILE または --live のどちらかを指定してください。')
  if (values.live && !/^[a-z0-9]{20}$/.test(values['project-ref'] || '')) throw new Error('--live には正しい --project-ref が必要です。')
  return values
}

// 管理者用。VITE_*やservice_roleを使わず、Management APIの読取専用エンドポイントだけを使う。
export async function readOnlyQuery(projectRef, query, { token = process.env.SUPABASE_ACCESS_TOKEN, fetchImpl = fetch } = {}) {
  if (!/^[a-z0-9]{20}$/.test(projectRef || '')) throw new Error('project-refが不正です。')
  if (!token) throw new Error('管理者のSUPABASE_ACCESS_TOKENを環境変数に設定してください（ブラウザには渡さないでください）。')
  const response = await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}/database/query/read-only`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!response.ok) throw new Error(`読取専用APIが失敗しました (HTTP ${response.status})。監査を中止します。`)
  const data = await response.json()
  if (!Array.isArray(data)) throw new Error('読取専用APIの応答が不正です。')
  return data
}

export async function readSnapshot(file) { return JSON.parse(await readFile(file, 'utf8')) }
export async function printReport(report, file) {
  const text = `${JSON.stringify(report, null, 2)}\n`
  if (file) await writeFile(file, text, { mode: 0o600, flag: 'wx' })
  else console.log(text.trimEnd())
}

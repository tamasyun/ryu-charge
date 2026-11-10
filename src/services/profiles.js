import { getDataClient } from '../lib/supabase'
import { demoAccount } from '../demo/account.js'

// 投稿ごとに通信せず、必要な投稿者だけをまとめて取得する。
export async function fetchAuthorNames(userIds, client = getDataClient()) {
  const names = demoAccount.isActive() ? demoAccount.authorNames() : new Map()
  const ids = [...new Set(userIds.filter(id => id && !names.has(id)))]
  for (let offset = 0; offset < ids.length; offset += 200) {
    const { data, error } = await client.from('profiles')
      .select('id, nickname').in('id', ids.slice(offset, offset + 200))
    if (error) throw error
    for (const profile of data ?? []) names.set(profile.id, profile.nickname)
  }
  return names
}

import { supabase } from '../lib/supabase'

// 投稿ごとに通信せず、必要な投稿者だけをまとめて取得する。
export async function fetchAuthorNames(userIds) {
  const ids = [...new Set(userIds.filter(Boolean))]
  const names = new Map()
  for (let offset = 0; offset < ids.length; offset += 200) {
    const { data, error } = await supabase.from('profiles')
      .select('id, nickname').in('id', ids.slice(offset, offset + 200))
    if (error) throw error
    for (const profile of data ?? []) names.set(profile.id, profile.nickname)
  }
  return names
}

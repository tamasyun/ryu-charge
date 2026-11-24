import { demoAccount } from '../demo/account.js'
import { getDataClient } from '../lib/supabase'
import { academicUnitNames, ROOM_ACCESS_ALREADY_REGISTERED } from '../utils/roomAccess.js'
import { fetchAuthorNames } from './profiles'

export async function fetchAcademicUnits(client = getDataClient()) {
  const { data, error } = await client.from('academic_units')
    .select('id, parent_id, name').order('sort_order').order('id')
  if (error) throw error
  return data ?? []
}

export async function fetchRegisteredRoomIds(roomIds) {
  const demo = demoAccount.isActive()
  const guard = demo ? demoAccount.capture() : () => {}
  const client = getDataClient()
  const registered = new Set()

  for (let offset = 0; offset < roomIds.length; offset += 100) {
    const { data, error } = await client.from('room_access_posts')
      .select('room_id').in('room_id', roomIds.slice(offset, offset + 100))
    if (error) throw error
    for (const { room_id } of data ?? []) registered.add(room_id)
  }
  guard()

  if (demo) {
    const requestedRooms = new Set(roomIds)
    for (const { room_id } of demoAccount.rows('room_access_posts')) {
      if (requestedRooms.has(room_id)) registered.add(room_id)
    }
  }
  return registered
}

export async function fetchRoomAccess(roomId) {
  const demo = demoAccount.isActive()
  const guard = demo ? demoAccount.capture() : () => {}
  const client = getDataClient()
  const { data, error } = await client.from('room_access_posts')
    .select('id, room_id, user_id, weekdays, starts_at, ends_at, room_access_audiences(unit_id)')
    .eq('room_id', roomId).order('created_at', { ascending: false })
  // マイグレーション前も既存の教室画面を表示できるようにする。
  if (error && error.code !== 'PGRST205') throw error
  guard()

  const publicPosts = (data ?? []).map(({ room_access_audiences, ...post }) => ({
    ...post, academic_unit_ids: room_access_audiences.map(({ unit_id }) => unit_id),
  }))
  const localPosts = demo
    ? demoAccount.rows('room_access_posts').filter(post => post.room_id === roomId).slice(0, 1)
    : []
  const posts = publicPosts.length ? publicPosts : localPosts
  if (!posts.length) return { posts, names: new Map() }

  const [units, authorNames] = await Promise.all([
    fetchAcademicUnits(client),
    fetchAuthorNames(posts.map(post => post.user_id), client),
  ])
  guard()
  return {
    names: academicUnitNames(units),
    posts: posts.map(post => ({ ...post, author_nickname: authorNames.get(post.user_id) })),
  }
}

export async function saveRoomAccess(record, id = null) {
  if (demoAccount.isActive()) {
    if (id) return demoAccount.changeBuildingRecord('room_access_posts', id, record)
    const guard = demoAccount.capture()
    const registered = await fetchRegisteredRoomIds([record.room_id])
    guard()
    if (registered.has(record.room_id)) throw new Error(ROOM_ACCESS_ALREADY_REGISTERED)
    return demoAccount.add('room_access_posts', [record])
  }
  const { error } = await getDataClient().rpc('save_room_access', {
    p_room_id: record.room_id,
    p_weekdays: record.weekdays,
    p_starts_at: record.starts_at,
    p_ends_at: record.ends_at,
    p_unit_ids: record.academic_unit_ids,
    p_post_id: id,
  })
  if (!id && error?.code === '23505') throw new Error(ROOM_ACCESS_ALREADY_REGISTERED)
  if (error) throw error
}

export async function deleteRoomAccess(id) {
  if (demoAccount.isActive()) return demoAccount.changeBuildingRecord('room_access_posts', id, null)

  const { data, error } = await getDataClient().from('room_access_posts').delete().eq('id', id).select('id')
  if (error) throw error
  if (data?.length !== 1 || data[0].id !== id) {
    throw new Error('教室の情報を削除できませんでした。投稿者を確認してください。')
  }
}

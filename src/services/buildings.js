import { getDataClient } from '../lib/supabase'
import { fetchAuthorNames } from './profiles'
import { demoAccount } from '../demo/account.js'

export async function createRoom(record) {
  if (demoAccount.isActive()) return demoAccount.add('rooms', [record])
  const { error } = await getDataClient().from('rooms').insert(record)
  if (error) throw error
}

export async function createOutlet(record) {
  if (demoAccount.isActive()) return demoAccount.add('outlets', [record])
  const { error } = await getDataClient().from('outlets').insert(record)
  if (error) throw error
}

export async function changeBuildingRecord(table, id, changes = null) {
  if (demoAccount.isActive()) return demoAccount.changeBuildingRecord(table, id, changes)

  const records = getDataClient().from(table)
  const request = changes ? records.update(changes) : records.delete()
  const { data, error } = await request.eq('id', id).select('id')

  if (!changes && table === 'rooms' && error?.code === '23503') {
    throw new Error('利用条件・コンセント・レビュー・写真が登録されている教室は削除できません。')
  }
  if (error) throw error
  if (data?.length !== 1 || data[0].id !== id) {
    throw new Error(table === 'rooms'
      ? '教室を変更できませんでした。編集・削除期限と投稿者を確認してください。'
      : 'コンセントを変更できませんでした。投稿者を確認してください。')
  }
}

export async function fetchBuildings() {
  const demo = demoAccount.isActive()
  const guard = demo ? demoAccount.capture() : () => {}
  const client = getDataClient()
  const { data, error } = await client
    .from('buildings')
    .select(`
      id, name, latitude, longitude,
      rooms (
        id, name, floor, location_detail, user_id, created_at,
        outlets (id, location_detail, ac_ports, user_id)
      )
    `)
    .order('id')

  if (error) throw error

  const authorNames = await fetchAuthorNames((data ?? []).flatMap(building =>
    (building.rooms ?? []).flatMap(room => [room.user_id, ...(room.outlets ?? []).map(outlet => outlet.user_id)])
  ), client)

  const buildings = (data ?? []).map(building => ({
    ...building,
    rooms: (building.rooms ?? [])
      .map(room => ({
        ...room,
        author_nickname: authorNames.get(room.user_id),
        outlets: (room.outlets ?? []).map(outlet => ({
          ...outlet, author_nickname: authorNames.get(outlet.user_id),
        })),
      }))
      .sort((a, b) =>
        (a.floor ?? 0) - (b.floor ?? 0) || a.name.localeCompare(b.name, 'ja')
      ),
  }))
  guard()
  return demo ? demoAccount.mergeBuildings(buildings) : buildings
}

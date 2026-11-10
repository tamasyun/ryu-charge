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

export async function fetchBuildings() {
  const demo = demoAccount.isActive()
  const guard = demo ? demoAccount.capture() : () => {}
  const client = getDataClient()
  const { data, error } = await client
    .from('buildings')
    .select(`
      id, name, latitude, longitude,
      rooms (
        id, name, floor, location_detail, user_id,
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

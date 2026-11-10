import { supabase } from '../lib/supabase'
import { fetchAuthorNames } from './profiles'
import { createBuildingDeleters } from './buildingDeletion.js'

export const { deleteRoom, deleteOutlet } = createBuildingDeleters(supabase)

export async function createRoom(record) {
  const { error } = await supabase.from('rooms').insert(record)
  if (error) throw error
}

export async function createOutlet(record) {
  const { error } = await supabase.from('outlets').insert(record)
  if (error) throw error
}

export async function fetchBuildings() {
  const { data, error } = await supabase
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
  ))

  return (data ?? []).map(building => ({
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
}

import { supabase } from '../lib/supabase'

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
        id, name, floor, location_detail,
        outlets (id, location_detail, ac_ports)
      )
    `)
    .order('id')

  if (error) throw error

  return (data ?? []).map(building => ({
    ...building,
    rooms: (building.rooms ?? [])
      .map(room => ({ ...room, outlets: room.outlets ?? [] }))
      .sort((a, b) =>
        (a.floor ?? 0) - (b.floor ?? 0) || a.name.localeCompare(b.name, 'ja')
      ),
  }))
}

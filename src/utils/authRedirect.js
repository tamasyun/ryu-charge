// Preserve the destination through Supabase's full-page email redirect.
export function readRedirectIntent() {
  const params = new URLSearchParams(window.location.search)
  const type = params.get('rc_intent')
  const buildingId = params.get('rc_building')
  const roomId = params.get('rc_room')
  if (!buildingId) return null
  if (type === 'add') return { type, buildingId }
  if (type === 'review' && roomId) return { type, buildingId, roomId }
  return null
}

export function clearRedirectIntent() {
  const url = new URL(window.location.href)
  url.searchParams.delete('rc_intent')
  url.searchParams.delete('rc_building')
  url.searchParams.delete('rc_room')
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
}


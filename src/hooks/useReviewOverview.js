import { useEffect, useState } from 'react'
import { fetchReviewOverview } from '../services/reviews'

export function useReviewOverview(building, refreshVersion) {
  const [overview, setOverview] = useState({ buildingId: null, status: 'idle', byRoom: {} })

  useEffect(() => {
    if (!building) return undefined

    const buildingId = building.id
    let active = true

    async function loadOverview() {
      setOverview({ buildingId, status: 'loading', byRoom: {} })
      try {
        const byRoom = await fetchReviewOverview(building.rooms.map(room => room.id))
        if (active) setOverview({ buildingId, status: 'ready', byRoom })
      } catch {
        if (active) setOverview({ buildingId, status: 'error', byRoom: {} })
      }
    }

    loadOverview()
    return () => { active = false }
  }, [building, refreshVersion])

  return overview
}

const OVERLAP_OFFSET = 20
const DIRECTIONS = [
  [1, 0], [-1, 0], [0, -1], [0, 1],
  [1, -1], [-1, -1], [1, 1], [-1, 1],
]

// 同じ座標の建物だけ少し重ねて表示し、ズーム時に位置を動かさない。
export function layoutBuildingMarkers(buildings) {
  const counts = new Map()
  return buildings.map(building => {
    const position = [building.latitude, building.longitude]
    const key = position.join(',')
    const index = counts.get(key) ?? 0
    counts.set(key, index + 1)
    if (index === 0) return { building, position, offset: [0, 0] }
    const ring = Math.ceil(index / DIRECTIONS.length)
    const [x, y] = DIRECTIONS[(index - 1) % DIRECTIONS.length]
    return { building, position, offset: [x * ring * OVERLAP_OFFSET, y * ring * OVERLAP_OFFSET] }
  })
}

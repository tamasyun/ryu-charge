import assert from 'node:assert/strict'
import { test } from 'node:test'
import { layoutBuildingMarkers } from '../src/utils/layoutBuildingMarkers.js'

const building = (id, x, y = 0) => ({ id, latitude: x, longitude: y })

test('isolated buildings keep their own coordinates and icon positions', () => {
  const buildings = [building('a', 0), building('b', 100)]
  const markers = layoutBuildingMarkers(buildings)
  assert.deepEqual(markers.map(marker => marker.offset), [[0, 0], [0, 0]])
  assert.equal(markers[0].building, buildings[0])
  assert.deepEqual(markers.map(marker => marker.position), [[0, 0], [100, 0]])
})

test('identical coordinates use compact, fixed offsets without changing source data', () => {
  const buildings = Array.from({ length: 20 }, (_, index) => Object.freeze(building(String(index), 0)))
  const markers = layoutBuildingMarkers(buildings)
  assert.equal(markers.length, buildings.length)
  assert.ok(markers.every(marker => marker.position[0] === 0 && marker.position[1] === 0))
  assert.deepEqual(markers.slice(0, 3).map(marker => marker.offset), [[0, 0], [20, 0], [-20, 0]])
  assert.equal(new Set(markers.map(marker => marker.offset.join(','))).size, buildings.length)
  assert.deepEqual(layoutBuildingMarkers(buildings), markers)
})

test('nearby buildings with distinct coordinates do not move as the map zooms', () => {
  const buildings = [building('a', 0), building('b', 0.00001)]
  assert.deepEqual(layoutBuildingMarkers(buildings).map(marker => marker.offset), [[0, 0], [0, 0]])
  assert.deepEqual(layoutBuildingMarkers([]), [])
})

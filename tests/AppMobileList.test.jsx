// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  buildings: [{ id: 'eng-1', name: '工学部1号館', rooms: [] }],
}))

vi.mock('../src/lib/supabase', () => ({
  appAuth: {
    onAuthStateChange(callback) {
      callback('INITIAL_SESSION', null)
      return { data: { subscription: { unsubscribe() {} } } }
    },
  },
}))
vi.mock('../src/services/buildings', () => ({
  fetchBuildings: async () => fixture.buildings,
  createRoom: vi.fn(),
  createOutlet: vi.fn(),
}))
vi.mock('../src/services/RoomPhotos.js', () => ({
  fetchRoomPhotos: async () => ({}),
  uploadRoomPhotos: vi.fn(),
}))
vi.mock('../src/hooks/useMediaQuery', () => ({
  useMediaQuery: query => query.includes('max-width'),
}))
vi.mock('../src/hooks/useReviewOverview', () => ({
  useReviewOverview: () => ({}),
}))
vi.mock('../src/hooks/useAccount', () => ({
  useAccount: () => ({ profile: null, status: 'ready', reloadProfile: vi.fn(), updateProfile: vi.fn() }),
}))
vi.mock('../src/components/map/CampusMap', () => ({
  default: ({ buildings, onSelectBuilding }) => (
    <button type="button" onClick={() => onSelectBuilding(buildings[0])}>地図上のピン</button>
  ),
}))
vi.mock('../src/components/buildings/BuildingDetailsPanel', () => ({
  default: ({ building, snapIndex, onSnapIndexChange, onClose, children }) => (
    <section data-testid="panel" data-peeking={!building && snapIndex === 0}>
      {!building && snapIndex === 0 ? (
        <button type="button" aria-label="建物一覧を開く" onClick={() => onSnapIndexChange(1)}>
          建物一覧
        </button>
      ) : (
        <>
          <button
            type="button"
            aria-label={building ? '詳細を閉じる' : '建物一覧を閉じる'}
            onClick={building ? onClose : () => onSnapIndexChange(0)}
          >
            閉じる
          </button>
          {children}
        </>
      )}
    </section>
  ),
}))
vi.mock('../src/components/buildings/BuildingRooms', () => ({
  default: ({ building }) => <div>{building.name}の詳細</div>,
}))
vi.mock('../src/components/auth/LoginDialog', () => ({ default: () => null }))
vi.mock('../src/components/auth/ProfileDialog', () => ({ default: () => null }))
vi.mock('../src/components/auth/AccountSettingsDialog', () => ({ default: () => null }))

afterEach(cleanup)

it('mobile begins with a compact building list and restores it after details', async () => {
  const { default: App } = await import('../src/App.jsx')
  await act(async () => render(<App />))

  expect(screen.getByTestId('panel').getAttribute('data-peeking')).toBe('false')
  expect(document.querySelector('.map-layout').classList.contains('sheet-collapsed')).toBe(false)
  expect(screen.getByRole('button', { name: '工学部1号館' })).toBeTruthy()
  expect(document.querySelector('.map-layout').style.getPropertyValue('--sheet-height')).toBe('30dvh')

  fireEvent.click(screen.getByRole('button', { name: '建物一覧を閉じる' }))
  expect(screen.getByTestId('panel').getAttribute('data-peeking')).toBe('true')

  fireEvent.click(screen.getByRole('button', { name: '建物一覧を開く' }))
  expect(document.querySelector('.map-layout').style.getPropertyValue('--sheet-height')).toBe('30dvh')
  fireEvent.click(screen.getByRole('button', { name: '工学部1号館' }))
  expect(screen.getByText('工学部1号館の詳細')).toBeTruthy()
  expect(document.querySelector('.map-layout').style.getPropertyValue('--sheet-height')).toBe('40dvh')
  expect(screen.queryByRole('button', { name: '建物一覧を開く' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '詳細を閉じる' }))
  expect(screen.getByTestId('panel').getAttribute('data-peeking')).toBe('false')
  expect(document.querySelector('.map-layout').style.getPropertyValue('--sheet-height')).toBe('30dvh')
})

it('tapping a map marker opens building details from the compact list', async () => {
  const { default: App } = await import('../src/App.jsx')
  await act(async () => render(<App />))
  fireEvent.click(screen.getByRole('button', { name: '地図上のピン' }))
  expect(screen.getByText('工学部1号館の詳細')).toBeTruthy()
  expect(document.querySelector('.map-layout').style.getPropertyValue('--sheet-height')).toBe('40dvh')
  fireEvent.click(screen.getByRole('button', { name: '詳細を閉じる' }))
  expect(screen.getByRole('button', { name: '工学部1号館' })).toBeTruthy()
})

// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  user: { id: 'user-1', email: 'student@ie.u-ryukyu.ac.jp' },
  photos: {},
  buildings: [{ id: 'building', name: '建物', rooms: [{ id: 'room', name: '教室', user_id: 'user-1', author_nickname: '旧名',
    outlets: [{ id: 'outlet', user_id: 'other', author_nickname: '他の投稿者' }] }] }],
}))
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: {
  onAuthStateChange(callback) { callback('INITIAL_SESSION', { user: fixture.user }); return { data: { subscription: { unsubscribe() {} } } } },
} } }))
vi.mock('../src/services/buildings', () => ({ fetchBuildings: async () => fixture.buildings, createRoom: vi.fn(), createOutlet: vi.fn() }))
vi.mock('../src/services/RoomPhotos.js', () => ({ fetchRoomPhotos: async () => fixture.photos, uploadRoomPhotos: vi.fn() }))
vi.mock('../src/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }))
vi.mock('../src/hooks/useReviewOverview', () => ({ useReviewOverview: () => ({}) }))
vi.mock('../src/hooks/useAccount', () => ({ useAccount: function useAccount() {
  const [profile, updateProfile] = useState({ id: 'user-1', nickname: '旧名' })
  return { profile, updateProfile, status: 'ready', reloadProfile() {} }
} }))
vi.mock('../src/components/map/CampusMap', () => ({ default: ({ onSelectBuilding, buildings }) => <button onClick={() => onSelectBuilding(buildings[0])}>建物を開く</button> }))
vi.mock('../src/components/buildings/BuildingDetailsPanel', () => ({ default: ({ children }) => <div>{children}</div> }))
vi.mock('../src/components/buildings/BuildingRooms', () => ({ default: ({ building, roomPhotos, onShowReviews }) => <div>
  <span>{building.rooms[0].author_nickname}</span><span>{building.rooms[0].outlets[0].author_nickname}</span>
  {(roomPhotos.room ?? []).map(photo => <img key={photo.id} src={photo.image_url} alt="教室の写真" />)}
  <button onClick={() => onShowReviews('room')}>レビューを見る</button>
</div> }))
vi.mock('../src/components/reviews/RoomReviews', () => ({ default: ({ authorVersion }) => <p>レビュー更新番号：{authorVersion}</p> }))
vi.mock('../src/components/auth/LoginDialog', () => ({ default: () => null }))
vi.mock('../src/components/auth/ProfileDialog', () => ({ default: () => null }))
vi.mock('../src/components/auth/AccountSettingsDialog', () => ({ default: ({ open, onSaved, onClose, onDeleted }) => open && <div role="dialog" aria-label="アカウント設定">
  <button onClick={() => { onSaved({ id: 'user-1', nickname: '更新名' }); onClose() }}>テスト用に名前を保存</button>
  <button onClick={() => { fixture.photos = {}; onDeleted() }}>テスト用にアカウントを削除</button>
</div> }))

beforeEach(() => { fixture.photos = { room: [{ id: 'photo', image_url: '/own.webp' }] } })
afterEach(cleanup)

it('username opens settings; saving updates header and equipment authors and refreshes reviews', async () => {
  const { default: App } = await import('../src/App.jsx')
  await act(async () => render(<App />))
  fireEvent.click(screen.getByRole('button', { name: '建物を開く' }))
  fireEvent.click(screen.getByRole('button', { name: '旧名のアカウント設定' }))
  expect(screen.getByRole('dialog', { name: 'アカウント設定' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'テスト用に名前を保存' }))
  expect(screen.getByRole('button', { name: '更新名のアカウント設定' })).toBeTruthy()
  expect(screen.getByText('更新名', { selector: 'span' })).toBeTruthy()
  expect(screen.getByText('他の投稿者')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'レビューを見る' }))
  expect(screen.getByText('レビュー更新番号：1')).toBeTruthy()
})

it('account deletion refreshes room photos even when the retained room IDs do not change', async () => {
  const { default: App } = await import('../src/App.jsx')
  await act(async () => render(<App />))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '建物を開く' })))
  expect(screen.getByAltText('教室の写真')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '旧名のアカウント設定' }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'テスト用にアカウントを削除' })))
  expect(screen.queryByAltText('教室の写真')).toBeNull()
  expect(screen.getByRole('button', { name: 'ログイン', exact: true })).toBeTruthy()
  expect(screen.getByText('他の投稿者')).toBeTruthy()
})

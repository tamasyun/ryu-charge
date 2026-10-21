import { useEffect, useRef, useState } from 'react'
import './App.css'
import { supabase } from './lib/supabase'
import { createRoom, createOutlet, fetchBuildings } from './services/buildings'
import { isUniversityEmail } from './utils/universityEmail'
import { readRedirectIntent, clearRedirectIntent } from './utils/authRedirect'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useReviewOverview } from './hooks/useReviewOverview'
import AddDataForm from './components/buildings/AddDataForm'
import BuildingRooms from './components/buildings/BuildingRooms'
import BuildingDetailsPanel from './components/buildings/BuildingDetailsPanel'
import CampusMap from './components/map/CampusMap'
import RoomReviews from './components/reviews/RoomReviews'
import LoginDialog from './components/auth/LoginDialog'

// 小さい画面でもヘッダーと追加ボタンを同時に表示できる高さを確保する。
const PORTRAIT_SNAP_POINTS = ['200px', 0.5, 0.85]
const LANDSCAPE_SNAP_POINTS = ['200px', 0.7, 0.9]

function App() {
  const isMobile = useMediaQuery('(max-width: 760px)')
  const isLandscape = useMediaQuery('(orientation: landscape)')
  const [sheetSnapIndex, setSheetSnapIndex] = useState(1)
  const [buildings, setBuildings] = useState([])
  const [selectedBuildingId, setSelectedBuildingId] = useState(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [formMode, setFormMode] = useState('outlet')
  const [detailView, setDetailView] = useState('details')
  const [selectedRoomId, setSelectedRoomId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const loginReturnFocusRef = useRef(null)
  const [signingOut, setSigningOut] = useState(false)
  const [loginIntent, setLoginIntent] = useState(null)
  const [redirectIntent, setRedirectIntent] = useState(readRedirectIntent)
  const [reviewOverviewVersion, setReviewOverviewVersion] = useState(0)

  const canPost = authReady && isUniversityEmail(user?.email)
  const selectedBuilding =
    buildings.find(building => building.id === selectedBuildingId) ?? null
  const selectedRoom =
    selectedBuilding?.rooms.find(room => room.id === selectedRoomId) ?? null
  const reviewOverview = useReviewOverview(selectedBuilding, reviewOverviewVersion)
  const sheetSnapPoints = isLandscape ? LANDSCAPE_SNAP_POINTS : PORTRAIT_SNAP_POINTS

  function openLogin(intent = null) {
    loginReturnFocusRef.current = document.activeElement
    setLoginIntent(intent)
    setIsLoginOpen(true)
  }

  function closeLogin() {
    setIsLoginOpen(false)
  }

  function restoreLoginFocus() {
    const target = loginReturnFocusRef.current?.isConnected
      ? loginReturnFocusRef.current
      : document.querySelector('.auth-button')
    target?.focus()
  }

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null)
      setAuthReady(true)
      if (event === 'SIGNED_IN') setIsLoginOpen(false)
      if (event === 'SIGNED_OUT') setIsFormOpen(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    setErrorMessage('')
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      setIsLoginOpen(false)
      setLoginIntent(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'ログアウトに失敗しました。')
    } finally {
      setSigningOut(false)
    }
  }

  async function loadBuildings() {
    setBuildings(await fetchBuildings())
  }

  useEffect(() => {
    let active = true
    async function initialize() {
      try {
        const buildings = await fetchBuildings()
        if (active) setBuildings(buildings)
      } catch (error) {
        if (active) setErrorMessage(error instanceof Error ? error.message : '建物を取得できませんでした。')
      }
    }
    initialize()
    return () => { active = false }
  }, [])

  // 別タブで開く認証リンクでも、URLから操作を再開する。
  useEffect(() => {
    const intent = redirectIntent ?? loginIntent
    if (!canPost || !intent || buildings.length === 0) return

    // 認証と建物データが揃ってから、元の画面を復元する。
    const frame = requestAnimationFrame(() => {
      const building = buildings.find(b => b.id === intent.buildingId)
      if (building) {
        setSelectedBuildingId(building.id)
        setFormMode(building.rooms.length ? 'outlet' : 'room')
        setErrorMessage('')
        if (intent.type === 'review' && building.rooms.some(r => r.id === intent.roomId)) {
          setSelectedRoomId(intent.roomId)
          setDetailView('write')
          setIsFormOpen(false)
          setSheetSnapIndex(2)
        } else if (intent.type === 'add') {
          setSelectedRoomId(null)
          setDetailView('details')
          setIsFormOpen(true)
          setSheetSnapIndex(2)
        }
      }

      if (redirectIntent) clearRedirectIntent()
      setRedirectIntent(null)
      setLoginIntent(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [canPost, buildings, redirectIntent, loginIntent])

  function selectBuilding(building) {
    setSelectedBuildingId(building.id)
    setDetailView('details')
    setSelectedRoomId(null)
    setFormMode(building.rooms.length ? 'outlet' : 'room')
    setIsFormOpen(false)
    setErrorMessage('')
    setSheetSnapIndex(1)
  }

  function closeDetails() {
    setSelectedBuildingId(null)
    setIsFormOpen(false)
    setDetailView('details')
    setSelectedRoomId(null)
  }

  async function handleAdd(event) {
    event.preventDefault()
    if (!selectedBuilding || saving) return
    if (!canPost) {
      setIsFormOpen(false)
      openLogin({ type: 'add', buildingId: selectedBuilding.id })
      return
    }

    const form = new FormData(event.currentTarget)
    const text = name => String(form.get(name) ?? '').trim()
    let createRecord
    let record

    if (formMode === 'room') {
      const floorText = text('floor')
      const floor = floorText === '' ? null : Number(floorText)
      if (!text('name') ||
          text('name').length > 80 ||
          text('location_detail').length > 300 ||
          (floor !== null &&
            (!Number.isInteger(floor) || floor < -10 || floor > 40))) {
        setErrorMessage('教室の入力内容を確認してください。')
        return
      }
      createRecord = createRoom
      record = {
        id: `room-${crypto.randomUUID()}`,
        building_id: selectedBuilding.id,
        name: text('name'),
        floor,
        location_detail: text('location_detail'),
      }
    } else {
      const roomId = text('room_id')
      const portsText = text('ac_ports')
      const ports = portsText === '' ? null : Number(portsText)
      if (!selectedBuilding.rooms.some(r => r.id === roomId) ||
          !text('location_detail') ||
          text('location_detail').length > 300 ||
          (ports !== null &&
            (!Number.isInteger(ports) || ports < 0 || ports > 50))) {
        setErrorMessage('コンセントの入力内容を確認してください。')
        return
      }
      createRecord = createOutlet
      record = {
        id: `outlet-${crypto.randomUUID()}`,
        room_id: roomId,
        location_detail: text('location_detail'),
        ac_ports: ports,
      }
    }

    setSaving(true)
    setErrorMessage('')
    try {
      await createRecord(record)
      await loadBuildings()
      setIsFormOpen(false)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '追加できませんでした。')
    } finally {
      setSaving(false)
    }
  }

  function renderDetailBody() {
    return (
      <>
        {detailView !== 'details' && selectedRoom ? (
          <RoomReviews
            key={selectedRoom.id}
            roomId={selectedRoom.id}
            roomName={selectedRoom.name}
            mode={detailView}
            canPost={canPost}
            authReady={authReady}
            isLoggedIn={Boolean(user)}
            onWrite={() => {
              setDetailView('write')
              setSheetSnapIndex(2)
            }}
            onLogin={() => {
              if (user && !canPost) {
                setErrorMessage('大学メール以外のアカウントでは投稿できません。ログアウトしてください。')
              } else {
                openLogin({ type: 'review', buildingId: selectedBuilding.id, roomId: selectedRoom.id })
              }
            }}
            onBack={() => {
              setDetailView('details')
              setSelectedRoomId(null)
            }}
            onSubmitted={() => {
              setReviewOverviewVersion(version => version + 1)
              setDetailView('reviews')
            }}
          />
        ) : isFormOpen && canPost ? (
          <AddDataForm
            building={selectedBuilding}
            formMode={formMode}
            onFormModeChange={setFormMode}
            onSubmit={handleAdd}
            saving={saving}
          />
        ) : (
          <BuildingRooms
            building={selectedBuilding}
            reviewOverview={reviewOverview}
            onShowReviews={roomId => {
              setSelectedRoomId(roomId)
              setIsFormOpen(false)
              setDetailView('reviews')
              setSheetSnapIndex(2)
            }}
          />
        )}
      </>
    )
  }

  function renderDetailFooter() {
    return detailView === 'details' && authReady && user && (
      <div className="detail-footer">
        <button
          type="button"
          className="add-button"
          onClick={() => {
            setErrorMessage('')
            if (!canPost) {
              setErrorMessage('大学メール以外のアカウントでは投稿できません。ログアウトしてください。')
              return
            }
            if (!isFormOpen) setSheetSnapIndex(2)
            setIsFormOpen(open => !open)
          }}
        >
          {!canPost ? '追加できません' : isFormOpen ? 'キャンセル' : '＋ 追加'}
        </button>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>琉CHARGE</h1>
        <div className="auth-header">
          {!authReady ? (
            <span className="auth-status">確認中...</span>
          ) : user ? (
            <>
              <span className="auth-email" title={user.email}>{user.email}</span>
              {!canPost && <span className="auth-restricted">大学メール以外は投稿不可</span>}
              <button type="button" className="auth-button" disabled={signingOut} onClick={handleSignOut}>
                {signingOut ? '処理中...' : 'ログアウト'}
              </button>
            </>
          ) : (
            <button type="button" className="auth-button" onClick={() => openLogin()}>
              ログイン
            </button>
          )}
        </div>
      </header>

      <LoginDialog
        open={isLoginOpen && !user}
        onClose={closeLogin}
        onAfterClose={restoreLoginFocus}
        returnFocusRef={loginReturnFocusRef}
      />

      {errorMessage && <p role="alert" className="app-error">{errorMessage}</p>}

      <main className={`map-layout ${selectedBuilding ? 'with-details' : ''}`}>
        <CampusMap
          buildings={buildings}
          selectedBuilding={selectedBuilding}
          isMobile={isMobile}
          onSelectBuilding={selectBuilding}
        />

        {selectedBuilding && (
          <BuildingDetailsPanel
            building={selectedBuilding}
            isMobile={isMobile}
            snapPoints={sheetSnapPoints}
            snapIndex={sheetSnapIndex}
            onSnapIndexChange={setSheetSnapIndex}
            onClose={closeDetails}
            footer={renderDetailFooter()}
          >
            {renderDetailBody()}
          </BuildingDetailsPanel>
        )}
      </main>
    </div>
  )
}

export default App

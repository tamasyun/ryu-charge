import { useEffect, useRef, useState } from 'react'
import './App.css'
import { supabase } from './lib/supabase'
import { createRoom, createOutlet, deleteRoom, deleteOutlet, fetchBuildings } from './services/buildings'
import { fetchRoomPhotos, uploadRoomPhotos } from './services/RoomPhotos.js'
import { isUniversityEmail } from './utils/universityEmail'
import { readRedirectIntent, clearRedirectIntent } from './utils/authRedirect'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useReviewOverview } from './hooks/useReviewOverview'
import { useAccount } from './hooks/useAccount'
import AddDataForm from './components/buildings/AddDataForm'
import BuildingRooms from './components/buildings/BuildingRooms'
import BuildingDetailsPanel from './components/buildings/BuildingDetailsPanel'
import CampusMap from './components/map/CampusMap'
import RoomReviews from './components/reviews/RoomReviews'
import LoginDialog from './components/auth/LoginDialog'
import ProfileDialog from './components/auth/ProfileDialog'

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
  const [authMode, setAuthMode] = useState('login')
  const [dismissedProfileUserId, setDismissedProfileUserId] = useState(null)
  const loginReturnFocusRef = useRef(null)
  const [signingOut, setSigningOut] = useState(false)
  const [loginIntent, setLoginIntent] = useState(null)
  const [redirectIntent, setRedirectIntent] = useState(readRedirectIntent)
  const [reviewOverviewVersion, setReviewOverviewVersion] = useState(0)
  const [roomPhotos, setRoomPhotos] = useState({})
  const [uploadingRoomId, setUploadingRoomId] = useState(null)
  const [photoProgress, setPhotoProgress] = useState(null)
  const [roomPhotosVersion, setRoomPhotosVersion] = useState(0)
  const photoUploadLock = useRef(false)
  const deletionLock = useRef(false)
  const [deletingItem, setDeletingItem] = useState(null)

  const { profile, status: profileStatus, reloadProfile } = useAccount(user)
  const hasUniversityEmail = isUniversityEmail(user?.email)
  const canPost = authReady && hasUniversityEmail && profileStatus === 'ready'
  const needsNickname = hasUniversityEmail && profileStatus === 'missing'
  const selectedBuilding =
    buildings.find(building => building.id === selectedBuildingId) ?? null
  const selectedRoom =
    selectedBuilding?.rooms.find(room => room.id === selectedRoomId) ?? null
  const reviewOverview = useReviewOverview(selectedBuilding, reviewOverviewVersion)
  const sheetSnapPoints = isLandscape ? LANDSCAPE_SNAP_POINTS : PORTRAIT_SNAP_POINTS

  function openLogin(intent = null, mode = 'login') {
    loginReturnFocusRef.current = document.activeElement
    setLoginIntent(intent)
    if (user) {
      setDismissedProfileUserId(null)
      if (profileStatus === 'error') reloadProfile()
      return
    }
    setAuthMode(mode)
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

  // 選択中の建物に属する教室の写真URLを取得する。
  const selectedRoomIdsKey = selectedBuilding?.rooms.map(room => room.id).join('|') ?? ''
  useEffect(() => {
    let active = true
    const roomIds = selectedRoomIdsKey ? selectedRoomIdsKey.split('|') : []
    fetchRoomPhotos(roomIds)
      .then(photosByRoom => {
        if (active) setRoomPhotos(photosByRoom)
      })
      .catch(error => {
        if (active) {
          setErrorMessage(error instanceof Error ? error.message : '教室の写真を取得できませんでした。')
        }
      })

    return () => { active = false }
  }, [selectedBuildingId, selectedRoomIdsKey, roomPhotosVersion])

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

  async function handleAddRoomPhotos(roomId, files) {
    if (!canPost) {
      setErrorMessage('写真を追加するには琉球大学の大学メールでログインしてください。')
      return
    }
    if (!selectedBuilding?.rooms.some(room => room.id === roomId)) {
      setErrorMessage('教室を確認できませんでした。画面を再読み込みしてください。')
      return
    }
    if (photoUploadLock.current || deletionLock.current) return
    photoUploadLock.current = true

    setUploadingRoomId(roomId)
    setErrorMessage('')
    try {
      const uploadedPhotos = await uploadRoomPhotos(roomId, files, setPhotoProgress)
      setRoomPhotosVersion(version => version + 1)
      setRoomPhotos(current => ({
        ...current,
        [roomId]: [...(current[roomId] ?? []), ...uploadedPhotos],
      }))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '写真を追加できませんでした。')
    } finally {
      photoUploadLock.current = false
      setPhotoProgress(null)
      setUploadingRoomId(null)
    }
  }

  async function handleDelete(type, item) {
    if (deletionLock.current || photoUploadLock.current || !selectedBuilding) return
    if (!user || item.user_id !== user.id) {
      setErrorMessage('自分が追加したデータだけ削除できます。ログイン状態を確認してください。')
      return
    }
    const message = type === 'room'
      ? `「${item.name}」を削除しますか？\nこの教室に自分が追加したコンセント・写真・レビューも削除されます。元には戻せません。\nほかの人の投稿や投稿者不明のデータがある場合は削除できません。`
      : `「${item.location_detail}」のコンセントを削除しますか？\n元には戻せません。`
    if (!window.confirm(message)) return

    const buildingId = selectedBuilding.id
    deletionLock.current = true
    setDeletingItem({ type, id: item.id })
    setErrorMessage('')
    try {
      const result = await (type === 'room' ? deleteRoom(item.id) : deleteOutlet(item.id))
      // 確認できた削除だけを一覧へ反映する。再取得の失敗で削除済みデータを残さない。
      setBuildings(current => current.map(building => building.id !== buildingId ? building : {
        ...building,
        rooms: type === 'room'
          ? building.rooms.filter(room => room.id !== item.id)
          : building.rooms.map(room => ({ ...room, outlets: room.outlets.filter(outlet => outlet.id !== item.id) })),
      }))
      if (type === 'room') {
        setReviewOverviewVersion(version => version + 1)
        setRoomPhotosVersion(version => version + 1)
      }
      if (result?.imageCleanupPending) {
        setErrorMessage('教室と関連する投稿を削除しました。写真ファイルの回収は確認待ちです。')
      }
    } catch (error) {
      setErrorMessage(error?.message || '削除できませんでした。通信状態とログイン状態を確認してください。')
    } finally {
      deletionLock.current = false
      setDeletingItem(null)
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
            authReady={authReady && profileStatus !== 'loading'}
            isLoggedIn={Boolean(user)}
            onWrite={() => {
              setDetailView('write')
              setSheetSnapIndex(2)
            }}
            onLogin={() => {
              if (user && !hasUniversityEmail) {
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
            roomPhotos={roomPhotos}
            canPost={canPost}
            currentUserId={authReady ? user?.id : null}
            deletingItem={deletingItem}
            uploadingRoomId={uploadingRoomId}
            photoProgress={photoProgress}
            onAddPhotos={handleAddRoomPhotos}
            onDeleteRoom={room => handleDelete('room', room)}
            onDeleteOutlet={outlet => handleDelete('outlet', outlet)}
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

  function handleToggleAdd() {
    setErrorMessage('')
    if (!canPost) {
      if (!hasUniversityEmail) {
        setErrorMessage('大学メール以外のアカウントでは投稿できません。ログアウトしてください。')
      } else {
        openLogin({ type: 'add', buildingId: selectedBuilding.id })
      }
      return
    }
    if (!isFormOpen) {
      setSheetSnapIndex(2)
      if (!selectedBuilding.rooms.length) setFormMode('room')
    }
    setIsFormOpen(open => !open)
  }

  function renderDetailFooter() {
    return detailView === 'details' && authReady && user && (
      <div className="detail-footer">
        <button
          type="button"
          className="add-button"
          disabled={profileStatus === 'loading' || deletingItem != null}
          onClick={handleToggleAdd}
        >
          {!hasUniversityEmail ? '追加できません' : profileStatus === 'loading' ? '確認中...' : needsNickname ? 'ニックネームを設定' : isFormOpen ? 'キャンセル' : '＋ 追加'}
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
              {profileStatus === 'ready' ? (
                <span className="auth-nickname" title={profile.nickname}>{profile.nickname}</span>
              ) : needsNickname ? (
                <button type="button" className="auth-button" aria-label="ニックネームを設定" onClick={() => setDismissedProfileUserId(null)}>
                  名前を設定
                </button>
              ) : profileStatus === 'error' ? (
                <button type="button" className="auth-button" onClick={reloadProfile}>再試行</button>
              ) : <span className="auth-status">{profileStatus === 'loading' ? '確認中...' : 'ログイン中'}</span>}
              {!hasUniversityEmail && <span className="auth-restricted">大学メール以外は投稿不可</span>}
              <button type="button" className="auth-button" disabled={signingOut} onClick={handleSignOut}>
                {signingOut ? '処理中...' : 'ログアウト'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="auth-button" onClick={() => openLogin()}>ログイン</button>
              <button type="button" className="auth-button" onClick={() => openLogin(null, 'signup')}>新規登録</button>
            </>
          )}
        </div>
      </header>

      <LoginDialog
        key={authMode}
        open={isLoginOpen && !user}
        initialMode={authMode}
        onClose={closeLogin}
        onAfterClose={restoreLoginFocus}
        returnFocusRef={loginReturnFocusRef}
      />

      {user && (
        <ProfileDialog
          key={user.id}
          open={needsNickname && dismissedProfileUserId !== user.id}
          user={user}
          onClose={() => setDismissedProfileUserId(user.id)}
          onSaved={reloadProfile}
        />
      )}

      {user && profileStatus === 'error' && (
        <p role="alert" className="app-error">プロフィールを取得・保存できませんでした。「再試行」を押してください。</p>
      )}

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

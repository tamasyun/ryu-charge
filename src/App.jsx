import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { appAuth } from './lib/supabase'
import { demoAccount } from './demo/account.js'
import { changeBuildingRecord, createRoom, createOutlet, fetchBuildings } from './services/buildings'
import { fetchRoomPhotos, uploadRoomPhotos } from './services/RoomPhotos.js'
import { isUniversityEmail } from './utils/universityEmail'
import { readRedirectIntent, clearRedirectIntent } from './utils/authRedirect'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useReviewOverview } from './hooks/useReviewOverview'
import { useAccount } from './hooks/useAccount'
import BuildingDataForm from './components/buildings/BuildingDataForm'
import BuildingRooms from './components/buildings/BuildingRooms'
import BuildingDetailsPanel from './components/buildings/BuildingDetailsPanel'
import CampusMap from './components/map/CampusMap'
import ReviewForm from './components/reviews/ReviewForm'
import RoomReviews from './components/reviews/RoomReviews'
import LoginDialog from './components/auth/LoginDialog'
import ProfileDialog from './components/auth/ProfileDialog'
import AccountSettingsDialog from './components/auth/AccountSettingsDialog'

const SHEET_SNAP_POINTS = {
  list: {
    portrait: ['56px', 0.3, 0.85],
    landscape: ['56px', 0.4, 0.8],
  },
  details: {
    portrait: ['56px', 0.4, 0.85],
    landscape: ['56px', 0.5, 0.8],
  },
}

function App() {
  const isMobile = useMediaQuery('(max-width: 760px)')
  const isLandscape = useMediaQuery('(orientation: landscape)')
  const [sheetSnapIndex, setSheetSnapIndex] = useState(1)
  const [overviewRequest, setOverviewRequest] = useState(0)
  const [buildings, setBuildings] = useState([])
  const [selectedBuildingId, setSelectedBuildingId] = useState(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [formMode, setFormMode] = useState('outlet')
  const [selectedRoomId, setSelectedRoomId] = useState(null)
  const [reviewEditor, setReviewEditor] = useState(null)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  // PC版パネルの開閉状態
  const [isDesktopOpen, setIsDesktopOpen] = useState(true)

  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [dismissedProfileUserId, setDismissedProfileUserId] = useState(null)
  const loginReturnFocusRef = useRef(null)
  const [signingOut, setSigningOut] = useState(false)
  const [loginIntent, setLoginIntent] = useState(null)
  const [redirectIntent, setRedirectIntent] = useState(readRedirectIntent)
  const [reviewVersion, setReviewVersion] = useState(0)
  const [isAccountOpen, setIsAccountOpen] = useState(false)
  const [accountNotice, setAccountNotice] = useState('')
  const accountReturnFocusRef = useRef(null)
  const [roomPhotos, setRoomPhotos] = useState({})
  const [uploadingRoomId, setUploadingRoomId] = useState(null)
  const [photoProgress, setPhotoProgress] = useState(null)
  const [roomPhotosVersion, setRoomPhotosVersion] = useState(0)
  const photoUploadLock = useRef(false)
  const addDataLock = useRef(false)
  const accountIdentityRef = useRef(null)
  const buildingRequestRef = useRef(0)

  const { profile, status: profileStatus, reloadProfile, updateProfile } = useAccount(user)
  const isDemo = demoAccount.isUser(user)
  const hasUniversityEmail = isUniversityEmail(user?.email) || isDemo
  const canPost = authReady && hasUniversityEmail && profileStatus === 'ready'
  const needsNickname = hasUniversityEmail && profileStatus === 'missing'
  const selectedBuilding =
    buildings.find(building => building.id === selectedBuildingId) ?? null
  const selectedRoom =
    selectedBuilding?.rooms.find(room => room.id === selectedRoomId) ?? null
  const isReviewFormOpen = canPost && reviewEditor != null && selectedRoom?.id === reviewEditor.roomId
  const reviewOverview = useReviewOverview(selectedBuilding, reviewVersion)
  const sheetSnapPoints = SHEET_SNAP_POINTS[selectedBuilding ? 'details' : 'list'][isLandscape ? 'landscape' : 'portrait']
  const sheetSnap = sheetSnapPoints[sheetSnapIndex]
  const sheetHeight = typeof sheetSnap === 'number' ? `${sheetSnap * 100}dvh` : sheetSnap

  function openLogin(intent = null, mode = 'login') {
    setAccountNotice('')
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
    const { data: { subscription } } = appAuth.onAuthStateChange((event, session) => {
      const nextId = session?.user?.id ?? null
      if (accountIdentityRef.current !== nextId) {
        accountIdentityRef.current = nextId
        setBuildings([])
        setRoomPhotos({})
        setReviewEditor(null)
        setIsFormOpen(false)
        setIsAccountOpen(false)
        setReviewVersion(value => value + 1)
        setRoomPhotosVersion(value => value + 1)
      }
      setUser(session?.user ?? null)
      setAuthReady(true)
      if (event === 'SIGNED_IN') setIsLoginOpen(false)
      if (event === 'SIGNED_OUT') {
        setIsFormOpen(false)
        setIsAccountOpen(false)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  function handleNicknameSaved(updated) {
    updateProfile(updated)
    setBuildings(items => items.map(building => ({
      ...building,
      rooms: building.rooms.map(room => ({
        ...room,
        author_nickname: room.user_id === updated.id ? updated.nickname : room.author_nickname,
        outlets: room.outlets.map(outlet => ({
          ...outlet, author_nickname: outlet.user_id === updated.id ? updated.nickname : outlet.author_nickname,
        })),
      })),
    })))
    setReviewVersion(value => value + 1)
  }

  const loadBuildings = useCallback(async (isActive = () => true) => {
    const identity = accountIdentityRef.current
    const request = ++buildingRequestRef.current
    const data = await fetchBuildings()
    if (identity === accountIdentityRef.current && request === buildingRequestRef.current && isActive()) {
      setBuildings(data)
    }
  }, [])

  function handleAccountDeleted(confirmed = true) {
    setUser(null)
    setIsAccountOpen(false)
    setIsFormOpen(false)
    setLoginIntent(null)
    setReviewEditor(null)
    setAccountNotice(confirmed ? 'アカウントを削除しました。' : 'セッションが無効になりました。再ログインして削除状態を確認してください。')
    setReviewVersion(value => value + 1)
    setRoomPhotosVersion(value => value + 1)
    loadBuildings().catch(() => setErrorMessage('設備情報を再取得できませんでした。ページを再読み込みしてください。'))
  }

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    setErrorMessage('')
    try {
      const { error } = await appAuth.signOut()
      if (error) throw error
      setIsLoginOpen(false)
      setLoginIntent(null)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'ログアウトに失敗しました。')
    } finally {
      setSigningOut(false)
    }
  }

  useEffect(() => {
    let active = true
    async function initialize() {
      try {
        await loadBuildings(() => active)
      } catch (error) {
        if (active) setErrorMessage(error instanceof Error ? error.message : '建物を取得できませんでした。')
      }
    }
    initialize()
    function refresh() {
      if (document.visibilityState === 'hidden') return
      initialize()
      setReviewVersion(value => value + 1)
      setRoomPhotosVersion(value => value + 1)
    }
    const timer = isDemo ? window.setInterval(refresh, 60000) : null
    if (isDemo) window.addEventListener('focus', refresh)
    return () => {
      active = false
      if (timer) window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [user?.id, isDemo, loadBuildings])

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
  }, [selectedBuildingId, selectedRoomIdsKey, roomPhotosVersion, user?.id])

  useEffect(() => {
    const intent = redirectIntent ?? loginIntent
    if (!canPost || !intent || buildings.length === 0) return

    const frame = requestAnimationFrame(() => {
      const building = buildings.find(b => b.id === intent.buildingId)
      if (building) {
        setSelectedBuildingId(building.id)
        setFormMode(building.rooms.length ? 'outlet' : 'room')
        setErrorMessage('')
        setIsDesktopOpen(true)
        if (intent.type === 'review' && building.rooms.some(r => r.id === intent.roomId)) {
          setSelectedRoomId(intent.roomId)
          setReviewEditor({ roomId: intent.roomId, review: null })
          setIsFormOpen(false)
          setSheetSnapIndex(2)
        } else if (intent.type === 'add') {
          setSelectedRoomId(null)
          setReviewEditor(null)
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

  // ★ マップ上のピンを押したときの処理：直接その建物の教室情報を開く
  function selectBuilding(building) {
    setSelectedBuildingId(building.id)
    setReviewEditor(null)
    setSelectedRoomId(null)
    setFormMode(building.rooms.length ? 'outlet' : 'room')
    setIsFormOpen(false)
    setErrorMessage('')
    setSheetSnapIndex(1)
    setIsDesktopOpen(true) // パネルを確実に開いて表示
  }

  function closeDetails() {
    setSelectedBuildingId(null)
    setIsFormOpen(false)
    setReviewEditor(null)
    setSelectedRoomId(null)
    setSheetSnapIndex(1)
  }

  function showOverview() {
    closeDetails()
    setErrorMessage('')
    setOverviewRequest(request => request + 1)
    setIsDesktopOpen(true)
  }

  // ★ 「☰ 一覧を表示」ボタンを押したときの処理：前回の状態をクリアして必ず建物一覧を開く
  function handleOpenBuildingList() {
    setSelectedBuildingId(null)
    setSelectedRoomId(null)
    setReviewEditor(null)
    setIsFormOpen(false)
    setErrorMessage('')
    setSheetSnapIndex(1)
    setIsDesktopOpen(true)
  }

  async function refreshBuildingData() {
    try {
      await loadBuildings()
    } catch {
      setErrorMessage('変更を保存しました。最新の情報を表示するにはページを再読み込みしてください。')
    }
  }

  async function handleChangeBuildingRecord(table, id, changes) {
    await changeBuildingRecord(table, id, changes)
    await refreshBuildingData()
  }

  async function handleAdd(fields) {
    if (!selectedBuilding || addDataLock.current) return
    if (!canPost) {
      setIsFormOpen(false)
      openLogin({ type: 'add', buildingId: selectedBuilding.id })
      return
    }

    addDataLock.current = true
    setSaving(true)
    setErrorMessage('')
    try {
      const record = { id: `${formMode}-${crypto.randomUUID()}`, ...fields }
      if (formMode === 'room') await createRoom({ ...record, building_id: selectedBuilding.id })
      else await createOutlet(record)
      await refreshBuildingData()
      setIsFormOpen(false)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '追加できませんでした。')
    } finally {
      addDataLock.current = false
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
    if (photoUploadLock.current) return
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

  function handleReviewLogin() {
    if (user && !hasUniversityEmail) {
      setErrorMessage('大学メール以外のアカウントでは投稿できません。ログアウトしてください。')
    } else if (selectedBuilding && selectedRoom) {
      openLogin({ type: 'review', buildingId: selectedBuilding.id, roomId: selectedRoom.id })
    }
  }

  function handleReviewsChanged() {
    setReviewVersion(version => version + 1)
  }

  function openReviewEditor(review = null) {
    setErrorMessage('')
    setReviewEditor({ roomId: selectedRoom.id, review })
    setSheetSnapIndex(2)
  }

  function renderDetailBody() {
    if (isReviewFormOpen) {
      return (
        <ReviewForm
          key={reviewEditor.review?.id ?? selectedRoom.id}
          roomId={selectedRoom.id}
          roomName={selectedRoom.name}
          review={reviewEditor.review}
          canPost={canPost}
          onCancel={() => setReviewEditor(null)}
          onSubmitted={() => {
            handleReviewsChanged()
            setReviewEditor(current => current === reviewEditor ? null : current)
          }}
        />
      )
    }

    if (isFormOpen && canPost) {
      return (
        <BuildingDataForm
          building={selectedBuilding}
          formMode={formMode}
          onFormModeChange={setFormMode}
          onSubmit={handleAdd}
          saving={saving}
        />
      )
    }

    return (
      <BuildingRooms
        building={selectedBuilding}
        selectedRoom={selectedRoom}
        onSelectRoom={roomId => {
          setSelectedRoomId(roomId)
          setReviewEditor(null)
        }}
        reviewOverview={reviewOverview}
        roomPhotos={roomPhotos}
        canPost={canPost}
        userId={user?.id}
        onChangeRecord={handleChangeBuildingRecord}
        onStartEdit={() => setSheetSnapIndex(2)}
        uploadingRoomId={uploadingRoomId}
        photoProgress={photoProgress}
        onAddPhotos={handleAddRoomPhotos}
        onBackToBuildings={closeDetails}
        reviews={selectedRoom && (
          <RoomReviews
            reviewVersion={reviewVersion}
            key={`${user?.id ?? 'guest'}-${selectedRoom.id}`}
            roomId={selectedRoom.id}
            canPost={canPost}
            authReady={authReady && profileStatus !== 'loading'}
            isLoggedIn={Boolean(user)}
            onWrite={() => openReviewEditor()}
            onEdit={openReviewEditor}
            onLogin={handleReviewLogin}
            onDeleted={handleReviewsChanged}
          />
        )}
      />
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
      if (!selectedBuilding.rooms.length) setFormMode('room')
      setSheetSnapIndex(2)
    }
    setIsFormOpen(open => !open)
  }

  function renderDetailFooter() {
    return !isReviewFormOpen && authReady && user && (
      <div className="detail-footer">
        <button
          type="button"
          className="add-button"
          disabled={saving || profileStatus === 'loading'}
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
        <h1>
          <button type="button" className="brand-button" aria-label="琉CHARGE 地図全体に戻る" onClick={showOverview}>
            <svg viewBox="0 0 24 26" aria-hidden="true"><path d="M14.8 1 4 14.7h7.1L8.9 25 20 11.1h-7.1Z" /></svg>
            琉CHARGE
          </button>
        </h1>
        <div className="auth-header">
          {!authReady ? (
            <span className="auth-status">確認中...</span>
          ) : user ? (
            <>
              {profileStatus === 'ready' ? (
                <button type="button" className="auth-nickname auth-nickname-button" title={profile.nickname}
                  aria-label={`${profile.nickname}のアカウント設定`} onClick={event => {
                    accountReturnFocusRef.current = event.currentTarget
                    setIsAccountOpen(true)
                  }}>{profile.nickname}</button>
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
        onPasskeyNotice={setAccountNotice}
      />

      {user && profile && <AccountSettingsDialog key={`settings-${user.id}`} open={isAccountOpen}
        user={user} profile={profile} returnFocusRef={accountReturnFocusRef}
        onClose={() => setIsAccountOpen(false)} onSaved={handleNicknameSaved} onDeleted={handleAccountDeleted} />}

      {user && (
        <ProfileDialog
          key={user.id}
          open={needsNickname && dismissedProfileUserId !== user.id}
          user={user}
          onClose={() => setDismissedProfileUserId(user.id)}
          onSaved={reloadProfile}
        />
      )}

      <div className="app-messages">
        {accountNotice && <p role="status" className="app-account-notice">{accountNotice}</p>}
        {user && profileStatus === 'error' && (
          <p role="alert" className="app-error">プロフィールを取得・保存できませんでした。「再試行」を押してください。</p>
        )}
        {errorMessage && <p role="alert" className="app-error">{errorMessage}</p>}
      </div>

      <main
        className={`map-layout${sheetSnapIndex === 2 ? ' sheet-expanded' : ''}${isMobile && !selectedBuilding && sheetSnapIndex === 0 ? ' sheet-collapsed' : ''}${!isMobile && !isDesktopOpen ? ' desktop-panel-collapsed' : ''}`}
        style={isMobile ? { '--sheet-height': sheetHeight } : undefined}
      >
        <CampusMap
          buildings={buildings}
          selectedBuilding={selectedBuilding}
          isMobile={isMobile}
          overviewRequest={overviewRequest}
          onSelectBuilding={selectBuilding}
        />

        <BuildingDetailsPanel
          building={selectedBuilding}
          roomId={selectedRoom?.id}
          isMobile={isMobile}
          snapPoints={sheetSnapPoints}
          snapIndex={sheetSnapIndex}
          sheetHeight={sheetHeight}
          onSnapIndexChange={setSheetSnapIndex}
          onClose={closeDetails}
          overviewRequest={overviewRequest}
          footer={selectedBuilding && renderDetailFooter()}
          isDesktopOpen={isDesktopOpen}
          onOpenDesktop={handleOpenBuildingList}
          onCloseDesktop={() => setIsDesktopOpen(false)}
        >
          {selectedBuilding ? renderDetailBody() : (
            <ul className="building-list">
              {buildings.map(building => (
                <li key={building.id}>
                  <button type="button" onClick={() => selectBuilding(building)}>
                    {building.name}
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </BuildingDetailsPanel>
      </main>
    </div>
  )
}

export default App

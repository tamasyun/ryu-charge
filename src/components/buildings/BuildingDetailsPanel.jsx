import { useEffect, useId, useRef, useState } from 'react'
import { Drawer } from '@base-ui/react/drawer'
import CloseIcon from '../CloseIcon'

export default function BuildingDetailsPanel({
  building,
  isMobile,
  snapPoints,
  snapIndex,
  sheetHeight,
  onSnapIndexChange,
  onClose,
  overviewRequest,
  children,
  footer,
  // PC版の開閉状態と操作関数を受け取る
  isDesktopOpen = true,
  onOpenDesktop,
  onCloseDesktop,
}) {
  const titleId = useId()
  const titleRef = useRef(null)
  const contentRef = useRef(null)
  const [popupNode, setPopupNode] = useState(null)
  const previousBuildingId = useRef(null)
  const buildingId = building?.id ?? null
  const title = building?.name ?? '建物一覧'
  const Title = isMobile ? Drawer.Title : 'h2'
  const Content = isMobile ? Drawer.Content : 'div'
  const collapsed = isMobile && !building && snapIndex === 0

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0
  }, [buildingId, overviewRequest])

  useEffect(() => {
    const previous = previousBuildingId.current
    previousBuildingId.current = buildingId
    if (previous === buildingId) return
    if (buildingId || document.activeElement === document.body) {
      titleRef.current?.focus({ preventScroll: true })
    }
  }, [buildingId])

  useEffect(() => {
    const visibleArea = popupNode?.querySelector('.sheet-visible-area')
    const layout = document.querySelector('.map-layout')
    if (!isMobile || !visibleArea || !layout) return

    function updateHeight() {
      layout.style.setProperty('--map-sheet-height', `${visibleArea.getBoundingClientRect().height}px`)
    }
    const observer = new ResizeObserver(updateHeight)
    observer.observe(visibleArea)
    updateHeight()
    return () => {
      observer.disconnect()
      layout.style.removeProperty('--map-sheet-height')
    }
  }, [isMobile, popupNode])

  // ✕ボタンを押したときの挙動
  function handleCloseButtonClick() {
    if (isMobile) {
      if (building) onClose()
      else onSnapIndexChange(0)
    } else {
      // ★ PC版：建物を選択中であっても、✕を押したらサイドバー自体を非表示にする
      if (onCloseDesktop) {
        onCloseDesktop()
      } else if (building) {
        onClose()
      }
    }
  }

  const header = (
    <div className="detail-header">
      <div>
        <Title id={titleId} ref={titleRef} tabIndex={-1}>{title}</Title>
        {building && <p>{building.rooms.length}教室</p>}
      </div>
      {/* PC版でも常に✕ボタンを表示 */}
      <button
        type="button"
        className="close-button"
        aria-label={building ? '詳細を閉じる' : '一覧を閉じる'}
        onClick={handleCloseButtonClick}
      >
        <CloseIcon />
      </button>
    </div>
  )

  const content = (
    <Content
      ref={contentRef}
      className="detail-content"
      data-base-ui-swipe-ignore="y"
    >
      {children}
    </Content>
  )

  // ----------------------------------------------------
  // PC（デスクトップ）表示
  // ----------------------------------------------------
  if (!isMobile) {
    // ✕を押して閉じている時は、左上に3本線（ハンバーガー）ボタンを表示
    if (!isDesktopOpen) {
      return (
        <button
          type="button"
          className="desktop-menu-button"
          aria-label="一覧を開く"
          onClick={onOpenDesktop}
          style={{
            position: 'absolute',
            top: '76px',
            left: '16px',
            zIndex: 1000,
            background: 'var(--bg, #ffffff)',
            border: '1px solid var(--border, #e5e7eb)',
            borderRadius: '8px',
            padding: '8px 12px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '14px',
            fontWeight: '600',
            color: 'var(--text-h, #111827)'
          }}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" aria-hidden="true">
            <path d="M5 7h14M5 12h14M5 17h14" strokeLinecap="round" />
          </svg>
          <span>一覧を表示</span>
        </button>
      )
    }

    return (
      <aside className="detail-panel desktop-detail-panel" aria-labelledby={titleId}>
        {header}
        {content}
        {footer}
      </aside>
    )
  }

  // ----------------------------------------------------
  // スマートフォン表示
  // ----------------------------------------------------
  if (collapsed) {
    return (
      <button
        type="button"
        className="mobile-list-button"
        aria-label="建物一覧を開く"
        aria-expanded={false}
        onClick={() => onSnapIndexChange(1)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 7h14M5 12h14M5 17h14" />
        </svg>
      </button>
    )
  }

  const expanded = snapIndex === snapPoints.length - 1
  const panelLabel = building ? '建物詳細' : '建物一覧'
  return (
    <Drawer.Root
      open
      onOpenChange={(open, eventDetails) => {
        if (open) return
        eventDetails.cancel()
        if (building) onClose()
        else onSnapIndexChange(0)
      }}
      modal={false}
      disablePointerDismissal
      snapPoints={snapPoints}
      snapToSequentialPoints
      snapPoint={snapPoints[snapIndex]}
      onSnapPointChange={point => {
        const index = snapPoints.indexOf(point)
        if (building && index === 0) onClose()
        else if (index >= 0) onSnapIndexChange(index)
      }}
    >
      <Drawer.VirtualKeyboardProvider>
        <Drawer.Portal>
          <Drawer.Viewport className="mobile-drawer-viewport" style={{ '--sheet-height': sheetHeight }}>
            <Drawer.Popup ref={setPopupNode} className="detail-panel mobile-detail-panel" initialFocus={titleRef}>
              <div className="sheet-visible-area">
                <div className="sheet-drag-area">
                  <button
                    type="button"
                    className="sheet-handle"
                    aria-label={panelLabel + (expanded ? 'を縮める' : 'を広げる')}
                    aria-expanded={expanded}
                    onClick={() => onSnapIndexChange(expanded ? 1 : snapPoints.length - 1)}
                  />
                  {header}
                </div>
                {content}
                {footer}
              </div>
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </Drawer.VirtualKeyboardProvider>
    </Drawer.Root>
  )
}
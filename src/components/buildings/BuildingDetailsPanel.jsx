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

  // 高さの変化だけを監視し、地図操作をシートの上に置く。
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

  const header = (
    <div className="detail-header">
      <div>
        <Title id={titleId} ref={titleRef} tabIndex={-1}>{title}</Title>
        {building && <p>{building.rooms.length}教室</p>}
      </div>
      {(building || (isMobile && snapIndex > 0)) && (
        <button
          type="button"
          className="close-button"
          aria-label={building ? '詳細を閉じる' : '建物一覧を閉じる'}
          onClick={building ? onClose : () => onSnapIndexChange(0)}
        ><CloseIcon /></button>
      )}
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

  if (!isMobile) {
    return (
      <aside className="detail-panel desktop-detail-panel" aria-labelledby={titleId}>
        {header}
        {content}
        {footer}
      </aside>
    )
  }

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

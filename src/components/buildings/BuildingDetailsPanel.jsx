import { useEffect, useId, useRef } from 'react'
import { Drawer } from '@base-ui/react/drawer'

export default function BuildingDetailsPanel({
  building,
  isMobile,
  snapPoints,
  snapIndex,
  onSnapIndexChange,
  onClose,
  overviewRequest,
  children,
  footer,
}) {
  const titleId = useId()
  const titleRef = useRef(null)
  const contentRef = useRef(null)
  const previousBuildingId = useRef(null)
  const buildingId = building?.id ?? null
  const title = building?.name ?? '建物一覧'
  const Title = isMobile ? Drawer.Title : 'h2'
  const Content = isMobile ? Drawer.Content : 'div'

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

  const header = (
    <div className="detail-header">
      <div>
        <Title id={titleId} ref={titleRef} tabIndex={-1}>{title}</Title>
        {building && <p>{building.rooms.length}教室</p>}
      </div>
      {building && (
        <button type="button" className="close-button" aria-label="詳細を閉じる" onClick={onClose}>×</button>
      )}
    </div>
  )

  const content = (
    <Content ref={contentRef} className="detail-content" data-base-ui-swipe-ignore="y">
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

  const expanded = snapIndex === snapPoints.length - 1
  const panelLabel = building ? '建物詳細' : '建物一覧'
  const compactIndex = building ? 1 : 0
  return (
    <Drawer.Root
      open
      onOpenChange={(open, eventDetails) => {
        if (open) return
        eventDetails.cancel()
        // 一覧は開いたままにし、詳細を閉じると一覧に戻す。
        if (eventDetails.reason === 'swipe' && snapIndex > 0) {
          onSnapIndexChange(snapIndex - 1)
        } else if (building) {
          onClose()
        }
      }}
      modal={false}
      disablePointerDismissal
      snapPoints={snapPoints}
      snapToSequentialPoints
      snapPoint={snapPoints[snapIndex]}
      onSnapPointChange={point => {
        const index = snapPoints.indexOf(point)
        if (index >= 0) onSnapIndexChange(index)
      }}
    >
      <Drawer.VirtualKeyboardProvider>
        <Drawer.Portal>
          <Drawer.Viewport className="mobile-drawer-viewport">
            <Drawer.Popup className="detail-panel mobile-detail-panel" initialFocus={false}>
              <div className="sheet-visible-area">
                <div className="sheet-drag-area">
                  <button
                    type="button"
                    className="sheet-handle"
                    aria-label={panelLabel + (expanded ? 'を縮める' : 'を広げる')}
                    aria-expanded={expanded}
                    onClick={() => onSnapIndexChange(expanded ? compactIndex : snapPoints.length - 1)}
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

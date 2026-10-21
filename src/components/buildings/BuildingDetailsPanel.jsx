import { Drawer } from '@base-ui/react/drawer'

export default function BuildingDetailsPanel({
  building,
  isMobile,
  snapPoints,
  snapIndex,
  onSnapIndexChange,
  onClose,
  children,
  footer,
}) {
  if (!isMobile) {
    return (
      <aside className="detail-panel">
        <div className="detail-header">
          <div>
            <h2>{building.name}</h2>
            <p>{building.rooms.length}教室</p>
          </div>
          <button
            type="button"
            className="close-button"
            aria-label="詳細を閉じる"
            onClick={onClose}
          >×</button>
        </div>
        <div className="detail-content" data-base-ui-swipe-ignore="y">
          {children}
        </div>
        {footer}
      </aside>
    )
  }

  return (
    <Drawer.Root
      open
      onOpenChange={(open, eventDetails) => {
        if (open) return
        // スワイプでは閉じる前に一段ずつ縮める。
        if (eventDetails.reason === 'swipe' && snapIndex > 0) {
          eventDetails.cancel()
          onSnapIndexChange(Math.max(0, snapIndex - 1))
          return
        }
        onClose()
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
              {/* 本文と追加ボタンを画面内に収める。 */}
              <div className="sheet-visible-area">
                <div className="sheet-drag-area">
                  <span className="sheet-handle" aria-hidden="true" />
                  <div className="detail-header">
                    <div>
                      <Drawer.Title>{building.name}</Drawer.Title>
                      <p>{building.rooms.length}教室</p>
                    </div>
                    <Drawer.Close className="close-button" aria-label="詳細を閉じる">×</Drawer.Close>
                  </div>
                </div>
                {/* 本文のスクロールをパネルのスワイプと分ける。 */}
                <Drawer.Content className="detail-content" data-base-ui-swipe-ignore="y">
                  {children}
                </Drawer.Content>
                {footer}
              </div>
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </Drawer.VirtualKeyboardProvider>
    </Drawer.Root>
  )
}

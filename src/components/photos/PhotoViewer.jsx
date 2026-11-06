import { useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import './PhotoViewer.css'

export default function PhotoViewer({ src, alt, className = '', imageClassName = '' }) {
  const [imageError, setImageError] = useState(false)

  return (
    <Dialog.Root onOpenChange={open => { if (open) setImageError(false) }}>
      <Dialog.Trigger
        type="button"
        className={`photo-viewer-trigger ${className}`}
        aria-label={`${alt}を全画面表示`}
      >
        <img src={src} alt={alt} className={imageClassName} loading="lazy" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="photo-viewer-backdrop" />
        <Dialog.Viewport className="photo-viewer-viewport">
          <Dialog.Popup className="photo-viewer" aria-describedby={undefined}>
            <Dialog.Title className="photo-viewer-title">{alt}</Dialog.Title>
            <Dialog.Close type="button" className="photo-viewer-close" aria-label="写真を閉じる">
              <span aria-hidden="true">×</span>
            </Dialog.Close>
            {imageError ? (
              <p className="photo-viewer-error" role="alert">写真を読み込めませんでした。</p>
            ) : (
              <img
                src={src}
                alt={alt}
                className="photo-viewer-image"
                onError={() => setImageError(true)}
              />
            )}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

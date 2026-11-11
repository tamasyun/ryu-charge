import { useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import Lightbox from 'yet-another-react-lightbox'
import Inline from 'yet-another-react-lightbox/plugins/inline'
import Counter from 'yet-another-react-lightbox/plugins/counter'
import CloseIcon from '../CloseIcon'
import 'yet-another-react-lightbox/styles.css'
import 'yet-another-react-lightbox/plugins/counter.css'
import './PhotoViewer.css'

export default function PhotoViewer({ photos, className = '', imageClassName = '' }) {
  const [index, setIndex] = useState(0)
  const multiple = photos.length > 1

  if (photos.length === 0) return null

  return (
    <Dialog.Root>
      {photos.map((photo, photoIndex) => (
        <Dialog.Trigger
          key={photo.id ?? photo.src}
          type="button"
          className={`photo-viewer-trigger ${className}`}
          aria-label={`${photo.alt}を全画面表示`}
          onClick={() => setIndex(photoIndex)}
        >
          <img src={photo.src} alt={photo.alt} className={imageClassName} loading="lazy" />
        </Dialog.Trigger>
      ))}
      <Dialog.Portal>
        <Dialog.Backdrop className="photo-viewer-backdrop" />
        <Dialog.Viewport className="photo-viewer-viewport">
          <Dialog.Popup className="photo-viewer" aria-describedby={undefined}>
            <Dialog.Title className="photo-viewer-title">{photos[index]?.alt ?? photos[0].alt}</Dialog.Title>
            {/* ダイアログのフォーカス管理を保ち、写真の操作だけをライブラリに任せる。 */}
            <Lightbox
              plugins={multiple ? [Inline, Counter] : [Inline]}
              slides={photos}
              index={index}
              on={{ view: ({ index }) => setIndex(index) }}
              controller={{ closeOnEscape: false }}
              carousel={{ finite: !multiple, imageProps: { className: 'photo-viewer-image' } }}
              labels={{
                Previous: '前の写真', Next: '次の写真',
                'Photo gallery': '写真ギャラリー', Carousel: 'カルーセル', Slide: '写真',
                '{index} of {total}': '{total}枚中{index}枚目',
              }}
              counter={{ container: { className: 'photo-viewer-counter' } }}
              render={{
                ...(!multiple && { buttonPrev: () => null, buttonNext: () => null }),
                iconError: () => <p className="photo-viewer-error" role="alert">写真を読み込めませんでした。</p>,
                controls: () => (
                  <Dialog.Close type="button" className="photo-viewer-close" aria-label="写真を閉じる">
                    <CloseIcon />
                  </Dialog.Close>
                ),
              }}
            />
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

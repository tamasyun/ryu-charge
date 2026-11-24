import { Menu } from '@base-ui/react/menu'
import './PostActionsMenu.css'

export default function PostActionsMenu({ label, disabled, onEdit, onDelete }) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger className="post-actions-trigger" aria-label={`${label}の操作`} disabled={disabled}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="19" cy="12" r="1.7" />
        </svg>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="post-actions-positioner" align="end" sideOffset={4}>
          <Menu.Popup className="post-actions-popup">
            {onEdit && <Menu.Item className="post-actions-item" onClick={onEdit}>編集</Menu.Item>}
            <Menu.Item className="post-actions-item post-actions-delete" onClick={onDelete}>削除</Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

import { useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { supabase } from '../../lib/supabase'
import { createAccountService } from '../../services/account'
import NicknameField from './NicknameField'

const account = createAccountService(supabase)

export default function ProfileDialog({ open, user, onClose, onSaved }) {
  const [nickname, setNickname] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  async function handleSave(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setErrorMessage('')
    try {
      await account.initializeProfile(user, nickname)
      onSaved()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '保存できませんでした。もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={nextOpen => { if (!nextOpen && !busy) onClose() }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="login-overlay" />
        <Dialog.Viewport className="login-viewport">
          <Dialog.Popup className="login-dialog">
            <div className="login-dialog-header">
              <Dialog.Title>ニックネームを設定</Dialog.Title>
              <Dialog.Close className="login-close" aria-label="閉じる" disabled={busy}>×</Dialog.Close>
            </div>
            <form className="login-form" onSubmit={handleSave}>
              <p>投稿する前に、ニックネームを設定してください。</p>
              <NicknameField value={nickname} onChange={setNickname} disabled={busy} autoFocus />
              <button className="login-submit" type="submit" disabled={busy}>
                {busy ? '保存中...' : 'ニックネームを保存'}
              </button>
              {errorMessage && <p className="login-error" role="alert">{errorMessage}</p>}
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

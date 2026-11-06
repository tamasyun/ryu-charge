import { useEffect, useId, useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { supabase } from '../../lib/supabase'
import { createAccountService } from '../../services/account'
import { createAccountDeletionService } from '../../services/accountDeletion'
import { createPasskeyService, passkeyErrorMessage, supportsPasskeys } from '../../services/passkeys'
import { isValidNickname } from '../../utils/nickname'
import NicknameField from './NicknameField'
import DeleteAccountForm from './DeleteAccountForm'
import './AccountSettingsDialog.css'

const account = createAccountService(supabase)
const passkeys = createPasskeyService(supabase)
const deletion = createAccountDeletionService(supabase)

function PasskeyRow({ passkey, busy, onRename, onRemove }) {
  const id = useId()
  const [name, setName] = useState(passkey.friendly_name ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  return <li className="account-passkey">
    <form className="account-form" onSubmit={event => { event.preventDefault(); onRename(passkey.id, name) }}>
      <label htmlFor={id}>パスキーの名前</label>
      <input id={id} value={name} onChange={event => setName(event.target.value)} disabled={busy} placeholder="端末の名前" />
      <small>登録日：{new Date(passkey.created_at).toLocaleDateString('ja-JP')}
        {passkey.last_used_at && ` ／ 最終使用：${new Date(passkey.last_used_at).toLocaleDateString('ja-JP')}`}</small>
      <div className="account-actions">
        <button className="auth-button" disabled={busy || !name.trim()}>名前を保存</button>
        <button className="auth-button" type="button" disabled={busy} onClick={() => setConfirmDelete(true)}>パスキーを削除</button>
      </div>
    </form>
    {confirmDelete && <div className="account-confirm">
      <p>このパスキーを削除しますか？削除後もメール認証でログインできます。</p>
      <div className="account-actions">
        <button className="account-delete-button" disabled={busy} onClick={() => onRemove(passkey.id)}>このパスキーの削除を確定</button>
        <button className="auth-button" disabled={busy} onClick={() => setConfirmDelete(false)}>キャンセル</button>
      </div>
    </div>}
  </li>
}

function SettingsContent({ user, profile, busy, setBusy, onSaved, onDeleted }) {
  const [nickname, setNickname] = useState(profile.nickname)
  const [items, setItems] = useState(null)
  const [passkeyError, setPasskeyError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    let active = true
    passkeys.list().then(data => { if (active) setItems(data) }).catch(() => {
      if (active) setPasskeyError('パスキー一覧を取得できませんでした。Supabaseのパスキー設定もご確認ください。')
    })
    deletion.status().then(data => { if (active) setPending(Boolean(data?.pending)) }).catch(() => {
      // 削除用サーバーが未配備でも、名前変更・パスキー管理は利用できる。
    })
    return () => { active = false }
  }, [])

  async function saveNickname(event) {
    event.preventDefault()
    if (busy || pending) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const updated = await account.updateNickname(user, nickname)
      setNickname(updated.nickname)
      onSaved(updated)
      setNotice('ユーザー名を保存しました。')
    } catch {
      setError('ユーザー名を保存できませんでした。1〜20文字の入力と通信状況をご確認ください。')
    } finally { setBusy(false) }
  }

  async function changePasskey(action, message) {
    if (busy || pending) return
    setBusy(true)
    setPasskeyError('')
    setNotice('')
    try {
      // 登録ボタンから余分な事前通信をせず、標準のWebAuthn画面を直接開く。
      await action()
      setItems(await passkeys.list())
      setNotice(message)
    } catch (error) {
      setPasskeyError(passkeyErrorMessage(error))
    } finally { setBusy(false) }
  }

  return <>
    {pending && <p className="login-error" role="alert">アカウントの削除処理が途中です。下の本人確認から削除を再試行してください。新しい投稿や設定変更はできません。</p>}
    <section className="account-section" aria-label="ユーザー名変更">
      <h3>ユーザー名変更</h3>
      <form className="account-form" onSubmit={saveNickname}>
        <NicknameField value={nickname} onChange={setNickname} disabled={busy || pending} />
        <button className="login-submit" disabled={busy || pending || !isValidNickname(nickname)}>ユーザー名を保存</button>
      </form>
      {error && <p className="login-error" role="alert">{error}</p>}
    </section>
    <section className="account-section" aria-label="パスキー管理">
      <h3>パスキー管理</h3>
      <p>Face ID・Touch ID・Windows Helloなど、端末の確認方法でログインできます。秘密鍵は端末やパスワード管理サービスが管理します。</p>
      <button className="auth-button" disabled={busy || pending || !supportsPasskeys()}
        onClick={() => changePasskey(() => passkeys.register(), 'パスキーを登録しました。')}>
        パスキーを登録
      </button>
      {!supportsPasskeys() && <p>この環境ではパスキー登録を利用できません。対応ブラウザーからHTTPSで開いてください。</p>}
      {items?.length === 0 && <p>登録済みのパスキーはありません。</p>}
      {items === null && !passkeyError && <p role="status">パスキーを確認中...</p>}
      <ul className="account-passkeys">
        {(items ?? []).map(item => <PasskeyRow key={item.id} passkey={item} busy={busy || pending}
          onRename={(id, name) => changePasskey(() => passkeys.rename(id, name), 'パスキーの名前を保存しました。')}
          onRemove={id => changePasskey(() => passkeys.remove(id), 'パスキーを削除しました。')} />)}
      </ul>
      {passkeyError && <p className="login-error" role="alert">{passkeyError}</p>}
      {passkeyError && <button className="auth-button" disabled={busy || pending}
        onClick={() => changePasskey(() => Promise.resolve(), '一覧を更新しました。')}>一覧を再取得</button>}
    </section>
    {notice && <p role="status" className="login-notice">{notice}</p>}
    <DeleteAccountForm user={user} busy={busy} setBusy={setBusy} onDeleted={onDeleted} onPending={() => setPending(true)} />
  </>
}

export default function AccountSettingsDialog({ open, user, profile, onClose, onSaved, onDeleted, returnFocusRef }) {
  const [busy, setBusy] = useState(false)
  return <Dialog.Root open={open} onOpenChange={next => { if (!next && !busy) onClose() }}>
    <Dialog.Portal>
      <Dialog.Backdrop className="login-overlay" />
      <Dialog.Viewport className="login-viewport">
        <Dialog.Popup className="login-dialog account-dialog" finalFocus={returnFocusRef}>
          <div className="login-dialog-header">
            <Dialog.Title>アカウント設定</Dialog.Title>
            <Dialog.Close className="login-close" disabled={busy} aria-label="閉じる">×</Dialog.Close>
          </div>
          <Dialog.Description className="account-description">ユーザー名・ログイン方法・アカウントを管理します。</Dialog.Description>
          <SettingsContent user={user} profile={profile} busy={busy} setBusy={setBusy} onSaved={onSaved} onDeleted={onDeleted} />
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  </Dialog.Root>
}

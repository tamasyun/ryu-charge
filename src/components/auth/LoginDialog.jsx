import { useEffect, useId, useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { setKeepSignedIn, supabase } from '../../lib/supabase'
import { isUniversityEmail } from '../../utils/universityEmail'
import './LoginDialog.css'
import './LoginDialogOtp.css'

const REMEMBERED_EMAIL_KEY = 'ryu-charge:remembered-email'

function readRememberedEmail() {
  try {
    const saved = window.localStorage.getItem(REMEMBERED_EMAIL_KEY) ?? ''
    return isUniversityEmail(saved) ? saved : ''
  } catch {
    return ''
  }
}

function storeRememberedEmail(email, shouldRemember) {
  try {
    if (shouldRemember) {
      window.localStorage.setItem(REMEMBERED_EMAIL_KEY, email)
    } else {
      window.localStorage.removeItem(REMEMBERED_EMAIL_KEY)
    }
  } catch {
    // 保存できない環境でもログイン処理は続ける。
  }
}

function authErrorMessage(error, action) {
  if (error?.status === 429) {
    return '短時間に多くのリクエストがありました。しばらく待ってからお試しください。'
  }
  if (action === 'verify') {
    return '認証コードが正しくないか、有効期限が切れています。コードを確認するか再送信してください。'
  }
  return error instanceof Error ? error.message : '認証メールを送信できませんでした。'
}

function LoginDialogContent({ onClose, returnFocusRef }) {
  const emailInputId = useId()
  const codeInputId = useId()

  const [email, setEmail] = useState(readRememberedEmail)
  const [rememberEmail, setRememberEmail] = useState(() => Boolean(readRememberedEmail()))
  const [keepSignedIn, setKeepSignedInChoice] = useState(true)
  const [step, setStep] = useState('email')
  const [sentEmail, setSentEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [resendWait, setResendWait] = useState(0)

  useEffect(() => {
    if (resendWait <= 0) return undefined
    const timer = window.setTimeout(() => {
      setResendWait(seconds => Math.max(0, seconds - 1))
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [resendWait])

  async function sendCode(targetEmail) {
    const { error } = await supabase.auth.signInWithOtp({
      email: targetEmail,
      options: { shouldCreateUser: true },
    })
    if (error) throw error
  }

  async function handleSend(event) {
    event.preventDefault()
    if (busy) return

    const normalizedEmail = email.trim().toLowerCase()
    setErrorMessage('')
    setNotice('')

    if (!isUniversityEmail(normalizedEmail)) {
      setErrorMessage('琉球大学のメールアドレスのみ利用できます。')
      return
    }

    setBusy(true)
    try {
      await sendCode(normalizedEmail)
      storeRememberedEmail(normalizedEmail, rememberEmail)
      setEmail(normalizedEmail)
      setSentEmail(normalizedEmail)
      setCode('')
      setStep('code')
      setResendWait(60)
      setNotice('認証コードを送信しました。メールをご確認ください。')
    } catch (error) {
      setErrorMessage(authErrorMessage(error, 'send'))
    } finally {
      setBusy(false)
    }
  }

  async function handleVerify(event) {
    event.preventDefault()
    if (busy) return
    if (!/^\d{8}$/.test(code)) {
      setErrorMessage('8桁の認証コードを入力してください。')
      return
    }

    setBusy(true)
    setErrorMessage('')
    setNotice('')
    try {
      setKeepSignedIn(keepSignedIn)
      const { error } = await supabase.auth.verifyOtp({
        email: sentEmail,
        token: code,
        type: 'email',
      })
      if (error) throw error
      // 認証後の追加・レビュー画面の復元はApp.jsxで行う。
      onClose()
    } catch (error) {
      setErrorMessage(authErrorMessage(error, 'verify'))
    } finally {
      setBusy(false)
    }
  }

  async function handleResend() {
    if (busy || resendWait > 0) return
    setBusy(true)
    setErrorMessage('')
    setNotice('')
    try {
      await sendCode(sentEmail)
      setCode('')
      setResendWait(60)
      setNotice('新しい認証コードを送信しました。最新のメールをご確認ください。')
    } catch (error) {
      setErrorMessage(authErrorMessage(error, 'send'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Popup
      className="login-dialog"
      finalFocus={() => returnFocusRef.current?.isConnected
        ? returnFocusRef.current
        : document.querySelector('.auth-button')}
    >
        <div className="login-dialog-header">
          <Dialog.Title>{step === 'code' ? '認証コードを入力' : 'ログイン／新規登録'}</Dialog.Title>
          <Dialog.Close
            type="button"
            className="login-close"
            aria-label="閉じる"
          >
            ×
          </Dialog.Close>
        </div>

        {step === 'email' ? (
          <form className="login-form" onSubmit={handleSend}>
            <p>琉球大学のメールアドレスに認証コードを送信します。</p>
            <label htmlFor={emailInputId}>メールアドレス</label>
            <input
              id={emailInputId}
              type="email"
              autoComplete="email"
              placeholder="example@*.u-ryukyu.ac.jp"
              value={email}
              onChange={event => setEmail(event.target.value)}
              disabled={busy}
              required
              autoFocus
            />
            <label className="login-remember">
              <input
                type="checkbox"
                checked={rememberEmail}
                onChange={event => {
                  const checked = event.target.checked
                  setRememberEmail(checked)
                  if (!checked) storeRememberedEmail('', false)
                }}
              />
              <span>このブラウザにメールアドレスを記憶する</span>
            </label>
            <button type="submit" className="login-submit" disabled={busy}>
              {busy ? '送信中...' : '認証コードを送信'}
            </button>
          </form>
        ) : (
          <form className="login-form" onSubmit={handleVerify}>
            <p>
              <strong className="login-destination">{sentEmail}</strong>
              に届いた認証コードを入力してください。
              届かない場合は、迷惑メールフォルダをご確認ください。
            </p>
            <label htmlFor={codeInputId}>認証コード</label>
            <input
              id={codeInputId}
              className="login-code-input"
              type="text"
              name="one-time-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{8}"
              maxLength={8}
              placeholder="12345678"
              value={code}
              onChange={event => {
                setCode(event.target.value.replace(/\D/g, '').slice(0, 8))
                setErrorMessage('')
              }}
              disabled={busy}
              required
              autoFocus
            />
            <label className="login-remember">
              <input
                type="checkbox"
                checked={keepSignedIn}
                onChange={event => setKeepSignedInChoice(event.target.checked)}
                disabled={busy}
              />
              <span>ログイン状態を保持する</span>
            </label>
            <button
              type="submit"
              className="login-submit"
              disabled={busy || code.length !== 8}
            >
              {busy ? '確認中...' : 'ログイン／新規登録'}
            </button>
            <div className="login-code-actions">
              <button
                className="login-secondary"
                type="button"
                disabled={busy || resendWait > 0}
                onClick={handleResend}
              >
                {resendWait > 0
                  ? `再送信まで ${resendWait}秒`
                  : '認証コードを再送信'}
              </button>
              <button
                className="login-secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  setStep('email')
                  setCode('')
                  setErrorMessage('')
                  setNotice('')
                }}
              >
                メールアドレスを変更
              </button>
            </div>
          </form>
        )}

        {notice && <p className="login-notice" role="status">{notice}</p>}
        {errorMessage && <p className="login-error" role="alert">{errorMessage}</p>}
    </Dialog.Popup>
  )
}

export default function LoginDialog({ open, onClose, onAfterClose, returnFocusRef }) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={nextOpen => { if (!nextOpen) onClose() }}
      onOpenChangeComplete={nextOpen => { if (!nextOpen) onAfterClose() }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="login-overlay" />
        <Dialog.Viewport className="login-viewport">
          <LoginDialogContent onClose={onClose} returnFocusRef={returnFocusRef} />
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

import { useEffect, useId, useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { setKeepSignedIn, supabase } from '../../lib/supabase'
import { isUniversityEmail } from '../../utils/universityEmail'
import { createAccountService } from '../../services/account'
import NicknameField from './NicknameField'
import { isValidNickname } from '../../utils/nickname'
import './LoginDialog.css'
import './LoginDialogOtp.css'

const REMEMBERED_EMAIL_KEY = 'ryu-charge:remembered-email'
const account = createAccountService(supabase)

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

function authErrorMessage(error, action, mode) {
  if (error?.status === 429) {
    return '短時間に多くのリクエストがありました。しばらく待ってからお試しください。'
  }
  if (action === 'verify') {
    return '認証コードが正しくないか、有効期限が切れています。コードを確認するか再送信してください。'
  }
  if (mode === 'login' && ['otp_disabled', 'user_not_found', 'signup_disabled'].includes(error?.code)) {
    return '認証コードを送信できませんでした。登録がお済みでない場合は「新規登録」からお進みください。'
  }
  return '認証コードを送信できませんでした。入力内容と通信状況を確認して、もう一度お試しください。'
}

function LoginDialogContent({ initialMode, onClose, returnFocusRef }) {
  const emailInputId = useId()
  const codeInputId = useId()

  const [email, setEmail] = useState(readRememberedEmail)
  const [mode, setMode] = useState(initialMode)
  const [nickname, setNickname] = useState('')
  const [rememberEmail, setRememberEmail] = useState(() => Boolean(readRememberedEmail()))
  const [keepSignedIn, setKeepSignedInChoice] = useState(true)
  const [step, setStep] = useState('email')
  const [sentRequest, setSentRequest] = useState(null)
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

  async function handleSend(event) {
    event.preventDefault()
    if (busy || resendWait > 0) return

    const normalizedEmail = email.trim().toLowerCase()
    setErrorMessage('')
    setNotice('')

    if (!isUniversityEmail(normalizedEmail)) {
      setErrorMessage('琉球大学のメールアドレスのみ利用できます。')
      return
    }

    if (mode === 'signup' && !isValidNickname(nickname)) {
      setErrorMessage('ニックネームを1〜20文字で入力してください。')
      return
    }

    setBusy(true)
    try {
      const request = { email: normalizedEmail, mode, nickname }
      await account.sendCode(request)
      storeRememberedEmail(normalizedEmail, rememberEmail)
      setEmail(normalizedEmail)
      setSentRequest(request)
      setCode('')
      setStep('code')
      setResendWait(60)
    } catch (error) {
      setErrorMessage(authErrorMessage(error, 'send', mode))
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
      await account.verifyCode({ email: sentRequest.email, code })
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
      await account.sendCode(sentRequest)
      setCode('')
      setResendWait(60)
      setNotice('認証コードを再送信しました。')
    } catch (error) {
      setErrorMessage(authErrorMessage(error, 'send', sentRequest.mode))
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
          <Dialog.Title>{step === 'code' ? '認証コードを入力' : mode === 'signup' ? '新規登録' : 'ログイン'}</Dialog.Title>
          <Dialog.Close
            type="button"
            className="login-close"
            aria-label="閉じる"
            disabled={busy}
          >
            ×
          </Dialog.Close>
        </div>

        {step === 'email' && (
          <div className="auth-mode-switch" role="group" aria-label="認証方法">
            {['login', 'signup'].map(value => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                disabled={busy}
                onClick={() => { setMode(value); setErrorMessage(''); setNotice('') }}
              >
                {value === 'login' ? 'ログイン' : '新規登録'}
              </button>
            ))}
          </div>
        )}

        {step === 'email' ? (
          <form className="login-form" onSubmit={handleSend}>
            <p>琉球大学のメールアドレスに認証コードを送信します。</p>
            {mode === 'signup' && (
              <NicknameField value={nickname} onChange={setNickname} disabled={busy} autoFocus />
            )}
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
              autoFocus={mode === 'login'}
            />
            <label className="login-remember">
              <input
                type="checkbox"
                disabled={busy}
                checked={rememberEmail}
                onChange={event => {
                  const checked = event.target.checked
                  setRememberEmail(checked)
                  if (!checked) storeRememberedEmail('', false)
                }}
              />
              <span>メールアドレスを記憶する</span>
            </label>
            <button type="submit" className="login-submit" disabled={busy || resendWait > 0}>
              {busy ? '送信中...' : resendWait > 0 ? `送信まで ${resendWait}秒` : '認証コードを送信'}
            </button>
          </form>
        ) : (
          <form className="login-form" onSubmit={handleVerify}>
            <p>
              <strong className="login-destination">{sentRequest.email}</strong>
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
              placeholder="・・・・・・・・"
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
              {busy ? '確認中...' : sentRequest.mode === 'signup' ? '認証して登録' : 'ログイン'}
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
            </div>
          </form>
        )}

        {notice && <p className="login-notice" role="status">{notice}</p>}
        {errorMessage && <p className="login-error" role="alert">{errorMessage}</p>}
    </Dialog.Popup>
  )
}

export default function LoginDialog({ open, initialMode = 'login', onClose, onAfterClose, returnFocusRef }) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={nextOpen => { if (!nextOpen) onClose() }}
      onOpenChangeComplete={nextOpen => { if (!nextOpen) onAfterClose() }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="login-overlay" />
        <Dialog.Viewport className="login-viewport">
          <LoginDialogContent initialMode={initialMode} onClose={onClose} returnFocusRef={returnFocusRef} />
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

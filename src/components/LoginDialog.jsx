import { useEffect, useId, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isUniversityEmail } from '../lib/universityEmail'
import './LoginDialog.css'

export default function LoginDialog({ onClose, redirectIntent }) {
  const emailInputId = useId()
  const headingId = useId()
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [onClose])

  async function handleSubmit(event) {
    event.preventDefault()
    if (sending) return

    const normalizedEmail = email.trim().toLowerCase()
    setErrorMessage('')

    if (!isUniversityEmail(normalizedEmail)) {
      setErrorMessage('琉球大学のメールアドレスのみ利用できます。')
      return
    }

    const redirectUrl = new URL(import.meta.env.BASE_URL, window.location.origin)
    if (redirectIntent?.buildingId) {
      redirectUrl.searchParams.set('rc_building', redirectIntent.buildingId)
      redirectUrl.searchParams.set('rc_intent', redirectIntent.type)
      if (redirectIntent.type === 'review' && redirectIntent.roomId) {
        redirectUrl.searchParams.set('rc_room', redirectIntent.roomId)
      }
    }

    setSending(true)
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: redirectUrl.toString(),
          shouldCreateUser: true,
        },
      })
      if (error) throw error
      setEmail(normalizedEmail)
      setSent(true)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'メールの送信に失敗しました。')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="login-overlay">
      <section
        className="login-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
      >
        <div className="login-dialog-header">
          <h2 id={headingId}>ログイン</h2>
          <button type="button" className="login-close" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </div>

        {sent ? (
          <div className="login-sent">
            <p role="status"><strong>{email}</strong> にログインリンクを送信しました。</p>
            <p>メールに記載されたリンクを開いてください。</p>
            <button
              type="button"
              className="login-secondary"
              onClick={() => {
                setSent(false)
                setErrorMessage('')
              }}
            >
              別のメールアドレスを使う
            </button>
          </div>
        ) : (
          <form className="login-form" onSubmit={handleSubmit}>
            <p>琉球大学のメールアドレスにログイン用リンクを送ります。</p>
            <label htmlFor={emailInputId}>大学のメールアドレス</label>
            <input
              id={emailInputId}
              type="email"
              autoComplete="email"
              placeholder="example@*.u-ryukyu.ac.jp"
              value={email}
              onChange={event => setEmail(event.target.value)}
              required
              autoFocus
            />
            <button type="submit" className="login-submit" disabled={sending}>
              {sending ? '送信中...' : 'ログインリンクを送信'}
            </button>
          </form>
        )}

        {errorMessage && <p className="login-error" role="alert">{errorMessage}</p>}
      </section>
    </div>
  )
}

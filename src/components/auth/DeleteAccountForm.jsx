import { useEffect, useId, useRef, useState } from 'react'
import { Turnstile } from '@marsidev/react-turnstile'
import { supabase, clearDeletedAccountSession } from '../../lib/supabase'
import { createAccountService } from '../../services/account'
import { createAccountDeletionService } from '../../services/accountDeletion'

const account = createAccountService(supabase)
const deletion = createAccountDeletionService(supabase)
const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() ?? ''

export default function DeleteAccountForm({ user, busy, setBusy, onDeleted, onPending }) {
  const id = useId()
  const [codeSent, setCodeSent] = useState(false)
  const [code, setCode] = useState('')
  const [wait, setWait] = useState(0)
  const [proof, setProof] = useState(null)
  const [confirmation, setConfirmation] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaError, setCaptchaError] = useState('')
  const captchaRef = useRef(null)

  useEffect(() => {
    if (wait <= 0) return undefined
    const timer = window.setTimeout(() => setWait(value => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [wait])

  function invalidateCaptcha() {
    setCaptchaToken('')
    setCaptchaError('セキュリティ確認を完了できませんでした。再確認するか、ページを再読み込みしてください。')
  }

  async function sendCode() {
    if (busy || wait > 0) return
    if (siteKey && (!captchaToken || captchaRef.current?.isExpired())) {
      invalidateCaptcha()
      captchaRef.current?.reset()
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    const token = captchaToken
    setCaptchaToken('')
    try {
      await account.sendCode({ email: user.email, mode: 'login', captchaToken: token })
      setCodeSent(true)
      setCode('')
      setWait(60)
      setMessage('本人確認用の認証コードを送信しました。')
    } catch (error) {
      setError(error?.code === 'captcha_failed'
        ? 'セキュリティ確認に失敗しました。繰り返し失敗する場合は管理者にお問い合わせください。'
        : '認証コードを送信できませんでした。時間をおいて再度お試しください。')
    } finally {
      captchaRef.current?.reset()
      setBusy(false)
    }
  }

  async function verify(event) {
    event.preventDefault()
    if (busy || !/^\d{8}$/.test(code)) return
    setBusy(true)
    setError('')
    try {
      const result = await deletion.verifyCode(code)
      setProof(result.proof)
      setCode('')
      setMessage('本人確認が完了しました。5分以内に最終確認を行ってください。')
    } catch (error) {
      setError(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function remove(event) {
    event.preventDefault()
    if (busy || !proof || !acknowledged || confirmation !== '削除する') return
    setBusy(true)
    setError('')
    try {
      const result = await deletion.remove(proof, confirmation)
      if (!result?.deleted) throw new Error('削除結果を確認できませんでした。もう一度お試しください。')
      try { await clearDeletedAccountSession() } catch { /* ローカルの保存領域はfinallyで消去される。 */ }
      onDeleted()
    } catch (error) {
      if (error.code === 'not_authenticated') {
        try { await clearDeletedAccountSession() } catch { /* ローカル保存領域は消去する。 */ }
        // 削除成功後の応答喪失もあり得るため、未確認の結果を成功とは表示しない。
        onDeleted(false)
        return
      }
      if (error.code === 'reauth_required') {
        setProof(null)
        setCodeSent(false)
      }
      if (error.code === 'deletion_pending') onPending()
      setError(error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="account-section account-danger" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>アカウント削除</h3>
      <p>アカウント、プロフィール、パスキー、本人のレビューと写真を削除します。教室とコンセントの設備情報は投稿者の情報を外して残します。</p>
      {!proof ? <>
        <p>削除前に、<strong className="login-destination">{user.email}</strong>へ届く8桁のコードで本人確認します。</p>
        {siteKey && <div className="login-captcha">
          <Turnstile ref={captchaRef} siteKey={siteKey}
            options={{ language: 'ja', size: 'compact', responseField: false, refreshExpired: 'auto' }}
            onSuccess={token => { setCaptchaToken(token); setCaptchaError('') }}
            onExpire={invalidateCaptcha} onError={invalidateCaptcha} onTimeout={invalidateCaptcha}
            onUnsupported={invalidateCaptcha} scriptOptions={{ onError: invalidateCaptcha }} />
          {captchaError && <p role="alert" className="login-error">{captchaError}</p>}
        </div>}
        <button className="auth-button" type="button" onClick={sendCode}
          disabled={busy || wait > 0 || Boolean(siteKey && !captchaToken)}>
          {wait > 0 ? `再送信まで ${wait}秒` : codeSent ? '削除用コードを再送信' : '削除用コードを送信'}
        </button>
        {codeSent && <form className="account-form" onSubmit={verify}>
          <label htmlFor={`${id}-code`}>削除用の認証コード</label>
          <input id={`${id}-code`} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}"
            maxLength={8} value={code} disabled={busy} required
            onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))} />
          <button className="auth-button" disabled={busy || code.length !== 8}>本人確認を完了する</button>
        </form>}
      </> : <form className="account-form" onSubmit={remove}>
        <p>この操作は取り消せません。途中で写真の削除などが失敗した場合も、同じ画面から削除を再試行できます。</p>
        <label className="login-remember">
          <input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} disabled={busy} />
          <span>削除対象と、設備情報が残ることを確認しました</span>
        </label>
        <label htmlFor={`${id}-confirm`}>最終確認として「削除する」と入力してください</label>
        <input id={`${id}-confirm`} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} autoComplete="off" />
        <button className="account-delete-button" disabled={busy || !acknowledged || confirmation !== '削除する'}>
          {busy ? '削除処理中...' : 'アカウントを完全に削除する'}
        </button>
      </form>}
      {message && <p role="status" className="login-notice">{message}</p>}
      {error && <p role="alert" className="login-error">{error}</p>}
    </section>
  )
}

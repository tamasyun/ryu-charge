// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  signInWithOtp: vi.fn(), verifyOtp: vi.fn(), setKeepSignedIn: vi.fn(),
}))
const captcha = vi.hoisted(() => ({ props: null, reset: vi.fn(), expired: false }))

vi.mock('../src/lib/supabase', () => ({
  supabase: { auth }, setKeepSignedIn: auth.setKeepSignedIn,
}))
vi.mock('@marsidev/react-turnstile', async () => {
  const { useImperativeHandle } = await import('react')
  return {
    Turnstile: function MockTurnstile({ ref, ...props }) {
      captcha.props = props
      useImperativeHandle(ref, () => ({ reset: captcha.reset, isExpired: () => captcha.expired }))
      return <div data-testid="turnstile" />
    },
  }
})

let LoginDialog
const email = 'student@ie.u-ryukyu.ac.jp'

beforeEach(async () => {
  vi.resetModules()
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'public-site-key')
  vi.clearAllMocks()
  auth.signInWithOtp.mockResolvedValue({ error: null })
  auth.verifyOtp.mockResolvedValue({ error: null })
  captcha.expired = false
  captcha.props = null
  // Node側のWeb Storageではなく、ブラウザーの保存領域を模擬する。
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() })
  ;({ default: LoginDialog } = await import('../src/components/auth/LoginDialog.jsx'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function openDialog(initialMode = 'login') {
  const onClose = vi.fn()
  const props = { open: true, initialMode, onClose, onAfterClose: vi.fn(), returnFocusRef: { current: null } }
  const view = render(<LoginDialog {...props} />)
  fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: email } })
  if (initialMode === 'signup') {
    fireEvent.change(screen.getByLabelText('ニックネーム'), { target: { value: '　りゅう　' } })
  }
  return { ...view, onClose, props }
}

function solve(token = 'first-token') {
  act(() => captcha.props.onSuccess(token))
}

async function send() {
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '認証コードを送信' })))
}

async function finishCooldown() {
  // 既存の60秒の再送信待ちを実時間を待たずに経過させる。
  for (let second = 0; second < 60; second++) {
    await act(async () => vi.advanceTimersByTime(1000))
  }
}

describe('Turnstile-protected email OTP', () => {
  it.each(['login', 'signup'])('%s requires a solved CAPTCHA and sends its token', async mode => {
    openDialog(mode)
    const button = screen.getByRole('button', { name: '認証コードを送信' })
    expect(button.disabled).toBe(true)
    // ボタンのdisabledだけに依存せず、Enter等のフォーム送信も防ぐ。
    await act(async () => fireEvent.submit(button.closest('form')))
    expect(auth.signInWithOtp).not.toHaveBeenCalled()
    expect(captcha.props.siteKey).toBe('public-site-key')
    solve()
    expect(button.disabled).toBe(false)
    await send()
    expect(auth.signInWithOtp).toHaveBeenCalledExactlyOnceWith({
      email,
      options: {
        shouldCreateUser: mode === 'signup',
        ...(mode === 'signup' ? { data: { nickname: 'りゅう' } } : {}),
        captchaToken: 'first-token',
      },
    })
    expect(captcha.reset).toHaveBeenCalled()
    expect(screen.getByLabelText('認証コード')).toBeTruthy()
  })

  it.each(['onExpire', 'onError', 'onTimeout', 'onUnsupported'])('%s invalidates the token and allows a fresh challenge', async callback => {
    openDialog()
    solve('old-token')
    act(() => captcha.props[callback]())
    expect(screen.getByRole('button', { name: '認証コードを送信' }).disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('セキュリティ確認')
    fireEvent.click(screen.getByRole('button', { name: 'セキュリティ確認をやり直す' }))
    expect(captcha.reset).toHaveBeenCalled()
    solve('new-token')
    await send()
    expect(auth.signInWithOtp.mock.calls[0][0].options.captchaToken).toBe('new-token')
  })

  it('checks expiry again at submission even before the expiry callback arrives', async () => {
    openDialog()
    solve()
    captcha.expired = true
    await send()
    expect(auth.signInWithOtp).not.toHaveBeenCalled()
    expect(captcha.reset).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '認証コードを送信' }).disabled).toBe(true)
  })

  it('explains script loading failure and blocks sending', () => {
    openDialog()
    solve()
    act(() => captcha.props.scriptOptions.onError())
    expect(screen.getByRole('button', { name: '認証コードを送信' }).disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('ページを再読み込み')
    expect(screen.queryByRole('button', { name: 'セキュリティ確認をやり直す' })).toBeNull()
  })

  it.each([
    { code: 'captcha_failed', status: 400 },
    { code: 'over_email_send_rate_limit', status: 429 },
    new Error('network failure'),
  ])('discards consumed tokens on send failure (%j) without a fallback request', async error => {
    openDialog()
    auth.signInWithOtp.mockResolvedValueOnce({ error })
    solve('rejected-token')
    await send()
    expect(auth.signInWithOtp).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(captcha.reset).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '認証コードを送信' }).disabled).toBe(true)
    solve('retry-token')
    await send()
    expect(auth.signInWithOtp.mock.calls[1][0].options.captchaToken).toBe('retry-token')
  })

  it.each(['login', 'signup'])('%s resends using a new token, with the same nickname and cooldown', async mode => {
    openDialog(mode)
    solve('first-token')
    vi.useFakeTimers()
    await send()
    expect(screen.getByRole('button', { name: '再送信まで 60秒' }).disabled).toBe(true)
    await finishCooldown()
    const resend = screen.getByRole('button', { name: '認証コードを再送信' })
    expect(resend.disabled).toBe(true)
    solve('second-token')
    expect(resend.disabled).toBe(false)
    auth.signInWithOtp.mockResolvedValueOnce({ error: { code: 'captcha_failed' } })
    await act(async () => fireEvent.click(resend))
    expect(resend.disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('セキュリティ確認に失敗')
    solve('third-token')
    await act(async () => fireEvent.click(resend))
    const requests = auth.signInWithOtp.mock.calls.map(([request]) => request)
    expect(requests.map(request => request.options.captchaToken)).toEqual(['first-token', 'second-token', 'third-token'])
    for (const request of requests) {
      expect(request.options.shouldCreateUser).toBe(mode === 'signup')
      if (mode === 'signup') expect(request.options.data).toEqual({ nickname: 'りゅう' })
    }
    expect(screen.getByRole('button', { name: '再送信まで 60秒' }).disabled).toBe(true)
    expect(screen.getByText('認証コードを再送信しました。')).toBeTruthy()
  })

  it.each([true, false])('verifies exactly eight digits without CAPTCHA and preserves keepSignedIn=%s', async keepSignedIn => {
    const { onClose } = openDialog()
    solve()
    await send()
    act(() => captcha.props.onError())
    const code = screen.getByLabelText('認証コード')
    fireEvent.change(code, { target: { value: '123456' } })
    const login = screen.getByRole('button', { name: 'ログイン' })
    expect(login.disabled).toBe(true)
    await act(async () => fireEvent.submit(login.closest('form')))
    expect(auth.verifyOtp).not.toHaveBeenCalled()
    fireEvent.change(code, { target: { value: '12345678' } })
    if (!keepSignedIn) fireEvent.click(screen.getByLabelText('ログイン状態を保持する'))
    await act(async () => fireEvent.click(login))
    expect(auth.verifyOtp).toHaveBeenCalledExactlyOnceWith({ email, token: '12345678', type: 'email' })
    expect(auth.setKeepSignedIn).toHaveBeenCalledWith(keepSignedIn)
    expect(onClose).toHaveBeenCalled()
  })

  it('does not retain a solved token after closing and reopening the dialog', async () => {
    const view = openDialog()
    solve('old-dialog-token')
    view.rerender(<LoginDialog {...view.props} open={false} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    view.rerender(<LoginDialog {...view.props} />)
    expect(screen.getByRole('button', { name: '認証コードを送信' }).disabled).toBe(true)
    expect(auth.signInWithOtp).not.toHaveBeenCalled()
  })
})

describe('without a Site Key', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '  ')
    ;({ default: LoginDialog } = await import('../src/components/auth/LoginDialog.jsx'))
  })

  it.each(['login', 'signup'])('preserves %s and resend when server-side CAPTCHA is disabled', async mode => {
    openDialog(mode)
    expect(screen.queryByTestId('turnstile')).toBeNull()
    vi.useFakeTimers()
    await send()
    await finishCooldown()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '認証コードを再送信' })))
    expect(auth.signInWithOtp).toHaveBeenCalledTimes(2)
    for (const [request] of auth.signInWithOtp.mock.calls) {
      expect(request.options).toEqual({
        shouldCreateUser: mode === 'signup',
        ...(mode === 'signup' ? { data: { nickname: 'りゅう' } } : {}),
      })
    }
  })

  it('shows a configuration error if the server already requires CAPTCHA', async () => {
    openDialog()
    auth.signInWithOtp.mockResolvedValueOnce({ error: { code: 'captcha_failed' } })
    await send()
    expect(screen.getByRole('alert').textContent).toContain('設定に問題')
    expect(auth.signInWithOtp).toHaveBeenCalledTimes(1)
    expect(auth.signInWithOtp.mock.calls[0][0].options).toEqual({ shouldCreateUser: false })
  })
})

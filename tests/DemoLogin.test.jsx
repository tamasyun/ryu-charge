// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ signInWithOtp: vi.fn(), verifyOtp: vi.fn(), from: vi.fn() }))
const enrollment = vi.hoisted(() => ({ register: vi.fn(), signIn: vi.fn() }))
vi.mock('../src/lib/supabase', () => ({ supabase: { auth, from: auth.from }, setKeepSignedIn: vi.fn() }))
vi.mock('../src/components/auth/SecurityChallenge', () => ({ default: () => <p>通常アカウントのCAPTCHA</p> }))
vi.mock('../src/demo/passkeys.js', () => ({ demoPasskeys: enrollment }))

let LoginDialog, demoAccount
function storage() {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  enrollment.register.mockResolvedValue({ id: 'demo-key' })
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'normal-captcha')
  vi.stubGlobal('localStorage', storage())
  vi.stubGlobal('sessionStorage', storage())
  vi.spyOn(window, 'alert').mockImplementation(() => {})
  ;({ default: LoginDialog } = await import('../src/components/auth/LoginDialog.jsx'))
  ;({ demoAccount } = await import('../src/demo/account.js'))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

it('reserved login bypasses email and CAPTCHA, creates a local profile and explains scope once in a popup', async () => {
  const onClose = vi.fn()
  render(<LoginDialog open onClose={onClose} onAfterClose={() => {}} returnFocusRef={{ current: null }} />)
  fireEvent.change(screen.getByLabelText('大学のメールアドレス'), { target: { value: 'demo@example.com' } })
  expect(screen.queryByText('通常アカウントのCAPTCHA')).toBeNull()
  const form = screen.getByLabelText('大学のメールアドレス').closest('form')
  await act(async () => fireEvent.submit(form))
  expect(auth.signInWithOtp).not.toHaveBeenCalled()
  expect(auth.from).not.toHaveBeenCalled()
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(window.alert).toHaveBeenCalledTimes(1)
  expect(window.alert.mock.calls[0][0]).toContain('このブラウザ内だけ')
  expect(demoAccount.profile().nickname).toBe('デモアカウント')
  expect(enrollment.register).toHaveBeenCalledTimes(1)
})

it.each([false, true])('first-login enrollment is attempted once; cancellation=%s preserves login and allows later logins', async cancelled => {
  if (cancelled) enrollment.register.mockRejectedValueOnce(new DOMException('cancelled', 'NotAllowedError'))
  const onPasskeyNotice = vi.fn()
  render(<LoginDialog open onClose={() => {}} onAfterClose={() => {}} returnFocusRef={{ current: null }} onPasskeyNotice={onPasskeyNotice} />)
  fireEvent.change(screen.getByLabelText('大学のメールアドレス'), { target: { value: 'demo@example.com' } })
  const form = screen.getByLabelText('大学のメールアドレス').closest('form')
  await act(async () => fireEvent.submit(form))
  expect(enrollment.register).toHaveBeenCalledTimes(1)
  expect(demoAccount.isActive()).toBe(true)
  expect(window.alert).toHaveBeenCalledTimes(1)
  if (cancelled) expect(onPasskeyNotice).toHaveBeenCalledWith(expect.stringContaining('ログインは完了'))
  else expect(onPasskeyNotice).not.toHaveBeenCalled()
  demoAccount.signOut()
  await act(async () => fireEvent.submit(form))
  expect(enrollment.register).toHaveBeenCalledTimes(1)
  expect(demoAccount.isActive()).toBe(true)
  expect(auth.signInWithOtp).not.toHaveBeenCalled()
  expect(auth.from).not.toHaveBeenCalled()
})

it('existing demo accounts do not automatically open enrollment', async () => {
  demoAccount.signIn()
  demoAccount.signOut()
  render(<LoginDialog open onClose={() => {}} onAfterClose={() => {}} returnFocusRef={{ current: null }} />)
  fireEvent.change(screen.getByLabelText('大学のメールアドレス'), { target: { value: 'demo@example.com' } })
  await act(async () => fireEvent.submit(screen.getByLabelText('大学のメールアドレス').closest('form')))
  expect(enrollment.register).not.toHaveBeenCalled()
})

it('an empty email uses the saved demo passkey without production CAPTCHA or authentication', async () => {
  vi.stubGlobal('PublicKeyCredential', class {})
  vi.stubGlobal('isSecureContext', true)
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: { create() {}, get() {} } })
  demoAccount.signIn()
  demoAccount.savePasskeys([{ id: 'saved-demo-key' }])
  demoAccount.signOut()
  enrollment.signIn.mockImplementation(async () => demoAccount.signIn())
  const onClose = vi.fn()
  render(<LoginDialog open onClose={onClose} onAfterClose={() => {}} returnFocusRef={{ current: null }} />)
  expect(screen.getByLabelText('大学のメールアドレス').value).toBe('')
  const button = screen.getByRole('button', { name: 'パスキーでログイン', exact: true })
  expect(button.disabled).toBe(false)
  await act(async () => fireEvent.click(button))
  expect(enrollment.signIn).toHaveBeenCalledTimes(1)
  expect(onClose).toHaveBeenCalledTimes(1)
  expect(demoAccount.isActive()).toBe(true)
  expect(window.alert).toHaveBeenCalledTimes(1)
})

it('the reserved email cannot accidentally create a production signup', async () => {
  render(<LoginDialog open initialMode="signup" onClose={() => {}} onAfterClose={() => {}} returnFocusRef={{ current: null }} />)
  fireEvent.change(screen.getByLabelText('大学のメールアドレス'), { target: { value: 'demo@example.com' } })
  fireEvent.change(screen.getByLabelText('ニックネーム'), { target: { value: '試用' } })
  await act(async () => fireEvent.submit(screen.getByLabelText('大学のメールアドレス').closest('form')))
  expect(screen.getByRole('alert').textContent).toContain('このアドレスはデモ用')
  expect(auth.signInWithOtp).not.toHaveBeenCalled()
  expect(demoAccount.isActive()).toBe(false)
})

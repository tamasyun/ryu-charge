// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ signInWithOtp: vi.fn(), verifyOtp: vi.fn(), from: vi.fn() }))
vi.mock('../src/lib/supabase', () => ({ supabase: { auth, from: auth.from }, setKeepSignedIn: vi.fn() }))
vi.mock('../src/components/auth/SecurityChallenge', () => ({ default: () => <p>通常アカウントのCAPTCHA</p> }))

let LoginDialog, demoAccount
function storage() {
  const values = new Map()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
}

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
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

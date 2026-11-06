// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  update: vi.fn(), list: vi.fn(), register: vi.fn(), rename: vi.fn(), remove: vi.fn(),
  invoke: vi.fn(), send: vi.fn(), clearSession: vi.fn(), captcha: null, resetCaptcha: vi.fn(), keys: [],
}))

vi.mock('../src/lib/supabase', () => ({
  clearDeletedAccountSession: mock.clearSession,
  supabase: {
    auth: { signInWithOtp: mock.send, registerPasskey: mock.register,
      passkey: { list: mock.list, update: mock.rename, delete: mock.remove } },
    from: () => ({ update: mock.update }),
    functions: { invoke: mock.invoke },
  },
}))
vi.mock('@marsidev/react-turnstile', async () => {
  const { useImperativeHandle } = await import('react')
  return { Turnstile: function MockTurnstile({ ref, ...props }) {
    mock.captcha = props
    useImperativeHandle(ref, () => ({ reset: mock.resetCaptcha, isExpired: () => false }))
    return <div data-testid="captcha" />
  } }
})

let AccountSettingsDialog
const user = { id: 'user-1', email: 'student@ie.u-ryukyu.ac.jp' }
const profile = { id: user.id, nickname: 'りゅう' }

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'test-site-key')
  vi.stubGlobal('PublicKeyCredential', class {})
  vi.stubGlobal('isSecureContext', true)
  Object.defineProperty(window.navigator, 'credentials', { configurable: true, value: { create() {}, get() {} } })
  mock.keys = [{ id: 'key-1', friendly_name: 'iPhone', created_at: '2026-11-01T00:00:00Z' }]
  mock.list.mockImplementation(async () => ({ data: [...mock.keys], error: null }))
  mock.register.mockImplementation(async () => {
    mock.keys.push({ id: 'key-2', friendly_name: 'Mac', created_at: '2026-11-06T00:00:00Z' })
    return { data: mock.keys[1], error: null }
  })
  mock.rename.mockResolvedValue({ error: null })
  mock.remove.mockImplementation(async ({ passkeyId }) => {
    mock.keys = mock.keys.filter(key => key.id !== passkeyId)
    return { error: null }
  })
  mock.update.mockImplementation(({ nickname }) => ({ eq: (column, id) => ({ select: () => ({ single: async () => ({ data: { id, nickname }, error: null }) }) }) }))
  mock.send.mockResolvedValue({ error: null })
  mock.clearSession.mockResolvedValue()
  mock.invoke.mockImplementation(async (_name, { body }) => ({ data:
    body.action === 'status' ? { pending: false } : body.action === 'verify' ? { proof: 'a'.repeat(64) } : { deleted: true }, error: null }))
  ;({ default: AccountSettingsDialog } = await import('../src/components/auth/AccountSettingsDialog.jsx'))
})

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

async function open() {
  const props = { open: true, user, profile, onClose: vi.fn(), onSaved: vi.fn(), onDeleted: vi.fn(), returnFocusRef: { current: null } }
  await act(async () => render(<AccountSettingsDialog {...props} />))
  return props
}

async function verifyDeletion() {
  act(() => mock.captcha.onSuccess('deletion-captcha'))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '削除用コードを送信' })))
  fireEvent.change(screen.getByLabelText('削除用の認証コード'), { target: { value: '12345678' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '本人確認を完了する' })))
}

function confirmDeletion() {
  fireEvent.click(screen.getByLabelText('削除対象と、設備情報が残ることを確認しました'))
  fireEvent.change(screen.getByLabelText('最終確認として「削除する」と入力してください'), { target: { value: '削除する' } })
}

it('saves the normalized nickname and notifies the header/author consumers', async () => {
  const props = await open()
  fireEvent.change(screen.getByLabelText('ニックネーム'), { target: { value: '　新しい名前　' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'ユーザー名を保存' })))
  expect(props.onSaved).toHaveBeenCalledWith({ id: user.id, nickname: '新しい名前' })
  expect(screen.getByText('ユーザー名を保存しました。')).toBeTruthy()
})

it('invalid nickname and failed RLS updates do not report a saved profile', async () => {
  const props = await open()
  fireEvent.change(screen.getByLabelText('ニックネーム'), { target: { value: 'あ'.repeat(21) } })
  expect(screen.getByRole('button', { name: 'ユーザー名を保存' }).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('ニックネーム'), { target: { value: '名前' } })
  mock.update.mockImplementation(() => ({ eq: () => ({ select: () => ({ single: async () => ({ error: new Error('RLS denied') }) }) }) }))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'ユーザー名を保存' })))
  expect(props.onSaved).not.toHaveBeenCalled()
  expect(screen.getByRole('alert').textContent).toContain('保存できません')
})

it('registers, lists, renames and explicitly confirms removal of a passkey', async () => {
  await open()
  expect(screen.getByDisplayValue('iPhone')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('パスキーの名前'), { target: { value: '　自分の端末　' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '名前を保存' })))
  expect(mock.rename).toHaveBeenCalledWith({ passkeyId: 'key-1', friendlyName: '自分の端末' })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'パスキーを登録' })))
  expect(mock.register).toHaveBeenCalledTimes(1)
  expect(screen.getByDisplayValue('Mac')).toBeTruthy()
  fireEvent.click(screen.getAllByRole('button', { name: 'パスキーを削除' })[0])
  expect(mock.remove).not.toHaveBeenCalled()
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'このパスキーの削除を確定' })))
  expect(mock.remove).toHaveBeenCalledWith({ passkeyId: 'key-1' })
  expect(screen.queryByDisplayValue('自分の端末')).toBeNull()
})

it('cancelled manual registration preserves the account and allows another button attempt', async () => {
  const props = await open()
  mock.register.mockResolvedValueOnce({ error: { name: 'NotAllowedError' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'パスキーを登録' })))
  expect(screen.getByRole('alert').textContent).toContain('キャンセル')
  expect(props.onDeleted).not.toHaveBeenCalled()
  expect(mock.clearSession).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'パスキーを登録' }).disabled).toBe(false)
})

it('requires CAPTCHA, a fresh eight-digit OTP and two explicit final confirmations for account deletion', async () => {
  const props = await open()
  expect(screen.getByRole('button', { name: '削除用コードを送信' }).disabled).toBe(true)
  expect(screen.queryByRole('button', { name: 'アカウントを完全に削除する' })).toBeNull()
  await verifyDeletion()
  expect(mock.send).toHaveBeenCalledWith({ email: user.email, options: { shouldCreateUser: false, captchaToken: 'deletion-captcha' } })
  const remove = screen.getByRole('button', { name: 'アカウントを完全に削除する' })
  expect(remove.disabled).toBe(true)
  confirmDeletion()
  await act(async () => fireEvent.click(remove))
  expect(mock.invoke).toHaveBeenCalledWith('delete-account', { body: { action: 'delete', proof: 'a'.repeat(64), confirmation: '削除する' } })
  expect(mock.clearSession).toHaveBeenCalledTimes(1)
  expect(props.onDeleted).toHaveBeenCalledTimes(1)
})

it('Storage deletion failure retains the session and permits a retry; settings are frozen', async () => {
  const props = await open()
  await verifyDeletion()
  confirmDeletion()
  const invoke = mock.invoke.getMockImplementation()
  mock.invoke.mockImplementation(async (name, args) => args.body.action === 'delete'
    ? { error: { context: { json: async () => ({ code: 'deletion_pending', message: '写真を削除できませんでした。再試行してください。' }) } } }
    : invoke(name, args))
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'アカウントを完全に削除する' })))
  expect(mock.clearSession).not.toHaveBeenCalled()
  expect(props.onDeleted).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'ユーザー名を保存' }).disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'パスキーを登録' }).disabled).toBe(true)
  expect(screen.getByRole('button', { name: 'アカウントを完全に削除する' }).disabled).toBe(false)
})

it('expired deletion proof returns to OTP verification without logging out', async () => {
  await open()
  await verifyDeletion()
  confirmDeletion()
  mock.invoke.mockResolvedValueOnce({ error: { context: { json: async () => ({ code: 'reauth_required', message: '本人確認の期限切れです。' }) } } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'アカウントを完全に削除する' })))
  expect(screen.queryByRole('button', { name: 'アカウントを完全に削除する' })).toBeNull()
  expect(mock.clearSession).not.toHaveBeenCalled()
})

it('lost or expired session clears browser credentials without claiming the deletion succeeded', async () => {
  const props = await open()
  await verifyDeletion()
  confirmDeletion()
  mock.invoke.mockResolvedValueOnce({ error: { context: { json: async () => ({ code: 'not_authenticated', message: '再ログインしてください。' }) } } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'アカウントを完全に削除する' })))
  expect(mock.clearSession).toHaveBeenCalledTimes(1)
  expect(props.onDeleted).toHaveBeenCalledWith(false)
})

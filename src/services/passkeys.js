import { isUniversityEmail } from '../utils/universityEmail.js'

export function supportsPasskeys() {
  return typeof window !== 'undefined' && window.isSecureContext === true &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials?.create === 'function' && typeof navigator.credentials?.get === 'function'
}

export function passkeyErrorMessage(error) {
  if (['NotAllowedError', 'AbortError'].includes(error?.name) ||
      ['ERROR_CEREMONY_ABORTED', 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY', 'ERROR_NOT_ALLOWED'].includes(error?.code)) {
    return 'パスキー操作を完了できませんでした。キャンセルした場合や端末の確認画面が開かない場合は、もう一度ボタンからお試しください。'
  }
  return 'パスキーを利用できませんでした。端末・ブラウザーの対応と接続先をご確認ください。メール認証でもログインできます。'
}

export function createPasskeyService(client) {
  return {
    async signIn(captchaToken) {
      const { data, error } = await client.auth.signInWithPasskey({
        options: captchaToken ? { captchaToken } : {},
      })
      if (error) throw error
      if (!isUniversityEmail(data?.user?.email)) {
        await client.auth.signOut({ scope: 'local' })
        throw new Error('琉球大学のメールアドレスのみ利用できます。')
      }
      return data
    },
    async register() {
      const { data, error } = await client.auth.registerPasskey()
      if (error) throw error
      return data
    },
    async list() {
      const { data, error } = await client.auth.passkey.list()
      if (error) throw error
      return data ?? []
    },
    async rename(passkeyId, value) {
      const friendlyName = value.trim()
      if (!friendlyName || Array.from(friendlyName).length > 120 || /\p{Cc}/u.test(friendlyName)) {
        throw new Error('パスキーの名前を1〜120文字で入力してください。')
      }
      const { data, error } = await client.auth.passkey.update({ passkeyId, friendlyName })
      if (error) throw error
      return data
    },
    async remove(passkeyId) {
      const { error } = await client.auth.passkey.delete({ passkeyId })
      if (error) throw error
    },
  }
}

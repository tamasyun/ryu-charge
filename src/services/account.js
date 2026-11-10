import { isUniversityEmail } from '../utils/universityEmail.js'
import { isValidNickname, normalizeNickname } from '../utils/nickname.js'
import { demoAccount, isDemoEmail } from '../demo/account.js'

// クライアントを受け取り、ログインと新規登録で同じ送信・検証処理を使う。
export function createAccountService(client) {
  async function fetchProfile(userId) {
    const { data, error } = await client.from('profiles')
      .select('id, nickname').eq('id', userId).maybeSingle()
    if (error) throw error
    return data
  }

  async function initializeProfile(user, value) {
    const nickname = normalizeNickname(value)
    if (!isUniversityEmail(user?.email) || !isValidNickname(nickname)) {
      throw new Error('ニックネームを1〜20文字で入力してください。')
    }
    // 同じメールで再登録した場合や別タブと競合した場合も、既存の名前を守る。
    const { error } = await client.from('profiles').upsert(
      { id: user.id, nickname },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    if (error) throw error
    const profile = await fetchProfile(user.id)
    if (!profile) throw new Error('ニックネームを保存できませんでした。もう一度お試しください。')
    return profile
  }

  return {
    signInDemo() { return demoAccount.signIn() },
    async sendCode({ email, mode, nickname, captchaToken }) {
      if (mode !== 'login' && mode !== 'signup') throw new Error('認証方法を確認してください。')
      const normalizedEmail = email.trim().toLowerCase()
      if (isDemoEmail(normalizedEmail)) throw new Error('デモ用のアドレスにはメールを送信しません。ログインからお進みください。')
      if (!isUniversityEmail(normalizedEmail)) {
        throw new Error('琉球大学のメールアドレスのみ利用できます。')
      }
      if (mode === 'signup' && !isValidNickname(nickname)) {
        throw new Error('ニックネームを1〜20文字で入力してください。')
      }
      const options = { shouldCreateUser: mode === 'signup' }
      if (mode === 'signup') options.data = { nickname: normalizeNickname(nickname) }
      if (captchaToken) options.captchaToken = captchaToken
      const { error } = await client.auth.signInWithOtp({ email: normalizedEmail, options })
      if (error) throw error
      return normalizedEmail
    },

    async verifyCode({ email, code }) {
      if (isDemoEmail(email)) throw new Error('デモアカウントに認証コードは不要です。')
      if (!/^\d{8}$/.test(code)) throw new Error('8桁の認証コードを入力してください。')
      const { data, error } = await client.auth.verifyOtp({ email, token: code, type: 'email' })
      if (error) throw error
      return data
    },

    async updateNickname(user, value) {
      const nickname = normalizeNickname(value)
      if (demoAccount.isUser(user) && isValidNickname(nickname)) return demoAccount.updateNickname(nickname)
      if (!user?.id || !isUniversityEmail(user.email) || !isValidNickname(nickname)) {
        throw new Error('ニックネームを1〜20文字で入力してください。')
      }
      const { data, error } = await client.from('profiles').update({ nickname })
        .eq('id', user.id).select('id, nickname').single()
      if (error) throw error
      return data
    },

    async registerInitialPasskey(user) {
      if (demoAccount.isUser(user)) return false
      // 呼び出し元は新規登録のOTP完了ハンドラーのみ。再読込・通常ログインでは呼ばない。
      const profile = await this.loadProfile(user)
      if (!profile) return false
      const { data: claimed, error } = await client.rpc('claim_initial_passkey_enrollment')
      if (error) throw error
      if (!claimed) return false
      // DBの一度限りの権利を先に消費する。キャンセルやSafariの制限時も自動再試行しない。
      const { error: registrationError } = await client.auth.registerPasskey()
      if (registrationError) throw registrationError
      return true
    },

    async loadProfile(user) {
      if (demoAccount.isUser(user)) return demoAccount.profile()
      const profile = await fetchProfile(user.id)
      if (profile) return profile
      // メール認証が済んでから公開プロフィールを作る。途中で閉じても再開できる。
      const nickname = user.user_metadata?.nickname
      if (isUniversityEmail(user.email) && isValidNickname(nickname)) {
        return initializeProfile(user, nickname)
      }
      return null
    },

    initializeProfile,
  }
}

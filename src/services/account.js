import { isUniversityEmail } from '../utils/universityEmail.js'
import { isValidNickname, normalizeNickname } from '../utils/nickname.js'

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
    async sendCode({ email, mode, nickname, captchaToken }) {
      if (mode !== 'login' && mode !== 'signup') throw new Error('認証方法を確認してください。')
      const normalizedEmail = email.trim().toLowerCase()
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
      if (!/^\d{8}$/.test(code)) throw new Error('8桁の認証コードを入力してください。')
      const { error } = await client.auth.verifyOtp({ email, token: code, type: 'email' })
      if (error) throw error
    },

    async loadProfile(user) {
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

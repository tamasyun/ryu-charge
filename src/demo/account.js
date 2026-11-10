export const DEMO_EMAIL = 'demo@example.com'
export const DEMO_NOTICE = 'デモアカウントでログインしました。追加・変更はこのブラウザ内だけに保存され、公開データには反映されません。ブラウザのデータを消すと利用できなくなります。'
export const DEMO_STORAGE_KEY = 'ryu-charge:demo:v1'
const SESSION_KEY = 'ryu-charge:demo-session:v1'

export function isDemoEmail(email) {
  return typeof email === 'string' && email.trim().toLowerCase() === DEMO_EMAIL
}

// 公開データのコピーは保存せず、このブラウザで行った追加・変更だけを持つ。
export function createDemoAccount({
  storage = () => window.localStorage,
  session = () => window.sessionStorage,
  uuid = () => crypto.randomUUID(),
} = {}) {
  const listeners = new Set()
  let generation = 0

  function read() {
    const raw = storage().getItem(DEMO_STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (data.version !== 1 || !data.userId || !['rooms', 'outlets', 'reviews', 'photos', 'passkeys'].every(key => Array.isArray(data[key]))) {
      throw new Error('デモの保存データを読み込めませんでした。')
    }
    return data
  }

  function write(data) {
    try {
      storage().setItem(DEMO_STORAGE_KEY, JSON.stringify(data))
    } catch {
      throw new Error('ブラウザに保存できませんでした。空き容量や保存設定を確認してください。')
    }
  }

  function isActive() {
    try { return session().getItem(SESSION_KEY) === 'active' } catch { return false }
  }

  function requireActive() {
    if (!isActive()) throw new Error('デモアカウントにログインしてください。')
    const data = read()
    if (!data) throw new Error('デモの保存データがありません。再ログインしてください。')
    return data
  }

  function emit(event) {
    generation += 1
    for (const listener of listeners) listener(event)
  }

  const api = {
    isActive,
    read,
    // 画像処理・パスキー操作中のログアウトやアカウント切替を検出する。
    capture() {
      const { userId } = requireActive()
      const current = generation
      return () => {
        if (generation !== current || requireActive().userId !== userId) {
          throw new Error('ログイン状態が変わりました。もう一度お試しください。')
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getUser() {
      if (!isActive()) return null
      const data = read()
      return data ? {
        id: data.userId, email: DEMO_EMAIL,
        app_metadata: { provider: 'browser-demo' }, user_metadata: { nickname: data.nickname },
      } : null
    },
    isUser(user) {
      return Boolean(isActive() && user?.app_metadata?.provider === 'browser-demo' && user.id === read()?.userId)
    },
    signIn() {
      if (!read()) write({ version: 1, userId: uuid(), nickname: 'デモアカウント', rooms: [], outlets: [], reviews: [], photos: [], passkeys: [] })
      session().setItem(SESSION_KEY, 'active')
      emit('SIGNED_IN')
      return { user: api.getUser() }
    },
    signOut() {
      session().removeItem(SESSION_KEY)
      emit('SIGNED_OUT')
    },
    profile() {
      const data = requireActive()
      return { id: data.userId, nickname: data.nickname }
    },
    updateNickname(nickname) {
      const data = requireActive()
      write({ ...data, nickname })
      return api.profile()
    },
    rows(table) { return requireActive()[table] },
    add(table, records) {
      const data = requireActive()
      const rows = records.map(record => ({
        ...record, id: record.id ?? uuid(), user_id: data.userId,
        created_at: new Date().toISOString(),
      }))
      if (table === 'reviews' && rows.some(row => data.reviews.some(item => item.room_id === row.room_id))) {
        throw new Error('この教室には既にレビューを投稿しています。')
      }
      write({ ...data, [table]: [...data[table], ...rows] })
      return rows
    },
    removeReview(id) {
      const data = requireActive()
      if (!data.reviews.some(row => row.id === id)) throw new Error('自分が追加したレビューだけ削除できます。')
      write({ ...data, reviews: data.reviews.filter(row => row.id !== id) })
      return { imageCleanupPending: false }
    },
    savePasskeys(passkeys) {
      const data = read()
      if (!data) throw new Error('デモアカウントがありません。')
      write({ ...data, passkeys })
    },
    removeAccount() {
      requireActive()
      storage().removeItem(DEMO_STORAGE_KEY)
      api.signOut()
      return { deleted: true }
    },
    mergeBuildings(buildings) {
      const data = requireActive()
      const author = row => ({ ...row, author_nickname: data.nickname })
      return buildings.map(building => ({
        ...building,
        rooms: [...(building.rooms ?? []), ...data.rooms.filter(room => room.building_id === building.id).map(author)]
          .map(room => ({
            ...room,
            outlets: [...(room.outlets ?? []), ...data.outlets.filter(outlet => outlet.room_id === room.id).map(author)],
          }))
          .sort((a, b) => (a.floor ?? 0) - (b.floor ?? 0) || a.name.localeCompare(b.name, 'ja')),
      }))
    },
    authorNames() {
      const { userId, nickname } = requireActive()
      return new Map([[userId, nickname]])
    },
    reviews(roomId) {
      const data = requireActive()
      return data.reviews.filter(row => row.room_id === roomId).map(row => ({ ...row, author_nickname: data.nickname }))
    },
  }
  return api
}

export const demoAccount = createDemoAccount()

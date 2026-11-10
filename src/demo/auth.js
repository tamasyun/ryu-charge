// デモのセッションをSupabaseのJWTや保存領域と混ぜない。
export function createAppAuth(auth, demo) {
  return {
    onAuthStateChange(callback) {
      let realSession = null
      const unsubscribe = demo.subscribe(event => {
        const user = demo.getUser()
        if (!user && realSession?.user) demo.rememberRealSignIn()
        callback(event, user ? { user } : realSession)
      })
      const { data: { subscription } } = auth.onAuthStateChange((event, session) => {
        realSession = session
        if (session?.user && !demo.isActive()) demo.rememberRealSignIn()
        const user = demo.getUser()
        callback(user ? 'SIGNED_IN' : event, user ? { user } : session)
      })
      return { data: { subscription: { unsubscribe() { unsubscribe(); subscription.unsubscribe() } } } }
    },
    async getUser() {
      return demo.isActive() ? { data: { user: demo.getUser() }, error: null } : auth.getUser()
    },
    async signOut() {
      if (!demo.isActive()) return auth.signOut()
      demo.signOut()
      return { error: null }
    },
  }
}

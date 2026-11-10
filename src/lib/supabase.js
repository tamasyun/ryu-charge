import { createClient } from '@supabase/supabase-js'
import { createAuthStorage } from './authStorage'
import { demoAccount } from '../demo/account.js'
import { createAppAuth } from '../demo/auth.js'
import { guardedFetch } from '../demo/network.js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const storageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`

function browserStorage(name) {
  try {
    return window[name]
  } catch {
    return null
  }
}

const authStorage = createAuthStorage(
  storageKey,
  browserStorage('localStorage'),
  browserStorage('sessionStorage')
)

export const setKeepSignedIn = authStorage.setKeepSignedIn

// Authユーザー削除後、サーバーへのsignOutが失敗しても保存済みセッションを除去する。
export async function clearDeletedAccountSession() {
  if (demoAccount.isActive()) {
    demoAccount.signOut()
    return
  }
  try {
    await supabase.auth.signOut({ scope: 'local' })
  } finally {
    authStorage.storage.removeItem(storageKey)
  }
}

export const supabase = createClient(
  supabaseUrl,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  {
    global: { fetch: guardedFetch({ isDemo: demoAccount.isActive }) },
    auth: {
      // supabase-js 2.117以降、パスキーAPIは既定で有効（experimental.passkeyは非推奨）。
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: authStorage.storage,
    },
  }
)

const publicReadClient = createClient(supabaseUrl, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'ryu-charge-public-reader' },
  global: { fetch: guardedFetch({ readOnly: true }) },
})

export const appAuth = createAppAuth(supabase.auth, demoAccount)
export const getDataClient = () => demoAccount.isActive() ? publicReadClient : supabase

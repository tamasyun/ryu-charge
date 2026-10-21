import { createClient } from '@supabase/supabase-js'
import { createAuthStorage } from './authStorage'

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

export const supabase = createClient(
  supabaseUrl,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: authStorage.storage,
    },
  }
)

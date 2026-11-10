import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { createAccountService } from '../services/account'

const account = createAccountService(supabase)

export function useAccount(user) {
  const userId = user?.id
  const email = user?.email
  const nickname = user?.user_metadata?.nickname
  const [result, setResult] = useState(null)
  const [revision, setRevision] = useState(0)
  const reloadProfile = useCallback(() => setRevision(value => value + 1), [])
  const updateProfile = useCallback(profile => {
    setResult({ userId, revision, profile, status: 'ready' })
  }, [userId, revision])

  useEffect(() => {
    if (!userId) return undefined
    let active = true
    account.loadProfile({ id: userId, email, user_metadata: { nickname } }).then(profile => {
      if (active) setResult({ userId, revision, profile, status: profile ? 'ready' : 'missing' })
    }).catch(() => {
      if (active) setResult({ userId, revision, profile: null, status: 'error' })
    })
    return () => { active = false }
  }, [userId, email, nickname, revision])

  const current = userId && result?.userId === userId && result.revision === revision
    ? result
    : { profile: null, status: userId ? 'loading' : 'idle' }

  return { profile: current.profile, status: current.status, reloadProfile, updateProfile }
}

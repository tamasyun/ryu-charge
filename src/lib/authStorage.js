// Keep Supabase's existing storage key so already signed-in users stay signed in.
export function createAuthStorage(storageKey, localStorage, sessionStorage) {
  let keepSignedIn = true
  let preferenceSelected = false
  const memory = new Map()

  function read(storage, key) {
    try {
      return storage?.getItem(key) ?? null
    } catch {
      return null
    }
  }

  function write(storage, key, value) {
    try {
      storage?.setItem(key, value)
      return Boolean(storage)
    } catch {
      return false
    }
  }

  function remove(storage, key) {
    try {
      storage?.removeItem(key)
    } catch {
      // A blocked storage area must not prevent signing out of this tab.
    }
  }

  return {
    setKeepSignedIn(value) {
      keepSignedIn = value
      preferenceSelected = true
    },
    storage: {
      getItem(key) {
        if (memory.has(key)) return memory.get(key)

        if (key === storageKey) {
          const tabSession = read(sessionStorage, key)
          if (tabSession !== null) {
            if (!preferenceSelected) keepSignedIn = false
            return tabSession
          }
          const savedSession = read(localStorage, key)
          if (savedSession !== null) {
            if (!preferenceSelected) keepSignedIn = true
            return savedSession
          }
          return null
        }

        const preferred = keepSignedIn ? localStorage : sessionStorage
        const other = keepSignedIn ? sessionStorage : localStorage
        return read(preferred, key) ?? read(other, key)
      },
      setItem(key, value) {
        const preferred = keepSignedIn ? localStorage : sessionStorage
        const other = keepSignedIn ? sessionStorage : localStorage
        if (write(preferred, key, value)) {
          memory.delete(key)
        } else {
          memory.set(key, value)
        }
        remove(other, key)
      },
      removeItem(key) {
        memory.delete(key)
        remove(localStorage, key)
        remove(sessionStorage, key)
      },
    },
  }
}

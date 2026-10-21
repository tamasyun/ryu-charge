import assert from 'node:assert/strict'
import test from 'node:test'
import { createAuthStorage } from '../src/lib/authStorage.js'

const key = 'sb-example-auth-token'

function storage() {
  const values = new Map()
  return {
    getItem(name) { return values.get(name) ?? null },
    setItem(name, value) { values.set(name, value) },
    removeItem(name) { values.delete(name) },
  }
}

test('existing local session stays available after adding the storage adapter', () => {
  const local = storage()
  const session = storage()
  local.setItem(key, 'old-token')

  const auth = createAuthStorage(key, local, session)
  assert.equal(auth.storage.getItem(key), 'old-token')
  auth.storage.setItem(key, 'refreshed-token')
  assert.equal(local.getItem(key), 'refreshed-token')
  assert.equal(session.getItem(key), null)
})

test('session choice survives reload and refresh, then can move to persistent storage', () => {
  const local = storage()
  const session = storage()
  const auth = createAuthStorage(key, local, session)

  auth.setKeepSignedIn(false)
  auth.storage.setItem(key, 'tab-token')
  assert.equal(local.getItem(key), null)
  assert.equal(session.getItem(key), 'tab-token')

  const reloaded = createAuthStorage(key, local, session)
  assert.equal(reloaded.storage.getItem(key), 'tab-token')
  reloaded.storage.setItem(key, 'refreshed-token')
  assert.equal(local.getItem(key), null)
  assert.equal(session.getItem(key), 'refreshed-token')

  reloaded.setKeepSignedIn(true)
  reloaded.storage.setItem(key, 'saved-token')
  assert.equal(local.getItem(key), 'saved-token')
  assert.equal(session.getItem(key), null)
})

test('sign-out clears both storage areas', () => {
  const local = storage()
  const session = storage()
  local.setItem(key, 'old-token')
  session.setItem(key, 'tab-token')

  const auth = createAuthStorage(key, local, session)
  auth.storage.removeItem(key)
  assert.equal(local.getItem(key), null)
  assert.equal(session.getItem(key), null)
})

test('a login choice is not overwritten by an older saved session', () => {
  const local = storage()
  const session = storage()
  local.setItem(key, 'old-token')

  const auth = createAuthStorage(key, local, session)
  auth.setKeepSignedIn(false)
  assert.equal(auth.storage.getItem(key), 'old-token')
  auth.storage.setItem(key, 'new-token')
  assert.equal(local.getItem(key), null)
  assert.equal(session.getItem(key), 'new-token')
})

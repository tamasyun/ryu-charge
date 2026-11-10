import assert from 'node:assert/strict'
import test from 'node:test'
import { webcrypto } from 'node:crypto'
import { createDemoAccount } from '../src/demo/account.js'
import { createDemoPasskeys } from '../src/demo/passkeys.js'

const location = { origin: 'https://demo.example.test', hostname: 'demo.example.test' }
const encoder = new TextEncoder()
const bytes = value => Buffer.from(value)
const encode = value => bytes(value).toString('base64url')

function der(signature) {
  const parts = [signature.slice(0, 32), signature.slice(32)].map(part => {
    while (part.length > 1 && part[0] === 0) part = part.slice(1)
    if (part[0] & 0x80) part = Buffer.concat([Buffer.from([0]), part])
    return Buffer.concat([Buffer.from([2, part.length]), part])
  })
  const body = Buffer.concat(parts)
  return Buffer.concat([Buffer.from([0x30, body.length]), body])
}

async function fixture(alg = -7) {
  const values = new Map()
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  const demo = createDemoAccount({ storage: () => storage, session: () => storage, uuid: () => 'local-user' })
  demo.signIn()
  const algorithm = alg === -7 ? { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }
  const pair = await webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify'])
  const publicKey = await webcrypto.subtle.exportKey('spki', pair.publicKey)
  const authData = new Uint8Array(37)
  authData.set(new Uint8Array(await webcrypto.subtle.digest('SHA-256', encoder.encode(location.hostname))))
  authData[32] = 5
  let bad = ''
  const clientData = (type, challenge) => encoder.encode(JSON.stringify({ type,
    challenge: bad === 'challenge' ? 'wrong' : encode(challenge),
    origin: bad === 'origin' ? 'https://wrong.test' : location.origin, crossOrigin: bad === 'crossOrigin',
  }))
  const credentials = {
    async create({ publicKey: options }) {
      return { rawId: encoder.encode('credential'), response: {
        clientDataJSON: clientData('webauthn.create', options.challenge),
        getPublicKey: () => publicKey, getPublicKeyAlgorithm: () => alg,
        getAuthenticatorData: () => authData, getTransports: () => ['internal'],
      } }
    },
    async get({ publicKey: options }) {
      const clientDataJSON = clientData('webauthn.get', options.challenge)
      const hash = new Uint8Array(await webcrypto.subtle.digest('SHA-256', clientDataJSON))
      const signed = new Uint8Array([...authData, ...hash])
      let signature = bytes(await webcrypto.subtle.sign(algorithm, pair.privateKey, signed))
      if (alg === -7) signature = der(signature)
      if (bad === 'signature') signature[signature.length - 1] ^= 0xff
      return { rawId: encoder.encode('credential'), response: {
        clientDataJSON, authenticatorData: authData, signature, userHandle: encoder.encode('local-user'),
      } }
    },
  }
  return { demo, authData, corrupt: value => { bad = value },
    passkeys: createDemoPasskeys(demo, { credentials: () => credentials, location: () => location, webCrypto: () => webcrypto }) }
}

for (const algorithm of [-7, -257]) {
  test(`local passkey ${algorithm}: register, rename, sign out and verify a real signature before signing in`, async () => {
    const f = await fixture(algorithm)
    const key = await f.passkeys.register()
    await f.passkeys.rename(key.id, 'この端末')
    assert.equal((await f.passkeys.list())[0].friendly_name, 'この端末')
    f.demo.signOut()
    assert.equal(f.demo.isActive(), false)
    const result = await f.passkeys.signIn()
    assert.equal(result.user.id, 'local-user')
    assert.ok((await f.passkeys.list())[0].last_used_at)
    await f.passkeys.remove(key.id)
    assert.equal((await f.passkeys.list()).length, 0)
  })
}

test('invalid signature, challenge, origin, cross-origin and missing user verification cannot log in', async () => {
  const f = await fixture()
  await f.passkeys.register()
  f.demo.signOut()
  for (const value of ['signature', 'challenge', 'origin', 'crossOrigin']) {
    f.corrupt(value)
    await assert.rejects(f.passkeys.signIn())
    assert.equal(f.demo.isActive(), false)
  }
  f.corrupt('')
  f.authData[32] = 1
  await assert.rejects(f.passkeys.signIn())
  assert.equal(f.demo.isActive(), false)
})

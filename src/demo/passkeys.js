import { demoAccount, DEMO_EMAIL } from './account.js'

function encode(value) {
  return btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decode(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))
}

// WebAuthnのES256署名（DER）をWeb Cryptoのr||s形式へ変換する。
function ecdsaSignature(signature) {
  const bytes = new Uint8Array(signature)
  if (bytes[0] !== 0x30 || bytes[1] !== bytes.length - 2) throw new Error('署名形式が不正です。')
  let offset = 2
  const output = new Uint8Array(64)
  for (let i = 0; i < 2; i++) {
    if (bytes[offset++] !== 2) throw new Error('署名形式が不正です。')
    const size = bytes[offset++]
    let part = bytes.slice(offset, offset + size)
    offset += size
    if (part.length === 33 && part[0] === 0) part = part.slice(1)
    if (!part.length || part.length > 32) throw new Error('署名形式が不正です。')
    output.set(part, i * 32 + 32 - part.length)
  }
  if (offset !== bytes.length) throw new Error('署名形式が不正です。')
  return output
}

export function createDemoPasskeys(demo, {
  credentials = () => navigator.credentials,
  location = () => window.location,
  webCrypto = () => crypto,
} = {}) {
  const challenge = () => webCrypto().getRandomValues(new Uint8Array(32))
  async function validate(response, expected, type, authData) {
    const client = JSON.parse(new TextDecoder().decode(response.clientDataJSON))
    if (client.type !== type || client.challenge !== encode(expected) || client.origin !== location().origin || client.crossOrigin) {
      throw new Error('パスキーの応答を確認できませんでした。')
    }
    const data = new Uint8Array(authData)
    const rpHash = new Uint8Array(await webCrypto().subtle.digest('SHA-256', new TextEncoder().encode(location().hostname)))
    if (data.length < 37 || !rpHash.every((byte, i) => data[i] === byte) || (data[32] & 5) !== 5) {
      throw new Error('パスキーの本人確認を完了できませんでした。')
    }
  }

  return {
    async register() {
      const guard = demo.capture()
      const data = demo.read()
      const nonce = challenge()
      const credential = await credentials().create({ publicKey: {
        challenge: nonce,
        rp: { id: location().hostname, name: '琉CHARGE デモ' },
        user: { id: new TextEncoder().encode(data.userId), name: DEMO_EMAIL, displayName: data.nickname },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
        excludeCredentials: data.passkeys.map(key => ({ id: decode(key.id), type: 'public-key' })),
        attestation: 'none', timeout: 60000,
      } })
      if (!credential) throw new Error('パスキー登録をキャンセルしました。')
      guard()
      const response = credential.response
      const publicKey = response.getPublicKey?.()
      const algorithm = response.getPublicKeyAlgorithm?.()
      if (!publicKey || ![-7, -257].includes(algorithm)) throw new Error('このブラウザではデモ用パスキーを登録できません。')
      await validate(response, nonce, 'webauthn.create', response.getAuthenticatorData())
      guard()
      const record = {
        id: encode(credential.rawId), publicKey: encode(publicKey), algorithm,
        transports: response.getTransports?.() ?? [], friendly_name: 'デモ用パスキー',
        created_at: new Date().toISOString(), last_used_at: null,
      }
      demo.savePasskeys([...demo.read().passkeys, record])
      return record
    },
    async signIn() {
      const data = demo.read()
      if (!data?.passkeys.length) throw new Error('先にデモアカウントの設定からパスキーを登録してください。')
      const nonce = challenge()
      const credential = await credentials().get({ publicKey: {
        challenge: nonce, rpId: location().hostname, userVerification: 'required', timeout: 60000,
        allowCredentials: data.passkeys.map(key => ({ type: 'public-key', id: decode(key.id), transports: key.transports })),
      } })
      if (!credential) throw new Error('パスキーログインをキャンセルしました。')
      const key = data.passkeys.find(key => key.id === encode(credential.rawId))
      if (!key || demo.read()?.userId !== data.userId) throw new Error('デモ用のパスキーが見つかりません。')
      const response = credential.response
      await validate(response, nonce, 'webauthn.get', response.authenticatorData)
      if (response.userHandle && new TextDecoder().decode(response.userHandle) !== data.userId) throw new Error('パスキーのアカウントが一致しません。')
      const algorithm = key.algorithm === -7 ? { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
      const publicKey = await webCrypto().subtle.importKey('spki', decode(key.publicKey), algorithm, false, ['verify'])
      const clientHash = new Uint8Array(await webCrypto().subtle.digest('SHA-256', response.clientDataJSON))
      const authData = new Uint8Array(response.authenticatorData)
      const signed = new Uint8Array(authData.length + clientHash.length)
      signed.set(authData); signed.set(clientHash, authData.length)
      const valid = await webCrypto().subtle.verify(algorithm, publicKey,
        key.algorithm === -7 ? ecdsaSignature(response.signature) : response.signature, signed)
      if (!valid) throw new Error('パスキーの署名を確認できませんでした。')
      const current = demo.read()
      if (current?.userId !== data.userId || !current.passkeys.some(item => item.id === key.id)) throw new Error('デモ用のパスキーが削除されました。')
      demo.savePasskeys(current.passkeys.map(item => item.id === key.id ? { ...item, last_used_at: new Date().toISOString() } : item))
      return demo.signIn()
    },
    async list() { return demo.rows('passkeys') },
    async rename(id, friendly_name) {
      const keys = demo.rows('passkeys')
      if (!keys.some(key => key.id === id)) throw new Error('パスキーが見つかりません。')
      demo.savePasskeys(keys.map(key => key.id === id ? { ...key, friendly_name } : key))
    },
    async remove(id) { demo.savePasskeys(demo.rows('passkeys').filter(key => key.id !== id)) },
  }
}

export const demoPasskeys = createDemoPasskeys(demoAccount)

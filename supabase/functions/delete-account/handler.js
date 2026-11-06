const CONFIRMATION = '削除する'

export function reviewImagePath(value, supabaseUrl) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    const prefix = '/storage/v1/object/public/review-images/'
    if (url.origin !== new URL(supabaseUrl).origin || !url.pathname.startsWith(prefix)) return null
    const name = decodeURIComponent(url.pathname.slice(prefix.length))
    if (!name || name.split('/').some(part => !part || part === '.' || part === '..') || /\p{Cc}/u.test(name) || name.includes('\\')) return null
    return name
  } catch { return null }
}

export async function hashProof(proof) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(proof))
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('')
}

// Denoの起動処理と分離し、認可・途中失敗・Storage削除の順序をNodeでもテストする。
export function createDeleteAccountHandler({ admin, createVerifier, supabaseUrl, allowedOrigins }) {
  return async function handle(request) {
    const origin = request.headers.get('origin')
    const headers = {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      ...(origin && allowedOrigins.includes(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    }
    const response = (status, body) => new Response(JSON.stringify(body), { status, headers })
    if (origin && !allowedOrigins.includes(origin)) return response(403, { code: 'origin_not_allowed', message: 'この接続先からは実行できません。' })
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return response(405, { message: 'POSTを使用してください。' })
    const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]
    if (!token) return response(401, { code: 'not_authenticated', message: '再ログインしてからお試しください。' })
    let user
    try {
      const result = await admin.auth.getUser(token)
      if (result.error || !result.data?.user || result.data.user.is_anonymous || !result.data.user.email_confirmed_at) {
        return response(401, { code: 'not_authenticated', message: 'セッションを確認できませんでした。再ログインしてください。' })
      }
      user = result.data.user
    } catch { return response(503, { message: '本人情報を確認できませんでした。時間をおいて再試行してください。' }) }

    let body
    try {
      const text = await request.text()
      if (text.length > 8192) return response(413, { message: 'リクエストが大きすぎます。' })
      body = JSON.parse(text)
      if (!body || typeof body !== 'object') throw new Error('invalid_body')
    } catch { return response(400, { message: '入力内容を確認してください。' }) }

    if (body.action === 'status') {
      try {
        const { data, error } = await admin.rpc('account_deletion_status', { p_user_id: user.id })
        if (error) throw error
        return response(200, { pending: Boolean(data) })
      } catch { return response(503, { message: '削除状態を確認できませんでした。' }) }
    }

    if (body.action === 'verify') {
      if (typeof body.code !== 'string' || !/^\d{8}$/.test(body.code)) return response(400, { message: '8桁の認証コードを入力してください。' })
      try {
        // 受信したJWTのiatだけでは再認証と認めない。本人メール宛ての新しいOTPをAuthで検証する。
        const { data, error } = await createVerifier().auth.verifyOtp({ email: user.email, token: body.code, type: 'email' })
        if (data?.session?.access_token) {
          const { error: revokeError } = await admin.auth.admin.signOut(data.session.access_token, 'local')
          if (revokeError) throw revokeError
        }
        if (error || data?.user?.id !== user.id) return response(400, { code: 'invalid_otp', message: '認証コードが正しくないか期限切れです。必要なら再送信してください。' })
        const proof = Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('')
        const saved = await admin.rpc('issue_account_deletion_proof', { p_user_id: user.id, p_proof_hash: await hashProof(proof) })
        if (saved.error) throw saved.error
        return response(200, { proof })
      } catch { return response(503, { message: '本人確認を完了できませんでした。コードを再送信してお試しください。' }) }
    }

    if (body.action !== 'delete' || body.confirmation !== CONFIRMATION || !/^[0-9a-f]{64}$/.test(body.proof)) {
      return response(400, { message: '本人確認と削除の最終確認を完了してください。' })
    }
    let prepared = false
    try {
      const reviewFiles = []
      // PostgRESTの既定行数制限で写真を取りこぼさない。
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await admin.from('room_reviews').select('id, image_url')
          .eq('user_id', user.id).order('id').range(offset, offset + 499)
        if (error) throw error
        for (const review of data ?? []) {
          const name = reviewImagePath(review.image_url, supabaseUrl)
          if (name) reviewFiles.push({ name, url: review.image_url })
        }
        if ((data ?? []).length < 500) break
      }
      const result = await admin.rpc('prepare_account_deletion', {
        p_user_id: user.id, p_proof_hash: await hashProof(body.proof), p_review_files: reviewFiles,
      })
      if (result.error?.code === '28000') return response(403, { code: 'reauth_required', message: '本人確認の期限が切れました。コードを再送信して本人確認をやり直してください。' })
      if (result.error) throw result.error
      prepared = true
      const buckets = new Map()
      for (const file of result.data ?? []) {
        if (!buckets.has(file.bucket_id)) buckets.set(file.bucket_id, [])
        buckets.get(file.bucket_id).push(file.name)
      }
      for (const [bucket, paths] of buckets) {
        for (let offset = 0; offset < paths.length; offset += 100) {
          const { error } = await admin.storage.from(bucket).remove(paths.slice(offset, offset + 100))
          if (error) throw error
        }
      }
      // 最後にAuthを削除。トリガーがレビューを削除し、FKがプロフィール・パスキー・セッションを削除する。
      const { error } = await admin.auth.admin.deleteUser(user.id, false)
      if (error) throw error
      return response(200, { deleted: true })
    } catch {
      return response(503, { code: 'deletion_pending', message: '削除処理を完了できませんでした。一部の写真が削除済みの場合があります。認証ユーザーは削除完了まで残ります。同じ画面から再試行してください。' })
    } finally {
      if (prepared) {
        try { await admin.rpc('release_account_deletion_lease', { p_user_id: user.id }) } catch { /* リースは2分後にも解除される。 */ }
      }
    }
  }
}

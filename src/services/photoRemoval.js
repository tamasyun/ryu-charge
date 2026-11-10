// SELECTを削除APIだけに限定しているため、list/infoの拒否は不存在の根拠にならない。
// 公開URLをキャッシュを避けて取得し、明示的なNot Foundだけを不存在と扱う。
export async function verifyPublicPhotoAbsent(publicUrl, { fetchImpl = fetch } = {}) {
  const url = new URL(publicUrl)
  url.searchParams.set('cacheNonce', crypto.randomUUID())
  const response = await fetchImpl(url.href, {
    method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error',
    headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(15000),
  })
  if (response.status === 404) { await response.body?.cancel(); return }
  // Storage APIはNot FoundをHTTP 400 + JSON statusCode:404で返す場合がある。
  if (response.status === 400) {
    const body = await response.json()
    if (String(body?.statusCode) === '404' && body?.message === 'Object not found') return
  } else {
    await response.body?.cancel()
  }
  throw new Error(response.ok ? '削除後も写真ファイルが存在しています。' : '写真ファイルの削除後の存在確認ができませんでした。')
}

export async function removePhotoObjects(client, bucket, paths, { verifyAbsent = verifyPublicPhotoAbsent } = {}) {
  if (!Array.isArray(paths) || new Set(paths).size !== paths.length) throw new Error('削除対象の写真パスが不正です。')
  if (!paths.length) return []
  const storage = client.storage.from(bucket)
  const { data, error } = await storage.remove(paths)
  if (error) throw error
  const removed = new Set((data ?? []).map(item => item.name))
  if (data?.length !== paths.length || removed.size !== paths.length || paths.some(path => !removed.has(path))) {
    throw new Error('写真ファイルの削除件数が一致しません。')
  }
  await Promise.all(paths.map(path => verifyAbsent(storage.getPublicUrl(path).data.publicUrl)))
  return data
}

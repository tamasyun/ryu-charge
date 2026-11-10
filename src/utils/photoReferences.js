// 公開URLをこのプロジェクト・バケットのStorageパスに限定して解釈する。
export function publicPhotoPath(value, supabaseUrl, bucket) {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(value)
    const base = new URL(supabaseUrl)
    const prefix = `/storage/v1/object/public/${bucket}/`
    if (url.origin !== base.origin || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(prefix)) return null
    const path = decodeURIComponent(url.pathname.slice(prefix.length))
    if (path.includes('\\') || [...path].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || path.split('/').some(part => !part || part === '.' || part === '..')) return null
    return path
  } catch {
    return null
  }
}

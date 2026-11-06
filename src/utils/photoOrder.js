// DBのcreated_atが同値でも、新しいバッチの写真を選択順に復元する。
// 既存のUUIDだけのファイル名には手を加えず、その表示位置を維持する。
export function orderPhotoBatches(photos) {
  const groups = new Map()
  const keyFor = photo => {
    const match = photo.storage_path?.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(\d{2})\.(?:jpg|png|webp)$/i)
    return match ? { key: `${photo.created_at}:${match[1]}`, position: Number(match[2]) } : null
  }
  for (const photo of photos) {
    const batch = keyFor(photo)
    if (!batch) continue
    const group = groups.get(batch.key) ?? []
    group.push({ photo, position: batch.position })
    groups.set(batch.key, group)
  }
  for (const group of groups.values()) group.sort((a, b) => a.position - b.position)
  return photos.map(photo => {
    const batch = keyFor(photo)
    return batch ? groups.get(batch.key).shift().photo : photo
  })
}

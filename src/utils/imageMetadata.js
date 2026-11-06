// Canvasのエンコーダー自体がEXIFを付けるSafari等でも、保存する候補から除去する。
export function stripImageMetadata(bytes, type, orientationOnly = false) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = (start, end) => new TextDecoder().decode(bytes.subarray(start, end))
  const parts = []
  if (type === 'image/jpeg') {
    parts.push(bytes.subarray(0, 2))
    let offset = 2
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) throw new Error('JPEGの構造が不正です。')
      const start = offset++
      while (bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]
      if (marker === 0xda || marker === 0xd9) {
        parts.push(bytes.subarray(start))
        return new Blob(parts, { type })
      }
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) throw new Error('JPEGの構造が不正です。')
      if (!(orientationOnly ? marker === 0xe1 : (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe)) parts.push(bytes.subarray(start, offset + length))
      offset += length
    }
  } else if (type === 'image/png') {
    parts.push(bytes.subarray(0, 8))
    let offset = 8
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset)
      const end = offset + length + 12
      if (end > bytes.length) throw new Error('PNGの構造が不正です。')
      const name = text(offset + 4, offset + 8)
      if (!(orientationOnly ? ['eXIf'] : ['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']).includes(name)) parts.push(bytes.subarray(offset, end))
      offset = end
      if (name === 'IEND') return new Blob(parts, { type })
    }
  } else if (type === 'image/webp') {
    let offset = 12
    while (offset + 8 <= bytes.length) {
      const name = text(offset, offset + 4)
      const length = view.getUint32(offset + 4, true)
      const end = offset + 8 + length + (length % 2)
      if (end > bytes.length) throw new Error('WebPの構造が不正です。')
      if (!(orientationOnly ? ['EXIF'] : ['EXIF', 'XMP ', 'ICCP']).includes(name)) {
        const chunk = bytes.slice(offset, end)
        if (name === 'VP8X') chunk[8] &= ~(orientationOnly ? 0x08 : 0x08 | 0x04 | 0x20)
        parts.push(chunk)
      }
      offset = end
    }
    if (offset !== bytes.length) throw new Error('WebPの構造が不正です。')
    const header = bytes.slice(0, 12)
    new DataView(header.buffer).setUint32(4, 4 + parts.reduce((sum, part) => sum + part.length, 0), true)
    return new Blob([header, ...parts], { type })
  }
  throw new Error('画像のメタデータを除去できませんでした。')
}

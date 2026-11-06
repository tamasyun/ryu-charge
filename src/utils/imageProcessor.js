import { stripImageMetadata } from './imageMetadata.js'
import { JPG } from 'image-size/types/jpg'
import { PNG } from 'image-size/types/png'
import { WEBP } from 'image-size/types/webp'
import { HEIF } from 'image-size/types/heif'

export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif'
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
export const MAX_INPUT_BYTES = 30 * 1024 * 1024
export const MAX_INPUT_PIXELS = 50_000_000
const MAX_INPUT_SIDE = 16384
const MAX_OUTPUT_SIDE = 1600
const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const processed = new WeakSet()
let queue = Promise.resolve()

export function extensionForType(type) {
  if (!extensions[type]) throw new Error('変換後の画像形式が不正です。')
  return extensions[type]
}

function checkDimensions({ width, height }, output = false) {
  const side = output ? MAX_OUTPUT_SIDE : MAX_INPUT_SIDE
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > side || height > side || width * height > MAX_INPUT_PIXELS) {
    throw new Error(output ? '変換後の画像サイズが不正です。' : '写真は5000万画素・一辺16384px以下にしてください。')
  }
}

// HEIFのclap（クロップ）適用前の画素数も確認する。
function checkHeifProperties(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const text = (start, end) => new TextDecoder().decode(bytes.subarray(start, end))
  let found = false
  function visit(start, end, depth) {
    if (depth > 4) throw new Error('HEIFの構造が不正です。')
    for (let offset = start; offset < end;) {
      if (offset + 8 > end) throw new Error('HEIFの構造が不正です。')
      let size = view.getUint32(offset)
      const type = text(offset + 4, offset + 8)
      let header = 8
      if (size === 1) {
        if (offset + 16 > end) throw new Error('HEIFの構造が不正です。')
        size = Number(view.getBigUint64(offset + 8))
        header = 16
      } else if (size === 0) size = end - offset
      if (size < header || offset + size > end) throw new Error('HEIFの構造が不正です。')
      if (type === 'ispe') {
        if (size < header + 12) throw new Error('HEIFの構造が不正です。')
        checkDimensions({ width: view.getUint32(offset + header + 4), height: view.getUint32(offset + header + 8) })
        found = true
      } else if (['meta', 'iprp', 'ipco'].includes(type)) {
        visit(offset + header + (type === 'meta' ? 4 : 0), offset + size, depth + 1)
      }
      offset += size
    }
  }
  visit(0, bytes.length, 0)
  if (!found) throw new Error('HEIFの画素数を確認できませんでした。')
}

// デコードより先にバイト列を確認する。拡張子は形式判定に使わない。
export function inspectImage(bytes, declaredType = '') {
  let info
  let type
  for (const [parser, mime] of [[JPG, 'image/jpeg'], [PNG, 'image/png'], [WEBP, 'image/webp'], [HEIF, 'image/heif']]) {
    if (parser.validate(bytes)) {
      if (mime === 'image/heif') checkHeifProperties(bytes)
      info = parser.calculate(bytes)
      type = mime
      break
    }
  }
  if (!info || (type === 'image/heif' && !['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(info.type))) {
    throw new Error('JPEG・PNG・WebP・HEIC・HEIF形式の写真を選択してください。')
  }
  const mime = declaredType.toLowerCase()
  const matches = type === 'image/heif'
    ? ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'].includes(mime)
    : mime === type
  if (mime && mime !== 'application/octet-stream' && !matches) {
    throw new Error('写真のMIMEタイプと実際の画像形式が一致しません。')
  }
  checkDimensions(info)
  // HEIFではサムネイル・タイルだけでなく全てのispeを検査する。
  for (const dimensions of info.images ?? []) checkDimensions(dimensions)
  return { ...info, type }
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    const finish = error => {
      clearTimeout(timer)
      img.onload = img.onerror = null
      URL.revokeObjectURL(url)
      if (error) { img.src = ''; reject(error) }
      else resolve(img)
    }
    const timer = setTimeout(() => finish(new Error('写真の読み込みがタイムアウトしました。')), 30000)
    img.onload = () => finish()
    img.onerror = () => finish(new Error('写真を読み込めませんでした。別の写真を選択してください。'))
    // ラスター画像はEXIFを取り除いてから読み込み、共通の変換行列で向きを適用する。
    img.src = url
  })
}

async function decode(file, info) {
  try {
    return await loadImage(file)
  } catch (error) {
    if (info.type !== 'image/heif') throw error
    // HEIC非対応ブラウザでのみロード。libheifがirot/imirも適用する。
    return decodeHeif(file)
  }
}

function decodeHeif(file) {
  return new Promise((resolve, reject) => {
    // 変換ごとのWorkerに隔離し、終了時にデコーダーのメモリも解放する。
    const worker = new Worker(new URL('./heicDecoder.worker.js', import.meta.url), { type: 'module' })
    const finish = () => { clearTimeout(timer); worker.terminate() }
    const timer = setTimeout(() => {
      finish()
      reject(new Error('HEIC/HEIFの変換がタイムアウトしました。小さい写真を選択してください。'))
    }, 60000)
    worker.onmessage = ({ data }) => {
      finish()
      if (data.error) reject(new Error('HEIC/HEIFを変換できませんでした。別の写真を選択してください。'))
      else resolve(data.bitmap)
    }
    worker.onerror = () => {
      finish()
      reject(new Error('HEIC/HEIFの変換を開始できませんでした。'))
    }
    worker.postMessage(file)
  })
}

async function encode(canvas, type) {
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('写真を変換できませんでした。')), type, 0.8)
  })
  if (type !== 'image/webp' || blob.type === type) return blob
  // WebPを表示できてもCanvasでエンコードできないSafari等にはWASMを使う。
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./webpEncoder.worker.js', import.meta.url), { type: 'module' })
    const finish = () => { clearTimeout(timer); worker.terminate() }
    const timer = setTimeout(() => { finish(); reject(new Error('WebP変換がタイムアウトしました。')) }, 60000)
    worker.onmessage = ({ data }) => {
      finish()
      if (data.error) reject(new Error('WebPに変換できませんでした。'))
      else resolve(new Blob([data.buffer], { type: 'image/webp' }))
    }
    worker.onerror = () => { finish(); reject(new Error('WebP変換を開始できませんでした。')) }
    worker.postMessage(pixels, [pixels.data.buffer])
  })
}

async function convert(file) {
  if (processed.has(file)) return file
  if (!(file instanceof Blob) || !file.size) throw new Error('空の写真は選択できません。')
  if (file.size > MAX_INPUT_BYTES) throw new Error('変換前の写真は1枚30MB以下にしてください。')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const info = inspectImage(bytes, file.type)
  let orientation = 1
  let source = file
  if (info.type !== 'image/heif') {
    const { default: ExifReader } = await import('exifreader')
    try {
      const tags = ExifReader.load(bytes.buffer, { includeTags: { exif: ['Orientation'] } })
      const value = tags.Orientation?.value
      if (Number.isInteger(value) && value >= 1 && value <= 8) orientation = value
    } catch {
      // 向きの情報がない画像は標準方向として扱う。
    }
    // ブラウザによるEXIF対応差と二重回転を避ける。入力のICC色プロファイルは維持。
    source = stripImageMetadata(bytes, info.type, true)
  }
  const image = await decode(source, info)
  const canvas = document.createElement('canvas')
  try {
    const width = image.naturalWidth || image.width
    const height = image.naturalHeight || image.height
    checkDimensions({ width, height })
    // EXIF除去後の実デコード寸法をヘッダーと照合する。
    if (info.type !== 'image/heif' && (width !== info.width || height !== info.height)) {
      throw new Error('写真のヘッダーと読み込み結果が一致しません。')
    }
    const rotated = orientation >= 5
    const orientedWidth = rotated ? height : width
    const orientedHeight = rotated ? width : height
    const scale = Math.min(1, MAX_OUTPUT_SIDE / Math.max(orientedWidth, orientedHeight))
    canvas.width = Math.max(1, Math.round(orientedWidth * scale))
    canvas.height = Math.max(1, Math.round(orientedHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('このブラウザでは写真を変換できません。')
    const transforms = [
      [1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 0], [-1, 0, 0, 1, width, 0],
      [-1, 0, 0, -1, width, height], [1, 0, 0, -1, 0, height],
      [0, 1, 1, 0, 0, 0], [0, 1, -1, 0, height, 0],
      [0, -1, -1, 0, height, width], [0, -1, 1, 0, 0, width],
    ]
    context.setTransform(...transforms[orientation].map(value => value * scale))
    context.drawImage(image, 0, 0)
    // 全候補を新しいcanvasから作るので、元のEXIF/GPS/日時は引き継がない。
    // PNG/WebPはJPEG候補を作らず、透明部分を保持する。
    const types = new Set(['image/webp', info.type === 'image/heif' ? 'image/png' : info.type])
    if (info.type === 'image/heif') types.add('image/jpeg')
    const candidates = []
    for (const type of types) {
      const encoded = await encode(canvas, type)
      const blob = stripImageMetadata(new Uint8Array(await encoded.arrayBuffer()), encoded.type)
      // Safari等が未対応形式をPNGにフォールバックしても実形式で扱う。
      const actual = inspectImage(new Uint8Array(await blob.arrayBuffer()), blob.type)
      extensionForType(actual.type)
      checkDimensions(actual, true)
      if (actual.width !== canvas.width || actual.height !== canvas.height) throw new Error('変換後の画像を検証できませんでした。')
      candidates.push(blob)
    }
    candidates.sort((a, b) => a.size - b.size)
    const result = candidates[0]
    if (result.size > MAX_UPLOAD_BYTES) throw new Error('圧縮後も写真が5MBを超えています。小さい写真を選択してください。')
    // 出力も実際にデコードできることを確認してからStorageに渡す。
    const verified = await loadImage(result)
    if (verified.naturalWidth !== canvas.width || verified.naturalHeight !== canvas.height) throw new Error('変換後の写真を読み込めませんでした。')
    verified.src = ''
    const name = (file.name || 'photo').replace(/\.[^.]*$/, '')
    const output = new File([result], `${name}.${extensionForType(result.type)}`, { type: result.type })
    processed.add(output)
    return output
  } finally {
    image.close?.()
    if ('src' in image) image.src = ''
    canvas.width = canvas.height = 1
  }
}

// 別フォームから同時に選択された場合も大きな画像を並列デコードしない。
export function processImage(file) {
  const task = queue.then(() => convert(file)).catch(error => {
    throw new Error(`${file?.name || '写真'}：${error.message || '写真の変換に失敗しました。'}`, { cause: error })
  })
  queue = task.catch(() => {})
  return task
}

export async function processImages(files, onProgress = () => {}) {
  const result = []
  for (const [index, file] of files.entries()) {
    onProgress({ phase: 'processing', current: index + 1, total: files.length })
    result.push(await processImage(file))
  }
  return result
}

import { demoAccount } from './account.js'
import { processImages } from '../utils/imageProcessor.js'

function dataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('写真を読み込めませんでした。'))
    reader.readAsDataURL(file)
  })
}

export async function prepareDemoPhotos(files, onProgress) {
  const guard = demoAccount.capture()
  const converted = await processImages(files, onProgress)
  const urls = await Promise.all(converted.map(dataUrl))
  guard()
  return urls
}

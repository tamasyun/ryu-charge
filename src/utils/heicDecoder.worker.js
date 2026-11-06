import { heicTo } from 'heic-to/csp'

// bitmap経路はdocument/Canvasを使わないためWorkerでも動作する。
self.onmessage = async ({ data: file }) => {
  try {
    const bitmap = await heicTo({ blob: file, type: 'bitmap' })
    self.postMessage({ bitmap }, [bitmap])
  } catch {
    self.postMessage({ error: true })
  }
}

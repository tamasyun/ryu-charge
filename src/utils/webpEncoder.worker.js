import encode, { init } from '@jsquash/webp/encode.js'
import wasmUrl from '@jsquash/webp/codec/enc/webp_enc.wasm?url'
import simdWasmUrl from '@jsquash/webp/codec/enc/webp_enc_simd.wasm?url'

self.onmessage = async ({ data }) => {
  try {
    await init({ locateFile: path => path.endsWith('_simd.wasm') ? simdWasmUrl : wasmUrl })
    const buffer = await encode(data, { quality: 80 })
    self.postMessage({ buffer }, [buffer])
  } catch {
    self.postMessage({ error: true })
  }
}

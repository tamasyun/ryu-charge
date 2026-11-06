import { extensionForType, processImages } from '../utils/imageProcessor.js'

const RECOVERY_KEY = 'ryu-charge:photo-recovery'

// アップロード前から記録し、タブが閉じられた場合も管理者が回収を追跡できる。
// 自動削除には使わない（DBの遅延コミット・別端末の利用を考慮）。
function trackUpload(entry, complete = false) {
  try {
    const previous = JSON.parse(localStorage.getItem(RECOVERY_KEY) || '[]')
    const remaining = previous.filter(item => item.id !== entry.id)
    localStorage.setItem(RECOVERY_KEY, JSON.stringify(complete ? remaining : [...remaining, { ...entry, at: new Date().toISOString() }]))
  } catch (error) {
    console.error('写真の回収情報を端末に保存できませんでした:', error)
  }
}

function rememberRecovery(entry) {
  trackUpload(entry)
  console.error('写真の保存状態の確認・回収が必要です:', entry)
}

function isDefiniteRejection(error) {
  // SQLの拒否、PostgRESTの検証エラーはトランザクション未成立。
  // タイムアウト・接続断・5xxではサーバー側のコミット有無が分からない。
  return /^(22|23|42|44|P0)/.test(error?.code || '') || /^PGRST(1|2)/.test(error?.code || '')
}

export function createPhotoUploader(client, { prepare = processImages, recordRecovery = rememberRecovery, track = trackUpload } = {}) {
  return async function uploadPhotos({ bucket, folder, files, table, makeRecord, onProgress = () => {} }) {
    // 5枚すべてを変換できるまでStorage/DBを変更しない。
    const converted = await prepare(files, onProgress)
    const paths = []
    const records = []
    const id = crypto.randomUUID()
    const journal = reason => ({ id, bucket, paths: [...paths], table, reason })
    let savingDatabase = false
    try {
      for (const [index, file] of converted.entries()) {
        const path = `${folder}/${id}-${String(index + 1).padStart(2, '0')}.${extensionForType(file.type)}`
        // 通信断でアップロード成功の応答だけ失われた場合も回収対象に含める。
        paths.push(path)
        track(journal('uploading'))
        onProgress({ phase: 'uploading', current: index + 1, total: files.length })
        const { error } = await client.storage.from(bucket).upload(path, file, {
          contentType: file.type, cacheControl: '3600', upsert: false,
        })
        if (error) {
          // upsert:falseの重複エラーで既存ファイルを削除してはいけない。
          if (['400', '401', '403', '409', '413'].includes(String(error.statusCode))) paths.pop()
          throw error
        }
        const { data } = client.storage.from(bucket).getPublicUrl(path)
        records.push(makeRecord(path, data.publicUrl))
      }
      onProgress({ phase: 'saving', current: files.length, total: files.length })
      track(journal('saving'))
      savingDatabase = true
      // 複数の写真も1つのINSERTにし、部分的なDB登録を避ける。
      const { data, error } = await client.from(table).insert(records).select('*')
      if (error) throw error
      track(journal('complete'), true)
      // PostgRESTの返却順には依存せず、選択順にそろえる。
      return records.map(record => (data ?? []).find(row =>
        record.storage_path ? row.storage_path === record.storage_path : row.image_url === record.image_url
      )).filter(Boolean)
    } catch (error) {
      if (savingDatabase && !isDefiniteRejection(error)) {
        recordRecovery(journal('database-result-unknown'))
        throw new Error('通信が途切れ、写真の保存結果を確認できませんでした。再投稿する前に画面を再読み込みしてください。', { cause: error })
      }
      if (paths.length) {
        try {
          const { data, error: cleanupError } = await client.storage.from(bucket).remove(paths)
          // RLSで対象が見えないと、エラーなし・0件で終了する場合もある。
          const removed = new Set((data ?? []).map(item => item.name))
          if (cleanupError || paths.some(path => !removed.has(path))) throw cleanupError || new Error('削除結果を確認できませんでした。')
        } catch (cleanupError) {
          recordRecovery(journal('cleanup-failed'))
          throw new Error('投稿に失敗し、写真ファイルの回収も確認できませんでした。管理者にお問い合わせください。', { cause: cleanupError })
        }
      }
      track(journal('complete'), true)
      throw error
    }
  }
}

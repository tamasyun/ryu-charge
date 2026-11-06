import { extensionForType, processImages } from '../utils/imageProcessor.js'
import { removePhotoObjects } from './photoRemoval.js'

const RECOVERY_KEY = 'ryu-charge:photo-recovery'
const RETURN_COLUMNS = {
  room_reviews: 'id,room_id,rating,comment,image_url,user_id,created_at',
  room_photos: 'id,room_id,storage_path,image_url,user_id,created_at',
}

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

export function rememberRecovery(entry) {
  trackUpload(entry)
  console.error('写真の保存状態の確認・回収が必要です:', entry)
}

function isDefiniteRejection(error) {
  // SQLの拒否、PostgRESTの検証エラーはトランザクション未成立。
  // タイムアウト・接続断・5xxではサーバー側のコミット有無が分からない。
  return /^(22|23|42|44|P0)/.test(error?.code || '') || /^PGRST(1|2)/.test(error?.code || '')
}

export function createPhotoUploader(client, { prepare = processImages, recordRecovery = rememberRecovery, track = trackUpload, verifyAbsent } = {}) {
  return async function uploadPhotos({ bucket, folder, files, table, makeRecord, onProgress = () => {} }) {
    if (!RETURN_COLUMNS[table]) throw new Error('写真の保存先が不正です。')
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
      const { data, error } = await client.from(table).insert(records).select(RETURN_COLUMNS[table])
      if (error) throw error
      // PostgRESTの返却順には依存せず、選択順にそろえる。
      const ordered = records.map(record => (data ?? []).find(row =>
        record.storage_path ? row.storage_path === record.storage_path : row.image_url === record.image_url
      ))
      if (data?.length !== records.length || ordered.some(row => !row) || new Set(ordered).size !== records.length) {
        throw new Error('写真の保存結果が不完全です。')
      }
      track(journal('complete'), true)
      return ordered
    } catch (error) {
      if (savingDatabase && !isDefiniteRejection(error)) {
        recordRecovery(journal('database-result-unknown'))
        throw new Error('通信が途切れ、写真の保存結果を確認できませんでした。再投稿する前に画面を再読み込みしてください。', { cause: error })
      }
      if (paths.length) {
        try {
          await removePhotoObjects(client, bucket, paths, { verifyAbsent })
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

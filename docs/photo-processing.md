# 写真投稿の自動変換・圧縮

基準は `tamasyun/ryu-charge` の `main`、`c1c3f193f82136be240a73f1f62ceb0ff6d91de4`。
作業ブランチは `codex/photo-processing`。既存画像や本番設定は変更していない。

## 変更箇所

| ファイル | 変更内容 |
| --- | --- |
| `src/utils/imageProcessor.js` | 形式・容量・画素数の事前検査、向きの反映、縮小、候補の比較、出力デコード検証、逐次処理 |
| `src/utils/photoOrder.js` | ファイル名のバッチID・選択番号で再取得時の順序を復元。既存画像の位置を維持 |
| `src/utils/imageMetadata.js` | 再生成したJPEG/PNG/WebPからEXIF/XMP/GPS/日時などのメタデータ領域を除去 |
| `src/utils/heicDecoder.worker.js` | 非対応ブラウザでHEIC/HEIFをデコード。処理後または60秒のタイムアウトでWorkerを破棄 |
| `src/utils/webpEncoder.worker.js` | CanvasにWebPエンコーダーがないブラウザでWASMによるWebP変換 |
| `src/services/photoUpload.js` | 全件変換後のアップロード、DB一括登録、選択順の返却、確定した失敗の回収、保存結果不明時の記録 |
| `src/components/reviews/ReviewForm.jsx` | 1枚の自動変換・変換後プレビュー、変換中の投稿停止、再選択・削除の競合防止、Object URLの解放 |
| `src/services/reviews.js` | 写真を含めたレビュー保存を一括して扱う。単独アップロード関数は呼び出し元とともに廃止 |
| `src/components/buildings/BuildingRooms.jsx` | HEIC/HEIFの選択、5枚の変換・アップロード・DB保存の進捗表示、処理中の追加抑止 |
| `src/services/RoomPhotos.js` | 共通アップロード処理へ移行。既存の`image_url`と`storage_path`補完を維持 |
| `src/App.jsx` | 進捗と同時投稿ロック、保存後に古い取得結果で写真一覧が上書きされる競合の防止、既存lintエラーの修正 |
| `src/services/buildings.js` | 呼び出し元がない写真取得・アップロードの重複実装を除去 |
| `package.json` / `package-lock.json` | 画像処理とブラウザテストの依存を固定バージョンで追加 |
| `tests/imageProcessor.test.mjs` / `tests/photoForms.test.mjs` / `tests/photoUpload.test.mjs` | 実ブラウザでの画像処理・フォーム操作と、Storage/DB失敗の再現 |
| `tests/browser-harness.html` / `tests/browser-harness.mjs` / `tests/fixtures/` | テスト用画面と自作の画像フィクスチャ。本番ビルドには含まれない |
| `public/licenses/` | ライセンス本文、著作権表示、対応するソースの取得先 |
| `supabase/photo_storage_recovery_proposal.sql` | 所有者・未参照画像だけに限定したStorage回収権限とレビュー画像の容量制限。**未適用** |

## 画像処理

入力はJPEG / PNG / WebP / HEIC / HEIF。MIMEが空または`application/octet-stream`の場合も実データで判定する。
明示的なMIMEが実データと矛盾する場合、SVG/GIF/AVIF、破損画像は拒否する。
元画像の上限は30MiB、5000万画素、一辺16384px。HEIFはクロップ前の全ispeプロパティも検査する。

長辺は1600px以下で、元より拡大しない。JPEG/PNG/WebPのEXIF回転・鏡映はExifReaderで判定し、EXIFを除去してから共通の変換行列でピクセルへ反映する。ブラウザの自動回転には依存しない。HEIFのirot/imirはデコーダーで反映する。
原則WebP・品質0.8。CanvasがWebPを書き出せない場合はWASMで品質80のWebP候補を生成する。
元形式の再エンコード候補（HEIC/HEIFではJPEG/PNG候補）も作り、メタデータ除去後の最小候補を採用する。
PNG/WebP入力ではJPEG候補を作らず、透過を保持する。元ファイル自体は比較候補にしない。
最終結果を再デコードして形式・寸法を確認し、拡張子とContent-Typeをそろえる。
最終結果が5MiBを超える場合はエラー。元が5MiB超でも、30MiB以内で変換後5MiB以下なら投稿できる。

レビュー1枚・教室1回5枚の制限、保存先`review-images/reviews/`と`room-photos/{roomId}/`、教室IDとの関連は維持。
教室写真は選択順にアップロードし、直後の表示もその順にそろえる。再取得は従来の`created_at`昇順を維持する。
新しいファイル名にはバッチUUIDと選択番号を付け、同一バッチの`created_at`が同値でも選択順を復元する。既存ファイルはリネームせず、既存画像同士の表示位置を維持する。

## 失敗時の扱いと運用

- 教室写真は全件の変換が成功してからStorageへ保存する。1枚でも変換に失敗すればStorage/DBには書かない。
- DB登録は複数枚も1つのINSERTにする。DB内の部分登録を避ける。
- アップロード失敗・SQLで確定した登録拒否では、その処理で新しく作ったパスだけを回収する。既存画像の更新や上書きは行わない。
- Storageの削除エラーだけでなく「削除結果0件」も回収未確認として扱い、利用者に知らせる。
- DBへの通信断・5xx等でコミット有無が不明なときは画像を削除しない。保存済みレビュー・教室写真を壊す削除を避け、再読み込みを案内する。
- `localStorage['ryu-charge:photo-recovery']`へアップロード前からパスと状態を記録し、保存成功・回収確認で消す。画像本体や元ファイル名は記録しない。保存領域が利用できなければコンソールにも出す。
- これはクライアントの追跡記録であり、サーバーの永続的な回収ジョブではない。通信断やタブ終了、削除権限不足で残るファイルの完全な自動回収には、別途サーバー側の処理が必要。

管理者は記録されたbucket/pathについてDB参照とStorageの所有者を確認する。
保存結果不明の場合は遅延コミットが収束した後にも参照を再確認し、参照中の画像は絶対に削除しない。
回収はStorage APIを用い、Storageの管理テーブルへ直接DELETEしない。
端末の記録は消去され得るため、継続運用では十分古い未参照ファイルを定期点検する管理者ジョブを推奨する。

## Supabaseの読み取り確認（2026-11-06）

対象はプロジェクト`gpamidyeyyprvahxloyd`。スキーマ・バケット・ポリシーを読み取っただけで、設定やデータへの変更は行っていない。

- 実DBの`room_photos`には`image_url`と`storage_path`の両方がある。既存migrationの定義とは差があるため、現DBに合わせて既存の読み書きを維持した。
- `room-photos`は公開、5MiB、JPEG/PNG/WebP限定。所有者DELETEはあるが、削除用SELECTポリシーがない。
- `review-images`は公開、バケットの容量・MIME制限が未設定。現在のStorageポリシーはINSERTのみで、回収用のSELECT/DELETEがない。
- 公開バケットからの画像表示と、Storage APIのSELECT権限は別。削除にはSELECTとDELETEが必要。
- 提案SQLは所有者のみを対象とし、DB参照中の画像をDELETEできないrestrictiveなガードも加える。**内容を確認し、別途許可を得てから適用する。**
- 現行の削除権限では回収成功を保証できない。適用後、本人の未参照画像のみ削除でき、他人の画像・参照中の画像が削除できないことを確認する。
- 既存のINSERTポリシーの整理はこの変更で実施していない。複数のpermissiveなポリシーはOR結合となるため、大学メール・プロフィール制限の別途レビューも必要。

Supabaseの仕様: https://supabase.com/docs/guides/storage/security/access-control

## 依存関係とライセンス

| 用途 | バージョン | ライセンス |
| --- | --- | --- |
| HEIC/HEIFのブラウザデコード | heic-to 1.6.7 | LGPL-3.0-or-later |
| 内包デコーダー | libheif 1.23.7 / libde265 1.0.16 | LGPL-3.0-or-later |
| JPEG/PNG/WebPのEXIF方向判定 | exifreader 4.54.0 | MPL-2.0 |
| 画像のヘッダー・寸法検査 | image-size 2.0.4 | MIT |
| Safari等のWebP書き出し | @jsquash/webp 1.5.0 | Apache-2.0、内包libwebpはBSD-3-Clause |
| WASM機能検出（間接依存） | wasm-feature-detect 1.9.0 | Apache-2.0 |
| ExifReaderの任意依存 | @xmldom/xmldom 0.9.12 | MIT |
| 開発時のブラウザテスト | @playwright/test 1.65.0 | Apache-2.0 |

heic-toは追加のnpm実行時依存なし。image-sizeも実行時依存なし。
heic-toの対応ソースはnpmメタデータのgitHead `78345a3fcdb4a1d70d513fce2646aeff0127f7ba`を確認した。
libheif/libde265のバージョンはそのREADMEのリリース表・ビルド手順に基づく。
LGPLライブラリは改変せず、独立したWorkerにバンドルする。ライセンス本文、ソース取得先、差し替え方法は`public/licenses/index.html`から参照できる。
公開時はこのページとソース入手先も利用可能にする。

## 検証と手動で残る確認

初回準備:

```sh
npm ci
npx playwright install chromium webkit
npm test
npm run lint
npm run build
```

`npm test`はNodeのサービス検証とPlaywrightの実デコード・エンコード、フォーム操作を含む。
フィクスチャの縦向きHEICはImageIOで生成した自作画像。実際のiPhoneから撮影した画像ではない。
公開iPhone撮影サンプル（exifrの`heic-iphone.heic`、横向き）をローカルで追加検証する場合:

```sh
RYU_IPHONE_FIXTURE=/path/to/heic-iphone.heic npm test
```

インストール済みの通常のChromeも含める場合は`RYU_TEST_CHROME=1 npm test`を実行する。

元サンプル: https://github.com/MikeKovarik/exifr/blob/master/test/fixtures/heic-iphone.heic
この外部写真はリポジトリに含めない。

本番適用前にはiPhone Safari / Mac Safariで、生の縦向きHEIC（回転・位置情報を含む）、複数5枚選択、透過PNG、キャンセル・再選択、通信断の表示を手動で確認する。
PlaywrightのWebKitはSafari実機そのものではない。
本番Storage/DBでの投稿・失敗時の削除・他人の画像の削除拒否は未実行。
`npm run build`には大きなchunkの警告がある。画像コーデックは必要な時だけWorkerとして読み込む。


## 実行結果

- `npm test`: 56件成功、失敗0。画像の8方向すべての回転・鏡映、PNG/WebPのEXIF方向、透過、メタデータ除去、圧縮後上限、混在5形式5枚、フォーム操作、失敗・回収処理、再取得後の順序を含む。
- `RYU_TEST_CHROME=1 RYU_IPHONE_FIXTURE=... npm test`: 76件成功、失敗0。通常のGoogle Chromeと公開iPhone撮影サンプルも含む最終拡張検証。
- `npm run lint`: 成功。
- `npm run build`: 成功。大きなchunkの警告あり。HEICデコーダー約3.22MB、WebPエンコーダーWASM約0.28〜0.35MBは必要時に読み込む。ExifReaderも遅延ロード。
- `git diff --check`: 成功。
- `npm audit --omit=dev`: 脆弱性0件。全依存を含むauditには既存開発依存の指摘5件（moderate 4 / high 1）があり、本件と無関係な依存の更新は行っていない。
- Chromium 158.0.8127.18 / Playwright WebKit 27.2 / インストール済みGoogle Chrome 156.0.8078.80で画像処理を実行。
- 公開iPhone撮影サンプル（横向き、4032×3024→1600×1200）の変換・メタデータ除去を追加確認。縦向きはImageIO生成のHEICで120×240の向きと色の配置を確認。
- productionモードの補助ビルドでもChrome/WebKitからWorker/WASMを読み込み、HEIC→WebPと縦向き120×240を確認。

iPhone Safari / Mac Safariそのものの手動検証、本番Storage/DBへの投稿・削除、提案SQLの適用は実施していない。
ユーザーの明示的な指示に従い、実装と検証を終えて専用ブランチへコミット・pushする。PR作成・Supabase設定変更・本番デプロイは対象外。

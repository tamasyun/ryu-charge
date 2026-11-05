# 琉CHARGE

琉球大学内でコンセントを利用できる場所を探せるWebアプリケーションです。

https://ryu-charge.vercel.app

## 使用技術

| 分類 | 技術 |
|---|---|
| フロントエンド | React / JavaScript |
| 開発・ビルドツール | Vite |
| スタイリング | CSS |
| Linter | ESLint |
| マップ | Leaflet / OpenStreetMap |
| データベース | Supabase (PostgreSQL) |
| 認証 | Supabase Auth |

### システム構成

- **React + Vite**：地図、建物詳細、投稿フォーム、認証画面
- **Leaflet + OpenStreetMap**：地図および充電スポットの表示
- **Supabase**：データの保存・取得、アクセス制御、メール認証コードによるログイン
- **PostgreSQL**：充電スポット情報やレビューなどの管理

## ディレクトリ構成

役割別のディレクトリを使い、画面部品は機能ごとにまとめます。

```text
public/                         # そのまま配信する静的ファイル
src/
├── App.jsx                     # 機能の組み合わせと画面全体の状態
├── App.css                     # 画面レイアウトと共通スタイル
├── main.jsx                    # React の起動処理
├── index.css                   # 全体の基本スタイル
├── assets/                     # 画像など、コードから読み込むファイル
├── components/                 # 画面部品と、その部品の CSS
│   ├── auth/                   # ログイン画面
│   ├── buildings/              # 建物詳細・教室一覧・追加フォーム
│   ├── map/                    # 地図とマーカーの表示
│   └── reviews/                # レビュー一覧・投稿フォーム
├── hooks/                      # React の状態・Effect を使う処理
├── services/                   # 建物・レビューのデータ取得と保存
├── lib/                        # Supabase 接続と認証の保存処理
├── utils/                      # メール判定・認証後の遷移先などの補助処理
└── config/                     # 建物ごとのアイコン設定など
supabase/                       # DB の設定変更用 SQL
tests/                          # 自動テスト
```

- 表示を変えるときは `components/`、通信内容を変えるときは `services/` を確認します。
- 通信処理を画面部品から呼び出し、`services/` から画面部品は読み込まないようにします。
- 各部品だけで使う CSS は同じディレクトリに置きます。全体で共有するスタイルは `App.css` と `index.css` に置きます。
- 新しい機能は関連するディレクトリに追加します。ファイル数を増やすこと自体を目的にせず、役割で分けてください。

`index.html` は HTML の入口、`package.json` は依存パッケージとコマンド、`vite.config.js` は Vite の設定です。

## ローカル環境での実行方法

### 1. 必要な環境
- Node.js（Viteがサポートするバージョン。LTS版推奨）
- npm（Node.jsに付属）
- Git

バージョン確認：

`node -v`

`npm -v`

### 2. リポジトリをクローン

`git clone git@github.com:tamasyun/ryu-charge.git`


### 3. 依存パッケージのインストール

`npm ci`

※ `package-lock.json` がない場合は `npm install` を使用してください。

### 4. 環境変数の設定

`.env.example` をコピーして `.env.local` を作り、チームの Supabase URL と publishable key を設定します。

```sh
cp .env.example .env.local
```

- `VITE_SUPABASE_URL`：Supabase の Project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY`：フロントエンド用の publishable key

`.env.local` は Git の管理対象外です。`VITE_` で始まる変数は配信する JavaScript に含まれるため、`service_role` キーや DB パスワードを設定しないでください。変更後は開発サーバーを再起動します。

### 5. 開発サーバーの起動

`npm run dev`

起動後、表示されたURLにブラウザでアクセスします。

通常は以下のURLで確認できます。

http://localhost:5173/

開発サーバーを停止する場合は、ターミナルで `Ctrl + C` を押してください。

## 開発用コマンド

| コマンド | 説明 |
|---|---|
| `npm run dev` | 開発サーバーを起動 |
| `npm run build` | 本番環境向けにビルド |
| `npm run preview` | ビルド結果をローカルで確認 |
| `npm run lint` | ESLintでコードをチェック |
| `npm test` | 認証モード・ニックネーム保存・認証状態の保持をテスト |

## ログイン・新規登録と投稿者名

認証画面は共通のダイアログを使い、新規登録のときだけニックネームを入力します。ログインからの自動登録は無効です。既存ユーザーは、次回ログイン後にニックネームを設定してから投稿できます。

公開用の `profiles` テーブルにはユーザーIDとニックネームだけを保存します。新規登録で入力した名前は Auth のユーザーメタデータで引き継ぎ、メール認証後にプロフィールを初回作成します。既存プロフィールがあれば名前を上書きしません。ニックネームは前後の空白を除いて1〜20文字で、同名を許可します。

レビュー・教室・コンセントは `user_id` から投稿者名を表示します。DB側でも本人のIDとプロフィール設定済みであることを確認します。過去の教室・コンセントは投稿者IDがないため、「投稿者不明」と表示します。

### DB変更の適用順

`supabase/migrations/20261105164718_add_nickname_profiles_and_authorship.sql` は、既存スキーマに追加するSQLです。2026年11月6日に本番DBへ適用しました。ファイル名のバージョンは本番のマイグレーション履歴と一致しています。空のDB用の初期構築SQLではありません。

別環境へフロントエンドを反映する場合は、先にこのSQLを対象DBへ適用してください。`profiles` の作成、教室・コンセントへの投稿者IDの追加、INSERT権限・投稿者確認ポリシーの設定を行います。既存データに投稿者を推測して割り当てる処理はありません。

反映後は、実際の大学メールでのコード送信・検証、新規登録、既存ユーザーの初回設定、各投稿者名の表示を確認します。自動テストとモックによるブラウザ確認だけでは、実メールの到達は確認できません。

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

### システム構成（予定）

- **React + Vite**：画面表示、検索、投稿フォームなど
- **Leaflet + OpenStreetMap**：地図および充電スポットの表示
- **Supabase**：データの保存・取得、アクセス制御、必要に応じたユーザー認証
- **PostgreSQL**：充電スポット情報やレビューなどの管理

## ディレクトリ構成


- `public/`：静的ファイル
- `src/`：アプリケーションのソースコード
  - `App.jsx`：メインのReactコンポーネント
  - `App.css`：Appコンポーネントのスタイル
  - `index.css`：グローバルスタイル
  - `main.jsx`：Reactアプリケーションのエントリーポイント
- `index.html`：HTMLのエントリーポイント
- `package.json`：依存パッケージや実行コマンドの定義
- `vite.config.js`：Viteの設定

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

### 4. 開発サーバーの起動

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

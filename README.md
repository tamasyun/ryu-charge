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
- `VITE_TURNSTILE_SITE_KEY`：Cloudflare Turnstile の公開用 Site Key（導入手順は下記）

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
| `npm test` | 認証モード・ニックネーム保存・認証状態の保持・CAPTCHAの画面動作をテスト |
| `npm run test:ui` | CAPTCHAを含む認証画面をテスト（外部サービスはモック） |

## メールOTP認証のTurnstile保護

ログイン・新規登録・認証コード再送信では、`@marsidev/react-turnstile` で取得したトークンを `signInWithOtp()` の `options.captchaToken` に渡します。トークンは画面内のメモリだけに保持し、送信の成功・失敗にかかわらず破棄してウィジェットをリセットします。再送信には新しいトークンが必要です。期限切れ・確認失敗・タイムアウト時も送信を止め、再確認できるようにします。スクリプトの読込失敗時はページの再読込を案内します。

8桁OTPの検証、登録時のニックネーム、メールアドレスの記憶、ログイン状態の保持は従来どおりです。CAPTCHAが期限切れ・失敗になっても、受信済みOTPの入力・検証は継続できます。再送信の60秒待機も維持しています。

### 手動で行う設定と有効化の順序

1. [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/)で **Managed** ウィジェットを作成し、本番・検証用サイトのホスト名を許可します。ローカルでは後述の公開テスト用Site Keyを使います。実キーでのローカル確認が必要なら、本番用と分けたウィジェットで `localhost` を許可してください。
2. 公開用 **Site Key** をローカルの `.env.local` と、利用するホスティング環境の `VITE_TURNSTILE_SITE_KEY` に設定します。Viteはビルド時に読み込むため、設定後は開発サーバーの再起動、配信環境では再ビルドが必要です。
3. 先にSite Key入りのフロントエンドを検証・配信し、ウィジェットとコード送信の動作を確認します。この時点ではSupabase側のCAPTCHA保護はまだ有効になっていません。
4. [SupabaseのCAPTCHA設定](https://supabase.com/docs/guides/auth/auth-captcha)を開き、Authenticationの **Bot and Abuse Protection → Enable CAPTCHA protection** でプロバイダーに **Turnstile** を選択します。同じウィジェットの **Secret KeyをSupabaseの設定画面だけに入力**し、有効化・保存します。Secret Keyをフロントエンド、`VITE_` 環境変数、ソース、GitHub、リポジトリ内の設定ファイルには保存しないでください。検証はSupabaseがサーバー側で行うため、独自のSiteverify呼び出しは不要です。
5. 有効化後にログイン・新規登録・60秒後の再送信・期限切れ後の再確認を実機で確認します。事前に開かれた旧画面やSite Keyのないビルドでは送信できなくなるため、ページの再読込も確認します。OTPの桁数やメールテンプレートは変更しません。

このコード変更だけではSupabase設定・ホスティング設定・本番配信は変更されません。

| Site Key | SupabaseのCAPTCHA保護 | 動作 |
|---|---|---|
| 未設定（空白のみも含む） | 無効 | ウィジェットを表示せず、従来どおりOTP送信・再送信する |
| 設定済み | 無効 | 画面では確認完了を必須とし、トークンを送る。サーバー側の保護は未有効 |
| 設定済み | 有効 | 確認完了後に送信し、Supabaseがトークンを検証する |
| 未設定 | 有効 | Supabaseが送信を拒否する。`captcha_failed` は設定不備として案内する |

設定済みの状態で検証に失敗しても、トークンなしで自動再試行することはありません。繰り返し失敗する場合は許可ホスト名、Site KeyとSecret Keyの組み合わせ、Supabase側のプロバイダーを確認してください。保護を解除して戻す場合は、先にSupabase側でCAPTCHAを無効にしてからSite Keyのないビルドに戻します。

### ローカルでの確認

`npm test` はAPIをモックした送信・再送信・検証と、Turnstileコールバックをモックした画面テストを実行します。実際のメール送信やCloudflare/Supabase間の検証は行いません。

ウィジェット自体の動作確認には、[Cloudflare公式の公開テスト用Site Key](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)を一時的に指定できます。本番キーやSupabaseの設定を変更せずに確認できます。

```sh
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run dev
```

テスト用Site Keyのトークンは本番のSecret Keyでは検証できません。Supabaseまで含める結合確認は、本番と分離したプロジェクトで公式手順に沿って行ってください。本番では実際のウィジェットのSite Keyを使います。

トークンは[5分間有効・1回限り](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)です。自動更新に加えて送信直前にも期限を確認しています。

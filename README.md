# markdown-reviewer

ローカルの Markdown を Web エディタで開き、選択範囲にレビューコメントを付けて AI（Claude 等の LLM）と人間でレビューサイクルを回すツール。

- **正典の `.md` はクリーンなまま** — コメントは本文に埋め込まず、sidecar（`~/Library/Application Support/reviewer/` 等のユーザー設定ディレクトリ）で管理する
- **AI は `mr` CLI でコメントを読み書き** — `mr review <path>` で指摘を読み、本文を修正して `mr reply` / `mr resolve` で返す
- 保存時にファイル先頭へ HTML コメントの hint が注入され、AI がファイルを開いた瞬間に API / CLI をセルフディスカバリーできる
- リビジョン履歴を自動スナップショットし、Web UI 上で版間 diff を確認できる

## 仕組み

```
人間: Web UI で .md を開く → 範囲選択してコメント → （コメントは sidecar に保存）
AI:   mr inbox でコメントされたファイルを発見 → mr review <path> で指摘を読む
      → 本文を in-place 修正 → mr reply / mr resolve で対応状況を返す
人間: Web UI で diff とスレッドを確認 → 必要なら再コメント
```

- **Go server** (`:8080`) — 設定ルート配下の `.md` の list / read / write + コメント・リビジョン API
- **React SPA** — TipTap ベースの WYSIWYG エディタ（build 時は Go バイナリへ embed され単一バイナリで動く）
- **`mr` CLI** — サーバと同じ内部パッケージで sidecar を直接読み書きする。**サーバ未起動でも動作**
- ローカル運用専用。認証なし。Path traversal は設定ルート配下に制限することで防ぐ

## インストール

### Homebrew

```bash
brew install rengotaku/tap/markdown-reviewer
```

`markdown-review-server`（Web UI + API サーバ）と `mr`（CLI）がインストールされる。

### ソースから

Go 1.24+ / Node.js 22+（`frontend/.node-version` 参照）が必要。

```bash
git clone https://github.com/rengotaku/markdown-reviewer.git
cd markdown-reviewer
make install   # Go モジュール + フロントエンド依存の取得
make build     # SPA を embed した単一バイナリを bin/ に生成（mr も同時にビルド）
```

## 起動

レビュー対象のディレクトリを **`REVIEW_ROOTS`**（JSON 配列、複数指定可）で指定する。
単一ディレクトリなら **`REVIEW_ROOT`** でもよい。両方未指定の場合、ファイル系 API は 500 を返す。

```bash
# 単一ルート
REVIEW_ROOT=$HOME/notes markdown-review-server

# 複数ルート: サイドバーにルートタブが並び、UI 上で切り替えられる
REVIEW_ROOTS='[{"name":"works","path":"'"$HOME"'/works"},{"name":"notes","path":"'"$HOME"'/notes"}]' \
  markdown-review-server
```

ブラウザで `http://localhost:8080` を開く。

| 環境変数 | デフォルト | 用途 |
|----------|-----------|------|
| `REVIEW_ROOTS` | (なし) | レビュー対象ルートの JSON 配列 `[{"name":..., "path":...}]` |
| `REVIEW_ROOT` | (なし) | 単一ルート指定（`name` は basename になる） |
| `PORT` | `8080` | listen ポート |
| `DATABASE_DSN` | `app.db` | ユーザー DB（boilerplate 由来で実質未使用。`:memory:` 推奨） |
| `MARKDOWN_REVIEWER_BASE_URL` | (リクエストの Host から導出) | hint に埋める base URL の固定 |

`name` は API の `?root=<name>` クエリとサイドバーのタブ名に使われる。`/` 等のパス区切りは含められない。

## 使い方

1. ブラウザで対象 `.md` を開き、「取り込み」でレビュー管理下に置く（`draft` → `review`）
2. 本文のコメントしたい範囲を選択し、コメントを追加（sidecar に保存され、本文は汚れない）
3. AI にレビュー対応を依頼する。AI は `mr` CLI で指摘を読み、本文を修正して返信する
4. Web UI でリビジョン diff とコメントスレッドを確認し、解決 / 再オープンする

### `mr` CLI（AI 向け推奨インタフェース）

```
mr inbox    [--root NAME] [--all]                        # open コメントを持つファイル一覧（更新の新しい順）
mr comments <path> [--json] [--since ID] [--unanswered]  # コメント一覧
mr review   <path> [--all] [--since ID] [--unanswered]   # open コメントを整形 Markdown で表示
mr reply    <path> <id> <text> [--author NAME]           # スレッド返信（既定 author=ai）
mr resolve  <path> <id>                                  # resolved にする
mr reopen   <path> <id>                                  # resolved を open に戻す
```

パスは絶対 / cwd 相対のどちらでもよい（設定ルート配下であること）。ルートは `REVIEW_ROOTS` 環境変数、無ければ launchd plist から自動解決する。

## コメントモデル（sidecar）

- コメントは `<ユーザー設定ディレクトリ>/reviewer/<root>/<path>/review.json` に保存され、本文には埋め込まれない
- 各コメントは内容由来アンカー（`heading_path` + `snippet` + `occurrence`）で正典に紐付き、本文の軽微な編集に耐える。アンカー先が消えると `orphan` として明示される
- リビジョン履歴は同ディレクトリの `history.jsonl` に保存（直前と同一内容は dedupe、上限 20 件）
- 保存されるファイル先頭には次の hint が強制注入される（HTML コメントなのでレンダリング時は不可視）:

```html
<!-- markdown-reviewer
本文はクリーンです。レビューコメントは別管理(sidecar)で、以下から取得します。
CLI(推奨):  mr review <このファイルのパス>   # 返信: mr reply <path> <id> '...' / 解決: mr resolve <path> <id>
レビュー(open, 整形済): GET http://localhost:8080/api/review/doc.md?root=notes
コメント(JSON):         GET http://localhost:8080/api/comments/doc.md?root=notes
API 全仕様:             GET http://localhost:8080/api/help
-->
```

## API

API 全仕様は `GET /api/help` が `text/markdown` で配信する（`internal/handler/helpdoc/api.md` を `go:embed`。仕様の SoT はこの 1 ファイル）。主要エンドポイント:

| Method | Path | 用途 |
|--------|------|------|
| `GET` | `/api/help` | API 仕様（AI セルフディスカバリー用） |
| `GET` | `/api/files` | 選択ルート配下の `.md` 一覧 |
| `GET/PUT` | `/api/files/*path` | ファイル読み書き（保存はアトミック、hint 注入 + リビジョン記録） |
| `POST` | `/api/ingest/*path` | `draft` → `review` への取り込み |
| `GET/POST/PATCH/DELETE` | `/api/comments/*path` | コメントの取得・作成・更新・削除 |
| `POST` | `/api/replies/*path?id=` | スレッド返信 |
| `GET` | `/api/review/*path` | open コメントを AI 向けに整形した Markdown |
| `GET` | `/api/revisions/*path` | リビジョン一覧 / 単一リビジョン本文 |

## macOS で常駐 (launchd)

`service` サブコマンドで launchd エージェントとして登録できる。brew でインストールしたバイナリでも、ソースから `make build` した `bin/markdown-review-server` でも同じ。

```bash
# 単一ルート
markdown-review-server service install --review-root "$HOME/notes"

# 複数ルート + ポート指定
markdown-review-server service install --port 15174 \
  --review-roots '[{"name":"notes","path":"'"$HOME"'/notes"}]'

# 状態確認 / 解除
markdown-review-server service status
markdown-review-server service uninstall
```

- `--review-roots` / `--review-root` 未指定時は env `REVIEW_ROOTS` / `REVIEW_ROOT` にフォールバックする
- ラベル: `com.user.markdown-reviewer`（`--label` で変更可）
- ポート: デフォルト `15174`
- ログ: `~/Library/Logs/markdown-reviewer/markdown-reviewer.{out,err}.log`

## 開発

```bash
make run        # Go (air ホットリロード) + Vite を並列起動 → http://localhost:5174
make check      # lint + test（Go + frontend）
make ci         # CI 相当（カバレッジゲート付き）
make stop       # dev サーバ停止
```

詳細は `make help`。

## リリース（メンテナ向け）

`v*` タグを push すると GitHub Actions（GoReleaser）が darwin / linux × amd64 / arm64 のバイナリを GitHub Releases に公開し、[rengotaku/homebrew-tap](https://github.com/rengotaku/homebrew-tap) の Cask を自動更新する。

```bash
git tag v0.1.0 && git push origin v0.1.0
```

## ライセンス

[MIT](LICENSE)

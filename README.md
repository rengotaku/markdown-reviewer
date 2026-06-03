# markdown-reviewer

ローカルのディレクトリにある Markdown を Web ブラウザで開き、選択範囲にコメントを付けて保存できるツール。
保存された Markdown は HTML コメント形式のメタデータを含む単一ファイルとしてディスクに書き戻され、Claude（または任意の LLM / レビュアー）が `cat foo.md` するだけで本文・コメントの両方を読める。

## 動機・ユースケース

`~/MyWorkspace/.../phases/phaseN` などの作業ディレクトリに大量の Markdown があるが、
ターミナルでの編集ではコメントを残しにくく、Claude に「ここを直して」と伝えるのも難しい。

`markdown-reviewer` は:

- 対象ディレクトリ（`REVIEW_ROOT`）の Markdown を Web エディタで開く
- 選択範囲にコメントを付ける（id / author / date / body）
- 保存すると **HTML コメント形式** で同じファイルに書き戻される
- そのまま Claude にファイルを渡せばコメント込みで読める

サイドカーファイル不要・標準 Markdown 構文を壊さないのが特徴。

## アーキテクチャ

- **Go server** (`:8080`) — `REVIEW_ROOT` 配下の `.md` を list / read / write する API
- **React SPA** (`Vite :5174` for dev, build 時は Go バイナリへ embed)
- **エディタ** — TipTap + tiptap-markdown + MUI + Mermaid + zustand
- **コメント** — `CommentMark` 拡張で TipTap の選択範囲を HTML コメント形式にシリアライズ／デシリアライズ

ローカル運用専用。認証なし。Path traversal は `REVIEW_ROOT` 配下に制限することで防ぐ。

## セットアップ

### 必要なもの

- Go 1.22+
- Node.js 22+ (`.node-version` 参照)
- 任意: [air](https://github.com/air-verse/air)（`make run` でホットリロードに使用）

### インストール

```bash
make install
```

Go モジュールとフロントエンド依存を一括取得する。

## 起動

レビュー対象のディレクトリを **`REVIEW_ROOTS`** (JSON 配列、複数指定可) で指定する。
旧 `REVIEW_ROOT` (単一ディレクトリ) もフォールバックとしてサポートする。
両方未指定の場合、`/api/files` 系エンドポイントは 500 を返す。

```bash
# 複数ルート（推奨）: サイドバーにルートタブが並び、UI 上で切り替えられる
REVIEW_ROOTS='[{"name":"works","path":"'"$HOME"'/ot/works"},{"name":"rooms","path":"'"$HOME"'/ot/rooms"}]' make run

# 単一ルート（後方互換）: タブは表示されない（ルートが 1 つの時は隠れる）
REVIEW_ROOT=$HOME/ot/works make run
```

各エントリの `name` はサイドバー上部に表示されるタブ名 + API の `?root=<name>` クエリで使われる。
`/` 等のパス区切りは含められない。

### 開発モード（ホットリロード）

Go (`:8080`) と Vite (`:5174`) を並列起動する。ブラウザでは `http://localhost:5174` を開く（`/api` は Go にプロキシされる）。

```bash
# 例 1: ワークスペース 1 つだけをレビューする
REVIEW_ROOT=~/MyWorkspace/organize_tickets/works/work42/phases make run

# 例 2: works と rooms を同時にレビューする
REVIEW_ROOTS='[{"name":"works","path":"'"$HOME"'/ot/works"},{"name":"rooms","path":"'"$HOME"'/ot/rooms"}]' make run

# 例 3: 任意のメモディレクトリ
REVIEW_ROOT=/Users/me/notes make run
```

### 本番ビルド（単一バイナリ）

SPA を Go バイナリに embed し、`:8080` 単独で配信する。

```bash
make build
REVIEW_ROOT=/path/to/markdowns ./bin/markdown-review-server
```

または `make run-binary` で起動。

### 停止 / 状態確認

```bash
make stop    # :8080 と :5174 のプロセスを停止
make status  # 起動状況を表示
```

### macOS で常駐 (launchd)

ログイン時に自動起動させたい場合、`make build` 後に launchd エージェントとして登録する。

```bash
make build
./scripts/install-launchd.sh
```

デフォルトは `PORT=15174`, `REVIEW_ROOTS=''`（空のとき `REVIEW_ROOT=$HOME/ot/works` を使う）。上書き例:

```bash
# 単一ルート
PORT=15174 REVIEW_ROOT=$HOME/notes ./scripts/install-launchd.sh

# 複数ルート
REVIEW_ROOTS='[{"name":"works","path":"'"$HOME"'/ot/works"},{"name":"rooms","path":"'"$HOME"'/ot/rooms"}]' \
  ./scripts/install-launchd.sh
```

- ラベル: `com.user.markdown-reviewer`
- ログ: `~/Library/Logs/markdown-reviewer/markdown-reviewer.{out,err}.log`
- アンロード: `launchctl bootout gui/$UID/com.user.markdown-reviewer`

## コメントの付け方

1. ブラウザで `http://localhost:5174`（dev）または `http://localhost:8080`（binary）を開く
2. 左サイドバーから対象 `.md` ファイルを選ぶ
3. 本文中のコメントしたい範囲を選択
4. ツールバーまたはスラッシュコマンドから「コメント追加」を実行
5. ダイアログで本文を入力 → 保存
6. ファイルを保存すると、HTML コメント形式で同じファイルに書き戻される

サイドペインには既存コメント一覧が表示され、クリックで該当箇所へジャンプ・削除が可能。

## コメント記法（保存形式）

保存されたファイルは次の形式になる:

```markdown
本文の前半...

<!-- @comment id="c-1715414400000" author="kishira" date="2026-05-11" body="ここの記述を見直してほしい。" -->この段落を直したい<!-- /@comment -->

本文の後半...
```

属性:

| 属性 | 用途 |
|------|------|
| `id` | コメント ID（クライアントが採番、ファイル内一意） |
| `author` | コメント作成者 |
| `date` | 作成日（`YYYY-MM-DD`） |
| `body` | コメント本文 |
| `scope` | コメントの種別（`block` / `cross-section` / `global`。`inline` は省略） |

inline / block コメントの**対象テキストは `<!-- @comment ... -->` と `<!-- /@comment -->` の間にラップ**されているので、別途 `target` 属性を持たない（識別曖昧性回避のため、旧 `target` 属性は読み込みのみ後方互換でサポート）。cross-section / global コメントは対象テキストをラップしないため `target` を引き続き使う（cross-section は対象セクション名のリスト）。

**重要**: コメントは標準 Markdown の HTML コメント構文なので、GitHub / VS Code プレビュー / pandoc などで Markdown としてレンダリングしたとき**非表示**になる。
ただし `cat` や Claude のファイル読み込みでは **そのまま見える** ため、レビュー指示として機能する。

詳細は `CLAUDE.md` を参照。

## API

いずれのファイル系エンドポイントも `?root=<name>` を受け取り、指定された名前のレビュー対象ルートに対して動作する。
未指定時は最初に宣言されたルート（デフォルト）に対して動作する。

| Method | Path | 用途 |
|--------|------|------|
| `GET` | `/api/help` | API 仕様を markdown で返す（AI セルフディスカバリー用） |
| `GET` | `/api/config` | 設定済みルートの一覧 (`review_roots`) + 旧フィールド (`review_root`, `review_root_name`) |
| `GET` | `/api/files` | 選択されたルート配下の `.md` 一覧 |
| `GET` | `/api/files/*path` | ファイル読み込み |
| `PUT` | `/api/files/*path` | ファイル保存（先頭に AI hint コメントが強制注入される） |
| `GET` | `/api/comments/*path` | ファイル内コメントを構造化 JSON で取得（AI 向け） |

`*path` は `REVIEW_ROOT` からの相対パス。`..` を含むパスや絶対パスは拒否される。

### AI hint comment（強制注入）

`PUT /api/files/*path` で保存時、ファイル先頭に以下の HTML コメントが**強制的に**注入される（既存の hint は最新版で置換）。
AI クライアントが `Read` でファイルを開いた瞬間に、API へのアクセス方法をセルフディスカバリーできるようにするため。

```html
<!-- markdown-reviewer
このファイルには `<!-- @comment ... -->` レビューマーカーが含まれる可能性があります。
構造化コメント取得: GET http://localhost:15174/api/comments/phases/phase7/diff.v2.md?root=works
API 全仕様:        GET http://localhost:15174/api/help
-->
```

- base URL は環境変数 `MARKDOWN_REVIEWER_BASE_URL` で固定可能。未設定時はリクエストの Host から組み立てる
- HTML コメントなので人間が markdown をレンダリングする際は不可視
- 既存ファイルは「次回 PUT 時」に hint が付く（git diff にノイズが出るがトレードオフ）

### `GET /api/help`

API 全仕様を `text/markdown` で返す。`internal/handler/helpdoc/api.md` を `go:embed` でバンドルしているので、バイナリ単体で配信可能。仕様の SoT はこの 1 ファイル。

### `GET /api/comments/*path`

AI が markdown レビューに応答する際に grep で頑張らずに済むよう、ファイル内コメントを構造化 JSON で返す。
横断コメント（`group_id` で束ねられた複数の `scope="block"`）は 1 エントリに集約され、`members[]` に各セクションが入る。
ProseMirror が block 境界で分割した同一 `id` のマークも同様に `members[]` に集約される。

```json
{
  "file": "phases/phase7/diff.v2.md",
  "root": "works",
  "summary": { "total": 3, "by_scope": { "inline": 1, "cross_section": 1, "global": 1 } },
  "comments": [
    {
      "id": "c-001",
      "author": "kishira",
      "date": "2026-06-03",
      "scope": "inline",
      "body": "ここの数字が違うのでは",
      "wrapped_text": "10,000 件",
      "context": {
        "heading_path": ["## 比較表", "### サンプル数"],
        "line_range": [42, 42]
      }
    },
    {
      "id": "c-002",
      "scope": "cross_section",
      "group_id": "g-001",
      "body": "全体的に DB と S3 を分けて書いて",
      "members": [
        { "wrapped_text": "## DB チェック", "context": { "heading_path": ["## DB チェック"], "line_range": [10, 10] } },
        { "wrapped_text": "## S3 サイズ計測", "context": { "heading_path": ["## S3 サイズ計測"], "line_range": [20, 20] } }
      ]
    },
    { "id": "c-003", "scope": "global", "body": "もう少し簡潔に", "context": null }
  ]
}
```

- `scope`: `inline` / `block` / `cross_section` / `global`
- `context`: `null` のときは「ファイル全体への注釈」または「複数位置に分散（`members[]` を参照）」を意味する
- `heading_path`: 各要素は `## Section Title` のように heading レベル prefix を含む
- `line_range`: 1-indexed・inclusive。`heading_path` と組み合わせて該当箇所を最小限の Read で取得できる
- 属性値の HTML エスケープ（`\"` `\\` `\n` `\-\-`）はサーバ側で展開済み

## 開発

```bash
make check      # lint + test（Go + frontend）
make ci         # CI 相当（カバレッジ付き）
make lint       # Go の lint のみ
make test       # Go の test のみ
make test-frontend
make build-frontend
```

詳細は `make help`。

## ライセンス

未指定（社内/個人運用前提）。

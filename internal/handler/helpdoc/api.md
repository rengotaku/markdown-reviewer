# markdown-reviewer API

Markdown ファイルへのレビューコメント付与・取得・参照のための API。
AI クライアントが API 仕様をセルフディスカバリーできるよう、このドキュメントは `GET /api/help` で配信される。

正典（最新版）の `.md` 本文は**クリーン**で、レビューコメントは本文に埋め込まれず
別管理（sidecar: `<os.UserConfigDir()>/reviewer/<root>/<path>/review.json`。macOS では
`~/Library/Application Support/reviewer/...`、`XDG_CONFIG_HOME` 設定時はその配下）に保持される。
各 `.md` の先頭には書き込み時に以下の hint が強制注入されるので、AI は API を発見できる:

```
<!-- markdown-reviewer
本文はクリーンです。レビューコメントは別管理(sidecar)で、以下から取得します。
CLI(推奨):  mr review <このファイルのパス>   # 返信: mr reply <path> <id> '...' / 解決: mr resolve <path> <id>
レビュー(open, 整形済): GET <base-url>/api/review/<path>?root=<root>
コメント(JSON):         GET <base-url>/api/comments/<path>?root=<root>
API 全仕様:             GET <base-url>/api/help
-->
```

## CLI: `mr`（AI 向け推奨インタフェース）

シェルから直接コメントを読み書きできる CLI。URL 組み立て・`?root=` の指定が不要で、パスは
絶対パスでも cwd 相対でもよい（設定済みルート配下であること）。HTTP ではなくサーバと同一の
内部パッケージを直接使うため、**サーバ未起動でも動作**し、Web UI と同じ sidecar を読み書きする。

```
mr inbox    [--root NAME] [--all]    # open コメントを持つファイルを更新の新しい順に一覧
mr comments <path> [--json] [--since ID] [--unanswered]   # コメント一覧（解決位置 / orphan）
mr review   <path> [--all] [--since ID] [--unanswered]    # open コメントを整形 Markdown で（/api/review 相当）
mr reply    <path> <id> <text> [--author NAME]   # スレッド返信（既定 author=ai）
mr resolve  <path> <id>              # resolved にする
mr reopen   <path> <id>              # resolved を open に戻す
```

ルートは `REVIEW_ROOTS` 環境変数、無ければ launchd plist から自動解決する。

「人がコメントした」と言われたら **`mr inbox` でどのファイルか特定** → `mr review <path>` で読む。前回見た以降の新規だけ見たいときは `--since <最後に見た ID>`、AI 未対応分だけは `--unanswered`。コメント ID は `c-NNN` の単調増加なので、`mr comments` 末尾の最大 ID を控えておけば次回の `--since` に使える。

## ベース URL

サーバを起動した HTTP オリジン（例: `http://localhost:15174`）。
hint URL は環境変数 `MARKDOWN_REVIEWER_BASE_URL` で固定でき、未設定時はリクエストの Host ヘッダーから組み立てる。

## ルート

`?root=<name>` ですべてのファイル系エンドポイントが受け取るルート名。
省略時は最初に宣言されたルート (`REVIEW_ROOTS` の先頭) がデフォルト。

---

## コメントモデル（sidecar）

コメントは `review.json` に保存され、本文には埋め込まれない。各コメントは**内容由来アンカー**
（`heading_path` + `snippet` + `occurrence`）で正典に紐付く。ロード時に正典本文を再走査して
位置（`context.line_range`）を復元する。見つからなければ `orphan: true`（位置不明として明示）。

> **アンカーを自分で作るとき（`POST /api/comments` で `anchor` を指定する／CLI で起票する）の契約**:
> `heading_path` と `snippet` は **描画後テキスト（インライン記法を除去した形）** で書くこと。
> 具体的には、コードスパン `` `x` `` → `x`、強調 `**x**`/`*x*`/`__x__`/`_x_` → `x`、
> 取り消し線 `~~x~~` → `x`、リンク `[text](url)` → `text` のように記法を剥がした文字列を使う
> （コードスパン内部は literal。例: `` `_watchlist.md` `` は `_watchlist.md` のまま）。
> 正典本文の生 Markdown をそのままコピーすると記法が残り、**照合に失敗して `orphan` になる**。
> 見出しに記法が含まれる場合に特に注意。位置解決は行番号ベースではなく snippet 一致なので、
> 本文の軽微な編集には耐えるが、アンカーした**そのテキスト自体**が書き換わると orphan 化する。

| scope | 意味 | anchor |
|-------|------|--------|
| `inline` / `block` | テキスト範囲への注釈 | あり |
| `cross_section` | 複数見出し横断 | `anchors[]`（複数） |
| `global` | ファイル全体 | なし（`context: null`） |

`status` は `open` / `resolved`。返信は `replies[]`。

## GET /api/comments/*path

`review.json` のコメントを構造化 JSON で返す（`?root=` 対応）。各コメントはアンカーを
解決した `context`（`global`/orphan は `null`）と `orphan` フラグを含む。

```json
{
  "file": "doc.md", "root": "rooms",
  "summary": { "total": 2, "by_scope": {"inline":1,"global":1}, "by_status": {"open":1,"resolved":1} },
  "comments": [
    { "id": "c-001", "scope": "inline", "author": "reviewer", "body": "36 時間では？",
      "status": "open", "anchor": {"heading_path":["## トークンの期限"],"snippet":"24 時間","occurrence":0},
      "context": {"heading_path":["## トークンの期限"],"line_range":[5,5]}, "orphan": false,
      "replies": [{"author":"ai","body":"直しました"}] },
    { "id": "c-002", "scope": "global", "body": "もう少し簡潔に", "status": "resolved", "context": null, "orphan": false }
  ]
}
```

## POST /api/comments/*path

コメントを作成する（**ファイルが取り込み済み=review 状態であること**。draft は 409）。
ボディ: `{ scope, body, author?, date?, group_id?, anchor?{heading_path,snippet,occurrence}, anchors?[] }`。
`id` はサーバが採番（`c-NNN`）、`status` は `open` 既定。201 で作成コメントを返す。

## PATCH /api/comments/*path?id=<id>

status / body を更新する。ボディは `{ "status": "resolved" }`（`open`/`resolved` のみ）
または `{ "body": "新しい本文" }`、もしくは両方。いずれも未指定なら 400。

## DELETE /api/comments/*path?id=<id>

コメントを削除する（204）。

## POST /api/replies/*path?id=<id>

コメントにスレッド返信を追加する。ボディ: `{ body, author?, date? }`。
resolved なコメントには追加できない（409。先に `?status=open` で reopen する）。

## GET /api/review/*path

open コメントを **AI 向けに整形した Markdown** で返す（`?status=all` で resolved も含む）。
各コメントの解決位置（行番号 / orphan）・対象 snippet・指摘・返信を 1 リクエストで読める。

### Errors（コメント系共通）

| Status | 条件 |
|--------|------|
| 400 | path が `.md` 以外 / traversal / 未知 root / 必須項目欠落 |
| 404 | ファイル無し / コメント id 無し |
| 409 | 未取り込み（draft）への作成・更新 / resolved コメントへの返信・本文編集（先に reopen が必要） |
| 500 | files API 未設定 |

---

## GET /api/files

選択ルート配下の `.md` ファイル一覧（再帰）。

## GET /api/files/*path

ファイル内容を返す（先頭の AI hint コメント込み）。

## PUT /api/files/*path

ファイルを保存する。リクエストボディは `{ "content": "..." }`。
**サーバが先頭の AI hint コメントを強制注入**し、保存・レスポンスとも hint 込みになる。
保存は tmp ファイル + rename によるアトミック書き込み。レスポンスには `state`（`"draft"` | `"review"`）が含まれる。

**保存時に「前回保存内容」をリビジョン履歴へスナップショット**する（`review` 状態のファイルのみ）:
hint を除去した上で `~/.config/reviewer/<root>/<path>/history.jsonl` へ追記し、直前と同一内容なら dedupe、上限 20 件。
`?author=ai`（または `human`）でスナップショットの作成者を記録できる（省略時 `unknown`）。

## GET /api/stat/*path

ファイルの mtime / ctime と `state`（`"draft"` | `"review"`）のみ返す（外部更新検知用、ボディなし）。

## GET /api/dirs

選択ルート配下の即時子要素（dirs + `.md` files）を遅延ロード用に返す。

## GET /api/config

設定済みルート一覧 (`review_roots`) と legacy デフォルトを返す。

---

## マネージド・レビューセッション

正典（最新版）の `.md` は元フォルダにそのまま残し、レビュー状態（コメント / リビジョン履歴）は
正典フォルダの外 — ユーザー設定ディレクトリ `<os.UserConfigDir()>/reviewer/<root>/<相対パス>/`（macOS: `~/Library/Application Support/reviewer/...`）— に分離して保持する。
DB には置かない（本番 DB は `:memory:` で再起動消失するため）。

- `review.json` … コメント（schema は後続作業）
- `history.jsonl` … リビジョンの全文スナップショット（diff 用）

ライフサイクル: `draft`（管理外）→ **取り込み** → `review`（履歴・コメント管理下）。

## POST /api/ingest/*path

正典を `draft` → `review` に遷移させる（`~/.config/reviewer` 配下に管理エントリを生成）。
**正典バイト列は動かさない**。冪等（再取り込みは既存エントリを保持）。

Response: `{ "path": "doc.md", "root": "rooms", "state": "review" }`

| Status | 条件 |
|--------|------|
| 404 | 正典ファイルが存在しない |

## GET /api/revisions/*path

`id` クエリの有無で 2 通り:

- **`id` なし** … リビジョン一覧（新しい順、本文なし）
  `{ "path": "...", "root": "...", "revisions": [ { "id": "r-002", "ts": "...", "author": "ai" }, ... ] }`
- **`id=<rev>`** … 単一リビジョンの本文（hint 除去済み）
  `{ "id": "r-001", "ts": "...", "author": "human", "content": "# ..." }`

diff はクライアント側で計算する（サーバは版の中身を返すだけ）。
`review` 状態でない / 履歴のないファイルは空リストを返す。

| Status | 条件 |
|--------|------|
| 404 | `id` 指定だが該当リビジョンなし |

---

## AI 向けの使い方

正典本文にレビューマーカーは無い。**推奨は CLI `mr`**: `mr review <path>` で open コメントを読み、
本文をエディタ/ツールで in-place 更新し、`mr reply <path> <id> '...'` / `mr resolve <path> <id>`
で対応状況を返す。CLI が使えない環境では HTTP API（`GET /api/review` → 本文を `PUT /api/files`
→ `POST /api/replies` / `PATCH ...?status=resolved`）で同じことができる。`.vN.md` 等の派生ファイルは作らない。

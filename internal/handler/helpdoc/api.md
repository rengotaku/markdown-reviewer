# markdown-reviewer API

Markdown ファイルへのレビューコメント付与・取得・参照のための API。
AI クライアントが API 仕様をセルフディスカバリーできるよう、このドキュメントは `GET /api/help` で配信される。

各 `.md` ファイルの先頭には以下の HTML コメントが書き込み時に強制注入されるので、
AI はファイルを読んだ瞬間にこのエンドポイントを発見できる:

```
<!-- markdown-reviewer
このファイルには `<!-- @comment ... -->` レビューマーカーが含まれる可能性があります。
構造化コメント取得: GET <base-url>/api/comments/<path>?root=<root>
API 全仕様:        GET <base-url>/api/help
-->
```

## ベース URL

サーバを起動した HTTP オリジン（例: `http://localhost:15174`）。
hint URL は環境変数 `MARKDOWN_REVIEWER_BASE_URL` で固定でき、未設定時はリクエストの Host ヘッダーから組み立てる。

## ルート

`?root=<name>` ですべてのファイル系エンドポイントが受け取るルート名。
省略時は最初に宣言されたルート (`REVIEW_ROOTS` の先頭) がデフォルト。

---

## GET /api/comments/*path

ファイル内の `@comment` レビューマーカーを **AI 向けに構造化された JSON** で返す。
生 grep では再現困難な以下の集約をサーバ側で吸収する:

- `group_id` を共有する複数の block マーク → 1 エントリ + `members[]`
- ProseMirror が block 境界で分割した同一 `id` マーク → 1 エントリ + `members[]`
- 属性値の HTML エスケープ (`\"` `\\` `\n` `\-\-`) → 展開済みで返す
- 各コメントの `heading_path`（`##` レベル prefix 込み）と `line_range`（1-indexed inclusive）

### Query

| Name | Type | 説明 |
|------|------|------|
| `root` | string | ルート名。省略時はデフォルトルート |

### Response

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

### Scope

| scope | 意味 | context | members |
|-------|------|---------|---------|
| `inline` | テキスト範囲を wrap する単独のコメント（デフォルト） | あり | 単一 wrap 時は無し / 同一 id split 時はあり |
| `block` | 段落単位の単独 wrap | あり | 同一 id split 時はあり |
| `cross_section` | 横断（複数セクションへの注釈）。`group_id` で束ねられた block の集約、または旧 standalone `scope="cross-section"` | なし（集約時） | あり（集約時）。旧 standalone はなし |
| `global` | ファイル全体への注釈 | `null` | なし |

`context: null` のとき: `global` または「複数位置に分散しているので `members[]` を見よ」のいずれか。

### Errors

| Status | 条件 |
|--------|------|
| 400 | path が `.md` 以外 / path traversal / 未知の root |
| 404 | ファイルが存在しない |
| 500 | files API が未設定 (REVIEW_ROOTS / REVIEW_ROOT 両方とも空) |

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
正典フォルダの外 — ユーザー設定ディレクトリ `~/.config/reviewer/<root>/<相対パス>/` — に分離して保持する。
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

## コメント記法 on-disk

詳細はリポジトリの `CLAUDE.md` 参照。AI 視点では `/api/comments/*path` が正規化済み JSON を返すので、生 markdown をパースする必要はない。

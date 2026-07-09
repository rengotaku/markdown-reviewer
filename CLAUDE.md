# CLAUDE.md

このリポジトリと、このツールでレビューされる Markdown を Claude が扱う際の参考情報。

## このツールの位置づけ

`markdown-reviewer` は、ローカルの Markdown を Web エディタで開き、選択範囲にレビューコメントを付けるツール。
コメントは本文に埋め込まれず **sidecar**（`<os.UserConfigDir()>/reviewer/<root>/<path>/review.json`）で管理され、正典の `.md` は常にクリーンに保たれる。

利用パターン:

1. 人間が Web UI で Markdown にコメントを付ける（「ここを直して」「この記述は不正確」など）
2. Claude が `mr` CLI でコメントを読み取り、本文を修正する
3. Claude が `mr reply` / `mr resolve` で対応状況を返す
4. 人間が Web UI で diff とスレッドを確認する

## レビュー済み Markdown を扱う Claude への指示

ファイル先頭に次の hint コメントがあるファイルは、このツールの管理下にある:

```html
<!-- markdown-reviewer
本文はクリーンです。レビューコメントは別管理(sidecar)で、以下から取得します。
CLI(推奨):  mr review <このファイルのパス>   # 返信: mr reply <path> <id> '...' / 解決: mr resolve <path> <id>
...
-->
```

1. **「人がコメントした」と言われたら `mr inbox` で対象ファイルを特定**し、`mr review <path>` で open コメントを読む。前回以降の新規だけ見るなら `--since <ID>`、AI 未対応分だけなら `--unanswered`。
2. **コメントは修正・確認依頼の指示として扱う。** `mr review` の出力には解決位置（行番号）・対象 snippet・指摘・返信が含まれる。
3. **本文はそのファイルを in-place 修正する。** `.v2.md` などの派生ファイルを作らない。
4. **対応したら `mr reply <path> <id> '<対応内容>'` で返信し、完了したものは `mr resolve <path> <id>` する。**
5. **hint コメントは削除しない。** サーバが保存のたびに管理・再注入する。
6. `mr` が使えない環境では HTTP API で同じことができる（`GET /api/review` → 本文を `PUT /api/files` → `POST /api/replies` / `PATCH /api/comments?status=resolved`）。全仕様は `GET /api/help`。

### mr CLI クイックリファレンス

```
mr inbox    [--root NAME] [--all]                        # open コメントを持つファイル一覧
mr comments <path> [--json] [--since ID] [--unanswered]  # コメント一覧
mr review   <path> [--all] [--since ID] [--unanswered]   # open コメントを整形 Markdown で
mr reply    <path> <id> <text> [--author NAME]           # スレッド返信（既定 author=ai）
mr resolve  <path> <id>                                  # resolved にする
mr reopen   <path> <id>                                  # resolved を open に戻す
```

パスは絶対 / cwd 相対のどちらでもよい。サーバ未起動でも動作する。

### コメントを API で自作するときの注意（anchor 契約）

`POST /api/comments` で `anchor` を指定する場合、`heading_path` と `snippet` は**描画後テキスト**（`` `x` `` → `x`、`**x**` → `x` のようにインライン記法を剥がした形）で書く。生 Markdown をコピーすると照合に失敗して orphan になる。詳細は `GET /api/help`。

## このリポジトリで作業する Claude へ

- Go: `internal/`, `cmd/server/`（API サーバ）, `cmd/mr/`（CLI）, `cmd/migrate/`
- Frontend: `frontend/src/`
- コメント sidecar の実装: `internal/reviewstore/`（review.json / history.jsonl / anchor 解決）
- コメント・レビュー API: `internal/handler/comments.go`, `review.go`, `hint.go`
- ファイル API / path traversal 防止: `internal/handler/files.go`, `internal/files/safepath.go`
- API 仕様の SoT: `internal/handler/helpdoc/api.md`（`GET /api/help` で配信）
- 設定: `internal/config/config.go`, `internal/server/server.go`
- 動作確認は `make run`（要 `REVIEW_ROOTS` または `REVIEW_ROOT`）。CI は `make ci`。
- 複数ルート対応の env 形式: `REVIEW_ROOTS='[{"name":"works","path":"/abs/works"},{"name":"rooms","path":"/abs/rooms"}]'`。単一ルートのみ使う場合は引き続き `REVIEW_ROOT=<dir>` でよい（その場合 `name` は basename になる）。
- リリース: `v*` タグ push で GoReleaser が Releases + homebrew-tap を更新（`.goreleaser.yaml` / `.github/workflows/release.yml`）。実行手順は `/release` スキル（`.claude/skills/release/SKILL.md`）に従うこと。

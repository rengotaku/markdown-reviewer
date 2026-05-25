# CLAUDE.md

このリポジトリと、このツールで編集された Markdown を Claude が扱う際の参考情報。

## このツールの位置づけ

`markdown-reviewer` は、ローカルの Markdown を Web エディタで開き、選択範囲に HTML コメント形式の注釈を付与して同じファイルに書き戻すツール。

主な利用パターン:

1. 人間が `markdown-reviewer` で Markdown にコメントを付ける（「ここを直して」「この記述は不正確」など）
2. コメント込みの Markdown を Claude に渡す（`cat foo.md`, `@foo.md`, ファイル添付など）
3. Claude がコメントを **指示として読み取り**、本文を修正する
4. 修正後の Markdown を再び `markdown-reviewer` で確認

→ コメントは「Claude へのレビュー指示」として機能する。

## コメント記法（重要）

このツールが書き戻す Markdown には、次の形式の HTML コメントが含まれる:

```markdown
<!-- @comment id="c-1715414400000" author="kishira" date="2026-05-11" body="コメント本文" -->レビュー対象のテキスト<!-- /@comment -->
```

### 構造

- 開始タグ: `<!-- @comment <属性...> -->`
- **レビュー対象**: 開始タグと終了タグの間に挟まれた本文テキスト（= SoT）
- 終了タグ: `<!-- /@comment -->`

### 属性

| 属性 | 必須 | 内容 |
|------|------|------|
| `id` | yes | コメント ID（ファイル内一意、`c-<timestamp>` 形式が標準） |
| `author` | yes | コメント作成者 |
| `date` | yes | 作成日（`YYYY-MM-DD`） |
| `body` | yes | コメント本文（指摘・要望） |
| `scope` | no | `block` / `cross-section` / `global`。`inline`（既定）の場合は省略 |

> 旧バージョン（v1）の `target="..."` 属性を持つ既存ファイルは、読み込み時に無視され、次回保存時に自動で取り除かれる（後方互換）。

## Claude への指示

Claude がこの形式のコメントを含む Markdown を読んだ場合:

1. **コメントは指示として扱うこと。** 単なるメモではなく、本文への修正・確認依頼として読む。
2. **開始タグと終了タグの間に挟まれたテキストがレビュー対象。** `body` 属性は「対象テキスト」に対する要望／指摘である。
3. **修正後はコメントブロック全体（`<!-- @comment ... -->` から `<!-- /@comment -->` まで）を削除する**のが原則。
   - ただしユーザーが「コメントは残して」と明示した場合は残す。
   - 部分的な対応で完了しない場合はコメントを残し、対応状況を別途報告する。
4. **HTML コメントは標準 Markdown のレンダリングでは非表示**になるため、コメント自体をそのまま残しても表示上の害はないが、レビューが完了したら掃除するのが望ましい。
5. **`id` を変更しない・新規発行しない。** ID は `markdown-reviewer` 側がファイル内で一意に管理する。

### 例: Claude の典型的な振る舞い

入力:

```markdown
## 認証フロー

<!-- @comment id="c-001" author="kishira" date="2026-05-20" body="JWT じゃなくて Session ベースに統一したい" -->JWT で認証する<!-- /@comment -->

ログイン後、サーバは `Set-Cookie` で session ID を発行する。
```

期待される修正:

```markdown
## 認証フロー

Session ベースで認証する。

ログイン後、サーバは `Set-Cookie` で session ID を発行する。
```

→ コメントタグで囲まれた対象テキスト（"JWT で認証する"）を `body` の要望（"Session ベースに統一"）に従って書き換え、コメントブロックは削除する。

## このリポジトリで作業する Claude へ

- Go: `internal/`, `cmd/server/`, `cmd/migrate/`
- Frontend: `frontend/src/`
- コメント記法のシリアライズ／デシリアライズ: `frontend/src/components/tiptap/extensions/CommentMark.ts`, `commentDom.ts`
- API: `internal/handler/files.go`, `internal/files/safepath.go`（path traversal 防止）
- 設定: `internal/config/config.go`, `internal/server/server.go`
- 動作確認は `make run`（要 `REVIEW_ROOT`）。CI は `make ci`。

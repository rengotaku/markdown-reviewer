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

`REVIEW_ROOT` 環境変数で対象ディレクトリを **必須** で指定する。
未指定の場合、`/api/files` 系エンドポイントは 500 を返す。

### 開発モード（ホットリロード）

Go (`:8080`) と Vite (`:5174`) を並列起動する。ブラウザでは `http://localhost:5174` を開く（`/api` は Go にプロキシされる）。

```bash
# 例 1: 直近のワークスペースをレビューする
REVIEW_ROOT=~/MyWorkspace/organize_tickets/works/work42/phases make run

# 例 2: 同リポジトリ配下の docs/ をレビューする
REVIEW_ROOT=$PWD/docs make run

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

デフォルトは `PORT=15174`, `REVIEW_ROOT=$HOME/ot/works`。上書き例:

```bash
PORT=15174 REVIEW_ROOT=$HOME/notes ./scripts/install-launchd.sh
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

| Method | Path | 用途 |
|--------|------|------|
| `GET` | `/api/files` | `REVIEW_ROOT` 配下の `.md` 一覧 |
| `GET` | `/api/files/*path` | ファイル読み込み |
| `PUT` | `/api/files/*path` | ファイル保存（コメント込み） |

`*path` は `REVIEW_ROOT` からの相対パス。`..` を含むパスや絶対パスは拒否される。

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

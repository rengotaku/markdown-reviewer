---
name: release
description: "markdown-reviewer の新バージョンをリリースする。バージョン決定 → タグ push → GoReleaser workflow 監視 → Release/homebrew-tap/brew の検証まで一貫実行する"
when_to_use: "リリースして、release、新バージョンを出す、タグを切って、vX.Y.Z を出して、brew に反映して"
argument-hint: "[バージョン (例: v0.2.0) | 省略時は変更内容から semver 判定]"
allowed-tools: Bash Read Grep
---

# release

`v*` タグを push すると GitHub Actions（`.github/workflows/release.yml` → GoReleaser）が以下を自動実行する:

1. frontend ビルド + Go バイナリ（`markdown-review-server` / `mr`）を darwin/linux × amd64/arm64 でビルド
2. GitHub Releases にアーカイブ 4 個 + `checksums.txt` を公開
3. `rengotaku/homebrew-tap` の `Casks/markdown-reviewer.rb` を自動更新

このスキルは「タグを打つ前の確認」「バージョン決定」「push 後の検証」「失敗時のリカバリ」を定義する。

## 1. 前提確認（すべて満たすまでタグを打たない）

```bash
git fetch origin
git status --porcelain              # 空であること（main worktree で実行）
git rev-parse main origin/main     # 一致すること（ローカル main が最新）
gh run list --branch main --workflow=ci.yml --limit 1 --json conclusion --jq '.[0].conclusion'
                                    # "success" であること（main の CI が緑）
```

- main worktree（`~/Workspace/markdown-reviewer/main`）で作業する。feature worktree からタグを打たない
- CI が pending なら完了を待つ。failure なら**リリース中止**して原因を報告する

## 2. バージョン決定（semver）

```bash
LAST=$(git describe --tags --abbrev=0 origin/main)
git log --oneline "$LAST"..origin/main   # 前回リリース以降の変更一覧
```

| 変更内容 | bump |
|----------|------|
| 破壊的変更（API/CLI の非互換、設定 env の削除・意味変更、コメント sidecar スキーマ非互換） | major |
| 機能追加（`feat:`）、後方互換の挙動追加 | minor |
| バグ修正・ドキュメント・依存更新のみ（`fix:` / `docs:` / `chore:`） | patch |

- ユーザーがバージョンを指定した場合はそれを使う
- major bump に相当する変更を検出した場合は、タグを打つ前にユーザーに確認する
- v0.x 系では破壊的変更を minor に割り当ててもよい（semver の 0.x 慣例）。迷ったら候補と根拠を提示して確認する

## 3. タグ push

```bash
git tag vX.Y.Z && git push origin vX.Y.Z
```

## 4. workflow 監視

```bash
RID=$(gh run list --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RID" --exit-status
```

`gh run watch` が使えない環境ではポーリングで代替する:

```bash
for i in $(seq 1 40); do
  S=$(gh run view "$RID" --json status,conclusion --jq '.status + "/" + .conclusion')
  [ "${S%%/*}" = "completed" ] && break
  sleep 15
done
echo "$S"   # completed/success であること
```

## 5. 検証（完了報告の前に必ず全部実施）

```bash
# (1) Release アセット: tar.gz ×4 + checksums.txt の計 5 個
gh release view vX.Y.Z --json assets --jq '.assets[].name'

# (2) tap の Cask がこのバージョンを指している
gh api repos/rengotaku/homebrew-tap/contents/Casks/markdown-reviewer.rb \
  --jq '.content' | base64 -d | grep 'version "'

# (3) brew で実際に入る（インストール済み環境なら upgrade）
brew update >/dev/null && brew upgrade markdown-reviewer 2>&1 | tail -2 \
  || brew install rengotaku/tap/markdown-reviewer
markdown-review-server --help 2>/dev/null; mr --help | head -2
```

(3) の後、`PORT=18093 DATABASE_DSN=':memory:' REVIEW_ROOT=/tmp markdown-review-server` を起動し `curl -sf http://localhost:18093/api/help` が 200 を返すことまで見ると確実（確認後 kill する）。

完了報告には「バージョン / Release URL / tap の Cask version / brew 検証結果」を含める。

## 6. 失敗時のリカバリ

```bash
gh run view "$RID" --log-failed | tail -50   # まず原因を読む
```

| 症状 | 原因と対処 |
|------|-----------|
| cask push 段で 401/403 | `HOMEBREW_TAP_GITHUB_TOKEN`（fine-grained PAT）の失効・権限不足。ユーザーに再発行を依頼（homebrew-tap への Contents: Read and write）。secret 再登録後、下記の「タグ切り直し」で再実行 |
| frontend ビルド失敗 | main が壊れている。リリース中止 → 修正 PR → 再リリース |
| GitHub Releases に一部だけアセットがある | 中途半端な Release が残っている。下記手順で消してから再実行 |

**タグ切り直し（再実行）手順**:

```bash
gh release delete vX.Y.Z --yes           # Release を削除（存在する場合）
git push origin :refs/tags/vX.Y.Z        # リモートタグ削除
git tag -d vX.Y.Z                        # ローカルタグ削除
# 原因を修正した後、同じバージョンで再タグ → push（手順 3 に戻る）
```

- 一度でも `brew install` された可能性があるバージョンのタグを**別コミットに付け替えない**（sha256 不一致でユーザー側の brew が壊れる）。公開から時間が経っている場合はバージョンを進めて出し直す

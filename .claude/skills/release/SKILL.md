---
name: release
description: "markdown-reviewer の新バージョンをリリースする。バージョン決定 → タグ push → GoReleaser workflow 監視 → Release/homebrew-tap/brew の検証まで一貫実行する"
when_to_use: "リリースして、release、新バージョンを出す、タグを切って、vX.Y.Z を出して、brew に反映して"
argument-hint: "[バージョン (例: v0.2.0)]"
allowed-tools: Bash Read Grep
---

# release

`v*` タグを push すると GitHub Actions（`.github/workflows/release.yml` → GoReleaser）が以下を自動実行する:

1. frontend ビルド + Go バイナリ（`markdown-review-server` / `mr`）を darwin/linux × amd64/arm64 でビルド
2. GitHub Releases にアーカイブ 4 個 + `checksums.txt` を公開
3. `rengotaku/homebrew-tap` の `Casks/markdown-reviewer.rb` を自動更新

このスキルは `make release` の使い方・バージョン決定・失敗時のリカバリを定義する。工程そのものは `scripts/release.zsh` が持つ。

## 1. 実行

```bash
cd ~/Workspace/markdown-reviewer/main       # main worktree から実行する
make release VERSION=vX.Y.Z
```

`make release` が以下を一括で行う（実体は `scripts/release.zsh`）。手順をここに二重管理せず、スクリプトを正典とする。

1. **前提確認（fail-closed）**: main worktree であること / working tree が clean / ローカル main が origin/main と一致 / main の最新 CI が success / タグが未使用。どれか1つでも満たさなければタグを打たずに中断する
2. **タグ作成 → push**（push に失敗したらローカルタグを消してリトライ可能な状態に戻す）
3. **release workflow の完了待ち**（タグ名で run を特定するので、無関係な run を掴まない）
4. **公開物の検証**: Release アセット5個（tar.gz ×4 + `checksums.txt`）/ homebrew-tap の Cask が当該バージョンを指す
5. **ローカル反映**: 対象 tap だけ fast-forward → `brew upgrade --cask` → インストール版が一致することを確認
6. **`launchctl kickstart`** → `/api/config` が応答するまでポーリング（固定 `sleep` で起動途中を叩かない）

5・6 は brew / launchctl が無い環境、cask 未インストール環境では理由を出してスキップする。

## 2. バージョン決定（semver）

`VERSION` は必須。自動判定はしない。

```bash
LAST=$(git describe --tags --abbrev=0 origin/main)
git log --oneline "$LAST"..origin/main   # 前回リリース以降の変更一覧
```

| 変更内容 | bump |
|----------|------|
| 破壊的変更（API/CLI の非互換、設定 env の削除・意味変更、コメント sidecar スキーマ非互換） | major |
| 機能追加（`feat:`）、後方互換の挙動追加 | minor |
| バグ修正・ドキュメント・依存更新のみ（`fix:` / `docs:` / `chore:`） | patch |

- 🔴 **現行バージョンを記憶や外部メモから引かない。必ず `git describe --tags --abbrev=0 origin/main` で実測する**
- ユーザーがバージョンを指定した場合はそれを使う
- major bump に相当する変更を検出した場合は、タグを打つ前にユーザーに確認する
- v0.x 系では破壊的変更を minor に割り当ててもよい（semver の 0.x 慣例）。迷ったら候補と根拠を提示して確認する

## 3. 途中で失敗したとき

タグ push と workflow は成功したが、その後（検証 / brew / 再起動）で落ちた場合は**タグを切り直さない**。後半だけやり直す:

```bash
make release-verify VERSION=vX.Y.Z
```

workflow 自体が失敗した場合は下記のリカバリに従う。

## 4. workflow 失敗時のリカバリ

```bash
RID=$(gh run list --workflow=release.yml --limit 1 --json databaseId --jq '.[0].databaseId')
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

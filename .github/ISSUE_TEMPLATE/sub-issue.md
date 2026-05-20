---
name: sub-issue
about: 親 issue の議論で確定した仕様を実装するための sub-issue
title: ''
labels: []
assignees: ''
---

<!--
⚠️ AI実装者へ:
- **全セクションを必ず埋めること**。「後で追記」は禁止
- Status は起票直後 "実装待ち" にする
- 「元要望 (inline)」には要望全文をそのまま転記する（リンクだけではなく inline 必須）
- 「前提仕様」は親 issue の Decision Log から確定済み事項を転記する
- 「やってはいけないこと」は最低 3 項目。実装中に追加する
- DoD は完了条件を具体的に書く。「動作する」は DoD にならない
- PR には `Refs: #親issue番号` を含める。`Fixes:` は使わない（親をcloseさせない）
- PR マージ後、completion-comment.md を使って親 issue に完了報告を投稿する
- Status 凡例（sub-issue）: 実装待ち / 実装中 / 実装完了 / 保留 / 中断
-->

**Status:** 実装待ち

**Parent:** #親issue番号

## ⚠️ 実装前に必ず読むこと

- **親 [#親issue番号](PARENT_ISSUE_URL_HERE)** — Decision Log 全エントリ + 論点確定事項
- 親 #親issue番号 の first comment ([元要望全文](FIRST_COMMENT_URL_HERE))

## 元の要望 (inline)

<!--
親 issue の元要望から、この sub-issue に関係する部分を転記する。
リンクだけではなく、テキストを直接書くこと（self-contained にするため）。
-->

## Depends on

<!--
依存する sub-issue がある場合はリスト形式で記載する。
依存なしの場合は「依存 sub-issue なし」と明示する。
-->

依存 sub-issue なし

## 前提仕様 (親 #N から確定済み・転記)

<!--
親 issue の Decision Log で確定した、この sub-issue に関わる仕様を転記する。
転記元の論点番号を明示する（例: 「論点A」「Decision Log #3」）。
-->

## スコープ

<!--
このsub-issueで作成・変更するファイルや機能をリスト形式で書く。
チェックボックス形式で完了を追跡する。
-->

- [ ] ファイル/機能 1
- [ ] ファイル/機能 2

## やってはいけないこと

<!--
実装中に避けるべきことを明示する。最低 3 項目。
「❌ **XXX**」の形式で書く。
-->

- ❌ **XXX** — 理由
- ❌ **YYY** — 理由
- ❌ **ZZZ** — 理由

## DoD

<!--
完了条件を具体的に書く。「動作する」「実装できた」はDoD にならない。
「〜が確認できる」「〜テストが PASS する」形式で書く。
-->

- [ ] 条件 1 が確認できる
- [ ] 条件 2 のテストが PASS する
- [ ] PR が `Refs: #N` を含む（`Fixes:` ではない）

## 不明点があれば

実装を始める前に、**親 #N にコメントで質問すること**。推測で進めない。

---
name: 議論用 sub-issue
about: 親 issue の特定の論点を議論するための sub-issue
title: '議論: '
labels: []
assignees: ''
---

<!--
⚠️ AI実装者へ:
- この issue は特定の論点を議論するためのもの。決定が出たら close する
- close 時は GitHub 純正 reason「completed」+ --comment で決定内容を記載する
- 決定事項は必ず親 issue の Decision Log に転記してから close する
- Status は起票直後 "議論中" にする
- 「選択肢」は全候補を列挙する。「お好みで」等の曖昧表現は禁止
- 「決定」セクションは議論完了後に記入し、close コマンドを実行する
- Status 凡例（議論用 sub-issue）: 議論中 / 決定済み
-->

**Status:** 議論中

**Parent:** #親issue番号

## 論点

<!-- 議論する論点を 1 文で明確に述べる -->

## 背景・制約

<!-- なぜこの論点が生まれたか。制約や前提条件を書く -->

## 選択肢

<!-- 全候補をリスト形式で列挙する。メリット・デメリットを明記する -->

### 案 A: 〇〇

- メリット:
- デメリット:

### 案 B: 〇〇

- メリット:
- デメリット:

## 決定

<!--
議論完了後に記入する。
決定したら親 issue の Decision Log に転記し、この issue を close する。
close コマンド例:
  gh issue close <NUMBER> --reason completed --comment "決定: 案 A を採用。理由: XXX。親 #N Decision Log に転記済み。"
-->

**未決定**（議論中）

## 関連リソース

<!-- 参考になる外部ドキュメント・過去 issue などがあれば記載 -->

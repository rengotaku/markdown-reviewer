<!--
⚠️ AI実装者へ:
- 「Affects:」は他の sub-issue の前提仕様を変える変更がある場合に記載する。なければ「なし」
- 「Refs:」は参照のみ（issue を close しない）。「Fixes:」は issue を close する
- 親 issue は手動で close するため、PR には必ず「Refs: #親issue番号」を使う
- 「Closes:」は sub-issue に使う（PR マージで自動 close される）
- 全チェックボックスを埋めること。該当なしの場合は「N/A」と書く
-->

## 概要

<!-- 1〜3 行で「なぜ」「何を変えたか」を書く -->

## 関連 Issue

Refs: #親issue番号
Closes: #sub-issue番号

## Affects

<!--
このPR が他の sub-issue の前提仕様を変える場合に記載する。
記入例: Affects: #N (〇〇の前提仕様が変わる。例: Project 番号が X から Y に切り替わるため #M の設定値も変更が必要)
なければ「なし」と記載する。
前提変更がある場合は、影響先 sub-issue の「前提仕様」セクションを更新し、親 issue の Decision Log に転記する。
-->

なし

## 変更タイプ

- [ ] feat: 新機能
- [ ] fix: バグ修正
- [ ] refactor: 挙動変更なしのリファクタ
- [ ] perf: パフォーマンス改善
- [ ] chore / docs / test
- [ ] schema: DB スキーマ変更あり

## 動作確認手順（ローカル起動）

<!-- コピペで起動できるよう記載する。削らないこと -->

```bash

```

### 動作確認シナリオ

- [ ]
- [ ]

## テスト

- [ ] `make ci` PASS
- [ ] 新規/変更コードに対するユニットテストを追加した

## チェックリスト

- [ ] `Refs:` / `Closes:` の使い分けが正しい（親 issue には `Refs:`、sub-issue には `Closes:`）
- [ ] README の更新が必要なら反映した
- [ ] 機密情報（API キー等）を含まない
- [ ] PR タイトルが Conventional Commits 形式
- [ ] base ブランチが `main`

## 補足 / レビュー観点

<!-- 設計判断のトレードオフ、フォローアップ予定など -->

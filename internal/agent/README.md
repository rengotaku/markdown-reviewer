# AI へのレビュー引き継ぎ

AI ごとのセッション管理と送信方法を `Adapter` の裏へ分離し、登録・送り先選択・HTTP API・画面を共通化しています。現在登録している実装は Claude Code のみです。

## 依存関係

```text
HTTP handler → agent.Sender → agent.Service → agent.Adapter
                                               ↑
                                         claudeterm.Adapter
                                               ↓
                                         terminal.Writer
                                               ↑
                                          iterm.Writer
```

`internal/agentsetup` が実装を組み合わせる構成登録箇所です。HTTP ハンドラーと画面は Claude の JSON・環境変数・状態値・iTerm2 を参照しません。

## 共通側の責務

- `Identity` の `AgentID` と `SessionID` を組にして、ファイルを開いたセッションを登録します。ローカルプロセスを使う実装は PID も照合できます。
- 登録先を優先し、見つからなければファイルを含む最深の cwd のセッションを選びます。同じ深さなら agent ID、session ID 順です。
- 選択したセッションが入力待ちでなければコピーへ戻し、ほかのセッションに振り替えません。
- コマンドの生成、同時送信の抑止、送信結果の共通化を担当します。コピー自体は画面側のフォールバックです。

## アダプターの契約

```go
type Adapter interface {
    ID() string
    Sessions(context.Context) ([]Session, error)
    Send(context.Context, Session, string) error
}
```

- `ID` は AI 実装を識別する重複しない文字列です。
- `Sessions` は生存するセッションを共通型へ変換します。ID・絶対 cwd・表示名・入力待ちかどうかを返します。ネイティブの状態値は外へ渡しません。
- `Instance` はプロセスの起動時刻など、セッションの実体が変わっていないことを確認するための値です。共通側は値を解釈しません。
- `Send` は入力直前に同じ実体の生存と入力待ち状態を再確認します。候補選択時の `Ready` だけに依存しません。
- 状態が変わった場合は `ErrBusy`、消えた場合は `ErrNoSession`、対応する端末がない場合は `ErrNoTerminal` を返します。それ以外のエラーは `send_failed` に変換します。
- すべての処理は引数の context によるキャンセルに従います。

Claude 固有の状態の解釈・JSON の読み取り・PID と起動時刻の照合は `internal/claudeterm` にあります。iTerm2 の本文入力と Enter の別送は `internal/terminal/iterm` にあり、Claude 以外でも同じ方式なら再利用できます。

## 対応する AI を追加するとき

- 新しいパッケージに `Adapter` を実装します。
- CLI の `mr open` の起動元を認識する関数を実装します。共通の `Identity` と検出の成否を返します。
- `internal/agentsetup/setup.go` の `registrations` に、アダプターの生成関数と起動元認識関数の組を追加します。
- 追加実装のセッション発見・状態変換・送信直前の再確認をテストします。

HTTP API は `POST /api/agents/register/*path` と `POST /api/agents/send/*path` を使います。新しい AI の名前を HTTP ハンドラーやエディタへ追記する必要はありません。

共通の選択ロジックは `agent_test.go` で、実際の AI を起動せず複数のテスト用アダプターを使って検証しています。実際の iTerm2 入力は `MR_ITERM_INTEGRATION=1 go test -race ./internal/terminal/iterm -count=1 -v` で別途確認できます。

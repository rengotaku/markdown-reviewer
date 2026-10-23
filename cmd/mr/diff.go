package main

import (
	"fmt"
	"os"

	"github.com/pmezard/go-difflib/difflib"

	"markdown-reviewer/internal/reviewstore"
)

// cmdDiff prints a unified diff between a prior revision and the current
// canonical body (#322). It shares its id space with `mr revisions`/`mr
// restore`: --since <rev-id> names one directly, while the default (and
// --since-last-read, spelled out for clarity when a caller wants to be
// explicit) resolves to whatever last_read.json currently points at — the
// same baseline the drift banner and the write-command guard use, so a
// caller told "本文が変わっています" runs this with no extra flags and sees
// exactly the change that triggered it.
func cmdDiff(args []string) error {
	pos, flags := parseArgs(args)
	if len(pos) != 1 {
		return fmt.Errorf("usage: mr diff <path> [--since <rev-id>] [--since-last-read]")
	}
	root, rel, abs, err := resolveRegistered(pos[0])
	if err != nil {
		return err
	}
	raw, err := os.ReadFile(abs)
	if err != nil {
		return err
	}
	current := reviewstore.StripAIHint(string(raw))

	sinceID := flags["since"]
	if sinceID == "" {
		last, ok, lerr := reviewstore.ReadLastRead(root, rel)
		if lerr != nil {
			return lerr
		}
		if !ok {
			return fmt.Errorf("last_read が記録されていません（先に mr comments または mr review を実行してください）")
		}
		if last.RevID == "" {
			return fmt.Errorf("last_read に基準となる revision が記録されていません")
		}
		sinceID = last.RevID
	}

	baseRev, found, err := reviewstore.GetRevision(root, rel, sinceID)
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("revision %q が見つかりません（mr revisions %s で確認してください）", sinceID, pos[0])
	}

	if baseRev.Content == current {
		fmt.Println("差分はありません。")
		return nil
	}

	unified := difflib.UnifiedDiff{
		A:        difflib.SplitLines(baseRev.Content),
		FromFile: sinceID,
		B:        difflib.SplitLines(current),
		ToFile:   "current",
		Context:  3,
	}
	text, derr := difflib.GetUnifiedDiffString(unified)
	if derr != nil {
		return derr
	}
	fmt.Print(text)
	return nil
}

package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"markdown-reviewer/internal/files"
	"markdown-reviewer/internal/reviewstore"
)

// applyInput is the JSON `mr apply` reads: body edits and replies that the
// caller wants landed together (#345). Responding to a review used to take
// one tool call per Edit plus one per `mr reply`, and every call resends the
// AI session's whole context — so collapsing them into one command is what
// actually cuts the cost, not shrinking any single output.
type applyInput struct {
	Edits   []applyEdit  `json:"edits"`
	Replies []applyReply `json:"replies"`
}

type applyEdit struct {
	Old string `json:"old"`
	New string `json:"new"`
}

type applyReply struct {
	ID   string `json:"id"`
	Body string `json:"body"`
}

// cmdApply implements `mr apply <path> [<json-file>|-] [--author NAME] [--force]`.
//
// Everything is validated before anything is written: every edit must match
// exactly once (the same rule as an editor's exact-string replace), and every
// reply must target an existing, unresolved comment. Only then is the body
// written (comments re-anchored first, as the server's write path does),
// followed by the replies and a fresh last_read — so a follow-up `mr reply`
// does not trip the drift guard on the AI's own edit.
func cmdApply(args []string) error {
	pos, flags := parseArgs(args)
	if len(pos) < 1 || len(pos) > 2 {
		return fmt.Errorf("usage: mr apply <path> [<json-file>|-] [--author NAME] [--force]")
	}
	src := "-"
	if len(pos) == 2 {
		src = pos[1]
	}
	in, err := readApplyInput(src)
	if err != nil {
		return err
	}

	root, rel, abs, err := resolveRegistered(pos[0])
	if err != nil {
		return err
	}
	if gerr := checkWriteGuard(root, rel, abs, flags["force"] != ""); gerr != nil {
		return gerr
	}
	author := flags["author"]
	if author == "" {
		author = "ai"
	}

	raw, err := os.ReadFile(abs)
	if err != nil {
		return err
	}
	updated, err := applyEdits(string(raw), in.Edits)
	if err != nil {
		return err
	}
	if err := validateReplyTargets(root, rel, in.Replies); err != nil {
		return err
	}

	if updated != string(raw) {
		if err := writeAppliedBody(root, rel, abs, raw, updated, author); err != nil {
			return err
		}
	}

	date := time.Now().Format("2006-01-02")
	for _, r := range in.Replies {
		if _, err := reviewstore.AddReply(root, rel, r.ID, reviewstore.Reply{Author: author, Date: date, Body: r.Body}); err != nil {
			return fmt.Errorf("本文は反映済みですが、%s への返信で失敗しました: %w", r.ID, err)
		}
	}
	recordLastReadWarn(root, rel, updated)

	fmt.Printf("applied: edits %d 件, replies %d 件%s\n", len(in.Edits), len(in.Replies), replyIDs(in.Replies))
	return nil
}

// readApplyInput decodes the JSON from a file, or stdin when src is "-".
// Unknown fields are rejected so a typo such as "reply" for "replies" fails
// loudly instead of silently applying nothing.
func readApplyInput(src string) (applyInput, error) {
	var r io.Reader = os.Stdin
	if src != "-" {
		f, err := os.Open(src)
		if err != nil {
			return applyInput{}, err
		}
		defer func() { _ = f.Close() }()
		r = f
	}
	data, err := io.ReadAll(r)
	if err != nil {
		return applyInput{}, err
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	var in applyInput
	if err := dec.Decode(&in); err != nil {
		return applyInput{}, fmt.Errorf("apply の入力 JSON を読めません: %w", err)
	}
	if len(in.Edits) == 0 && len(in.Replies) == 0 {
		return applyInput{}, errors.New("apply の入力に edits も replies もありません")
	}
	return in, nil
}

// applyEdits replaces each edit's Old with New in order. Old must occur
// exactly once in the content as it stands at that step; zero or several
// matches abort the whole apply.
func applyEdits(content string, edits []applyEdit) (string, error) {
	for i, e := range edits {
		if e.Old == "" {
			return "", fmt.Errorf("edits[%d]: old が空です", i)
		}
		switch n := strings.Count(content, e.Old); n {
		case 1:
			content = strings.Replace(content, e.Old, e.New, 1)
		case 0:
			return "", fmt.Errorf("edits[%d]: old が本文に見つかりません（何も書き込んでいません）", i)
		default:
			return "", fmt.Errorf("edits[%d]: old が本文に %d 回現れます。前後を含めて一意にしてください（何も書き込んでいません）", i, n)
		}
	}
	return content, nil
}

// validateReplyTargets checks every reply id exists and is still open, so a
// bad id is reported before the body is touched.
func validateReplyTargets(root, rel string, replies []applyReply) error {
	if len(replies) == 0 {
		return nil
	}
	review, err := reviewstore.ReadReview(root, rel)
	if err != nil {
		return err
	}
	status := map[string]string{}
	for _, c := range review.Comments {
		status[c.ID] = c.Status
	}
	for i, r := range replies {
		if strings.TrimSpace(r.Body) == "" {
			return fmt.Errorf("replies[%d]: body が空です（何も書き込んでいません）", i)
		}
		st, ok := status[r.ID]
		if !ok {
			return fmt.Errorf("replies[%d]: コメント %q がありません（何も書き込んでいません）", i, r.ID)
		}
		if st == reviewstore.StatusResolved {
			return fmt.Errorf("replies[%d]: コメント %s は resolved です。mr reopen してから返信してください（何も書き込んでいません）", i, r.ID)
		}
	}
	return nil
}

// writeAppliedBody re-anchors comments, writes the new body only if the file
// is still what we read, and records the result as a revision. Re-anchoring
// before the write mirrors handler.WriteFile; if the compare-and-swap write
// loses a race, review.json is rolled back the same way `mr restore` does.
func writeAppliedBody(root, rel, abs string, raw []byte, updated, author string) error {
	// Make sure the pre-edit body is in history so `mr diff` / `mr restore`
	// can reach it. Best-effort, like the read path.
	if _, serr := reviewstore.SyncExternalEdit(root, rel, string(raw)); serr != nil {
		fmt.Fprintln(os.Stderr, "mr: warning: external-edit sync failed: "+serr.Error())
	}
	reviewPath, before, beforeExisted, err := snapshotReviewJSON(root, rel)
	if err != nil {
		return err
	}
	if _, err = reviewstore.ReanchorOnSave(root, rel, string(raw), updated); err != nil {
		return err
	}
	_, after, afterExisted, err := snapshotReviewJSON(root, rel)
	if err != nil {
		return err
	}
	if err = writeIfUnchangedSince(abs, files.Sha256Hex(raw), []byte(updated)); err != nil {
		if rerr := restoreReviewJSON(reviewPath, before, beforeExisted, after, afterExisted); rerr != nil {
			fmt.Fprintln(os.Stderr, "mr: warning: "+rerr.Error())
		}
		return fmt.Errorf("%s が書き込み中に変更されました。何も書き込んでいません。mr comments で読み直してから再実行してください: %w", rel, err)
	}
	if _, _, err = reviewstore.AppendRevision(root, rel, author, reviewstore.StripAIHint(updated)); err != nil {
		fmt.Fprintln(os.Stderr, "mr: warning: recording revision failed: "+err.Error())
	}
	if err = reviewstore.RecordAppWrite(root, rel, updated); err != nil {
		fmt.Fprintln(os.Stderr, "mr: warning: recording app write failed: "+err.Error())
	}
	return nil
}

func replyIDs(replies []applyReply) string {
	if len(replies) == 0 {
		return ""
	}
	ids := make([]string, len(replies))
	for i, r := range replies {
		ids[i] = r.ID
	}
	return "（" + strings.Join(ids, ", ") + "）"
}

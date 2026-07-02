package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"markdown-reviewer/internal/reviewstore"
)

// commentIDNum parses the numeric suffix of a "c-NNN" id, or -1 when the id is
// not in that form. Ids are monotonic (max+1), so the number orders comments by
// creation.
func commentIDNum(id string) int {
	s := strings.TrimPrefix(id, "c-")
	if s == id {
		return -1
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return -1
	}
	return n
}

// commentsSince returns the comments created after the given id (numeric suffix
// strictly greater), so a caller can see what was added since its last look.
func commentsSince(comments []reviewstore.Comment, since string) []reviewstore.Comment {
	threshold := commentIDNum(since)
	out := make([]reviewstore.Comment, 0, len(comments))
	for _, c := range comments {
		if commentIDNum(c.ID) > threshold {
			out = append(out, c)
		}
	}
	return out
}

// unansweredComments returns comments whose latest activity is not the AI's: no
// replies at all, or a last reply whose author is not "ai". This catches both
// brand-new human comments and fresh human follow-ups on existing threads.
func unansweredComments(comments []reviewstore.Comment) []reviewstore.Comment {
	out := make([]reviewstore.Comment, 0, len(comments))
	for _, c := range comments {
		if len(c.Replies) == 0 || c.Replies[len(c.Replies)-1].Author != "ai" {
			out = append(out, c)
		}
	}
	return out
}

// inboxEntry is one file that has comments, with counts and recency for sorting.
type inboxEntry struct {
	modTime time.Time
	root    string
	rel     string
	open    int
	total   int
}

// cmdInbox scans every configured root's sidecar store and lists the files that
// have open comments, newest-touched first — so "the human commented" can be
// answered without naming the file. --root limits to one root; --all also lists
// files whose comments are all resolved.
func cmdInbox(args []string) error {
	_, flags := parseArgs(args)
	roots, err := loadRoots()
	if err != nil {
		return err
	}
	base, err := reviewstore.BaseDir()
	if err != nil {
		return err
	}
	wantRoot := flags["root"]
	includeResolved := flags["all"] != ""

	var entries []inboxEntry
	for _, r := range roots {
		if wantRoot != "" && r.name != wantRoot {
			continue
		}
		storeDir := filepath.Join(base, r.name)
		_ = filepath.WalkDir(storeDir, func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() || d.Name() != reviewstore.ReviewFileName {
				return nil
			}
			rel, relErr := filepath.Rel(storeDir, filepath.Dir(p))
			if relErr != nil {
				return nil
			}
			review, rErr := reviewstore.ReadReview(r.name, filepath.ToSlash(rel))
			if rErr != nil {
				return nil
			}
			open := 0
			for _, c := range review.Comments {
				if c.Status == reviewstore.StatusOpen {
					open++
				}
			}
			if open == 0 && !includeResolved {
				return nil
			}
			if len(review.Comments) == 0 {
				return nil
			}
			info, _ := d.Info()
			mt := time.Time{}
			if info != nil {
				mt = info.ModTime()
			}
			entries = append(entries, inboxEntry{
				root:    r.name,
				rel:     filepath.ToSlash(rel),
				open:    open,
				total:   len(review.Comments),
				modTime: mt,
			})
			return nil
		})
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].modTime.After(entries[j].modTime)
	})

	if len(entries) == 0 {
		_, _ = fmt.Fprintln(os.Stdout, "open コメントを持つファイルはありません。")
		return nil
	}
	for _, e := range entries {
		_, _ = fmt.Fprintf(os.Stdout, "%s  [%s] %s  (open %d / 全 %d)\n",
			e.modTime.Local().Format("2006-01-02 15:04"), e.root, e.rel, e.open, e.total)
	}
	return nil
}

package main

import (
	"fmt"
	"path/filepath"

	"markdown-reviewer/internal/files"
)

// resolveRegistered maps a path to its (root, rel, abs) keys like resolvePath,
// and additionally reaches files parked in the server's ad-hoc ("anonymous")
// slot by an earlier `mr open` (issue #242). Every subcommand that reads or
// writes an existing review goes through this, so `mr open` and the read-back
// commands cover the same set of files.
//
// The ad-hoc slot is only ever looked up here, never re-pointed: registering
// is `mr open`'s job because it destroys the previous occupant's comments.
// A command asked to read or annotate one file must not quietly end another
// file's review to do it.
func resolveRegistered(arg string) (root, rel, abs string, err error) {
	root, rel, abs, err = resolvePath(arg)
	if err == nil {
		return root, rel, abs, nil
	}
	rootErr := err

	abs, absErr := filepath.Abs(arg)
	if absErr != nil {
		return "", "", "", rootErr
	}
	if resolved, e := filepath.EvalSymlinks(abs); e == nil {
		abs = resolved
	}

	current, found, lookupErr := lookupAdhoc(baseURL(launchdPort))
	if lookupErr != nil {
		return "", "", "", fmt.Errorf("%w; checking the one-off review slot failed too: %v", rootErr, lookupErr)
	}
	if !found {
		return "", "", "", fmt.Errorf("%w, and no one-off review is registered — run `mr open %s` first", rootErr, arg)
	}
	if filepath.Join(current.Dir, current.Base) == abs {
		return files.AdhocRootName, current.Base, abs, nil
	}
	return "", "", "", fmt.Errorf("%w; the one-off review slot currently holds %s — run `mr open %s` to switch to this file (that discards the comments on the file the slot holds now)",
		rootErr, filepath.Join(current.Dir, current.Base), arg)
}

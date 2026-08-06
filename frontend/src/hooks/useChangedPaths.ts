import { create } from "zustand";

/**
 * Key identifying a file/dir across roots — `${root}\0${path}`. NUL-separated
 * rather than `:` (the informal convention EditorPage's local `keyOf` uses):
 * both root names and paths can legally contain `:`, so `:`-joining lets two
 * distinct (root, path) pairs collide (e.g. root `a:b` + path `c.md` and root
 * `a` + path `b:c.md` both become `a:b:c.md`). NUL can't appear in either
 * segment, so it can't be forged from valid root/path input. This also lines
 * up with selfWriteSignature below, which already used `\0` for the same
 * reason.
 */
function pathKey(root: string, path: string): string {
  return `${root}\0${path}`;
}

/**
 * Signature identifying "this exact on-disk state was written by this app
 * itself" — `${root}\0${path}@${mtime}`. `mtime` is the RFC3339 string the
 * server derives from `info.ModTime().UTC().Format(time.RFC3339)` for both a
 * `PUT /api/files` response and a directory listing entry, so a self-write's
 * mtime can be compared byte-for-byte against a later dir-poll diff.
 */
function selfWriteSignature(root: string, path: string, mtime: string): string {
  return `${root}\0${path}@${mtime}`;
}

// Bound on tracked self-write signatures, mirroring useDirChangeWatcher's own
// announced-set cap: keeps memory from growing unbounded across a long
// session if saves pile up faster than the tree ever re-polls them away.
// Losing a stale entry here only means a rare save is (incorrectly) shown as
// an external change — never the other way around — so clearing outright is
// an acceptable trade-off for simplicity.
const MAX_SELF_WRITE_SIGNATURES = 500;

interface ChangedPathsState {
  /**
   * `pathKey(root, path)` set of files/dirs with an unseen change. A
   * directory itself can be marked (its own mtime moved, meaning "something
   * changed somewhere inside" — see useDirChangeWatcher) independently of
   * any of its descendants being marked.
   */
  changed: Set<string>;
  /** `selfWriteSignature(root, path, mtime)` set awaiting their diff echo. */
  selfWrites: Set<string>;
  /** Mark `path` (under `root`) as having an unread change. */
  mark: (root: string, path: string) => void;
  /** Clear `path`'s unread mark (e.g. the user just opened/saved/expanded it). */
  clear: (root: string, path: string) => void;
  /** Whether `path` itself currently has an unread mark. */
  isChanged: (root: string, path: string) => boolean;
  /** Whether any file/dir under `dirPath` (recursively) currently has an unread mark. */
  hasChangedUnder: (root: string, dirPath: string) => boolean;
  /**
   * Record that this app itself just wrote `path` with the resulting
   * `mtime` — the next directory-listing diff that reports this exact
   * root/path/mtime combination is an echo of our own save, not an external
   * change (#178).
   */
  registerSelfWrite: (root: string, path: string, mtime: string) => void;
  /**
   * If `path@mtime` (under `root`) matches a previously registered
   * self-write, consumes it (so it can't match again) and returns true.
   * Returns false — leaving state untouched — when there's no match, i.e.
   * this is a genuine external change.
   */
  consumeSelfWrite: (root: string, path: string, mtime: string) => boolean;
}

export const useChangedPaths = create<ChangedPathsState>((set, get) => ({
  changed: new Set(),
  selfWrites: new Set(),

  mark: (root, path) =>
    set((state) => {
      const key = pathKey(root, path);
      if (state.changed.has(key)) return state;
      const next = new Set(state.changed);
      next.add(key);
      return { changed: next };
    }),

  clear: (root, path) =>
    set((state) => {
      const key = pathKey(root, path);
      if (!state.changed.has(key)) return state;
      const next = new Set(state.changed);
      next.delete(key);
      return { changed: next };
    }),

  isChanged: (root, path) => get().changed.has(pathKey(root, path)),

  hasChangedUnder: (root, dirPath) => {
    const prefix = `${pathKey(root, dirPath)}/`;
    for (const key of get().changed) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  },

  registerSelfWrite: (root, path, mtime) =>
    set((state) => {
      const next = new Set(state.selfWrites);
      next.add(selfWriteSignature(root, path, mtime));
      if (next.size > MAX_SELF_WRITE_SIGNATURES) next.clear();
      return { selfWrites: next };
    }),

  consumeSelfWrite: (root, path, mtime) => {
    const sig = selfWriteSignature(root, path, mtime);
    if (!get().selfWrites.has(sig)) return false;
    set((state) => {
      const next = new Set(state.selfWrites);
      next.delete(sig);
      return { selfWrites: next };
    });
    return true;
  },
}));

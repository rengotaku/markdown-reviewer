/**
 * Comment author resolution.
 *
 * 1. `VITE_COMMENT_AUTHOR` env override (build-time).
 * 2. Locally-stored preference (set via the dialog).
 * 3. Fallback to "reviewer".
 */
import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "markdown-reviewer-comment-author";
const ENV_AUTHOR = (import.meta.env.VITE_COMMENT_AUTHOR as string | undefined)?.trim();
const FALLBACK = "reviewer";

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(value: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // ignore — author falls back to env / default on next read.
  }
}

const listeners = new Set<() => void>();

export function persistCommentAuthor(next: string): void {
  const trimmed = next.trim();
  if (!trimmed) return;
  writeStored(trimmed);
  listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): string {
  if (ENV_AUTHOR) return ENV_AUTHOR;
  const stored = readStored();
  if (stored && stored.trim()) return stored;
  return FALLBACK;
}

function getServerSnapshot(): string {
  return ENV_AUTHOR ?? FALLBACK;
}

export function useCommentAuthor(): { author: string; setAuthor: (next: string) => void } {
  const author = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setAuthor = useCallback((next: string) => {
    persistCommentAuthor(next);
  }, []);
  return { author, setAuthor };
}

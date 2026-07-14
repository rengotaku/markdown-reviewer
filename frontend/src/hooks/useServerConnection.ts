import { create } from "zustand";

/**
 * Tracks whether the SSE channel (useServerEvents, issue #112) is currently
 * connected. Deliberately a separate (non-persisted) store from useUIStore:
 * this is live connection state, not a user preference, and every
 * poll-driven hook (useDir, useFiles, useFileWatcher, EditorPage's comment
 * poll) needs to read it without EditorPage having to thread a prop through
 * Sidebar's call sites.
 *
 * `connected` starts false so every poll runs at its normal cadence until
 * the SSE connection actually opens — the polling fallback must be the
 * default, not an opt-in.
 *
 * Source of truth: this store only ever mirrors the `connected` value
 * EditorPage's useServerEvents() call already computes (via a `setConnected`
 * effect there) — it does not run its own EventSource. Treat writes from
 * anywhere else as a bug; this exists purely to broadcast that one value to
 * hooks EditorPage doesn't render as children (so no prop can reach them).
 */
interface ServerConnectionState {
  connected: boolean;
  setConnected: (connected: boolean) => void;
}

export const useServerConnection = create<ServerConnectionState>((set) => ({
  connected: false,
  setConnected: (connected) => set({ connected }),
}));

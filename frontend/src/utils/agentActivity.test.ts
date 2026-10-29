import { describe, it, expect } from "vitest";
import type { CommentJSON } from "@/api";
import {
  SEND_GRACE_MS,
  agentLabel,
  applySent,
  applyStatus,
  awaitsAiReply,
  emptyTracking,
  newAiReplies,
  replyCounts,
  unsentCount,
} from "./agentActivity";

const comment = (id: string, authors: string[]): CommentJSON => ({
  id,
  scope: "inline",
  body: "b",
  status: "open",
  context: null,
  orphan: false,
  replies: authors.map((author) => ({ author, body: "r" })),
});

describe("newAiReplies", () => {
  it("counts only AI replies added after the baseline", () => {
    const baseline = replyCounts([comment("c1", ["ai"]), comment("c2", [])]);
    const now = [
      comment("c1", ["ai", "kishira", "ai"]),
      comment("c2", ["ai"]),
      comment("c3", ["ai"]),
    ];
    expect([...newAiReplies(baseline, now)]).toEqual([
      ["c1", 1],
      ["c2", 1],
    ]);
  });

  it("is not fooled by the reader deleting their own reply", () => {
    const baseline = replyCounts([comment("c1", ["kishira"])]);
    expect([...newAiReplies(baseline, [comment("c1", ["ai"])])]).toEqual([["c1", 1]]);
  });

  it("is empty without a baseline", () => {
    expect(newAiReplies(null, [comment("c1", ["ai"])]).size).toBe(0);
  });
});

describe("applyStatus", () => {
  const key = "units:a.md";

  it("starts a busy period with a reply baseline", () => {
    const next = applyStatus(
      emptyTracking(key),
      key,
      { state: "busy" },
      [comment("c1", ["ai"])],
      1000
    );
    expect(next.busySince).toBe(1000);
    expect(next.sentByUs).toBe(false);
    expect(next.baseline?.get("c1")).toBe(1);
  });

  it("ends the busy period but keeps the baseline for new replies", () => {
    const busy = applyStatus(
      emptyTracking(key),
      key,
      { state: "busy" },
      [comment("c1", [])],
      1000
    );
    const idle = applyStatus(busy, key, { state: "idle" }, [comment("c1", ["ai"])], 9000);
    expect(idle.busySince).toBeNull();
    expect(idle.baseline?.get("c1")).toBe(0);
  });

  it("returns the same object when nothing changed", () => {
    const idle = applyStatus(
      emptyTracking(key),
      key,
      { state: "idle", session_name: "s" },
      [],
      1
    );
    expect(applyStatus(idle, key, { state: "idle", session_name: "s" }, [], 2)).toBe(
      idle
    );
    expect(
      applyStatus(idle, key, { state: "background", session_name: "s" }, [], 3)
    ).not.toBe(idle);
  });

  it("ignores an idle answer right after our own send", () => {
    const sent = applySent(emptyTracking(key), key, [], 1000);
    expect(applyStatus(sent, key, { state: "idle" }, [], 1000 + SEND_GRACE_MS - 1)).toBe(
      sent
    );
    const later = applyStatus(sent, key, { state: "idle" }, [], 1000 + SEND_GRACE_MS);
    expect(later.busySince).toBeNull();
    expect(later.sentByUs).toBe(false);
  });

  it("keeps a send's busy period when the session confirms busy", () => {
    const sent = applySent(emptyTracking(key), key, [comment("c1", [])], 1000);
    const busy = applyStatus(
      sent,
      key,
      { state: "busy", session_name: "s" },
      [comment("c1", [])],
      3000
    );
    expect(busy.busySince).toBe(1000);
    expect(busy.sentByUs).toBe(true);
  });

  it("keeps the busy period and baseline across a failed poll", () => {
    const busy = applyStatus(
      emptyTracking(key),
      key,
      { state: "busy" },
      [comment("c1", [])],
      1000
    );
    const failed = applyStatus(busy, key, null, [comment("c1", ["ai"])], 20_000);
    expect(failed.status).toBeNull();
    expect(failed.busySince).toBe(1000);
    const again = applyStatus(
      failed,
      key,
      { state: "busy" },
      [comment("c1", ["ai"])],
      23_000
    );
    expect(again.busySince).toBe(1000);
    expect(again.baseline?.get("c1")).toBe(0);
  });

  it("drops a send that resolves after switching to another file", () => {
    const current = applyStatus(emptyTracking(key), key, { state: "idle" }, [], 1);
    expect(applySent(current, "units:b.md", [], 2)).toBe(current);
  });

  it("discards tracking from another file", () => {
    const other = applySent(emptyTracking("units:b.md"), "units:b.md", [], 1);
    const next = applyStatus(other, key, { state: "idle" }, [], 2);
    expect(next.key).toBe(key);
    expect(next.sentByUs).toBe(false);
    expect(next.baseline).toBeNull();
  });
});

describe("awaitsAiReply (#372)", () => {
  it("waits only while the reader has the last word", () => {
    expect(awaitsAiReply({ ...comment("c1", []), author: "kishira" })).toBe(true);
    expect(awaitsAiReply({ ...comment("c1", ["ai"]), author: "kishira" })).toBe(false);
    expect(
      awaitsAiReply({ ...comment("c1", ["ai", "kishira"]), author: "kishira" })
    ).toBe(true);
    expect(awaitsAiReply({ ...comment("c1", []), author: "ai" })).toBe(false);
  });
});

describe("agentLabel", () => {
  it("capitalizes the adapter id and falls back to AI", () => {
    expect(agentLabel("claude")).toBe("Claude");
    expect(agentLabel(undefined)).toBe("AI");
  });
});

describe("sent comments (#366)", () => {
  const key = "root:a.md";
  const resolved = (id: string): CommentJSON => ({
    ...comment(id, []),
    status: "resolved",
  });

  it("records the open comments a send hands over", () => {
    const sent = applySent(
      emptyTracking(key),
      key,
      [comment("c1", []), resolved("c2")],
      1000
    );
    expect([...(sent.sentIds ?? [])]).toEqual(["c1"]);
  });

  it("keeps the set fixed before the request, not the list at the response", () => {
    const later = [comment("c1", []), comment("c2", [])];
    const sent = applySent(emptyTracking(key), key, later, 1000, new Set(["c1"]));
    expect([...(sent.sentIds ?? [])]).toEqual(["c1"]);
  });

  it("keeps the sent set when the busy period ends", () => {
    const sent = applySent(emptyTracking(key), key, [comment("c1", [])], 1000);
    const idle = applyStatus(
      sent,
      key,
      { state: "idle" },
      [comment("c1", [])],
      1000 + SEND_GRACE_MS
    );
    expect(idle.busySince).toBeNull();
    expect([...(idle.sentIds ?? [])]).toEqual(["c1"]);
  });

  it("counts open comments written after the send", () => {
    const sentIds = new Set(["c1"]);
    expect(
      unsentCount(sentIds, [comment("c1", []), comment("c2", []), resolved("c3")])
    ).toBe(1);
  });

  it("knows nothing before the first send", () => {
    expect(unsentCount(null, [comment("c1", [])])).toBeNull();
  });
});

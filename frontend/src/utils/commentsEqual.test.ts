import { describe, it, expect } from "vitest";
import { commentsEqual } from "./commentsEqual";
import type { CommentJSON } from "@/api/comments";

// #270: the gate that stops an identical refetch from re-running every
// `comments` consumer (and with it the full comment-anchor re-resolve).

const base = (over: Partial<CommentJSON> = {}): CommentJSON =>
  ({
    id: "c-001",
    status: "open",
    body: "ここ直して",
    author: "human",
    date: "2026-09-03",
    ...over,
  }) as CommentJSON;

describe("commentsEqual", () => {
  it("treats separately parsed but identical payloads as equal", () => {
    const wire = JSON.stringify([base()]);
    expect(commentsEqual(JSON.parse(wire), JSON.parse(wire))).toBe(true);
  });

  it("is true for the same reference", () => {
    const a = [base()];
    expect(commentsEqual(a, a)).toBe(true);
  });

  it("is false when a comment is added", () => {
    expect(commentsEqual([base()], [base(), base({ id: "c-002" })])).toBe(false);
  });

  it("is false when a comment is removed", () => {
    expect(commentsEqual([base(), base({ id: "c-002" })], [base()])).toBe(false);
  });

  it("is false when a status flips to resolved", () => {
    expect(commentsEqual([base()], [base({ status: "resolved" })])).toBe(false);
  });

  it("is false when a body is edited", () => {
    expect(commentsEqual([base()], [base({ body: "やっぱりこのまま" })])).toBe(
      false
    );
  });

  it("is false when a reply is appended", () => {
    const withReply = base({
      replies: [{ author: "ai", body: "直しました", date: "2026-09-03" }],
    } as Partial<CommentJSON>);
    expect(commentsEqual([base()], [withReply])).toBe(false);
  });

  it("is false when order changes", () => {
    const a = base();
    const b = base({ id: "c-002" });
    expect(commentsEqual([a, b], [b, a])).toBe(false);
  });

  it("handles two empty lists", () => {
    expect(commentsEqual([], [])).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { reorderArray } from "./tableDragDrop";

describe("reorderArray", () => {
  it("returns null when fromIdx equals toIdx", () => {
    expect(reorderArray([1, 2, 3], 1, 1)).toBeNull();
  });

  it("returns null when toIdx is directly after fromIdx (no actual move)", () => {
    expect(reorderArray([1, 2, 3], 0, 1)).toBeNull();
    expect(reorderArray([1, 2, 3], 1, 2)).toBeNull();
  });

  it("returns null when fromIdx is out of bounds", () => {
    expect(reorderArray([1, 2, 3], -1, 1)).toBeNull();
    expect(reorderArray([1, 2, 3], 3, 1)).toBeNull();
  });

  it("returns null when toIdx is out of bounds", () => {
    expect(reorderArray([1, 2, 3], 0, -1)).toBeNull();
    expect(reorderArray([1, 2, 3], 0, 4)).toBeNull();
  });

  it("moves an item forward (0 → before 3)", () => {
    expect(reorderArray([1, 2, 3, 4], 0, 3)).toEqual([2, 3, 1, 4]);
  });

  it("moves an item to the end", () => {
    expect(reorderArray([1, 2, 3], 0, 3)).toEqual([2, 3, 1]);
  });

  it("moves an item backward (2 → before 1)", () => {
    expect(reorderArray([1, 2, 3, 4], 2, 1)).toEqual([1, 3, 2, 4]);
  });

  it("moves an item to the beginning", () => {
    expect(reorderArray([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
  });

  it("handles a 2-element array", () => {
    expect(reorderArray([1, 2], 0, 2)).toEqual([2, 1]);
    expect(reorderArray([1, 2], 1, 0)).toEqual([2, 1]);
  });

  it("does not mutate the original array", () => {
    const arr = [1, 2, 3];
    reorderArray(arr, 0, 2);
    expect(arr).toEqual([1, 2, 3]);
  });
});

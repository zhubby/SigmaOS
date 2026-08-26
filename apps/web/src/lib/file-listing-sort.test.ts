import { describe, expect, it } from "vitest";
import type { FileEntry } from "../api.js";
import { sortEntriesByModifiedAt } from "./file-listing-sort.js";

const entries: FileEntry[] = [
  {
    name: "zeta.txt",
    path: "zeta.txt",
    kind: "file",
    sizeBytes: 3,
    modifiedAt: "2026-08-20T12:00:00.000Z",
    isSafe: true
  },
  {
    name: "alpha.txt",
    path: "alpha.txt",
    kind: "file",
    sizeBytes: 3,
    modifiedAt: "2026-08-21T12:00:00.000Z",
    isSafe: true
  },
  {
    name: "beta.txt",
    path: "beta.txt",
    kind: "file",
    sizeBytes: 3,
    modifiedAt: "2026-08-21T12:00:00.000Z",
    isSafe: true
  },
  {
    name: "beta.txt",
    path: "nested/beta.txt",
    kind: "file",
    sizeBytes: 3,
    modifiedAt: "2026-08-21T12:00:00.000Z",
    isSafe: true
  }
];

describe("sortEntriesByModifiedAt", () => {
  it("sorts newest first by default", () => {
    expect(sortEntriesByModifiedAt(entries).map((entry) => entry.path)).toEqual([
      "alpha.txt",
      "beta.txt",
      "nested/beta.txt",
      "zeta.txt"
    ]);
  });

  it("sorts oldest first when requested", () => {
    expect(sortEntriesByModifiedAt(entries, "asc").map((entry) => entry.path)).toEqual([
      "zeta.txt",
      "alpha.txt",
      "beta.txt",
      "nested/beta.txt"
    ]);
  });

  it("does not mutate the original array", () => {
    const original = [...entries];
    sortEntriesByModifiedAt(entries, "desc");
    expect(entries).toEqual(original);
  });
});

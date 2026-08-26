import type { FileEntry } from "../api.js";

export type FileSortDirection = "asc" | "desc";

export function sortEntriesByModifiedAt(entries: FileEntry[], direction: FileSortDirection = "desc"): FileEntry[] {
  const directionFactor = direction === "asc" ? 1 : -1;

  return [...entries].sort((left, right) => {
    const modifiedComparison = compareStrings(left.modifiedAt, right.modifiedAt);
    if (modifiedComparison !== 0) {
      return modifiedComparison * directionFactor;
    }

    const nameComparison = compareStrings(left.name, right.name);
    if (nameComparison !== 0) {
      return nameComparison;
    }

    return compareStrings(left.path, right.path);
  });
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

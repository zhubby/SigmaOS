import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFiles, updateSessionPath } from "../api.js";
import { loadEntriesForSession, sessionTitle } from "./session.js";
import type { FileEntry, Session, SessionSummary } from "../api.js";

vi.mock("../api.js", () => ({
  getFiles: vi.fn(),
  updateSessionPath: vi.fn()
}));

const mockedGetFiles = vi.mocked(getFiles);
const mockedUpdateSessionPath = vi.mocked(updateSessionPath);

const baseSession: SessionSummary = {
  id: "session-1",
  rootId: "root-1",
  currentPath: ".",
  createdAt: "2026-08-21T00:00:00.000Z",
  updatedAt: "2026-08-21T00:00:00.000Z",
  firstMessage: null,
  lastMessage: null
};

const fileEntry: FileEntry = {
  name: "hello.txt",
  path: "hello.txt",
  kind: "file",
  sizeBytes: 12,
  modifiedAt: "2026-08-21T00:00:00.000Z",
  isSafe: true
};

describe("session helpers", () => {
  beforeEach(() => {
    mockedGetFiles.mockReset();
    mockedUpdateSessionPath.mockReset();
  });

  it("prefers first message, then last message, then path fallback", () => {
    expect(sessionTitle({ ...baseSession, firstMessage: "First", lastMessage: "Last" })).toBe("First");
    expect(sessionTitle({ ...baseSession, lastMessage: "Last" })).toBe("Last");
    expect(sessionTitle(baseSession)).toBe("Root agent");
    expect(sessionTitle(baseSession, "Root session")).toBe("Root session");
    expect(sessionTitle({ ...baseSession, currentPath: "media/photos" })).toBe("media/photos");
  });

  it("keeps the existing 34-character truncation rule", () => {
    expect(sessionTitle({ ...baseSession, firstMessage: "12345678901234567890123456789012345" })).toBe(
      "1234567890123456789012345678901..."
    );
  });

  it("loads entries for the current session path without resetting", async () => {
    mockedGetFiles.mockResolvedValueOnce([fileEntry]);

    await expect(loadEntriesForSession("root-1", { ...baseSession, currentPath: "docs" })).resolves.toEqual({
      session: { ...baseSession, currentPath: "docs" },
      entries: [fileEntry],
      didResetPath: false
    });
    expect(mockedGetFiles).toHaveBeenCalledWith("root-1", "docs");
    expect(mockedUpdateSessionPath).not.toHaveBeenCalled();
  });

  it("resets recoverable stale paths to root and reloads entries", async () => {
    const resetSession: Session = {
      id: "session-1",
      rootId: "root-1",
      currentPath: "."
    };
    mockedGetFiles.mockRejectedValueOnce(new Error("Path not found")).mockResolvedValueOnce([fileEntry]);
    mockedUpdateSessionPath.mockResolvedValueOnce(resetSession);

    await expect(loadEntriesForSession("root-1", { ...baseSession, currentPath: "missing" })).resolves.toEqual({
      session: resetSession,
      entries: [fileEntry],
      didResetPath: true
    });
    expect(mockedUpdateSessionPath).toHaveBeenCalledWith("session-1", ".");
    expect(mockedGetFiles).toHaveBeenNthCalledWith(1, "root-1", "missing");
    expect(mockedGetFiles).toHaveBeenNthCalledWith(2, "root-1", ".");
  });

  it("rethrows root path and non-recoverable load errors", async () => {
    const rootError = new Error("Path not found");
    mockedGetFiles.mockRejectedValueOnce(rootError);
    await expect(loadEntriesForSession("root-1", baseSession)).rejects.toThrow(rootError);
    expect(mockedUpdateSessionPath).not.toHaveBeenCalled();

    const permissionError = new Error("Permission denied");
    mockedGetFiles.mockRejectedValueOnce(permissionError);
    await expect(loadEntriesForSession("root-1", { ...baseSession, currentPath: "locked" })).rejects.toThrow(
      permissionError
    );
    expect(mockedUpdateSessionPath).not.toHaveBeenCalled();
  });
});

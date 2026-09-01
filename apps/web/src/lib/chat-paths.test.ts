import { describe, expect, it } from "vitest";
import {
  remarkWorkspacePaths,
  resolveWorkspaceMessageLink,
  resolveWorkspaceMessagePath,
  splitWorkspaceMessagePaths,
  workspaceAbsolutePath,
  workspaceParentPath
} from "./chat-paths.js";

describe("resolveWorkspaceMessagePath", () => {
  it("maps absolute paths inside the selected root to workspace paths", () => {
    expect(resolveWorkspaceMessagePath("/srv/nas/docs/readme.md", "/srv/nas")).toEqual({
      displayPath: "/srv/nas/docs/readme.md",
      workspacePath: "docs/readme.md"
    });
    expect(resolveWorkspaceMessagePath("/srv/nas/", "/srv/nas/")).toEqual({
      displayPath: "/srv/nas/",
      workspacePath: "."
    });
    expect(resolveWorkspaceMessagePath("/srv/nas/docs/../readme.md", "/srv/nas")).toEqual({
      displayPath: "/srv/nas/docs/../readme.md",
      workspacePath: "readme.md"
    });
    expect(resolveWorkspaceMessagePath("/Users/zhubby/file.txt", "/")).toEqual({
      displayPath: "/Users/zhubby/file.txt",
      workspacePath: "Users/zhubby/file.txt"
    });
  });

  it("rejects paths outside the selected root or sharing only its prefix", () => {
    expect(resolveWorkspaceMessagePath("/srv/nas-backup/file.txt", "/srv/nas")).toBeNull();
    expect(resolveWorkspaceMessagePath("/srv/other/file.txt", "/srv/nas")).toBeNull();
    expect(resolveWorkspaceMessagePath("/srv/nas/../../etc/passwd", "/srv/nas")).toBeNull();
    expect(resolveWorkspaceMessagePath("/srv/nas/docs/../../nas/file.txt", "/srv/nas")).toBeNull();
    expect(resolveWorkspaceMessagePath("//srv/nas/file.txt", "/srv/nas")).toBeNull();
    expect(resolveWorkspaceMessagePath("docs/readme.md", "/srv/nas")).toBeNull();
  });
});

describe("resolveWorkspaceMessageLink", () => {
  it("decodes Markdown link paths before matching the selected root", () => {
    expect(resolveWorkspaceMessageLink("/srv/nas/My%20Files/report.pdf#page=2", "/srv/nas")).toEqual({
      displayPath: "/srv/nas/My Files/report.pdf",
      workspacePath: "My Files/report.pdf"
    });
    expect(resolveWorkspaceMessageLink("https://example.com/srv/nas/file.txt", "/srv/nas")).toBeNull();
    expect(resolveWorkspaceMessageLink("//srv/nas/file.txt", "/srv/nas")).toBeNull();
    expect(resolveWorkspaceMessageLink("%E0%A4%A", "/srv/nas")).toBeNull();
  });
});

describe("splitWorkspaceMessagePaths", () => {
  it("separates unquoted and quoted paths while preserving punctuation", () => {
    expect(
      splitWorkspaceMessagePaths(
        'Found /srv/nas/docs/readme.md. Open "/srv/nas/My Files/report.pdf" next.',
        "/srv/nas"
      )
    ).toEqual([
      { kind: "text", value: "Found " },
      {
        kind: "path",
        value: "/srv/nas/docs/readme.md",
        displayPath: "/srv/nas/docs/readme.md",
        workspacePath: "docs/readme.md"
      },
      { kind: "text", value: '. Open "' },
      {
        kind: "path",
        value: "/srv/nas/My Files/report.pdf",
        displayPath: "/srv/nas/My Files/report.pdf",
        workspacePath: "My Files/report.pdf"
      },
      { kind: "text", value: '" next.' }
    ]);
  });

  it("leaves external and root-relative paths as text", () => {
    const text = "See /srv/other/file.txt and docs/readme.md";
    expect(splitWorkspaceMessagePaths(text, "/srv/nas")).toEqual([{ kind: "text", value: text }]);
  });
});

describe("remarkWorkspacePaths", () => {
  it("converts message text paths to inline code but skips links and code blocks", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "text", value: "Open /srv/nas/docs/readme.md" },
            { type: "link", url: "/srv/nas/linked.md", children: [{ type: "text", value: "/srv/nas/linked.md" }] }
          ]
        },
        { type: "code", value: "/srv/nas/not-interactive.txt" }
      ]
    };

    remarkWorkspacePaths({ rootPath: "/srv/nas" })(tree);

    expect(tree.children[0]).toEqual({
      type: "paragraph",
      children: [
        { type: "text", value: "Open " },
        { type: "inlineCode", value: "/srv/nas/docs/readme.md" },
        { type: "link", url: "/srv/nas/linked.md", children: [{ type: "text", value: "/srv/nas/linked.md" }] }
      ]
    });
    expect(tree.children[1]).toEqual({ type: "code", value: "/srv/nas/not-interactive.txt" });
  });
});

describe("workspaceParentPath", () => {
  it("returns a root-relative parent directory", () => {
    expect(workspaceParentPath("docs/reference/file.md")).toBe("docs/reference");
    expect(workspaceParentPath("file.md")).toBe(".");
  });
});

describe("workspaceAbsolutePath", () => {
  it("joins a root-relative path to an absolute NAS root", () => {
    expect(workspaceAbsolutePath("/srv/nas", "docs/readme.md")).toBe("/srv/nas/docs/readme.md");
    expect(workspaceAbsolutePath("/", "docs/readme.md")).toBe("/docs/readme.md");
    expect(workspaceAbsolutePath("/srv/nas/", ".")).toBe("/srv/nas");
  });
});

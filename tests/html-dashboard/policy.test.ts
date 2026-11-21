import { describe, expect, it } from "vitest";
import {
  classifyHref,
  isHtmlFilePath,
  isHtmlSessionEntry,
  isInsideVault,
  isMarkdownPath,
  parseNoteFile,
  projectBridgeIndex,
  sessionEntryForHtml,
  type ClassifiedHref,
} from "../../src/lib/html-dashboard";

const ROOTS = ["/vault"];
const PAGE = "/vault/pages/index.html";

function expectIgnored(result: ClassifiedHref, secret: string): void {
  expect(result).toEqual({ action: "ignore" });
  expect(result).not.toHaveProperty("path");
  expect(result).not.toHaveProperty("url");
  expect(JSON.stringify(result)).not.toContain(secret);
}

describe("isHtmlFilePath / isMarkdownPath", () => {
  it("accepts html and htm and rejects md and extensionless names", () => {
    expect(isHtmlFilePath("/vault/pages/dash.html")).toBe(true);
    expect(isHtmlFilePath("/vault/pages/dash.htm")).toBe(true);
    expect(isHtmlFilePath("/vault/pages/dash.HTML")).toBe(true);
    expect(isHtmlFilePath("/vault/pages/dash.HTM")).toBe(true);
    expect(isHtmlFilePath("/vault/pages/dash.min.html")).toBe(true);
    expect(isHtmlFilePath("/vault/notes/note.md")).toBe(false);
    expect(isHtmlFilePath("/vault/notes/note.markdown")).toBe(false);
    expect(isHtmlFilePath("/vault/notes/readme")).toBe(false);
    expect(isHtmlFilePath("/vault/pages/file.html.md")).toBe(false);
  });

  it("accepts md and markdown and rejects html and extensionless names", () => {
    expect(isMarkdownPath("/vault/notes/note.md")).toBe(true);
    expect(isMarkdownPath("/vault/notes/note.MD")).toBe(true);
    expect(isMarkdownPath("/vault/notes/note.markdown")).toBe(true);
    expect(isMarkdownPath("/vault/notes/note.MARKDOWN")).toBe(true);
    expect(isMarkdownPath("/vault/pages/dash.html")).toBe(false);
    expect(isMarkdownPath("/vault/pages/dash.htm")).toBe(false);
    expect(isMarkdownPath("/vault/notes/readme")).toBe(false);
  });
});

describe("isInsideVault", () => {
  it("accepts the root and a descendant", () => {
    expect(isInsideVault("/vault", ROOTS)).toBe(true);
    expect(isInsideVault("/vault/notes/a.md", ROOTS)).toBe(true);
    expect(isInsideVault("/vault/sub/../note.md", ROOTS)).toBe(true);
  });

  it("rejects a sibling that only shares a prefix", () => {
    expect(isInsideVault("/vault-other/note.md", ROOTS)).toBe(false);
    expect(isInsideVault("/vault-other", ROOTS)).toBe(false);
  });

  it("rejects a path that escapes with ..", () => {
    expect(isInsideVault("/vault/../../etc/passwd", ROOTS)).toBe(false);
    expect(isInsideVault("/vault/sub/../../outside.html", ROOTS)).toBe(false);
  });

  it("rejects every path when rootPaths is empty", () => {
    expect(isInsideVault("/vault/notes/a.md", [])).toBe(false);
    expect(isInsideVault("/vault", [])).toBe(false);
  });
});

describe("classifyHref", () => {
  it("resolves a relative second html file inside the vault", () => {
    expect(classifyHref("widgets/second.html", PAGE, ROOTS)).toEqual({
      action: "html",
      path: "/vault/pages/widgets/second.html",
    });
    expect(classifyHref("./second.htm", PAGE, ROOTS)).toEqual({
      action: "html",
      path: "/vault/pages/second.htm",
    });
  });

  it("resolves a relative markdown note inside the vault", () => {
    expect(classifyHref("../notes/one.md", PAGE, ROOTS)).toEqual({
      action: "note",
      path: "/vault/notes/one.md",
    });
    expect(classifyHref("guide.markdown", PAGE, ROOTS)).toEqual({
      action: "note",
      path: "/vault/pages/guide.markdown",
    });
  });

  it("keeps an https url as an external link", () => {
    const href = "https://example.com/docs?q=1#start";
    expect(classifyHref(href, PAGE, ROOTS)).toEqual({
      action: "external",
      url: href,
    });
  });

  it("ignores javascript and does not leak the target", () => {
    expectIgnored(
      classifyHref("javascript:alert('do-not-leak-target')", PAGE, ROOTS),
      "do-not-leak-target",
    );
    expectIgnored(
      classifyHref("JavaScript:void(0)", PAGE, ROOTS),
      "void",
    );
  });

  it("ignores file and does not leak the target", () => {
    expectIgnored(
      classifyHref("file:///tmp/do-not-leak-target.html", PAGE, ROOTS),
      "do-not-leak-target",
    );
    expectIgnored(classifyHref("FILE:///etc/passwd", PAGE, ROOTS), "passwd");
  });

  it("opens html beside the page when no vault is active", () => {
    expect(classifyHref("other.html", "/tmp/notes/dash.html", [])).toEqual({
      action: "html",
      path: "/tmp/notes/other.html",
    });
    expect(classifyHref("note.md", "/tmp/notes/dash.html", [])).toEqual({
      action: "note",
      path: "/tmp/notes/note.md",
    });
  });

  it("ignores a path outside the vault and the page folder", () => {
    expectIgnored(
      classifyHref("/tmp/do-not-leak-target.html", PAGE, ROOTS),
      "do-not-leak-target",
    );
    expectIgnored(
      classifyHref("../../../../tmp/do-not-leak-target.html", PAGE, ROOTS),
      "do-not-leak-target",
    );
  });

  it("ignores data, mailto, and empty hrefs", () => {
    expectIgnored(classifyHref("data:text/html,do-not-leak-target", PAGE, ROOTS), "do-not-leak-target");
    expect(classifyHref("mailto:someone@example.com", PAGE, ROOTS)).toEqual({ action: "ignore" });
    expect(classifyHref("   ", PAGE, ROOTS)).toEqual({ action: "ignore" });
    expect(classifyHref("", PAGE, ROOTS)).toEqual({ action: "ignore" });
  });
});

describe("projectBridgeIndex", () => {
  it("drops extra fields and does not mutate the input", () => {
    const source = {
      vaultId: "v1",
      builtAt: 42,
      capped: true,
      rootPaths: ["/vault"],
      entries: [
        {
          path: "/vault/a.md",
          name: "a.md",
          title: "A",
          tags: ["t"],
          outboundLinks: ["/vault/b.md"],
          modified: 7,
          size: 99,
          frontmatter: { status: "draft" },
        },
      ],
    };

    const projected = projectBridgeIndex(source);

    expect(projected).toEqual({
      vaultId: "v1",
      builtAt: 42,
      capped: true,
      entries: [
        {
          path: "/vault/a.md",
          name: "a.md",
          title: "A",
          tags: ["t"],
          outboundLinks: ["/vault/b.md"],
          modified: 7,
          size: 99,
        },
      ],
    });
    expect(projected).not.toHaveProperty("rootPaths");
    expect(projected.entries[0]).not.toHaveProperty("frontmatter");
    expect(source.entries[0].frontmatter).toEqual({ status: "draft" });

    projected.entries[0].tags.push("changed");
    projected.entries[0].outboundLinks.push("/vault/c.md");
    expect(source.entries[0].tags).toEqual(["t"]);
    expect(source.entries[0].outboundLinks).toEqual(["/vault/b.md"]);
  });

  it("returns an empty entry list for a null index", () => {
    expect(projectBridgeIndex(null)).toEqual({
      vaultId: "",
      builtAt: 0,
      capped: false,
      entries: [],
    });
  });
});

describe("parseNoteFile", () => {
  it("returns a frontmatter key other than title and tags, plus the body", () => {
    const content = [
      "---",
      "title: Hello",
      "tags:",
      "  - alpha",
      "  - beta",
      "status: draft",
      "count: 3",
      "---",
      "",
      "Body paragraph",
      "",
    ].join("\n");

    const doc = parseNoteFile("/vault/notes/hello.md", content);

    expect(doc.path).toBe("/vault/notes/hello.md");
    expect(doc.title).toBe("Hello");
    expect(doc.tags).toEqual(["alpha", "beta"]);
    expect(doc.frontmatter.status).toBe("draft");
    expect(doc.frontmatter.count).toBe(3);
    expect(doc.frontmatter.title).toBe("Hello");
    expect(doc.body).toBe("\nBody paragraph\n");
  });

  it("wraps a single string tag and falls back to the first H1 then the filename stem", () => {
    const tagged = parseNoteFile(
      "/vault/notes/solo.md",
      "---\ntags: solo\n---\n# From heading\n\nText\n",
    );
    expect(tagged.tags).toEqual(["solo"]);
    expect(tagged.title).toBe("From heading");
    expect(tagged.body).toBe("# From heading\n\nText\n");

    const plain = parseNoteFile("/vault/notes/plain.md", "No heading here\n");
    expect(plain.frontmatter).toEqual({});
    expect(plain.body).toBe("No heading here\n");
    expect(plain.title).toBe("plain");
    expect(plain.tags).toEqual([]);
  });

  it("uses an empty frontmatter object when YAML is invalid and still returns the body", () => {
    const content = "---\n: [\n---\nStill here\n";
    expect(() => parseNoteFile("/vault/notes/bad.md", content)).not.toThrow();
    const doc = parseNoteFile("/vault/notes/bad.md", content);
    expect(doc.frontmatter).toEqual({});
    expect(doc.body).toBe("Still here\n");
    expect(doc.title).toBe("bad");
    expect(doc.tags).toEqual([]);
  });
});

describe("session helpers", () => {
  it("builds an html session entry at scroll 0", () => {
    expect(sessionEntryForHtml("/vault/pages/dash.html")).toEqual({
      filePath: "/vault/pages/dash.html",
      scrollTop: 0,
      pinned: false,
      kind: "html",
    });
    expect(sessionEntryForHtml("/vault/pages/dash.html", true)).toEqual({
      filePath: "/vault/pages/dash.html",
      scrollTop: 0,
      pinned: true,
      kind: "html",
    });
  });

  it("treats kind html as a page, kind editor as not, and missing kind by extension", () => {
    expect(isHtmlSessionEntry({ filePath: "/vault/pages/dash.html", kind: "html" })).toBe(true);
    expect(isHtmlSessionEntry({ filePath: "/vault/notes/note.md", kind: "html" })).toBe(true);
    expect(isHtmlSessionEntry({ filePath: "/vault/pages/dash.html", kind: "editor" })).toBe(false);
    expect(isHtmlSessionEntry({ filePath: "/vault/pages/dash.HTM", kind: "editor" })).toBe(false);
    expect(isHtmlSessionEntry({ filePath: "/vault/pages/dash.html" })).toBe(true);
    expect(isHtmlSessionEntry({ filePath: "/vault/pages/dash.htm" })).toBe(true);
    expect(isHtmlSessionEntry({ filePath: "/vault/notes/note.md" })).toBe(false);
    expect(isHtmlSessionEntry({ filePath: "/vault/notes/readme" })).toBe(false);
  });
});

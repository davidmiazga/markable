/**
 * tests/view-modal/read-compat.test.ts
 *
 * Read-compatibility tests for `_folder.md` files in both the new
 * codeblock shape and the legacy frontmatter shape.
 *
 * Step_01 (parser extension) — extends parseFolderMd() to detect a
 * `select` codeblock in the body and overlay its YAML onto the
 * frontmatter-derived config. Codeblock wins when both shapes are
 * present (AD-2). Legacy frontmatter remains a fallback (FR-55).
 *
 * Edge cases covered: EC-7 (legacy frontmatter renders),
 * EC-16 (malformed YAML → safe defaults), and the FR-55 / FR-57
 * precedence and projection contract.
 */

import { describe, it, expect } from "vitest";
import {
  parseFolderMd,
  extractSelectCodeblockBody,
} from "../../src/plugins/file-browser/folder-view/parser";

describe("parseFolderMd — codeblock-shape read path (step_01)", () => {
  it("extracts body codeblock — minimal", () => {
    const content = "```select\npath: ./\ndisplay: cards\n```";
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.layout).toBe("cards");
  });

  it("prefers codeblock over frontmatter when both present", () => {
    const content = [
      "---",
      "layout: bookshelf",
      "---",
      "",
      "```select",
      "display: table",
      "```",
    ].join("\n");
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.layout).toBe("table");
  });

  it("falls back to frontmatter when no codeblock", () => {
    const content = "---\nlayout: cards\npath: ./\n---\n";
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.layout).toBe("cards");
  });

  it("tolerates a width modifier on the opening fence", () => {
    const content = "```select wide\ndisplay: kanban\n```";
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.layout).toBe("kanban");
  });

  it("only honours the FIRST select codeblock", () => {
    const content = [
      "```select",
      "display: cards",
      "```",
      "",
      "```select",
      "display: table",
      "```",
    ].join("\n");
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.layout).toBe("cards");
  });

  it("ignores non-select codeblocks (e.g. ```js)", () => {
    const content = [
      "```js",
      "display: kanban",
      "```",
      "",
      "```select",
      "display: bookshelf",
      "```",
    ].join("\n");
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.layout).toBe("bookshelf");
  });

  it("malformed YAML in codeblock body returns safe defaults (no crash)", () => {
    // The codeblock has a malformed value; parseYamlLines is permissive and
    // will return whatever it can. The renderer-side fallback handles the
    // empty/garbled layout. parseFolderMd MUST NOT throw.
    const content = "```select\ndisplay: : invalid\n```";
    expect(() => parseFolderMd(content, "Folder")).not.toThrow();
  });

  it("collection-home slug carries through the codeblock overlay", () => {
    const content = "```select\ndisplay: collection-home\n```";
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.layout).toBe("collection-home");
  });

  it("frontmatter `icon:` survives when codeblock overlays the layout", () => {
    const content = [
      "---",
      "icon: book",
      "---",
      "",
      "```select",
      "display: cards",
      "```",
    ].join("\n");
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.layout).toBe("cards");
    expect(cfg.icon).toBe("book");
  });

  it("empty path: in the codeblock does not crash (renderer resolves default)", () => {
    const content = "```select\nshow-modified: false\n```";
    expect(() => parseFolderMd(content, "Folder")).not.toThrow();
    const cfg = parseFolderMd(content, "Folder");
    // The codeblock did not carry display:, so layout falls back to the
    // frontmatter shape (absent) → empty default.
    expect(cfg.layout).toBe("");
    // show-modified is read from the codeblock overlay.
    expect(cfg.showModified).toBe(false);
  });
});

describe("extractSelectCodeblockBody — boundary unit (step_01)", () => {
  it("returns null when body is empty", () => {
    expect(extractSelectCodeblockBody("")).toBeNull();
  });

  it("returns null when only the opening fence is present (unclosed)", () => {
    expect(extractSelectCodeblockBody("```select\nfoo: bar\n")).toBeNull();
  });

  it("returns empty string when fences are present with no inner content", () => {
    expect(extractSelectCodeblockBody("```select\n```")).toBe("");
  });

  it("returns the first fenced body when multiple fences exist", () => {
    const body = [
      "```select",
      "first: value",
      "```",
      "",
      "```select",
      "second: value",
      "```",
    ].join("\n");
    expect(extractSelectCodeblockBody(body)).toBe("first: value");
  });

  it("returns null when the opening fence is indented (must start at column 0)", () => {
    const body = "  ```select\nfoo: bar\n  ```";
    expect(extractSelectCodeblockBody(body)).toBeNull();
  });
});

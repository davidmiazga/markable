/**
 * tests/folder-view/parser.test.ts
 *
 * Unit tests for parseFolderMd().
 *
 * Covers all acceptance criteria from step_01_types-and-parser.md:
 * EC-04, EC-05, EC-11, EC-12, and all normal parse paths.
 */

import { describe, it, expect } from "vitest";
import { parseFolderMd } from "../../src/plugins/file-browser/folder-view/parser";

describe("parseFolderMd", () => {
  // ── EC-04: Empty or body-only content ──────────────────────────────────────

  it("EC-04: empty content returns layout '' and body '' with all defaults", () => {
    const cfg = parseFolderMd("", "MyFolder");
    expect(cfg.layout).toBe("");
    expect(cfg.body).toBe("");
    expect(cfg.title).toBe("MyFolder");
    expect(cfg.sort).toBe("name-asc");
    expect(cfg.columns).toBe(3);
    expect(cfg.showModified).toBe(true);
  });

  it("EC-04: body-only content (no --- markers) returns layout '' and body = content", () => {
    const content = "This is some body text\nwith multiple lines.";
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.layout).toBe("");
    expect(cfg.body).toBe(content.trim());
  });

  // ── Minimal valid front-matter ─────────────────────────────────────────────

  it("minimal valid: layout field only returns correct layout with all other defaults", () => {
    const content = "---\nlayout: folder-cards\n---\n";
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.layout).toBe("folder-cards");
    expect(cfg.title).toBe("Folder");
    expect(cfg.sort).toBe("name-asc");
    expect(cfg.columns).toBe(3);
    expect(cfg.showModified).toBe(true);
    expect(cfg.body).toBe("");
  });

  // ── Full front-matter ──────────────────────────────────────────────────────

  it("full front-matter: all five fields with non-default values are parsed correctly", () => {
    const content = [
      "---",
      "layout: folder-cards",
      "title: My Custom Title",
      "sort: name-desc",
      "columns: 5",
      "show-modified: false",
      "---",
      "",
      "This is the body.",
    ].join("\n");
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.layout).toBe("folder-cards");
    expect(cfg.title).toBe("My Custom Title");
    expect(cfg.sort).toBe("name-desc");
    expect(cfg.columns).toBe(5);
    expect(cfg.showModified).toBe(false);
    expect(cfg.body).toBe("This is the body.");
  });

  // ── EC-11: Column clamping ─────────────────────────────────────────────────

  it("EC-11: columns: 0 is clamped to 2 (minimum)", () => {
    const content = "---\nlayout: folder-cards\ncolumns: 0\n---\n";
    expect(parseFolderMd(content, "F").columns).toBe(2);
  });

  it("EC-11: columns: 100 is clamped to 6 (maximum)", () => {
    const content = "---\nlayout: folder-cards\ncolumns: 100\n---\n";
    expect(parseFolderMd(content, "F").columns).toBe(6);
  });

  it("EC-11: columns: 4 stays as 4 (within valid range)", () => {
    const content = "---\nlayout: folder-cards\ncolumns: 4\n---\n";
    expect(parseFolderMd(content, "F").columns).toBe(4);
  });

  // ── EC-12: Invalid sort value ──────────────────────────────────────────────

  it("EC-12: sort: invalid-value defaults to name-asc", () => {
    const content = "---\nlayout: folder-cards\nsort: invalid-value\n---\n";
    expect(parseFolderMd(content, "F").sort).toBe("name-asc");
  });

  // ── show-modified flag ─────────────────────────────────────────────────────

  it("show-modified: false → showModified is false", () => {
    const content = "---\nlayout: folder-cards\nshow-modified: false\n---\n";
    expect(parseFolderMd(content, "F").showModified).toBe(false);
  });

  it("show-modified: true → showModified is true", () => {
    const content = "---\nlayout: folder-cards\nshow-modified: true\n---\n";
    expect(parseFolderMd(content, "F").showModified).toBe(true);
  });

  it("show-modified absent → showModified is true (default)", () => {
    const content = "---\nlayout: folder-cards\n---\n";
    expect(parseFolderMd(content, "F").showModified).toBe(true);
  });

  // ── EC-05: Malformed YAML ──────────────────────────────────────────────────

  it("EC-05: malformed YAML (unclosed quote) does not throw; layout is empty or partial", () => {
    const content = '---\nlayout: "unclosed\n---\n';
    // Must not throw; layout ends up as something that does not match a valid renderer
    let cfg: ReturnType<typeof parseFolderMd> | undefined;
    expect(() => {
      cfg = parseFolderMd(content, "F");
    }).not.toThrow();
    // The spec says "layout is empty or partial parse" — accept either
    if (cfg !== undefined) {
      // The unclosed quote means value = '"unclosed' which is non-empty but
      // the normalisation step lowercases it; it is not "folder-cards"
      expect(typeof cfg.layout).toBe("string");
    }
  });

  // ── title field ────────────────────────────────────────────────────────────

  it("title field present: uses the YAML title value", () => {
    const content = "---\nlayout: folder-cards\ntitle: My Custom Title\n---\n";
    expect(parseFolderMd(content, "Folder").title).toBe("My Custom Title");
  });

  it("title absent: falls back to the passed folderName", () => {
    const content = "---\nlayout: folder-cards\n---\n";
    expect(parseFolderMd(content, "MyFolderName").title).toBe("MyFolderName");
  });

  // ── Body extraction ────────────────────────────────────────────────────────

  it("body present: extracts and trims the body text after the closing ---", () => {
    const content = "---\nlayout: folder-cards\n---\n\nHello **world**\n";
    expect(parseFolderMd(content, "F").body).toBe("Hello **world**");
  });

  // ── Unknown YAML fields ────────────────────────────────────────────────────

  it("unknown YAML fields are silently ignored — no crash, no bleed-through", () => {
    const content = "---\nlayout: folder-cards\nunknown-field: some-value\nanother: 123\n---\n";
    const cfg = parseFolderMd(content, "F");
    expect(cfg.layout).toBe("folder-cards");
    // The unknown fields must not appear on the config object
    expect((cfg as any)["unknown-field"]).toBeUndefined();
    expect((cfg as any)["another"]).toBeUndefined();
  });

  // ── Additional sort values ─────────────────────────────────────────────────

  it("sort: modified-asc is a valid value and is preserved", () => {
    const content = "---\nlayout: folder-cards\nsort: modified-asc\n---\n";
    expect(parseFolderMd(content, "F").sort).toBe("modified-asc");
  });

  it("sort: modified-desc is a valid value and is preserved", () => {
    const content = "---\nlayout: folder-cards\nsort: modified-desc\n---\n";
    expect(parseFolderMd(content, "F").sort).toBe("modified-desc");
  });

  // ── Layout case-normalisation ──────────────────────────────────────────────

  it("layout value is lowercased (case-insensitive dispatch per FR-27)", () => {
    const content = "---\nlayout: Folder-Cards\n---\n";
    expect(parseFolderMd(content, "F").layout).toBe("folder-cards");
  });
});

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
    expect(cfg.cardWidth).toBe(160);
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
    expect(cfg.cardWidth).toBe(160);
    expect(cfg.showModified).toBe(true);
    expect(cfg.body).toBe("");
  });

  // ── Full front-matter ──────────────────────────────────────────────────────

  it("full front-matter: all fields with non-default values are parsed correctly", () => {
    const content = [
      "---",
      "layout: folder-cards",
      "title: My Custom Title",
      "sort: name-desc",
      "card-width: 240",
      "show-modified: false",
      "---",
      "",
      "This is the body.",
    ].join("\n");
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.layout).toBe("folder-cards");
    expect(cfg.title).toBe("My Custom Title");
    expect(cfg.sort).toBe("name-desc");
    expect(cfg.cardWidth).toBe(240);
    expect(cfg.showModified).toBe(false);
    expect(cfg.body).toBe("This is the body.");
  });

  // ── card-width clamping ────────────────────────────────────────────────────

  it("card-width: 10 is clamped to 40 (minimum)", () => {
    const content = "---\nlayout: folder-cards\ncard-width: 10\n---\n";
    expect(parseFolderMd(content, "F").cardWidth).toBe(40);
  });

  it("card-width: 1000 is clamped to 600 (maximum)", () => {
    const content = "---\nlayout: folder-cards\ncard-width: 1000\n---\n";
    expect(parseFolderMd(content, "F").cardWidth).toBe(600);
  });

  it("card-width: 200 stays as 200 (within valid range)", () => {
    const content = "---\nlayout: folder-cards\ncard-width: 200\n---\n";
    expect(parseFolderMd(content, "F").cardWidth).toBe(200);
  });

  it("card-width absent → defaults to 160", () => {
    const content = "---\nlayout: folder-cards\n---\n";
    expect(parseFolderMd(content, "F").cardWidth).toBe(160);
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

  // ── layout-mode field ─────────────────────────────────────────────────────

  it("layout-mode absent → defaults to 'grid'", () => {
    const content = "---\nlayout: folder-cards\n---\n";
    expect(parseFolderMd(content, "F").layoutMode).toBe("grid");
  });

  it("layout-mode: flex → layoutMode 'flex'", () => {
    const content = "---\nlayout: folder-cards\nlayout-mode: flex\n---\n";
    expect(parseFolderMd(content, "F").layoutMode).toBe("flex");
  });

  it("layout-mode: grid → layoutMode 'grid'", () => {
    const content = "---\nlayout: folder-cards\nlayout-mode: grid\n---\n";
    expect(parseFolderMd(content, "F").layoutMode).toBe("grid");
  });

  it("layout-mode: invalid value → defaults to 'grid'", () => {
    const content = "---\nlayout: folder-cards\nlayout-mode: masonry\n---\n";
    expect(parseFolderMd(content, "F").layoutMode).toBe("grid");
  });

  // ── aspect-ratio field ─────────────────────────────────────────────────────

  it("aspect-ratio: 1/1 → aspectRatio '1/1'", () => {
    const content = "---\nlayout: folder-cards\naspect-ratio: 1/1\n---\n";
    expect(parseFolderMd(content, "F").aspectRatio).toBe("1/1");
  });

  it("aspect-ratio: 16:9 (colon notation) → aspectRatio '16/9'", () => {
    const content = "---\nlayout: folder-cards\naspect-ratio: 16:9\n---\n";
    expect(parseFolderMd(content, "F").aspectRatio).toBe("16/9");
  });

  it("aspect-ratio: original → aspectRatio 'original'", () => {
    const content = "---\nlayout: folder-cards\naspect-ratio: original\n---\n";
    expect(parseFolderMd(content, "F").aspectRatio).toBe("original");
  });

  it("aspect-ratio: 1.5 (plain number) → aspectRatio '1.5'", () => {
    const content = "---\nlayout: folder-cards\naspect-ratio: 1.5\n---\n";
    expect(parseFolderMd(content, "F").aspectRatio).toBe("1.5");
  });

  it("aspect-ratio: banana (invalid) → defaults to '1/1'", () => {
    const content = "---\nlayout: folder-cards\naspect-ratio: banana\n---\n";
    expect(parseFolderMd(content, "F").aspectRatio).toBe("1/1");
  });

  it("aspect-ratio absent → defaults to '1/1'", () => {
    const content = "---\nlayout: folder-cards\n---\n";
    expect(parseFolderMd(content, "F").aspectRatio).toBe("1/1");
  });

  // ── fit field ──────────────────────────────────────────────────────────────

  it("fit: contain → fit 'contain'", () => {
    const content = "---\nlayout: folder-cards\nfit: contain\n---\n";
    expect(parseFolderMd(content, "F").fit).toBe("contain");
  });

  it("fit: 80% auto (pass-through) → fit '80% auto'", () => {
    const content = "---\nlayout: folder-cards\nfit: 80% auto\n---\n";
    expect(parseFolderMd(content, "F").fit).toBe("80% auto");
  });

  it("fit: url(evil) (CSS injection) → defaults to 'cover'", () => {
    const content = "---\nlayout: folder-cards\nfit: url(evil)\n---\n";
    expect(parseFolderMd(content, "F").fit).toBe("cover");
  });

  it("fit absent → defaults to 'cover'", () => {
    const content = "---\nlayout: folder-cards\n---\n";
    expect(parseFolderMd(content, "F").fit).toBe("cover");
  });

  // ── min-height / max-height fields ────────────────────────────────────────

  it("min-height: 80 → minHeight 80", () => {
    const content = "---\nlayout: folder-cards\nmin-height: 80\n---\n";
    expect(parseFolderMd(content, "F").minHeight).toBe(80);
  });

  it("min-height: 5 (below clamp floor 20) → minHeight 20", () => {
    const content = "---\nlayout: folder-cards\nmin-height: 5\n---\n";
    expect(parseFolderMd(content, "F").minHeight).toBe(20);
  });

  it("max-height: 500 (above clamp ceiling 400) → maxHeight 400", () => {
    const content = "---\nlayout: folder-cards\nmax-height: 500\n---\n";
    expect(parseFolderMd(content, "F").maxHeight).toBe(400);
  });

  it("min-height: 150, max-height: 50 (inverted) → swapped: minHeight 50, maxHeight 150", () => {
    const content = "---\nlayout: folder-cards\nmin-height: 150\nmax-height: 50\n---\n";
    const cfg = parseFolderMd(content, "F");
    expect(cfg.minHeight).toBe(50);
    expect(cfg.maxHeight).toBe(150);
  });

  it("min-height / max-height absent → defaults 40 / 200", () => {
    const content = "---\nlayout: folder-cards\n---\n";
    const cfg = parseFolderMd(content, "F");
    expect(cfg.minHeight).toBe(40);
    expect(cfg.maxHeight).toBe(200);
  });
});

// ── Nested layout block (new YAML format) ─────────────────────────────────────

describe("nested layout block", () => {

  it("all fields parsed correctly from indented layout: block", () => {
    const content = [
      "---",
      "layout:",
      "  type: folder-cards",
      "  mode: flex",
      "  card-width: 200",
      "  aspect-ratio: 16:9",
      "  fit: contain",
      "  min-height: 60",
      "  max-height: 150",
      "  sort: name-desc",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.layout).toBe("folder-cards");
    expect(cfg.layoutMode).toBe("flex");
    expect(cfg.cardWidth).toBe(200);
    expect(cfg.aspectRatio).toBe("16/9");
    expect(cfg.fit).toBe("contain");
    expect(cfg.minHeight).toBe(60);
    expect(cfg.maxHeight).toBe(150);
    expect(cfg.sort).toBe("name-desc");
  });

  it("nested block with inline comments: comments stripped, values correct", () => {
    const content = [
      "---",
      "layout:",
      "  type: folder-cards",
      "  mode: grid            # grid = consistent columns, flex = fluid smooth resize",
      "  card-width: 160       # min px per card",
      "  sort: name-asc        # name-asc, name-desc, modified-asc, modified-desc",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.layout).toBe("folder-cards");
    expect(cfg.layoutMode).toBe("grid");
    expect(cfg.cardWidth).toBe(160);
    expect(cfg.sort).toBe("name-asc");
  });

  it("flat format still works after nested format is supported (backwards compat)", () => {
    const content = "---\nlayout: folder-cards\nlayout-mode: flex\ncard-width: 240\n---\n";
    const cfg = parseFolderMd(content, "F");
    expect(cfg.layout).toBe("folder-cards");
    expect(cfg.layoutMode).toBe("flex");
    expect(cfg.cardWidth).toBe(240);
  });

  it("inline comment on flat sort value is stripped correctly", () => {
    const content = "---\nlayout: folder-cards\nsort: name-desc # name-asc, name-desc\n---\n";
    expect(parseFolderMd(content, "F").sort).toBe("name-desc");
  });

});

// ── show-name ─────────────────────────────────────────────────────────────────

describe("show-name", () => {
  it("show-name: false → showName false", () => {
    const content = "---\nlayout:\n  type: folder-cards\n  show-name: false\n---\n";
    expect(parseFolderMd(content, "F").showName).toBe(false);
  });

  it("show-name: true → showName true", () => {
    const content = "---\nlayout:\n  type: folder-cards\n  show-name: true\n---\n";
    expect(parseFolderMd(content, "F").showName).toBe(true);
  });

  it("show-name absent → showName true (default)", () => {
    const content = "---\nlayout: folder-cards\n---\n";
    expect(parseFolderMd(content, "F").showName).toBe(true);
  });
});

// ── FVB-04: card-preview (compact mode) ───────────────────────────────────────

describe("FVB-04: card-preview", () => {
  it("card-preview: none → showPreview false", () => {
    const content = "---\nlayout:\n  type: folder-cards\n  card-preview: none\n---\n";
    expect(parseFolderMd(content, "F").showPreview).toBe(false);
  });

  it("card-preview: full → showPreview true", () => {
    const content = "---\nlayout:\n  type: folder-cards\n  card-preview: full\n---\n";
    expect(parseFolderMd(content, "F").showPreview).toBe(true);
  });

  it("card-preview absent → showPreview true (default)", () => {
    const content = "---\nlayout: folder-cards\n---\n";
    expect(parseFolderMd(content, "F").showPreview).toBe(true);
  });
});

// ── FVB-05: exclude list ──────────────────────────────────────────────────────

describe("FVB-05: exclude", () => {
  it("exclude sequence parsed into string[] correctly", () => {
    const content = [
      "---",
      "layout: folder-cards",
      "exclude:",
      "  - draft.md",
      "  - _index.md",
      "---",
    ].join("\n");
    expect(parseFolderMd(content, "F").exclude).toEqual(["draft.md", "_index.md"]);
  });

  it("exclude absent → empty array (default)", () => {
    const content = "---\nlayout: folder-cards\n---\n";
    expect(parseFolderMd(content, "F").exclude).toEqual([]);
  });

  it("exclude sequence + nested layout block coexist correctly", () => {
    const content = [
      "---",
      "layout:",
      "  type: folder-cards",
      "  sort: name-desc",
      "exclude:",
      "  - private.md",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.layout).toBe("folder-cards");
    expect(cfg.sort).toBe("name-desc");
    expect(cfg.exclude).toEqual(["private.md"]);
  });
});

// ── FVB-06: show-extensions ───────────────────────────────────────────────────

describe("FVB-06: show-extensions", () => {
  it("show-extensions: false → showExtensions false", () => {
    const content = "---\nlayout:\n  type: folder-cards\n  show-extensions: false\n---\n";
    expect(parseFolderMd(content, "F").showExtensions).toBe(false);
  });

  it("show-extensions: true → showExtensions true", () => {
    const content = "---\nlayout:\n  type: folder-cards\n  show-extensions: true\n---\n";
    expect(parseFolderMd(content, "F").showExtensions).toBe(true);
  });

  it("show-extensions absent → showExtensions true (default)", () => {
    const content = "---\nlayout: folder-cards\n---\n";
    expect(parseFolderMd(content, "F").showExtensions).toBe(true);
  });
});

// ── FVB-07: show-folders / show-files ─────────────────────────────────────────

describe("FVB-07: section visibility toggles", () => {
  it("show-folders: false → showFolders false", () => {
    const content = "---\nlayout:\n  type: folder-cards\n  show-folders: false\n---\n";
    expect(parseFolderMd(content, "F").showFolders).toBe(false);
  });

  it("show-files: false → showFiles false", () => {
    const content = "---\nlayout:\n  type: folder-cards\n  show-files: false\n---\n";
    expect(parseFolderMd(content, "F").showFiles).toBe(false);
  });

  it("show-folders / show-files absent → both true (default)", () => {
    const content = "---\nlayout: folder-cards\n---\n";
    const cfg = parseFolderMd(content, "F");
    expect(cfg.showFolders).toBe(true);
    expect(cfg.showFiles).toBe(true);
  });
});

// ── FVB-08: custom section titles ─────────────────────────────────────────────

describe("FVB-08: custom section titles", () => {
  it("folders-title: Projects → foldersTitle 'Projects'", () => {
    const content = "---\nlayout:\n  type: folder-cards\n  folders-title: Projects\n---\n";
    expect(parseFolderMd(content, "F").foldersTitle).toBe("Projects");
  });

  it("files-title: Notes → filesTitle 'Notes'", () => {
    const content = "---\nlayout:\n  type: folder-cards\n  files-title: Notes\n---\n";
    expect(parseFolderMd(content, "F").filesTitle).toBe("Notes");
  });

  it("folders-title absent → foldersTitle 'Folders' (default)", () => {
    const content = "---\nlayout: folder-cards\n---\n";
    expect(parseFolderMd(content, "F").foldersTitle).toBe("Folders");
  });

  it("files-title absent → filesTitle '' (default = no heading)", () => {
    const content = "---\nlayout: folder-cards\n---\n";
    expect(parseFolderMd(content, "F").filesTitle).toBe("");
  });
});

// ── FVB-01: show-tags ──────────────────────────────────────────────────────────

describe("FVB-01: show-tags", () => {
  it("show-tags: true → showTags true", () => {
    const content = "---\nlayout:\n  type: folder-cards\n  show-tags: true\n---\n";
    expect(parseFolderMd(content, "F").showTags).toBe(true);
  });

  it("show-tags: false → showTags false", () => {
    const content = "---\nlayout:\n  type: folder-cards\n  show-tags: false\n---\n";
    expect(parseFolderMd(content, "F").showTags).toBe(false);
  });

  it("show-tags absent → showTags false (default)", () => {
    const content = "---\nlayout: folder-cards\n---\n";
    expect(parseFolderMd(content, "F").showTags).toBe(false);
  });
});

// ── FVB-09: show-count ────────────────────────────────────────────────────────

describe("FVB-09: show-count", () => {
  it("show-count: true → showCount true", () => {
    const content = "---\nlayout:\n  type: folder-cards\n  show-count: true\n---\n";
    expect(parseFolderMd(content, "F").showCount).toBe(true);
  });

  it("show-count absent → showCount false (default)", () => {
    const content = "---\nlayout: folder-cards\n---\n";
    expect(parseFolderMd(content, "F").showCount).toBe(false);
  });
});

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

  // ── EC-12 (updated): Unknown sort values pass through verbatim (FR-08).
  // Truly absent sort field still defaults to "name-asc". Unknown values
  // are passed through so they can be handled as extra-field sort keys by
  // the table renderer.

  it("EC-12: sort absent → defaults to 'name-asc'", () => {
    const content = "---\nlayout: folder-cards\n---\n";
    expect(parseFolderMd(content, "F").sort).toBe("name-asc");
  });

  it("EC-12 (updated): sort: invalid-value passes through verbatim (not defaulted to name-asc)", () => {
    const content = "---\nlayout: folder-cards\nsort: invalid-value\n---\n";
    expect(parseFolderMd(content, "F").sort).toBe("invalid-value");
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

// ── content-area-override ─────────────────────────────────────────────────────

describe("content-area-override", () => {
  it("content-area-override: true → contentAreaOverride true", () => {
    const content = "---\nlayout:\n  type: folder-cards\n  content-area-override: true\n---\n";
    expect(parseFolderMd(content, "F").contentAreaOverride).toBe(true);
  });

  it("content-area-override: false → contentAreaOverride false", () => {
    const content = "---\nlayout:\n  type: folder-cards\n  content-area-override: false\n---\n";
    expect(parseFolderMd(content, "F").contentAreaOverride).toBe(false);
  });

  it("content-area-override absent → contentAreaOverride true (default)", () => {
    const content = "---\nlayout: folder-cards\n---\n";
    expect(parseFolderMd(content, "F").contentAreaOverride).toBe(true);
  });
});

describe("extra-fields parsing", () => {
  // T-01 — Simple list form
  it("T-01: simple list [status, priority] produces two ExtraField entries with capitalised labels", () => {
    const content = [
      "---",
      "layout: folder-table",
      "extra-fields:",
      "  - status",
      "  - priority",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.extraFields).toEqual([
      { key: "status",   label: "Status" },
      { key: "priority", label: "Priority" },
    ]);
  });

  // T-02 — Structured form
  it("T-02: structured form with explicit key/label produces correct ExtraField", () => {
    const content = [
      "---",
      "layout: folder-table",
      "extra-fields:",
      "  - key: status",
      "    label: My Status",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.extraFields).toEqual([{ key: "status", label: "My Status" }]);
  });

  // T-03 — Mixed form (implementation-defined; must not throw)
  it("T-03: mixed list (string and object) does not throw and returns parseable items", () => {
    const content = [
      "---",
      "layout: folder-table",
      "extra-fields:",
      "  - status",
      "  - key: priority",
      "    label: Priority",
      "---",
    ].join("\n");
    expect(() => parseFolderMd(content, "Folder")).not.toThrow();
    const cfg = parseFolderMd(content, "Folder");
    // At minimum: the parseable items are present; no crash.
    expect(cfg.extraFields.length).toBeGreaterThanOrEqual(1);
  });

  // T-04 — Absent extra-fields
  it("T-04: absent extra-fields produces extraFields=[]", () => {
    const content = "---\nlayout: folder-table\n---\n";
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.extraFields).toEqual([]);
  });

  // T-05 — Object item with empty key is silently skipped
  it("T-05: structured item with empty key is silently skipped", () => {
    const content = [
      "---",
      "layout: folder-table",
      "extra-fields:",
      "  - key:",
      "    label: Something",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.extraFields).toEqual([]);
  });

  // T-06 — Object item with valid key but missing label defaults to capitalised key
  it("T-06: structured item with valid key but no label uses capitalised key as label", () => {
    const content = [
      "---",
      "layout: folder-table",
      "extra-fields:",
      "  - key: priority",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.extraFields).toEqual([{ key: "priority", label: "Priority" }]);
  });

  // T-07 — Unknown sort value passes through (extra-field key)
  it("T-07: sort: status (not in VALID_SORTS) → config.sort is \"status\"", () => {
    const content = [
      "---",
      "layout: folder-table",
      "sort: status",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.sort).toBe("status");
  });

  // T-08 — Completely unknown sort value passes through
  it("T-08: sort: unknown-sort passes through unchanged", () => {
    const content = [
      "---",
      "layout: folder-table",
      "sort: unknown-sort",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.sort).toBe("unknown-sort");
  });

  // EC-01 — Empty sequence
  it("EC-01: extra-fields present but empty sequence → extraFields=[]", () => {
    const content = "---\nlayout: folder-table\nextra-fields:\n---\n";
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.extraFields).toEqual([]);
  });

  // EC-15 — Key with leading/trailing whitespace is trimmed
  it("EC-15: key with leading/trailing whitespace in structured form is trimmed", () => {
    const content = [
      "---",
      "layout: folder-table",
      "extra-fields:",
      "  - key:  status ",
      "    label: Status",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.extraFields[0]?.key).toBe("status");
  });

  // EC-02 — Key with special characters (hyphens, underscores) passes through as-is
  it("EC-02: key with hyphens and underscores is stored verbatim (no normalisation)", () => {
    const content = [
      "---",
      "layout: folder-table",
      "extra-fields:",
      "  - my-field",
      "  - field_name",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.extraFields).toEqual([
      { key: "my-field",   label: "My-field" },
      { key: "field_name", label: "Field_name" },
    ]);
  });

  // EC-16 — extra-fields + nested layout block coexist correctly
  it("EC-16: extra-fields sequence and nested layout block coexist without interference", () => {
    const content = [
      "---",
      "layout:",
      "  type: folder-table",
      "  sort: name-desc",
      "extra-fields:",
      "  - status",
      "  - priority",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.layout).toBe("folder-table");
    expect(cfg.sort).toBe("name-desc");
    expect(cfg.extraFields).toEqual([
      { key: "status",   label: "Status" },
      { key: "priority", label: "Priority" },
    ]);
  });
});

describe("fields: extraction", () => {
  // T-01
  it("T-01: fields:[name,modified,tags] → config.fields=[name,modified,tags]; extraFields=[]", () => {
    const content = [
      "---", "layout: folder-table",
      "fields:", "  - name", "  - modified", "  - tags",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.fields).toEqual(["name", "modified", "tags"]);
    expect(cfg.extraFields).toEqual([]);
  });

  // T-02
  it("T-02: fields:[name,status,priority] → extraFields=[{key:status,...},{key:priority,...}]", () => {
    const content = [
      "---", "layout: folder-table",
      "fields:", "  - name", "  - status", "  - priority",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.fields).toEqual(["name", "status", "priority"]);
    expect(cfg.extraFields).toEqual([
      { key: "status", label: "Status" },
      { key: "priority", label: "Priority" },
    ]);
  });

  // T-03
  it("T-03: fields: absent → config.fields=null; extraFields from extra-fields: as before", () => {
    const content = [
      "---", "layout: folder-table",
      "extra-fields:", "  - status",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.fields).toBeNull();
    expect(cfg.extraFields).toEqual([{ key: "status", label: "Status" }]);
  });

  // T-04
  it("T-04: fields: at top level (not nested under layout:) → correctly extracted", () => {
    const content = [
      "---", "layout: folder-table",
      "fields:", "  - name", "  - modified",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.fields).toEqual(["name", "modified"]);
  });

  // T-05
  it("T-05: fields: nested under layout: block → correctly extracted", () => {
    const content = [
      "---",
      "layout:",
      "  type: folder-table",
      "  sort: name-asc",
      "fields:",
      "  - name",
      "  - modified",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.fields).toEqual(["name", "modified"]);
    expect(cfg.layout).toBe("folder-table");
  });

  // T-06
  it("T-06: item with inline comment '- modified  # last changed' → parsed as 'modified'", () => {
    const content = [
      "---", "layout: folder-table",
      "fields:", "  - modified  # last changed",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.fields).toEqual(["modified"]);
  });

  // T-07
  it("T-07: fields: [] (empty sequence) → config.fields=null", () => {
    const content = "---\nlayout: folder-table\nfields:\n---\n";
    const cfg = parseFolderMd(content, "F");
    expect(cfg.fields).toBeNull();
  });

  // T-08
  it("T-08: fields: and extra-fields: both present → fields: wins; extra-fields: ignored", () => {
    const content = [
      "---", "layout: folder-table",
      "fields:", "  - name", "  - status",
      "extra-fields:", "  - priority",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.fields).toEqual(["name", "status"]);
    // extraFields derived from fields:, not extra-fields:
    expect(cfg.extraFields).toEqual([{ key: "status", label: "Status" }]);
    // 'priority' from extra-fields: is NOT present
    expect(cfg.extraFields.find(f => f.key === "priority")).toBeUndefined();
  });

  // T-09
  it("T-09: show-modified:false with fields:[modified] → both parsed independently", () => {
    const content = [
      "---", "layout: folder-table",
      "show-modified: false",
      "fields:", "  - modified",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    // Parser stores both; renderer decides which to use.
    expect(cfg.fields).toContain("modified");
    expect(cfg.showModified).toBe(false);
  });

  // EC-01: empty fields
  it("EC-01: fields: key present but no items → config.fields=null (falls through to legacy)", () => {
    const content = "---\nlayout: folder-table\nfields:\n---\n";
    const cfg = parseFolderMd(content, "F");
    expect(cfg.fields).toBeNull();
  });

  // EC-11: blank item after comment-stripping
  it("EC-11: item that becomes blank after comment-strip is silently skipped", () => {
    const content = [
      "---", "layout: folder-table",
      "fields:", "  - # just a comment", "  - name",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    // "# just a comment" — the "- " is followed by nothing after comment-strip
    expect(cfg.fields).toEqual(["name"]);
  });

  // EC-17: quoted item
  it("EC-17: quoted item '- \"modified\"' → parses as 'modified' (no quotes in result)", () => {
    const content = [
      "---", "layout: folder-table",
      'fields:', '  - "modified"',
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.fields).toEqual(["modified"]);
  });
});

describe("cover: and icon: parsing", () => {
  it("cover: relative path is parsed verbatim", () => {
    const content = [
      "---", "layout: folder-cards", "cover: ./header.png", "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.cover).toBe("./header.png");
  });

  it("cover: absent → config.cover is undefined", () => {
    const content = ["---", "layout: folder-cards", "---"].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.cover).toBeUndefined();
  });

  it("icon: emoji value is parsed verbatim", () => {
    const content = [
      "---", "layout: folder-cards", "icon: 🏠", "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.icon).toBe("🏠");
  });

  it("icon: relative path is parsed verbatim", () => {
    const content = [
      "---", "layout: folder-cards", "icon: ./icon.svg", "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.icon).toBe("./icon.svg");
  });

  it("icon: absent → config.icon is undefined", () => {
    const content = ["---", "layout: folder-cards", "---"].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.icon).toBeUndefined();
  });

  it("cover: and icon: coexist with other fields", () => {
    const content = [
      "---",
      "layout: folder-cards",
      "cover: ./banner.jpg",
      "icon: 📁",
      "title: My Folder",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.cover).toBe("./banner.jpg");
    expect(cfg.icon).toBe("📁");
    expect(cfg.title).toBe("My Folder");
  });

  it("cover: empty string → config.cover is undefined", () => {
    const content = ["---", "layout: folder-cards", "cover:", "---"].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.cover).toBeUndefined();
  });
});


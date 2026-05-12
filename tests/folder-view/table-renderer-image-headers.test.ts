/**
 * tests/folder-view/table-renderer-image-headers.test.ts
 *
 * Tests for fieldHeaderLabel additions for the four image built-in columns
 * (width, height, date-taken, camera) in table-renderer.ts.
 *
 * Covers TH-01 through TH-06 from step_06_table_renderer_headers.md.
 *
 * Tests render a minimal folder-table and check <th> text content, because
 * fieldHeaderLabel is a private function accessed indirectly via the renderer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderFolderTable } from "../../src/plugins/file-browser/folder-view/table-renderer";
import type { FolderViewConfig, FolderCard } from "../../src/plugins/file-browser/folder-view/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeConfig(fields: string[]): FolderViewConfig {
  return {
    layout: "folder-table",
    title: "Test Folder",
    sort: "name-asc",
    cardWidth: 160,
    layoutMode: "grid",
    showModified: true,
    body: "",
    aspectRatio: "1/1",
    fit: "cover",
    minHeight: 40,
    maxHeight: 200,
    showName: true,
    showPreview: true,
    showExtensions: false,
    showFolders: true,
    showFiles: true,
    foldersTitle: "Folders",
    filesTitle: "",
    showTags: false,
    showCount: false,
    exclude: [],
    contentAreaOverride: true,
    extraFields: [],
    fields,
  };
}

function makeFileCard(name: string): FolderCard {
  return {
    path: `/vault/${name}.jpg`,
    name,
    kind: "file",
    ext: ".jpg",
    modified: 0,
    meta: {},
  };
}

function makeContainer(): HTMLDivElement {
  return document.createElement("div");
}

/** Collect all <th> text content from the rendered table (trimmed). */
function getHeaderTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("thead th"))
    .map(th => th.textContent?.trim() ?? "");
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  (window as any).__MARKABLE_TAB_MANAGER__ = {
    openFileInTab: vi.fn(),
    openMediaInTab: vi.fn(),
  };
  (window as any).__MARKABLE_FILE_BROWSER__ = { expandDirectory: vi.fn() };
  (window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = vi.fn();
  (window as any).__MARKABLE_RENDER_MD__ = undefined;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("fieldHeaderLabel — image built-in column headers", () => {
  it("TH-01: fields:[name,width] → <th> with text 'Width' present", () => {
    const container = makeContainer();
    renderFolderTable(makeConfig(["name", "width"]), [makeFileCard("photo")], container, "/vault");
    expect(getHeaderTexts(container)).toContain("Width");
  });

  it("TH-02: fields:[name,height] → <th> with text 'Height' present", () => {
    const container = makeContainer();
    renderFolderTable(makeConfig(["name", "height"]), [makeFileCard("photo")], container, "/vault");
    expect(getHeaderTexts(container)).toContain("Height");
  });

  it("TH-03: fields:[name,date-taken] → <th> with text 'Date Taken' present", () => {
    const container = makeContainer();
    renderFolderTable(makeConfig(["name", "date-taken"]), [makeFileCard("photo")], container, "/vault");
    expect(getHeaderTexts(container)).toContain("Date Taken");
  });

  it("TH-04: fields:[name,camera] → <th> with text 'Camera' present", () => {
    const container = makeContainer();
    renderFolderTable(makeConfig(["name", "camera"]), [makeFileCard("photo")], container, "/vault");
    expect(getHeaderTexts(container)).toContain("Camera");
  });

  it("TH-05: all four image fields → all four header labels present in the rendered table", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig(["name", "width", "height", "date-taken", "camera"]),
      [makeFileCard("photo")],
      container,
      "/vault",
    );
    const headers = getHeaderTexts(container);
    expect(headers).toContain("Width");
    expect(headers).toContain("Height");
    expect(headers).toContain("Date Taken");
    expect(headers).toContain("Camera");
  });

  it("TH-06: existing labels are not regressed by the new cases", () => {
    // name, modified, tags, type (ext), count are unchanged.
    const container = makeContainer();

    // Render with the standard built-in fields.
    // (tags and count are tricky to test with a minimal config — just test name and modified.)
    renderFolderTable(
      makeConfig(["name", "modified"]),
      [makeFileCard("photo")],
      container,
      "/vault",
    );
    const headers = getHeaderTexts(container);
    expect(headers).toContain("Name");
    expect(headers).toContain("Modified");
  });
});

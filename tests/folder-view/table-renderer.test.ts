/**
 * tests/folder-view/table-renderer.test.ts
 *
 * Unit tests for renderFolderTable() — the "folder-table" layout renderer.
 *
 * Covers: table structure, section visibility, column visibility, lazy loading,
 * interactive sort, click/keyboard activation, empty state, exclude filter,
 * and content-area-override.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderFolderTable } from "../../src/plugins/file-browser/folder-view/table-renderer";
import type { FolderViewConfig, FolderCard } from "../../src/plugins/file-browser/folder-view/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<FolderViewConfig> = {}): FolderViewConfig {
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
    showExtensions: true,
    showFolders: true,
    showFiles: true,
    foldersTitle: "Folders",
    filesTitle: "",
    showTags: false,
    showCount: false,
    exclude: [],
    contentAreaOverride: true,
    ...overrides,
  };
}

function makeDirCard(name: string, path = `/vault/${name}`, hasFV = false, childCount = 0): FolderCard {
  return { path, name, kind: "directory", ext: "", modified: 0, hasFolderView: hasFV, childCount };
}

function makeFileCard(name: string, ext = ".md", modified = 0, path?: string, tags?: string[]): FolderCard {
  const fullPath = path ?? `/vault/${name}${ext === ".md" ? "" : ext}`;
  return { path: fullPath, name, kind: "file", ext, modified, tags };
}

function makeContainer(): HTMLDivElement {
  const div = document.createElement("div");
  div.id = "custom-tab-host";
  return div;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("renderFolderTable", () => {
  beforeEach(() => {
    (window as any).__MARKABLE_TAB_MANAGER__ = {
      openFileInTab: vi.fn(),
      openMediaInTab: vi.fn(),
    };
    (window as any).__MARKABLE_FILE_BROWSER__ = {
      expandDirectory: vi.fn(),
    };
    (window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = vi.fn();
    (window as any).__MARKABLE_RENDER_MD__ = undefined;
  });

  // ── Table structure ────────────────────────────────────────────────────────

  it("renders a <table> inside .folder-view-host", () => {
    const container = makeContainer();
    renderFolderTable(makeConfig(), [makeDirCard("A")], container, "/vault");
    expect(container.querySelector(".folder-view-host")).not.toBeNull();
    expect(container.querySelector("table.fv-table")).not.toBeNull();
  });

  it("folders section renders thead + tbody with one row per dir card", () => {
    const container = makeContainer();
    renderFolderTable(makeConfig(), [makeDirCard("A"), makeDirCard("B")], container, "/vault");
    const rows = container.querySelectorAll("tbody.fv-tbody tr.fv-row");
    expect(rows.length).toBe(2);
  });

  it("files section renders one row per file card", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig(),
      [makeFileCard("note"), makeFileCard("todo"), makeFileCard("ideas")],
      container,
      "/vault",
    );
    const rows = container.querySelectorAll("tbody.fv-tbody tr.fv-row");
    expect(rows.length).toBe(3);
  });

  it("two sections rendered when both dirs and files are present", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ foldersTitle: "Folders", filesTitle: "Files" }),
      [makeDirCard("Sub"), makeFileCard("note")],
      container,
      "/vault",
    );
    const headings = Array.from(container.querySelectorAll(".folder-view-section-title"))
      .map(h => h.textContent);
    expect(headings).toContain("Folders");
    expect(headings).toContain("Files");
    const tables = container.querySelectorAll("table.fv-table");
    expect(tables.length).toBe(2);
  });

  // ── Section visibility toggles ─────────────────────────────────────────────

  it("showFolders=false → no folders rows rendered", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ showFolders: false }),
      [makeDirCard("Sub"), makeFileCard("note")],
      container,
      "/vault",
    );
    const headings = Array.from(container.querySelectorAll(".folder-view-section-title"))
      .map(h => h.textContent);
    expect(headings).not.toContain("Folders");
    expect(container.querySelector("table.fv-table")).not.toBeNull();
  });

  it("showFiles=false → no file rows rendered", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ showFiles: false }),
      [makeDirCard("Sub"), makeFileCard("note")],
      container,
      "/vault",
    );
    const rows = container.querySelectorAll("tbody.fv-tbody tr.fv-row");
    // Only 1 dir card row
    expect(rows.length).toBe(1);
    const firstCell = rows[0].querySelector("td.fv-td-name");
    expect(firstCell?.textContent).toBe("Sub");
  });

  it("showFolders=false + showFiles=false → empty state shown, no table", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ showFolders: false, showFiles: false }),
      [makeDirCard("Sub"), makeFileCard("note")],
      container,
      "/vault",
    );
    expect(container.querySelector(".folder-view-empty")).not.toBeNull();
    expect(container.querySelector("table.fv-table")).toBeNull();
  });

  it("no cards at all → empty state", () => {
    const container = makeContainer();
    renderFolderTable(makeConfig(), [], container, "/vault");
    expect(container.querySelector(".folder-view-empty")).not.toBeNull();
  });

  // ── Column visibility: files section ──────────────────────────────────────

  it("showModified=true → .fv-th-modified header and .fv-td-modified cells present", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ showModified: true }),
      [makeFileCard("note", ".md", 1000000)],
      container,
      "/vault",
    );
    expect(container.querySelector("th.fv-th-modified")).not.toBeNull();
    expect(container.querySelector("td.fv-td-modified")).not.toBeNull();
  });

  it("showModified=false → no .fv-th-modified header or .fv-td-modified cells", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ showModified: false }),
      [makeFileCard("note", ".md", 1000000)],
      container,
      "/vault",
    );
    expect(container.querySelector("th.fv-th-modified")).toBeNull();
    expect(container.querySelector("td.fv-td-modified")).toBeNull();
  });

  it("showExtensions=true → .fv-th-ext header and .fv-td-ext cells present", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ showExtensions: true }),
      [makeFileCard("photo", ".png", 0, "/vault/photo.png")],
      container,
      "/vault",
    );
    expect(container.querySelector("th.fv-th-ext")).not.toBeNull();
    expect(container.querySelector("td.fv-td-ext")).not.toBeNull();
  });

  it("showExtensions=false → no .fv-th-ext or .fv-td-ext", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ showExtensions: false }),
      [makeFileCard("photo", ".png", 0, "/vault/photo.png")],
      container,
      "/vault",
    );
    expect(container.querySelector("th.fv-th-ext")).toBeNull();
    expect(container.querySelector("td.fv-td-ext")).toBeNull();
  });

  it("showExtensions=false → non-md file name shown without extension", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ showExtensions: false }),
      [makeFileCard("photo.png", ".png", 0, "/vault/photo.png")],
      container,
      "/vault",
    );
    const nameTd = container.querySelector<HTMLElement>("td.fv-td-name");
    expect(nameTd?.textContent).toBe("photo");
  });

  it("showTags=true + card with tags → .folder-view-tag-chip spans rendered", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ showTags: true }),
      [makeFileCard("note", ".md", 0, undefined, ["research", "todo"])],
      container,
      "/vault",
    );
    const chips = container.querySelectorAll(".folder-view-tag-chip");
    expect(chips.length).toBe(2);
  });

  it("showTags=false (default) → no .folder-view-tag-chip spans", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ showTags: false }),
      [makeFileCard("note", ".md", 0, undefined, ["research"])],
      container,
      "/vault",
    );
    expect(container.querySelector(".folder-view-tag-chip")).toBeNull();
  });

  // ── Column visibility: folders section ────────────────────────────────────

  it("showCount=true → .fv-th-count header and .fv-td-count cells present", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ showCount: true }),
      [makeDirCard("Sub", "/vault/Sub", false, 5)],
      container,
      "/vault",
    );
    expect(container.querySelector("th.fv-th-count")).not.toBeNull();
    expect(container.querySelector("td.fv-td-count")).not.toBeNull();
    expect(container.querySelector("td.fv-td-count")?.textContent).toBe("5");
  });

  it("showCount=false (default) → no .fv-th-count or .fv-td-count", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ showCount: false }),
      [makeDirCard("Sub")],
      container,
      "/vault",
    );
    expect(container.querySelector("th.fv-th-count")).toBeNull();
    expect(container.querySelector("td.fv-td-count")).toBeNull();
  });

  // ── Exclude filter ─────────────────────────────────────────────────────────

  it("exclude: ['draft.md'] → excluded file not in rows", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ exclude: ["draft.md"] }),
      [makeFileCard("draft"), makeFileCard("notes")],
      container,
      "/vault",
    );
    const names = Array.from(container.querySelectorAll("td.fv-td-name")).map(n => n.textContent);
    expect(names).not.toContain("draft");
    expect(names).toContain("notes");
  });

  it("exclude: [] (default) → all cards shown", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ exclude: [] }),
      [makeFileCard("a"), makeFileCard("b"), makeFileCard("c")],
      container,
      "/vault",
    );
    expect(container.querySelectorAll("tr.fv-row").length).toBe(3);
  });

  // ── content-area-override ─────────────────────────────────────────────────

  it("contentAreaOverride=true (default) → host does NOT have --constrained class", () => {
    const container = makeContainer();
    renderFolderTable(makeConfig({ contentAreaOverride: true }), [makeFileCard("note")], container, "/vault");
    expect(container.querySelector(".folder-view-host--constrained")).toBeNull();
  });

  it("contentAreaOverride=false → host has .folder-view-host--constrained class", () => {
    const container = makeContainer();
    renderFolderTable(makeConfig({ contentAreaOverride: false }), [makeFileCard("note")], container, "/vault");
    expect(container.querySelector(".folder-view-host--constrained")).not.toBeNull();
  });

  // ── Lazy loading ───────────────────────────────────────────────────────────

  it("≤50 cards → all rows rendered immediately, no sentinel row", () => {
    const cards: FolderCard[] = Array.from({ length: 30 }, (_, i) =>
      makeFileCard(`file-${i}`, ".md", i),
    );
    const container = makeContainer();
    renderFolderTable(makeConfig(), cards, container, "/vault");
    expect(container.querySelectorAll("tr.fv-row").length).toBe(30);
    expect(container.querySelector("tr.fv-sentinel-row")).toBeNull();
  });

  it(">50 cards → exactly 50 rows rendered initially, sentinel row present", () => {
    vi.stubGlobal("IntersectionObserver", class {
      constructor(_cb: (entries: IntersectionObserverEntry[]) => void) {}
      observe = vi.fn();
      disconnect = vi.fn();
    });

    const cards: FolderCard[] = Array.from({ length: 200 }, (_, i) =>
      makeFileCard(`file-${i}`, ".md", i),
    );
    const container = makeContainer();
    renderFolderTable(makeConfig(), cards, container, "/vault");
    expect(container.querySelectorAll("tr.fv-row").length).toBe(50);
    expect(container.querySelector("tr.fv-sentinel-row")).not.toBeNull();

    vi.unstubAllGlobals();
  });

  // ── Sort: initial order ────────────────────────────────────────────────────

  it("sort=name-asc → rows appear in ascending alphabetical order", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ sort: "name-asc" }),
      [makeFileCard("zebra"), makeFileCard("alpha"), makeFileCard("mango")],
      container,
      "/vault",
    );
    const names = Array.from(container.querySelectorAll("td.fv-td-name")).map(n => n.textContent);
    expect(names).toEqual(["alpha", "mango", "zebra"]);
  });

  it("sort=name-desc → rows appear in descending alphabetical order", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ sort: "name-desc" }),
      [makeFileCard("alpha"), makeFileCard("zebra"), makeFileCard("mango")],
      container,
      "/vault",
    );
    const names = Array.from(container.querySelectorAll("td.fv-td-name")).map(n => n.textContent);
    expect(names).toEqual(["zebra", "mango", "alpha"]);
  });

  it("sort=modified-asc → rows appear in ascending modified order", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ sort: "modified-asc" }),
      [makeFileCard("c", ".md", 300), makeFileCard("a", ".md", 100), makeFileCard("b", ".md", 200)],
      container,
      "/vault",
    );
    const names = Array.from(container.querySelectorAll("td.fv-td-name")).map(n => n.textContent);
    expect(names).toEqual(["a", "b", "c"]);
  });

  // ── Sort: initial header indicator ────────────────────────────────────────

  it("sort=name-asc → name header has fv-sorted-asc class", () => {
    const container = makeContainer();
    renderFolderTable(makeConfig({ sort: "name-asc" }), [makeFileCard("note")], container, "/vault");
    const nameTh = container.querySelector("th.fv-th-name");
    expect(nameTh?.classList.contains("fv-sorted-asc")).toBe(true);
    expect(nameTh?.classList.contains("fv-sorted-desc")).toBe(false);
  });

  it("sort=modified-desc → modified header has fv-sorted-desc class", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ sort: "modified-desc", showModified: true }),
      [makeFileCard("note", ".md", 1000)],
      container,
      "/vault",
    );
    const modTh = container.querySelector("th.fv-th-modified");
    expect(modTh?.classList.contains("fv-sorted-desc")).toBe(true);
  });

  // ── Interactive sort: clicking headers ────────────────────────────────────

  it("clicking name header toggles sort direction on same column", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ sort: "name-asc" }),
      [makeFileCard("zebra"), makeFileCard("alpha"), makeFileCard("mango")],
      container,
      "/vault",
    );
    const nameTh = container.querySelector<HTMLElement>("th.fv-th-name")!;

    // Initial: name-asc → [alpha, mango, zebra]
    let names = Array.from(container.querySelectorAll("td.fv-td-name")).map(n => n.textContent);
    expect(names).toEqual(["alpha", "mango", "zebra"]);

    // Click → name-desc → [zebra, mango, alpha]
    nameTh.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    names = Array.from(container.querySelectorAll("td.fv-td-name")).map(n => n.textContent);
    expect(names).toEqual(["zebra", "mango", "alpha"]);
    expect(nameTh.classList.contains("fv-sorted-desc")).toBe(true);

    // Click again → name-asc → [alpha, mango, zebra]
    nameTh.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    names = Array.from(container.querySelectorAll("td.fv-td-name")).map(n => n.textContent);
    expect(names).toEqual(["alpha", "mango", "zebra"]);
    expect(nameTh.classList.contains("fv-sorted-asc")).toBe(true);
  });

  it("clicking Type header sorts by extension asc, then desc on second click", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ sort: "name-asc", showExtensions: true }),
      [
        makeFileCard("b.ts", ".ts", 0, "/vault/b.ts"),
        makeFileCard("a.md", ".md", 0, "/vault/a.md"),
        makeFileCard("c.png", ".png", 0, "/vault/c.png"),
      ],
      container,
      "/vault",
    );
    const extTh = container.querySelector<HTMLElement>("th.fv-th-ext")!;

    // Click → ext-asc → [.md, .png, .ts]
    extTh.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    let names = Array.from(container.querySelectorAll("td.fv-td-name")).map(n => n.textContent);
    expect(names).toEqual(["a.md", "c.png", "b.ts"]);
    expect(extTh.classList.contains("fv-sorted-asc")).toBe(true);

    // Click again → ext-desc → [.ts, .png, .md]
    extTh.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    names = Array.from(container.querySelectorAll("td.fv-td-name")).map(n => n.textContent);
    expect(names).toEqual(["b.ts", "c.png", "a.md"]);
    expect(extTh.classList.contains("fv-sorted-desc")).toBe(true);
  });

  it("clicking Type header clears name and modified sort indicators", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ sort: "name-asc", showExtensions: true, showModified: true }),
      [makeFileCard("a.md", ".md", 0, "/vault/a.md")],
      container,
      "/vault",
    );
    const nameTh = container.querySelector<HTMLElement>("th.fv-th-name")!;
    const extTh = container.querySelector<HTMLElement>("th.fv-th-ext")!;
    expect(nameTh.classList.contains("fv-sorted-asc")).toBe(true);
    extTh.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    expect(nameTh.classList.contains("fv-sorted-asc")).toBe(false);
    expect(nameTh.classList.contains("fv-sorted-desc")).toBe(false);
    expect(extTh.classList.contains("fv-sorted-asc")).toBe(true);
  });

  it("clicking modified header switches active column and resets to asc", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ sort: "name-asc", showModified: true }),
      [makeFileCard("b", ".md", 200), makeFileCard("a", ".md", 300), makeFileCard("c", ".md", 100)],
      container,
      "/vault",
    );
    const modTh = container.querySelector<HTMLElement>("th.fv-th-modified")!;
    const nameTh = container.querySelector<HTMLElement>("th.fv-th-name")!;

    // Initial: name-asc → [a, b, c]
    let names = Array.from(container.querySelectorAll("td.fv-td-name")).map(n => n.textContent);
    expect(names).toEqual(["a", "b", "c"]);

    // Click modified → modified-asc → [c(100), b(200), a(300)]
    modTh.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    names = Array.from(container.querySelectorAll("td.fv-td-name")).map(n => n.textContent);
    expect(names).toEqual(["c", "b", "a"]);
    expect(modTh.classList.contains("fv-sorted-asc")).toBe(true);
    expect(nameTh.classList.contains("fv-sorted-asc")).toBe(false);
    expect(nameTh.classList.contains("fv-sorted-desc")).toBe(false);
  });

  // ── Row click / keyboard activation ───────────────────────────────────────

  it("clicking a file row (.md) calls openFileInTab", () => {
    const openFileSpy = vi.fn();
    (window as any).__MARKABLE_TAB_MANAGER__.openFileInTab = openFileSpy;

    const container = makeContainer();
    renderFolderTable(
      makeConfig(),
      [makeFileCard("note", ".md", 0, "/vault/note.md")],
      container,
      "/vault",
    );
    const row = container.querySelector<HTMLElement>("tr.fv-row")!;
    row.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    expect(openFileSpy).toHaveBeenCalledWith("/vault/note.md");
  });

  it("clicking a dir row calls expandDirectory (and openFolderViewTab when hasFolderView=true)", () => {
    const expandSpy = vi.fn();
    const openFVSpy = vi.fn();
    (window as any).__MARKABLE_FILE_BROWSER__.expandDirectory = expandSpy;
    (window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = openFVSpy;

    const container = makeContainer();
    renderFolderTable(
      makeConfig(),
      [makeDirCard("Sub", "/vault/Sub", true)],
      container,
      "/vault",
    );
    const row = container.querySelector<HTMLElement>("tr.fv-row")!;
    row.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    expect(expandSpy).toHaveBeenCalledWith("/vault/Sub");
    expect(openFVSpy).toHaveBeenCalledWith("/vault/Sub");
  });

  it("pressing Enter on a file row calls openFileInTab", () => {
    const openFileSpy = vi.fn();
    (window as any).__MARKABLE_TAB_MANAGER__.openFileInTab = openFileSpy;

    const container = makeContainer();
    renderFolderTable(
      makeConfig(),
      [makeFileCard("note", ".md", 0, "/vault/note.md")],
      container,
      "/vault",
    );
    const row = container.querySelector<HTMLElement>("tr.fv-row")!;
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(openFileSpy).toHaveBeenCalledWith("/vault/note.md");
  });

  // ── Accessibility ──────────────────────────────────────────────────────────

  it("all rows have role='row' and tabindex='0'", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig(),
      [makeDirCard("Sub"), makeFileCard("note")],
      container,
      "/vault",
    );
    const rows = container.querySelectorAll("tr.fv-row");
    for (const row of rows) {
      expect(row.getAttribute("role")).toBe("row");
      expect(row.getAttribute("tabindex")).toBe("0");
    }
  });

  it("all rows have non-empty aria-label", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig(),
      [makeDirCard("Reports"), makeFileCard("readme")],
      container,
      "/vault",
    );
    const rows = container.querySelectorAll("tr.fv-row");
    for (const row of rows) {
      expect((row.getAttribute("aria-label") ?? "").length).toBeGreaterThan(0);
    }
  });

  // ── Section headings ───────────────────────────────────────────────────────

  it("foldersTitle='Projects' → section heading shows 'Projects'", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ foldersTitle: "Projects" }),
      [makeDirCard("Sub")],
      container,
      "/vault",
    );
    const headings = Array.from(container.querySelectorAll(".folder-view-section-title"))
      .map(h => h.textContent);
    expect(headings).toContain("Projects");
  });

  it("filesTitle='' (default) → no files section heading rendered", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ filesTitle: "" }),
      [makeFileCard("note")],
      container,
      "/vault",
    );
    expect(container.querySelector(".folder-view-section-title")).toBeNull();
  });

  // ── Description body ──────────────────────────────────────────────────────

  it("non-empty body renders .folder-view-description", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ body: "Hello world" }),
      [makeFileCard("note")],
      container,
      "/vault",
    );
    const desc = container.querySelector(".folder-view-description");
    expect(desc).not.toBeNull();
    expect(desc?.textContent).toBe("Hello world");
  });

  it("empty body → no .folder-view-description element", () => {
    const container = makeContainer();
    renderFolderTable(makeConfig({ body: "" }), [makeFileCard("note")], container, "/vault");
    expect(container.querySelector(".folder-view-description")).toBeNull();
  });
});

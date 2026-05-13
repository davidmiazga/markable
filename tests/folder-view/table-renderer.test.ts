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
import type { FolderViewConfig, FolderCard, ExtraField } from "../../src/plugins/file-browser/folder-view/types";

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
    // showExtensions defaults to false so name-only assertions work without
    // needing per-test overrides (existing tests expect bare stems, not "name.md").
    showExtensions: false,
    showFolders: true,
    showFiles: true,
    foldersTitle: "Folders",
    filesTitle: "",
    showTags: false,
    showCount: false,
    exclude: [],
    contentAreaOverride: true,
    extraFields: [],             // T-25: existing tests unaffected
    fields: null,                // AD-7: null keeps all existing tests in legacy mode
    previewPane:   false,
    previewHeight: "60%",
    ...overrides,
  };
}

function makeDirCard(name: string, path = `/vault/${name}`, hasFV = false, childCount = 0): FolderCard {
  return { path, name, kind: "directory", ext: "", modified: 0, hasFolderView: hasFV, childCount };
}

function makeFileCard(
  name: string,
  ext = ".md",
  modified = 0,
  path?: string,
  tags?: string[],
  meta?: Record<string, string>,
): FolderCard {
  const fullPath = path ?? `/vault/${name}${ext === ".md" ? "" : ext}`;
  return { path: fullPath, name, kind: "file", ext, modified, tags, meta };
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
        // Use stem "a" for the .md card — buildFileRow appends ".md" when showExtensions=true.
        makeFileCard("a", ".md", 0, "/vault/a.md"),
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
      [makeFileCard("a", ".md", 0, "/vault/a.md")],
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

describe("extra-fields columns", () => {
  // Helper: build an ExtraField.
  function ef(key: string, label: string): ExtraField {
    return { key, label };
  }

  // T-15 — Extra field header and cell rendered
  it("T-15: extraFields with one field and card.meta → <th> with label and <td> with value", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ extraFields: [ef("status", "Status")] }),
      [makeFileCard("note", ".md", 0, undefined, [], { status: "done" })],
      container,
      "/vault",
    );
    const th = container.querySelector("th.fv-th-extra");
    expect(th).not.toBeNull();
    expect(th?.textContent).toBe("Status");
    const td = container.querySelector("td.fv-td-extra");
    expect(td).not.toBeNull();
    expect(td?.textContent).toBe("done");
  });

  // T-16 — Empty meta → em-dash
  it("T-16: card with meta={} (field absent) → cell displays '—'", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ extraFields: [ef("status", "Status")] }),
      [makeFileCard("note", ".md", 0, undefined, [], {})],
      container,
      "/vault",
    );
    const td = container.querySelector("td.fv-td-extra");
    expect(td?.textContent).toBe("—");  // em-dash
  });

  // T-17 — extraFields=[] (default) → no extra columns
  it("T-17: extraFields=[] → no extra <th> or <td> rendered", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ extraFields: [] }),
      [makeFileCard("note")],
      container,
      "/vault",
    );
    expect(container.querySelector("th.fv-th-extra")).toBeNull();
    expect(container.querySelector("td.fv-td-extra")).toBeNull();
  });

  // T-18 — sort: "status" pre-selects Status column header
  it("T-18: sort='status' with extraFields including status → Status header has fv-sorted-asc", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ sort: "status", extraFields: [ef("status", "Status")] }),
      [makeFileCard("note", ".md", 0, undefined, [], { status: "done" })],
      container,
      "/vault",
    );
    const extraTh = container.querySelector("th.fv-th-extra");
    expect(extraTh?.classList.contains("fv-sorted-asc")).toBe(true);
    // Name header must NOT be pre-selected.
    const nameTh = container.querySelector("th.fv-th-name");
    expect(nameTh?.classList.contains("fv-sorted-asc")).toBe(false);
    expect(nameTh?.classList.contains("fv-sorted-desc")).toBe(false);
  });

  // T-19 — Clicking Status header sorts rows ascending
  it("T-19: clicking Status header sorts rows by status value ascending (empty last)", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ extraFields: [ef("status", "Status")] }),
      [
        makeFileCard("c", ".md", 0, undefined, [], { status: "done" }),
        makeFileCard("a", ".md", 0, undefined, [], { status: "" }),
        makeFileCard("b", ".md", 0, undefined, [], { status: "in-progress" }),
      ],
      container,
      "/vault",
    );
    const statusTh = container.querySelector<HTMLElement>("th.fv-th-extra")!;
    statusTh.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    const names = Array.from(container.querySelectorAll("td.fv-td-name")).map(n => n.textContent);
    // "done" < "in-progress" alphabetically; empty last.
    expect(names).toEqual(["c", "b", "a"]);
  });

  // T-20 — Clicking Status header twice sorts rows descending
  it("T-20: clicking Status header twice sorts descending (empty still last)", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ extraFields: [ef("status", "Status")] }),
      [
        makeFileCard("c", ".md", 0, undefined, [], { status: "done" }),
        makeFileCard("a", ".md", 0, undefined, [], { status: "" }),
        makeFileCard("b", ".md", 0, undefined, [], { status: "in-progress" }),
      ],
      container,
      "/vault",
    );
    const statusTh = container.querySelector<HTMLElement>("th.fv-th-extra")!;
    statusTh.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    statusTh.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    const names = Array.from(container.querySelectorAll("td.fv-td-name")).map(n => n.textContent);
    // "in-progress" > "done" desc; empty last.
    expect(names).toEqual(["b", "c", "a"]);
    expect(statusTh.classList.contains("fv-sorted-desc")).toBe(true);
  });

  // T-21 — Empty status sorts last in both directions
  it("T-21: empty status value always sorts last regardless of direction", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ extraFields: [ef("status", "Status")] }),
      [
        makeFileCard("empty", ".md", 0, undefined, [], {}),
        makeFileCard("x",     ".md", 0, undefined, [], { status: "z" }),
        makeFileCard("a",     ".md", 0, undefined, [], { status: "a" }),
      ],
      container,
      "/vault",
    );
    const statusTh = container.querySelector<HTMLElement>("th.fv-th-extra")!;

    // Ascending click.
    statusTh.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    let names = Array.from(container.querySelectorAll("td.fv-td-name")).map(n => n.textContent);
    expect(names[names.length - 1]).toBe("empty");

    // Descending click.
    statusTh.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    names = Array.from(container.querySelectorAll("td.fv-td-name")).map(n => n.textContent);
    expect(names[names.length - 1]).toBe("empty");
  });

  // T-22 — Clicking Status header clears fixed column sort indicators
  it("T-22: clicking Status header clears fv-sorted-* from Name, Type, and Modified headers", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ sort: "name-asc", showExtensions: true, showModified: true, extraFields: [ef("status", "Status")] }),
      [makeFileCard("note", ".md", 0, undefined, [], { status: "done" })],
      container,
      "/vault",
    );
    const nameTh  = container.querySelector<HTMLElement>("th.fv-th-name")!;
    const extTh   = container.querySelector<HTMLElement>("th.fv-th-ext")!;
    const modTh   = container.querySelector<HTMLElement>("th.fv-th-modified")!;
    const statusTh = container.querySelector<HTMLElement>("th.fv-th-extra")!;

    expect(nameTh.classList.contains("fv-sorted-asc")).toBe(true);

    statusTh.dispatchEvent(new MouseEvent("click", { bubbles: false }));

    expect(nameTh.classList.contains("fv-sorted-asc")).toBe(false);
    expect(nameTh.classList.contains("fv-sorted-desc")).toBe(false);
    expect(extTh.classList.contains("fv-sorted-asc")).toBe(false);
    expect(modTh.classList.contains("fv-sorted-asc")).toBe(false);
    expect(statusTh.classList.contains("fv-sorted-asc")).toBe(true);
  });

  // T-23 — Extra cell uses fv-td-extra class and data-extra-key attribute
  it("T-23: extra column cells have class fv-td-extra and data-extra-key attribute", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ extraFields: [ef("status", "Status")] }),
      [makeFileCard("note", ".md", 0, undefined, [], { status: "done" })],
      container,
      "/vault",
    );
    const td = container.querySelector("td.fv-td-extra");
    expect(td?.getAttribute("data-extra-key")).toBe("status");
  });

  // T-24 — Extra columns appear after Tags column
  it("T-24: extra columns appear after Tags column in header row", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ showTags: true, extraFields: [ef("status", "Status")] }),
      [makeFileCard("note", ".md", 0, undefined, ["tag1"], { status: "done" })],
      container,
      "/vault",
    );
    const headers = Array.from(container.querySelectorAll("th")).map(th => th.className);
    const tagsIdx  = headers.findIndex(c => c.includes("fv-th-tags"));
    const extraIdx = headers.findIndex(c => c.includes("fv-th-extra"));
    expect(tagsIdx).toBeGreaterThanOrEqual(0);
    expect(extraIdx).toBeGreaterThan(tagsIdx);
  });

  // T-25 is verified implicitly: all existing tests pass after makeConfig() gains extraFields:[].

  // EC-06 — sort key not in extraFields → falls back to name-asc behavior
  it("EC-06: sort='status' with no extraFields → no extra column, no crash, name column sorted asc", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ sort: "status", extraFields: [] }),
      [makeFileCard("z"), makeFileCard("a"), makeFileCard("m")],
      container,
      "/vault",
    );
    // No crash; name header should default because "status" is not a builtin.
    const names = Array.from(container.querySelectorAll("td.fv-td-name")).map(n => n.textContent);
    // parseSortOrder("status") falls back to col:"name", dir:"asc".
    expect(names).toEqual(["a", "m", "z"]);
    expect(container.querySelector("th.fv-th-extra")).toBeNull();
  });

  // EC-11 — HTML in value is inserted via textContent (no injection)
  it("EC-11: HTML in field value is inserted via textContent, not innerHTML", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ extraFields: [ef("status", "Status")] }),
      [makeFileCard("note", ".md", 0, undefined, [], { status: "<b>done</b>" })],
      container,
      "/vault",
    );
    const td = container.querySelector("td.fv-td-extra");
    // innerHTML should contain the escaped version, not a <b> element.
    expect(td?.querySelector("b")).toBeNull();
    expect(td?.textContent).toBe("<b>done</b>");
  });
});

describe("fields-mode rendering", () => {
  // T-10 — Column order: name then modified
  it("T-10: fields:[name,modified] → files thead: Icon, Name, Modified (in that order)", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["name", "modified"], extraFields: [] }),
      [makeFileCard("note", ".md", 1000000)],
      container,
      "/vault",
    );
    const ths = Array.from(container.querySelectorAll("thead th")).map(th => th.className);
    // No checkbox column (no BulkContext provided). ths[0] = icon.
    expect(ths[0]).toContain("fv-th-icon");
    expect(ths[1]).toContain("fv-th-name");
    expect(ths[2]).toContain("fv-th-modified");
    expect(ths.length).toBe(3); // icon + name + modified
  });

  // T-11 — Column order: modified before name
  it("T-11: fields:[modified,name] → files thead: Icon, Modified, Name (Modified before Name)", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["modified", "name"], extraFields: [] }),
      [makeFileCard("note", ".md", 1000000)],
      container,
      "/vault",
    );
    const ths = Array.from(container.querySelectorAll("thead th")).map(th => th.className);
    // No checkbox (no BulkContext). ths[0] = icon, ths[1] = modified, ths[2] = name.
    expect(ths[1]).toContain("fv-th-modified");
    expect(ths[2]).toContain("fv-th-name");
  });

  // T-12 — Custom field with value
  it("T-12: fields:[name,status] with card.meta.status='draft' → Status th and 'draft' td", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({
        fields: ["name", "status"],
        extraFields: [{ key: "status", label: "Status" }],
      }),
      [makeFileCard("note", ".md", 0, undefined, [], { status: "draft" })],
      container,
      "/vault",
    );
    const ths = Array.from(container.querySelectorAll("thead th")).map(th => th.textContent);
    expect(ths).toContain("Status");
    const extraTd = container.querySelector("td.fv-td-extra");
    expect(extraTd?.textContent).toBe("draft");
  });

  // T-13 — Custom field absent from meta → em-dash
  it("T-13: fields:[name,status] with card.meta={} → Status td shows '—'", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({
        fields: ["name", "status"],
        extraFields: [{ key: "status", label: "Status" }],
      }),
      [makeFileCard("note", ".md", 0, undefined, [], {})],
      container,
      "/vault",
    );
    const extraTd = container.querySelector("td.fv-td-extra");
    expect(extraTd?.textContent).toBe("—");
  });

  // T-14 — Absent columns
  it("T-14: fields:[name,modified] → no Tags or Type column", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["name", "modified"], extraFields: [] }),
      [makeFileCard("note", ".md", 1000000, undefined, ["tag1"])],
      container,
      "/vault",
    );
    expect(container.querySelector("th.fv-th-tags")).toBeNull();
    expect(container.querySelector("th.fv-th-ext")).toBeNull();
    expect(container.querySelector("td.fv-td-tags")).toBeNull();
    expect(container.querySelector("td.fv-td-ext")).toBeNull();
  });

  // T-15 — Name absent
  it("T-15: fields:[modified,tags] (name omitted) → no Name th in files thead", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["modified", "tags"], extraFields: [] }),
      [makeFileCard("note", ".md", 1000000, undefined, ["t1"])],
      container,
      "/vault",
    );
    expect(container.querySelector("th.fv-th-name")).toBeNull();
  });

  // T-16 — count excluded from files; present in folders
  it("T-16: fields:[name,count] → Files thead: Icon+Name only; Folders: Icon+Name+Count", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["name", "count"], extraFields: [] }),
      [makeDirCard("Sub", "/vault/Sub", false, 3), makeFileCard("note")],
      container,
      "/vault",
    );
    // Two tables — one for folders, one for files.
    const tables = container.querySelectorAll("table.fv-table");
    expect(tables.length).toBe(2);

    // Folders table (first): should have Name and Count headers.
    const foldersTheads = tables[0].querySelectorAll("th");
    const folderThTexts = Array.from(foldersTheads).map(th => th.textContent);
    expect(folderThTexts).toContain("Items"); // count → "Items"
    expect(folderThTexts).toContain("Name");

    // Files table (second): should have Name header but no Count header.
    const filesTheads = tables[1].querySelectorAll("th");
    const fileThTexts = Array.from(filesTheads).map(th => th.textContent);
    expect(fileThTexts).toContain("Name");
    expect(fileThTexts).not.toContain("Items");
  });

  // T-17 — Folders section em-dash for modified
  it("T-17: fields:[name,modified] → Folders section: Name td + em-dash td per folder row", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["name", "modified"], extraFields: [] }),
      [makeDirCard("Sub"), makeFileCard("note", ".md", 1000000)],
      container,
      "/vault",
    );
    const placeholders = container.querySelectorAll("td.fv-td-placeholder");
    expect(placeholders.length).toBeGreaterThanOrEqual(1);
    expect(placeholders[0].textContent).toBe("—");
  });

  // T-18 — Legacy mode unchanged (AC-04 / NFR-04)
  it("T-18: config.fields=null (legacy mode) → showModified+showExtensions produce same output as before", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: null, showModified: true, showExtensions: true }),
      [makeFileCard("note", ".md", 1000000, "/vault/note.md")],
      container,
      "/vault",
    );
    // Legacy columns present.
    expect(container.querySelector("th.fv-th-modified")).not.toBeNull();
    expect(container.querySelector("th.fv-th-ext")).not.toBeNull();
    expect(container.querySelector("td.fv-td-modified")).not.toBeNull();
    expect(container.querySelector("td.fv-td-ext")).not.toBeNull();
  });

  // T-19 — Custom field sort pre-selection
  it("T-19: fields:[name,status], sort:status → Status th has fv-sorted-asc; Name th has none", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({
        fields: ["name", "status"],
        sort: "status",
        extraFields: [{ key: "status", label: "Status" }],
      }),
      [makeFileCard("note", ".md", 0, undefined, [], { status: "done" })],
      container,
      "/vault",
    );
    const ths = Array.from(container.querySelectorAll("th"));
    const statusTh = ths.find(th => th.textContent === "Status");
    const nameTh   = ths.find(th => th.className.includes("fv-th-name"));
    expect(statusTh?.classList.contains("fv-sorted-asc")).toBe(true);
    expect(nameTh?.classList.contains("fv-sorted-asc")).toBe(false);
    expect(nameTh?.classList.contains("fv-sorted-desc")).toBe(false);
  });

  // T-20 — Single name column
  it("T-20: fields:[name] → files thead has only Icon + Name", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["name"], extraFields: [] }),
      [makeFileCard("note")],
      container,
      "/vault",
    );
    const ths = container.querySelectorAll("thead th");
    // No checkbox (no BulkContext). icon + name = 2 columns.
    expect(ths.length).toBe(2);
    expect(ths[1].textContent).toBe("Name");
  });

  // EC-03 — count in files → excluded, no column
  it("EC-03: count in fields for files section → excluded by resolveFields, no extra column", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["name", "count"], extraFields: [] }),
      [makeFileCard("note")],
      container,
      "/vault",
    );
    // Files section: count is filtered out. No checkbox (no BulkContext). icon + name = 2.
    const ths = container.querySelectorAll("thead th");
    expect(ths.length).toBe(2);
    expect(Array.from(ths).map(th => th.textContent)).not.toContain("Items");
  });

  // EC-04 — type and ext aliases
  it("EC-04: type and ext both produce Type column header", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["name", "type"], extraFields: [] }),
      [makeFileCard("photo", ".png", 0, "/vault/photo.png")],
      container,
      "/vault",
    );
    const ths = Array.from(container.querySelectorAll("thead th")).map(th => th.textContent);
    expect(ths).toContain("Type");
  });

  // EC-10 — no name or count in folders
  it("EC-10: fields:[status,priority] → folders rows render only icon + em-dash cells", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["status", "priority"], extraFields: [{ key: "status", label: "Status" }, { key: "priority", label: "Priority" }] }),
      [makeDirCard("Sub")],
      container,
      "/vault",
    );
    const foldersTable = container.querySelector("table.fv-table");
    const placeholders = foldersTable?.querySelectorAll("td.fv-td-placeholder");
    expect(placeholders?.length).toBe(2); // status + priority em-dashes
    // No name td present in folder rows
    expect(foldersTable?.querySelector("td.fv-td-name")).toBeNull();
  });

  // EC-14 — clearIndicators covers all fields-mode ths
  it("EC-14: clicking a header in fields mode clears sort class from all other headers", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["name", "modified", "status"], sort: "name-asc",
                   extraFields: [{ key: "status", label: "Status" }] }),
      [makeFileCard("note", ".md", 1000000, undefined, [], { status: "done" })],
      container,
      "/vault",
    );
    const ths = Array.from(container.querySelectorAll("thead th"));
    const nameTh   = ths.find(th => th.className.includes("fv-th-name"))!;
    const statusTh = ths.find(th => th.textContent === "Status")!;
    // Initial: name has fv-sorted-asc
    expect(nameTh.classList.contains("fv-sorted-asc")).toBe(true);
    // Click status header
    (statusTh as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: false }));
    expect(nameTh.classList.contains("fv-sorted-asc")).toBe(false);
    expect(statusTh.classList.contains("fv-sorted-asc")).toBe(true);
  });

  // EC-08 — show-modified:false ignored when fields: contains "modified"
  it("EC-08: show-modified:false with fields:[name,modified] → Modified column IS rendered (fields mode wins)", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["name", "modified"], showModified: false, extraFields: [] }),
      [makeFileCard("note", ".md", 1000000)],
      container,
      "/vault",
    );
    // Fields mode: Modified column must be present despite showModified=false.
    expect(container.querySelector("th.fv-th-modified")).not.toBeNull();
    expect(container.querySelector("td.fv-td-modified")).not.toBeNull();
  });

  // EC-09 — show-count:true ignored when fields: does not contain "count"
  it("EC-09: show-count:true with fields:[name,modified] → Count column NOT rendered (fields mode supersedes)", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["name", "modified"], showCount: true, extraFields: [] }),
      [makeDirCard("Sub", "/vault/Sub", false, 5)],
      container,
      "/vault",
    );
    // Fields mode: Count column must be absent despite showCount=true.
    expect(container.querySelector("th.fv-th-count")).toBeNull();
    expect(container.querySelector("td.fv-td-count")).toBeNull();
  });
});

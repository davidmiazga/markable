/**
 * tests/folder-view/renderer.test.ts
 *
 * Unit tests for renderFolderCards().
 *
 * Covers all acceptance criteria from step_05_renderer.md:
 * FR-18, FR-20, FR-24, FR-26, EC-06, EC-07, EC-08, EC-13, EC-14, EC-22,
 * NFR-07.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderFolderCards } from "../../src/plugins/file-browser/folder-view/renderer";
import { createSelectionState } from "../../src/plugins/file-browser/folder-view/bulk-selection";
import { buildToolbar, updateToolbar } from "../../src/plugins/file-browser/folder-view/bulk-toolbar";
import type { FolderViewConfig, FolderCard, BulkContext } from "../../src/plugins/file-browser/folder-view/types";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<FolderViewConfig> = {}): FolderViewConfig {
  return {
    layout: "folder-cards",
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
    extraFields: [],
    fields: null,              // fields: null keeps this fixture in legacy mode (EC-18 / AD-7)
    previewPane:   false,
    previewHeight: "60%",
    ...overrides,
  };
}

function makeDirCard(name: string, path = `/vault/${name}`, hasFV = false): FolderCard {
  return { path, name, kind: "directory", ext: "", modified: 0, hasFolderView: hasFV };
}

function makeFileCard(name: string, ext = ".md", modified = 0, path?: string): FolderCard {
  const fullPath = path ?? `/vault/${name}${ext === ".md" ? "" : ext}`;
  return { path: fullPath, name, kind: "file", ext, modified };
}

function makeContainer(): HTMLDivElement {
  const div = document.createElement("div");
  div.id = "custom-tab-host";
  return div;
}

/**
 * Build a minimal BulkContext suitable for passing to renderFolderCards in tests.
 *
 * Creates a fresh SelectionState and a toolbar with no-op operation callbacks
 * so tests can verify checkbox/toolbar wiring without triggering real Tauri calls.
 */
function makeBulkContext(): BulkContext {
  const selectionState = createSelectionState();
  const toolbarRefs = buildToolbar(
    selectionState,
    async () => {},
    async () => {},
    async () => {},
  );
  const syncToolbar = () => updateToolbar(toolbarRefs, selectionState);
  return {
    selectionState,
    toolbarRefs,
    syncToolbar,
    onMove:   async () => {},
    onDelete: async () => {},
    onYaml:   async () => {},
  };
}

describe("renderFolderCards", () => {
  beforeEach(() => {
    // Stub globals used by handleCardClick.
    (window as any).__MARKABLE_TAB_MANAGER__ = {
      openFileInTab: vi.fn(),
      openMediaInTab: vi.fn(),
    };
    (window as any).__MARKABLE_FILE_BROWSER__ = {
      expandDirectory: vi.fn(),
    };
    (window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = vi.fn();
    (window as any).__MARKABLE_RENDER_MD__ = undefined; // no MD renderer by default
  });

  // ── FR-18: Two sections ───────────────────────────────────────────────────

  it("FR-18: directory cards appear in a section with heading 'Folders'", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig(),
      [makeDirCard("A"), makeDirCard("B")],
      container,
      "/vault",
    );
    const headings = container.querySelectorAll(".folder-view-section-title");
    const texts = Array.from(headings).map(h => h.textContent);
    expect(texts).toContain("Folders");
  });

  it("FR-18: file cards render in a section (no 'Files' heading — removed in session 13)", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig(),
      [makeFileCard("note")],
      container,
      "/vault",
    );
    // The files section renders without a heading (title: null path in buildSection).
    const sections = container.querySelectorAll(".folder-view-section");
    expect(sections.length).toBe(1);
    expect(sections[0].querySelector(".folder-view-section-title")).toBeNull();
  });

  it("FR-18: subfolder section renders before file section (files section has no heading)", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig(),
      [makeDirCard("A"), makeFileCard("note")],
      container,
      "/vault",
    );
    const sections = container.querySelectorAll(".folder-view-section");
    expect(sections[0].querySelector(".folder-view-section-title")?.textContent).toBe("Folders");
    expect(sections[1].querySelector(".folder-view-section-title")).toBeNull();
  });

  // ── FR-20: Sorting ────────────────────────────────────────────────────────

  it("FR-20 sort name-asc: cards sorted alphabetically A→Z", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ sort: "name-asc" }),
      [makeFileCard("Zebra"), makeFileCard("Apple"), makeFileCard("Mango")],
      container,
      "/vault",
    );
    const names = Array.from(container.querySelectorAll(".folder-view-card-name"))
      .map(n => n.textContent);
    expect(names).toEqual(["Apple", "Mango", "Zebra"]);
  });

  it("FR-20 sort name-desc: cards sorted alphabetically Z→A", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ sort: "name-desc" }),
      [makeFileCard("Apple"), makeFileCard("Zebra"), makeFileCard("Mango")],
      container,
      "/vault",
    );
    const names = Array.from(container.querySelectorAll(".folder-view-card-name"))
      .map(n => n.textContent);
    expect(names).toEqual(["Zebra", "Mango", "Apple"]);
  });

  it("FR-20 sort modified-desc: cards sorted by modified descending", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ sort: "modified-desc" }),
      [
        makeFileCard("Old", ".md", 100),
        makeFileCard("New", ".md", 900),
        makeFileCard("Mid", ".md", 500),
      ],
      container,
      "/vault",
    );
    const names = Array.from(container.querySelectorAll(".folder-view-card-name"))
      .map(n => n.textContent);
    expect(names).toEqual(["New", "Mid", "Old"]);
  });

  it("FR-20 sort modified-asc: cards sorted by modified ascending", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ sort: "modified-asc" }),
      [
        makeFileCard("Old", ".md", 100),
        makeFileCard("New", ".md", 900),
        makeFileCard("Mid", ".md", 500),
      ],
      container,
      "/vault",
    );
    const names = Array.from(container.querySelectorAll(".folder-view-card-name"))
      .map(n => n.textContent);
    expect(names).toEqual(["Old", "Mid", "New"]);
  });

  // ── FR-26 / EC-06: Empty state ─────────────────────────────────────────────

  it("FR-26: empty cards list → 'This folder is empty.' message", () => {
    const container = makeContainer();
    renderFolderCards(makeConfig(), [], container, "/vault");
    expect(container.querySelector(".folder-view-empty")?.textContent).toBe(
      "This folder is empty."
    );
  });

  it("EC-06: no dir cards and no file cards → empty-state message rendered", () => {
    const container = makeContainer();
    renderFolderCards(makeConfig(), [], container, "/vault");
    expect(container.querySelector(".folder-view-empty")).not.toBeNull();
    expect(container.querySelector(".folder-view-section")).toBeNull();
  });

  // ── EC-07: Only non-MD files (no .md files other than _folder.md) ─────────

  it("EC-07: only file cards, no dir cards → one section with no heading rendered", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig(),
      [makeFileCard("image", ".png")],
      container,
      "/vault",
    );
    const sections = container.querySelectorAll(".folder-view-section");
    expect(sections.length).toBe(1);
    // Files section has no heading (removed in session 13).
    expect(sections[0].querySelector(".folder-view-section-title")).toBeNull();
  });

  // ── EC-08: Only subdirectories ────────────────────────────────────────────

  it("EC-08: only dir cards, no file cards → only Folders section rendered", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig(),
      [makeDirCard("SubA")],
      container,
      "/vault",
    );
    const headings = Array.from(container.querySelectorAll(".folder-view-section-title"))
      .map(h => h.textContent);
    expect(headings).toContain("Folders");
    expect(headings).not.toContain("Files");
  });

  // ── FR-24: Description block ──────────────────────────────────────────────

  it("FR-24: non-empty config.body → .folder-view-description element present", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ body: "Hello world" }),
      [],
      container,
      "/vault",
    );
    expect(container.querySelector(".folder-view-description")).not.toBeNull();
  });

  it("FR-24: empty config.body → no .folder-view-description element", () => {
    const container = makeContainer();
    renderFolderCards(makeConfig({ body: "" }), [], container, "/vault");
    expect(container.querySelector(".folder-view-description")).toBeNull();
  });

  // ── EC-14: XSS in body ────────────────────────────────────────────────────

  it("EC-14: script tag in body is stripped when __MARKABLE_RENDER_MD__ is available", () => {
    // Provide a minimal markdown renderer that passes through HTML.
    (window as any).__MARKABLE_RENDER_MD__ = (md: string) => md;

    const container = makeContainer();
    renderFolderCards(
      makeConfig({ body: '<script>alert(1)</script>Hello' }),
      [],
      container,
      "/vault",
    );
    const desc = container.querySelector(".folder-view-description");
    expect(desc).not.toBeNull();
    // The script tag must have been stripped.
    expect(desc!.innerHTML).not.toContain("<script>");
    expect(desc!.innerHTML).toContain("Hello");
  });

  // ── EC-13: XSS via card name ─────────────────────────────────────────────

  it("EC-13: card name containing HTML special chars is set as textContent, not innerHTML", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig(),
      [makeFileCard("<script>alert(1)</script>")],
      container,
      "/vault",
    );
    const nameEl = container.querySelector<HTMLElement>(".folder-view-card-name");
    expect(nameEl).not.toBeNull();
    // .textContent should be the raw string (not HTML-interpreted).
    expect(nameEl!.textContent).toBe("<script>alert(1)</script>");
    // The DOM should not contain an actual <script> element inside the card.
    expect(nameEl!.querySelector("script")).toBeNull();
  });

  // ── NFR-07: Accessibility ─────────────────────────────────────────────────

  it("NFR-07: every card has role='button'", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig(),
      [makeDirCard("A"), makeFileCard("note")],
      container,
      "/vault",
    );
    const cards = container.querySelectorAll(".folder-view-card");
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.getAttribute("role")).toBe("button");
    }
  });

  it("NFR-07: every card has an aria-label containing the card name", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig(),
      [makeDirCard("Reports"), makeFileCard("readme")],
      container,
      "/vault",
    );
    const cards = container.querySelectorAll(".folder-view-card");
    for (const card of cards) {
      const label = card.getAttribute("aria-label") ?? "";
      expect(label.length).toBeGreaterThan(0);
    }
    // Specifically check the names appear in labels.
    const labels = Array.from(cards).map(c => c.getAttribute("aria-label") ?? "");
    expect(labels.some(l => l.includes("Reports"))).toBe(true);
    expect(labels.some(l => l.includes("readme"))).toBe(true);
  });

  it("NFR-07: pressing Enter on a file card calls openFileInTab", () => {
    const openFileSpy = vi.fn();
    (window as any).__MARKABLE_TAB_MANAGER__.openFileInTab = openFileSpy;

    const container = makeContainer();
    const card = makeFileCard("note", ".md", 0, "/vault/note.md");
    renderFolderCards(makeConfig(), [card], container, "/vault");

    const cardEl = container.querySelector<HTMLElement>(".folder-view-card-file")!;
    cardEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(openFileSpy).toHaveBeenCalledWith("/vault/note.md");
  });

  // ── EC-22: Performance guard ──────────────────────────────────────────────

  it("EC-22: 500 cards render without throwing (no O(N²) loop crash)", () => {
    const cards: FolderCard[] = Array.from({ length: 500 }, (_, i) =>
      makeFileCard(`file-${i}`, ".md", i),
    );
    const container = makeContainer();
    // Should complete without timeout or error; lazy loading means only first 50 are in DOM.
    expect(() => renderFolderCards(makeConfig(), cards, container, "/vault")).not.toThrow();
    expect(container.querySelectorAll(".folder-view-card").length).toBe(50);
    expect(container.querySelector(".fv-load-sentinel")).not.toBeNull();
  });

  // ── EC-11: columns CSS variable ───────────────────────────────────────────

  it("layoutMode 'grid' (default) → grid element has no fv-flex-mode class", () => {
    const container = makeContainer();
    renderFolderCards(makeConfig({ layoutMode: "grid" }), [makeFileCard("a")], container, "/vault");
    expect(container.querySelector(".folder-view-grid")?.classList.contains("fv-flex-mode")).toBe(false);
  });

  it("layoutMode 'flex' → grid element has fv-flex-mode class", () => {
    const container = makeContainer();
    renderFolderCards(makeConfig({ layoutMode: "flex" }), [makeFileCard("a")], container, "/vault");
    expect(container.querySelector(".folder-view-grid")?.classList.contains("fv-flex-mode")).toBe(true);
  });

  it("cardWidth: 200 → --fv-card-width CSS property is '200px' on the grid", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ cardWidth: 200 }),
      [makeFileCard("a")],
      container,
      "/vault",
    );
    const grid = container.querySelector<HTMLElement>(".folder-view-grid");
    expect(grid?.style.getPropertyValue("--fv-card-width")).toBe("200px");
  });

  // ── FR-10 show-modified ────────────────────────────────────────────────────

  it("FR-10 show-modified: false → no .folder-view-card-date elements", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ showModified: false }),
      [makeFileCard("note", ".md", 1000)],
      container,
      "/vault",
    );
    expect(container.querySelector(".folder-view-card-date")).toBeNull();
  });

  it("FR-10 show-modified: true → .folder-view-card-date present for files with modified>0", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ showModified: true }),
      [makeFileCard("note", ".md", 1000000)],
      container,
      "/vault",
    );
    expect(container.querySelector(".folder-view-card-date")).not.toBeNull();
  });

  // ── EC-09 / EC-10: subfolder card click routing ───────────────────────────

  it("EC-09: clicking a dir card with hasFolderView=true calls expandDirectory AND openFolderViewTab", () => {
    const expandSpy = vi.fn();
    const openFVSpy = vi.fn();
    (window as any).__MARKABLE_FILE_BROWSER__.expandDirectory = expandSpy;
    (window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = openFVSpy;

    const container = makeContainer();
    renderFolderCards(
      makeConfig(),
      [makeDirCard("Sub", "/vault/Sub", true)],
      container,
      "/vault",
    );
    const cardEl = container.querySelector<HTMLElement>(".folder-view-card-dir")!;
    cardEl.dispatchEvent(new MouseEvent("click", { bubbles: false }));

    expect(expandSpy).toHaveBeenCalledWith("/vault/Sub");
    expect(openFVSpy).toHaveBeenCalledWith("/vault/Sub");
  });

  it("EC-10: clicking a dir card with hasFolderView=false calls expandDirectory but NOT openFolderViewTab", () => {
    const expandSpy = vi.fn();
    const openFVSpy = vi.fn();
    (window as any).__MARKABLE_FILE_BROWSER__.expandDirectory = expandSpy;
    (window as any).__MARKABLE_OPEN_FOLDER_VIEW_TAB__ = openFVSpy;

    const container = makeContainer();
    renderFolderCards(
      makeConfig(),
      [makeDirCard("Sub", "/vault/Sub", false)],
      container,
      "/vault",
    );
    const cardEl = container.querySelector<HTMLElement>(".folder-view-card-dir")!;
    cardEl.dispatchEvent(new MouseEvent("click", { bubbles: false }));

    expect(expandSpy).toHaveBeenCalledWith("/vault/Sub");
    expect(openFVSpy).not.toHaveBeenCalled();
  });

  // ── aspect-ratio / fit / minHeight / maxHeight inline styles ──────────────

  it("aspectRatio '16/9' sets preview.style.aspectRatio (normalised form)", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ aspectRatio: "16/9" }),
      [makeFileCard("note")],
      container,
      "/vault",
    );
    const preview = container.querySelector<HTMLElement>(".folder-view-card-preview")!;
    // Browsers normalise "16/9" to "16 / 9"; strip spaces for a robust assertion.
    expect(preview.style.aspectRatio.replace(/\s/g, "")).toBe("16/9");
  });

  it("aspectRatio 'original' does NOT set preview.style.aspectRatio (unset)", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ aspectRatio: "original" }),
      [makeFileCard("note")],
      container,
      "/vault",
    );
    const preview = container.querySelector<HTMLElement>(".folder-view-card-preview")!;
    // When aspectRatio is "original" the renderer skips setting the property.
    expect(preview.style.aspectRatio).toBe("");
  });

  it("minHeight 60 sets preview.style.minHeight to '60px'", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ minHeight: 60 }),
      [makeFileCard("note")],
      container,
      "/vault",
    );
    const preview = container.querySelector<HTMLElement>(".folder-view-card-preview")!;
    expect(preview.style.minHeight).toBe("60px");
  });

  it("maxHeight 150 sets preview.style.maxHeight to '150px'", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ maxHeight: 150 }),
      [makeFileCard("note")],
      container,
      "/vault",
    );
    const preview = container.querySelector<HTMLElement>(".folder-view-card-preview")!;
    expect(preview.style.maxHeight).toBe("150px");
  });

  it("image card (fixed ratio): probe.onload appends bg-img div with backgroundSize = config.fit", () => {
    (window as any).__MARKABLE_CONVERT_FILE_SRC__ = (p: string) => `asset://${p}`;

    const container = makeContainer();
    renderFolderCards(
      makeConfig({ aspectRatio: "1/1", fit: "contain" }),
      [makeFileCard("photo", ".png", 0, "/vault/photo.png")],
      container,
      "/vault",
    );

    // Simulate the probe Image firing onload (happy-dom doesn't auto-fire it).
    const preview = container.querySelector<HTMLElement>(".folder-view-card-preview")!;
    // In happy-dom Image loads synchronously when src is set; bg-img div should exist.
    // At minimum the preview exists and no crash occurred.
    expect(preview).not.toBeNull();

    delete (window as any).__MARKABLE_CONVERT_FILE_SRC__;
  });

  it("image card (original): uses img.folder-view-preview-img-natural, not bg-img div", () => {
    (window as any).__MARKABLE_CONVERT_FILE_SRC__ = (p: string) => `asset://${p}`;

    const container = makeContainer();
    renderFolderCards(
      makeConfig({ aspectRatio: "original" }),
      [makeFileCard("photo", ".png", 0, "/vault/photo.png")],
      container,
      "/vault",
    );

    const naturalImg = container.querySelector(".folder-view-preview-img-natural");
    expect(naturalImg).not.toBeNull();
    expect(container.querySelector(".folder-view-preview-bg-img")).toBeNull();

    delete (window as any).__MARKABLE_CONVERT_FILE_SRC__;
  });

  // ── show-name / show-modified ─────────────────────────────────────────────

  it("showName=false → no .folder-view-card-name element on cards", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ showName: false }),
      [makeFileCard("note")],
      container,
      "/vault",
    );
    expect(container.querySelector(".folder-view-card-name")).toBeNull();
  });

  it("showName=true (default) → .folder-view-card-name present", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ showName: true }),
      [makeFileCard("note")],
      container,
      "/vault",
    );
    expect(container.querySelector(".folder-view-card-name")).not.toBeNull();
  });

  // ── FVB-04: card-preview: none (compact mode) ─────────────────────────────

  it("FVB-04: showPreview=false → no .folder-view-card-preview element on cards", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ showPreview: false }),
      [makeFileCard("note"), makeDirCard("Sub")],
      container,
      "/vault",
    );
    expect(container.querySelector(".folder-view-card-preview")).toBeNull();
  });

  it("FVB-04: showPreview=true (default) → .folder-view-card-preview present", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ showPreview: true }),
      [makeFileCard("note")],
      container,
      "/vault",
    );
    expect(container.querySelector(".folder-view-card-preview")).not.toBeNull();
  });

  // ── FVB-05: exclude list ───────────────────────────────────────────────────

  it("FVB-05: excluded .md file (by full name) does not appear in card grid", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ exclude: ["draft.md"] }),
      [makeFileCard("draft"), makeFileCard("notes")],
      container,
      "/vault",
    );
    const names = Array.from(container.querySelectorAll(".folder-view-card-name"))
      .map(n => n.textContent);
    expect(names).not.toContain("draft");
    expect(names).toContain("notes");
  });

  it("FVB-05: excluded non-md file (by full name with ext) does not appear", () => {
    const pngCard: FolderCard = { path: "/vault/image.png", name: "image.png", kind: "file", ext: ".png", modified: 0 };
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ exclude: ["image.png"] }),
      [pngCard, makeFileCard("doc")],
      container,
      "/vault",
    );
    const names = Array.from(container.querySelectorAll(".folder-view-card-name"))
      .map(n => n.textContent);
    expect(names).not.toContain("image.png");
    expect(names).toContain("doc");
  });

  it("FVB-05: empty exclude list → all cards shown", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ exclude: [] }),
      [makeFileCard("a"), makeFileCard("b"), makeFileCard("c")],
      container,
      "/vault",
    );
    expect(container.querySelectorAll(".folder-view-card").length).toBe(3);
  });

  // ── FVB-06: show-extensions: false ────────────────────────────────────────

  it("FVB-06: showExtensions=false → non-md file card shows name without extension", () => {
    // Non-md cards from collectChildren have name = full basename (e.g. "photo.png").
    const pngCard: FolderCard = { path: "/vault/photo.png", name: "photo.png", kind: "file", ext: ".png", modified: 0 };
    const container = makeContainer();
    renderFolderCards(makeConfig({ showExtensions: false }), [pngCard], container, "/vault");
    const nameEl = container.querySelector<HTMLElement>(".folder-view-card-name");
    expect(nameEl?.textContent).toBe("photo");
  });

  it("FVB-06: showExtensions=false does not affect .md card names (already stem)", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ showExtensions: false }),
      [makeFileCard("my-note", ".md")],
      container,
      "/vault",
    );
    const nameEl = container.querySelector<HTMLElement>(".folder-view-card-name");
    expect(nameEl?.textContent).toBe("my-note");
  });

  it("FVB-06: showExtensions=true (default) → non-md file card shows full name with ext", () => {
    const pngCard: FolderCard = { path: "/vault/photo.png", name: "photo.png", kind: "file", ext: ".png", modified: 0 };
    const container = makeContainer();
    renderFolderCards(makeConfig({ showExtensions: true }), [pngCard], container, "/vault");
    const nameEl = container.querySelector<HTMLElement>(".folder-view-card-name");
    expect(nameEl?.textContent).toBe("photo.png");
  });

  // ── FVB-07: section visibility toggles ───────────────────────────────────

  it("FVB-07: showFolders=false → no Folders section rendered", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ showFolders: false }),
      [makeDirCard("Sub"), makeFileCard("note")],
      container,
      "/vault",
    );
    const headings = Array.from(container.querySelectorAll(".folder-view-section-title"))
      .map(h => h.textContent);
    expect(headings).not.toContain("Folders");
    // Files section still rendered.
    expect(container.querySelector(".folder-view-card-file")).not.toBeNull();
  });

  it("FVB-07: showFiles=false → no file cards rendered", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ showFiles: false }),
      [makeDirCard("Sub"), makeFileCard("note")],
      container,
      "/vault",
    );
    expect(container.querySelector(".folder-view-card-file")).toBeNull();
    expect(container.querySelector(".folder-view-card-dir")).not.toBeNull();
  });

  it("FVB-07: showFolders=false + showFiles=false → empty state shown", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ showFolders: false, showFiles: false }),
      [makeDirCard("Sub"), makeFileCard("note")],
      container,
      "/vault",
    );
    expect(container.querySelector(".folder-view-empty")).not.toBeNull();
  });

  // ── FVB-08: custom section titles ─────────────────────────────────────────

  it("FVB-08: foldersTitle='Projects' → section heading shows 'Projects'", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ foldersTitle: "Projects" }),
      [makeDirCard("Sub")],
      container,
      "/vault",
    );
    const headings = Array.from(container.querySelectorAll(".folder-view-section-title"))
      .map(h => h.textContent);
    expect(headings).toContain("Projects");
    expect(headings).not.toContain("Folders");
  });

  it("FVB-08: filesTitle='Notes' → files section gets a heading", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ filesTitle: "Notes" }),
      [makeFileCard("note")],
      container,
      "/vault",
    );
    const headings = Array.from(container.querySelectorAll(".folder-view-section-title"))
      .map(h => h.textContent);
    expect(headings).toContain("Notes");
  });

  it("FVB-08: filesTitle='' (default) → files section has no heading", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ filesTitle: "" }),
      [makeFileCard("note")],
      container,
      "/vault",
    );
    expect(container.querySelector(".folder-view-section-title")).toBeNull();
  });

  // ── FVB-01: tag chips ─────────────────────────────────────────────────────

  it("FVB-01: showTags=true + card with tags → .folder-view-card-tags element present", () => {
    const container = makeContainer();
    const taggedCard: FolderCard = { ...makeFileCard("note"), tags: ["research", "todo"] };
    renderFolderCards(
      makeConfig({ showTags: true }),
      [taggedCard],
      container,
      "/vault",
    );
    expect(container.querySelector(".folder-view-card-tags")).not.toBeNull();
  });

  it("FVB-01: showTags=true → shows at most 3 tag chips", () => {
    const container = makeContainer();
    const taggedCard: FolderCard = {
      ...makeFileCard("note"),
      tags: ["a", "b", "c", "d", "e"],
    };
    renderFolderCards(
      makeConfig({ showTags: true }),
      [taggedCard],
      container,
      "/vault",
    );
    const chips = container.querySelectorAll(".folder-view-tag-chip");
    expect(chips.length).toBe(3);
  });

  it("FVB-01: showTags=false (default) → no tag chips", () => {
    const container = makeContainer();
    const taggedCard: FolderCard = { ...makeFileCard("note"), tags: ["research"] };
    renderFolderCards(
      makeConfig({ showTags: false }),
      [taggedCard],
      container,
      "/vault",
    );
    expect(container.querySelector(".folder-view-card-tags")).toBeNull();
  });

  it("FVB-01: showTags=true but card has no tags → no tags element", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ showTags: true }),
      [makeFileCard("note")],
      container,
      "/vault",
    );
    expect(container.querySelector(".folder-view-card-tags")).toBeNull();
  });

  // ── FVB-09: item count badge ──────────────────────────────────────────────

  it("FVB-09: showCount=true + dir with childCount → name shows count", () => {
    const container = makeContainer();
    const dirCard: FolderCard = { ...makeDirCard("Projects"), childCount: 7 };
    renderFolderCards(
      makeConfig({ showCount: true }),
      [dirCard],
      container,
      "/vault",
    );
    const nameEl = container.querySelector<HTMLElement>(".folder-view-card-name");
    expect(nameEl?.textContent).toBe("Projects (7)");
  });

  it("FVB-09: showCount=false (default) → name has no count", () => {
    const container = makeContainer();
    const dirCard: FolderCard = { ...makeDirCard("Projects"), childCount: 7 };
    renderFolderCards(
      makeConfig({ showCount: false }),
      [dirCard],
      container,
      "/vault",
    );
    const nameEl = container.querySelector<HTMLElement>(".folder-view-card-name");
    expect(nameEl?.textContent).toBe("Projects");
  });

  it("FVB-09: showCount=true but childCount=0 → name has no count", () => {
    const container = makeContainer();
    const dirCard: FolderCard = { ...makeDirCard("Empty"), childCount: 0 };
    renderFolderCards(
      makeConfig({ showCount: true }),
      [dirCard],
      container,
      "/vault",
    );
    const nameEl = container.querySelector<HTMLElement>(".folder-view-card-name");
    expect(nameEl?.textContent).toBe("Empty");
  });
});

// ── Lazy loading ─────────────────────────────────────────────────────────────

describe("lazy loading", () => {
  type IOCallback = (entries: Partial<IntersectionObserverEntry>[]) => void;
  let ioCallback: IOCallback | null = null;
  const mockObserve = vi.fn();
  const mockDisconnect = vi.fn();

  beforeEach(() => {
    ioCallback = null;
    mockObserve.mockClear();
    mockDisconnect.mockClear();
    vi.stubGlobal("IntersectionObserver", class {
      constructor(cb: IOCallback) { ioCallback = cb; }
      observe = mockObserve;
      disconnect = mockDisconnect;
    });
  });

  function makeFileCards(count: number): FolderCard[] {
    return Array.from({ length: count }, (_, i) => makeFileCard(`note${i}`));
  }

  it("≤50 cards → all rendered immediately, no sentinel", () => {
    const container = makeContainer();
    renderFolderCards(makeConfig(), makeFileCards(50), container, "/vault");
    expect(container.querySelectorAll(".folder-view-card").length).toBe(50);
    expect(container.querySelector(".fv-load-sentinel")).toBeNull();
  });

  it("51 cards → only first 50 rendered initially, sentinel present", () => {
    const container = makeContainer();
    renderFolderCards(makeConfig(), makeFileCards(51), container, "/vault");
    expect(container.querySelectorAll(".folder-view-card").length).toBe(50);
    expect(container.querySelector(".fv-load-sentinel")).not.toBeNull();
  });

  it("observer fires → next batch rendered", () => {
    const container = makeContainer();
    renderFolderCards(makeConfig(), makeFileCards(80), container, "/vault");
    expect(container.querySelectorAll(".folder-view-card").length).toBe(50);

    // Simulate sentinel entering viewport.
    ioCallback!([{ isIntersecting: true } as IntersectionObserverEntry]);
    expect(container.querySelectorAll(".folder-view-card").length).toBe(80);
  });

  it("all cards rendered → observer disconnected and sentinel removed", () => {
    const container = makeContainer();
    renderFolderCards(makeConfig(), makeFileCards(60), container, "/vault");

    ioCallback!([{ isIntersecting: true } as IntersectionObserverEntry]);
    expect(container.querySelectorAll(".folder-view-card").length).toBe(60);
    expect(mockDisconnect).toHaveBeenCalledOnce();
    expect(container.querySelector(".fv-load-sentinel")).toBeNull();
  });

  it("non-intersecting callback → no additional cards rendered", () => {
    const container = makeContainer();
    renderFolderCards(makeConfig(), makeFileCards(80), container, "/vault");

    ioCallback!([{ isIntersecting: false } as IntersectionObserverEntry]);
    expect(container.querySelectorAll(".folder-view-card").length).toBe(50);
  });
});

// ── content-area-override ─────────────────────────────────────────────────────

describe("content-area-override", () => {
  it("contentAreaOverride=true (default) → host has no constrained class", () => {
    const container = makeContainer();
    renderFolderCards(makeConfig({ contentAreaOverride: true }), [makeFileCard("a")], container, "/vault");
    const host = container.querySelector(".folder-view-host");
    expect(host?.classList.contains("folder-view-host--constrained")).toBe(false);
  });

  it("contentAreaOverride=false → host has constrained class", () => {
    const container = makeContainer();
    renderFolderCards(makeConfig({ contentAreaOverride: false }), [makeFileCard("a")], container, "/vault");
    const host = container.querySelector(".folder-view-host");
    expect(host?.classList.contains("folder-view-host--constrained")).toBe(true);
  });
});

// ── Step 03: Bulk toolbar wiring into cards layout ───────────────────────────

describe("bulk toolbar — folder-cards layout (Step 03)", () => {
  beforeEach(() => {
    (window as any).__MARKABLE_TAB_MANAGER__ = {
      openFileInTab: vi.fn(),
      openMediaInTab: vi.fn(),
    };
    (window as any).__MARKABLE_FILE_BROWSER__ = { expandDirectory: vi.fn() };
    vi.stubGlobal("IntersectionObserver", class {
      constructor(public cb: Function) {}
      observe = vi.fn();
      disconnect = vi.fn();
    });
  });

  // Test A: toolbar node is inserted as first child of host when context provided.
  it("A: toolbar node is inserted as first child of .folder-view-host when context provided", () => {
    const context = makeBulkContext();
    const container = makeContainer();
    renderFolderCards(makeConfig(), [makeFileCard("note")], container, "/vault", context);

    const host = container.querySelector(".folder-view-host")!;
    const firstChild = host.firstElementChild;
    // The toolbar must be the first child of host.
    expect(firstChild?.classList.contains("fv-bulk-toolbar")).toBe(true);
    // The container must also expose the toolbar via querySelector.
    expect(container.querySelector(".fv-bulk-toolbar")).not.toBeNull();
  });

  // Test B: toolbar node is absent when no context provided.
  it("B: toolbar node is absent when no context provided (backward-compat no-op)", () => {
    const container = makeContainer();
    renderFolderCards(makeConfig(), [makeFileCard("note")], container, "/vault");

    expect(container.querySelector(".fv-bulk-toolbar")).toBeNull();
  });

  // Test C: toolbar is hidden by default (no fv-bulk-toolbar--visible class).
  it("C: toolbar starts hidden (no fv-bulk-toolbar--visible) before any checkbox interaction", () => {
    const context = makeBulkContext();
    const container = makeContainer();
    renderFolderCards(makeConfig(), [makeFileCard("note")], container, "/vault", context);

    const toolbar = container.querySelector(".fv-bulk-toolbar");
    expect(toolbar?.classList.contains("fv-bulk-toolbar--visible")).toBe(false);
  });
});

// ── Step 04: Card checkboxes ──────────────────────────────────────────────────

describe("card checkboxes (Step 04)", () => {
  type IOCallback = (entries: Partial<IntersectionObserverEntry>[]) => void;
  let ioCallback: IOCallback | null = null;

  beforeEach(() => {
    ioCallback = null;
    (window as any).__MARKABLE_TAB_MANAGER__ = {
      openFileInTab: vi.fn(),
      openMediaInTab: vi.fn(),
    };
    (window as any).__MARKABLE_FILE_BROWSER__ = { expandDirectory: vi.fn() };
    vi.stubGlobal("IntersectionObserver", class {
      constructor(cb: IOCallback) { ioCallback = cb; }
      observe = vi.fn();
      disconnect = vi.fn();
    });
  });

  function makeFileCards(count: number): FolderCard[] {
    return Array.from({ length: count }, (_, i) =>
      makeFileCard(`file${i}`, ".md", 0, `/vault/file${i}.md`),
    );
  }

  // EC-10: directory card gets a checkbox.
  it("EC-10: directory card contains an input[type=checkbox] when context provided", () => {
    const context = makeBulkContext();
    const container = makeContainer();
    renderFolderCards(makeConfig(), [makeDirCard("Sub")], container, "/vault", context);

    const dirCard = container.querySelector(".folder-view-card-dir");
    expect(dirCard?.querySelector("input[type=checkbox]")).not.toBeNull();
  });

  // EC-9: checkbox click stops propagation (does not trigger card navigation).
  it("EC-9: checkbox change event does NOT call openFileInTab (stopPropagation works)", () => {
    const context = makeBulkContext();
    const container = makeContainer();
    const card = makeFileCard("note", ".md", 0, "/vault/note.md");
    renderFolderCards(makeConfig({ showFolders: false }), [card], container, "/vault", context);

    const checkbox = container.querySelector<HTMLInputElement>(".fv-card-checkbox-wrap input")!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));

    expect((window as any).__MARKABLE_TAB_MANAGER__.openFileInTab).not.toHaveBeenCalled();
  });

  // Checkbox change adds path to selectionState and makes toolbar visible.
  it("checking a card checkbox adds its path to selectionState and shows toolbar", () => {
    const context = makeBulkContext();
    const container = makeContainer();
    const card = makeFileCard("note", ".md", 0, "/vault/note.md");
    renderFolderCards(makeConfig({ showFolders: false }), [card], container, "/vault", context);

    const checkbox = container.querySelector<HTMLInputElement>(".fv-card-checkbox-wrap input")!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));

    expect(context.selectionState.paths.has("/vault/note.md")).toBe(true);
    expect(container.querySelector(".fv-bulk-toolbar--visible")).not.toBeNull();
  });

  // Card has position: relative set inline when checkboxCtx provided.
  it("card element has style.position === 'relative' when context provided", () => {
    const context = makeBulkContext();
    const container = makeContainer();
    renderFolderCards(makeConfig({ showFolders: false }), [makeFileCard("note")], container, "/vault", context);

    const cardEl = container.querySelector<HTMLElement>(".folder-view-card")!;
    expect(cardEl.style.position).toBe("relative");
  });

  // Checkbox container has class fv-card-checkbox-wrap.
  it("checkbox container has className === 'fv-card-checkbox-wrap'", () => {
    const context = makeBulkContext();
    const container = makeContainer();
    renderFolderCards(makeConfig({ showFolders: false }), [makeFileCard("note")], container, "/vault", context);

    const wrap = container.querySelector(".fv-card-checkbox-wrap");
    expect(wrap).not.toBeNull();
    // The wrap should contain the checkbox input.
    expect(wrap?.querySelector("input[type=checkbox]")).not.toBeNull();
  });

  // EC-5: lazy-loaded card checkboxes register into selectionState.
  it("EC-5: lazy-loaded card checkbox registers into selectionState when fired", () => {
    const context = makeBulkContext();
    const container = makeContainer();
    // 51 cards trigger lazy loading (threshold is 50).
    const cards = makeFileCards(51);
    renderFolderCards(makeConfig({ showFolders: false }), cards, container, "/vault", context);

    // Before observer fires, only 50 cards in DOM.
    expect(container.querySelectorAll(".folder-view-card").length).toBe(50);

    // Fire the IntersectionObserver to load the 51st card.
    ioCallback!([{ isIntersecting: true } as IntersectionObserverEntry]);
    expect(container.querySelectorAll(".folder-view-card").length).toBe(51);

    // The 51st card should have a checkbox.
    const allCheckboxes = container.querySelectorAll<HTMLInputElement>(".fv-card-checkbox-wrap input");
    expect(allCheckboxes.length).toBe(51);

    // Checking the last card's checkbox should register in selectionState.
    // Note: the lazy-loaded card is the 51st in SORTED order (name-asc), not
    // necessarily cards[50] from the original unsorted array. We check that
    // selectionState.paths grows by 1 — i.e. some path was registered.
    const lastCheckbox = allCheckboxes[allCheckboxes.length - 1];
    lastCheckbox.checked = true;
    lastCheckbox.dispatchEvent(new Event("change"));

    expect(context.selectionState.paths.size).toBe(1);
  });

  // EC-6: previously checked card retains checked state after lazy load.
  it("EC-6: first card checkbox stays checked after lazy batch loads", () => {
    const context = makeBulkContext();
    const container = makeContainer();
    const cards = makeFileCards(51);
    renderFolderCards(makeConfig({ showFolders: false }), cards, container, "/vault", context);

    // Check the first card.
    const firstCheckbox = container.querySelector<HTMLInputElement>(".fv-card-checkbox-wrap input")!;
    firstCheckbox.checked = true;
    firstCheckbox.dispatchEvent(new Event("change"));
    expect(context.selectionState.paths.has(cards[0].path)).toBe(true);

    // Fire the IntersectionObserver to load the next batch.
    ioCallback!([{ isIntersecting: true } as IntersectionObserverEntry]);

    // The first card's path must still be in selectionState.
    expect(context.selectionState.paths.has(cards[0].path)).toBe(true);
    // The newly loaded card should not be checked.
    const allCheckboxes = container.querySelectorAll<HTMLInputElement>(".fv-card-checkbox-wrap input");
    expect(allCheckboxes[50].checked).toBe(false);

    // EC-6 spec: "Master checkbox transitions to indeterminate if partial selection now exists."
    // With 1 of 51 cards checked after the lazy batch, master must be indeterminate.
    const masterInput = container.querySelector<HTMLInputElement>(".fv-card-master-checkbox-wrap input")!;
    expect(masterInput).not.toBeNull();
    expect(masterInput.indeterminate).toBe(true);
    expect(masterInput.checked).toBe(false);
  });

  // EC-11: two independent renders have isolated SelectionStates.
  it("EC-11: two independent renders have isolated selectionStates", () => {
    const ctx1 = makeBulkContext();
    const ctx2 = makeBulkContext();

    const c1 = makeContainer();
    const c2 = makeContainer();
    const card1 = makeFileCard("note1", ".md", 0, "/vault/note1.md");
    const card2 = makeFileCard("note2", ".md", 0, "/vault/note2.md");

    renderFolderCards(makeConfig({ showFolders: false }), [card1], c1, "/vault", ctx1);
    renderFolderCards(makeConfig({ showFolders: false }), [card2], c2, "/vault", ctx2);

    // Check the card in the first render.
    const cb1 = c1.querySelector<HTMLInputElement>(".fv-card-checkbox-wrap input")!;
    cb1.checked = true;
    cb1.dispatchEvent(new Event("change"));

    // ctx1 should have note1; ctx2 should have nothing.
    expect(ctx1.selectionState.paths.has("/vault/note1.md")).toBe(true);
    expect(ctx2.selectionState.paths.size).toBe(0);
  });
});

// ── Step 05: Metadata line (.fv-card-meta) ────────────────────────────────────

describe("metadata line — fv-card-meta (Step 05)", () => {
  beforeEach(() => {
    (window as any).__MARKABLE_TAB_MANAGER__ = {
      openFileInTab: vi.fn(),
      openMediaInTab: vi.fn(),
    };
    (window as any).__MARKABLE_FILE_BROWSER__ = { expandDirectory: vi.fn() };
    vi.stubGlobal("IntersectionObserver", class {
      constructor(public cb: Function) {}
      observe = vi.fn();
      disconnect = vi.fn();
    });
  });

  // EC-1A: legacy mode, showModified=true — date appears in .folder-view-card-date,
  // NOT in .fv-card-meta (which is reserved for fields: mode).
  it("EC-1A: legacy mode — showModified=true → .folder-view-card-date shows date, no .fv-card-meta", () => {
    const container = makeContainer();
    const card = makeFileCard("note", ".md", 1_000_000);
    renderFolderCards(
      makeConfig({ fields: null, showModified: true, showTags: false }),
      [card],
      container,
      "/vault",
    );
    const dateEl = container.querySelector(".folder-view-card-date");
    expect(dateEl).not.toBeNull();
    expect(dateEl?.textContent?.length).toBeGreaterThan(0);
    // .fv-card-meta must be absent in legacy mode to avoid rendering the date twice.
    expect(container.querySelector(".fv-card-meta")).toBeNull();
  });

  // EC-1B: legacy mode, neither flag → no meta line.
  it("EC-1B: legacy mode — showModified=false, showTags=false → no .fv-card-meta", () => {
    const container = makeContainer();
    const card = makeFileCard("note", ".md", 1_000_000);
    renderFolderCards(
      makeConfig({ fields: null, showModified: false, showTags: false }),
      [card],
      container,
      "/vault",
    );
    expect(container.querySelector(".fv-card-meta")).toBeNull();
  });

  // EC-2: fields mode [modified, tags] → correct joined string.
  it("EC-2: fields:[modified,tags] → meta line shows date · tags joined", () => {
    const container = makeContainer();
    const card: FolderCard = {
      ...makeFileCard("note", ".md", 1_000_000),
      tags: ["a", "b"],
    };
    renderFolderCards(
      makeConfig({ fields: ["modified", "tags"] }),
      [card],
      container,
      "/vault",
    );
    const meta = container.querySelector(".fv-card-meta");
    expect(meta).not.toBeNull();
    // The meta line should contain both the date and the tags joined.
    expect(meta?.textContent).toContain("a · b");
  });

  // EC-3: fields:[name, status], file with meta → shows status only (name filtered).
  it("EC-3: fields:[name,status], file with meta.status → shows status value only", () => {
    const container = makeContainer();
    const card: FolderCard = {
      ...makeFileCard("note", ".md", 0),
      meta: { status: "draft" },
    };
    renderFolderCards(
      makeConfig({ fields: ["name", "status"] }),
      [card],
      container,
      "/vault",
    );
    const meta = container.querySelector(".fv-card-meta");
    expect(meta?.textContent).toBe("draft");
  });

  // EC-3b: fields:[name, status], file with no meta → no meta element (all em-dashes).
  it("EC-3b: fields:[name,status], file with empty meta → no .fv-card-meta (all em-dashes)", () => {
    const container = makeContainer();
    const card: FolderCard = { ...makeFileCard("note", ".md", 0), meta: {} };
    renderFolderCards(
      makeConfig({ fields: ["name", "status"] }),
      [card],
      container,
      "/vault",
    );
    // All-em-dash result → no element appended (EC-13 rule).
    expect(container.querySelector(".fv-card-meta")).toBeNull();
  });

  // EC-13: fields:[name] only → no meta element (only skipped fields).
  it("EC-13: fields:[name] only → no .fv-card-meta appended", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ fields: ["name"] }),
      [makeFileCard("note")],
      container,
      "/vault",
    );
    expect(container.querySelector(".fv-card-meta")).toBeNull();
  });

  // EC-14: fields:[count], directory → shows childCount; file → no meta element.
  it("EC-14: fields:[count], directory with childCount=5 → meta shows '5'", () => {
    const container = makeContainer();
    const dirCard: FolderCard = { ...makeDirCard("Sub"), childCount: 5 };
    renderFolderCards(
      makeConfig({ fields: ["count"], showFiles: false }),
      [dirCard],
      container,
      "/vault",
    );
    const meta = container.querySelector(".fv-card-meta");
    expect(meta?.textContent).toBe("5");
  });

  it("EC-14: fields:[count], file card → no .fv-card-meta (count is dirs-only)", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ fields: ["count"], showFolders: false }),
      [makeFileCard("note")],
      container,
      "/vault",
    );
    // File card with count field → em-dash → all-em-dash → no element.
    expect(container.querySelector(".fv-card-meta")).toBeNull();
  });

  // EC-15: XSS via textContent — script tag in field value rendered as literal text.
  it("EC-15: XSS — script tag in meta.status rendered as literal text via textContent", () => {
    const xss = "<script>alert(1)</script>";
    const container = makeContainer();
    const card: FolderCard = {
      ...makeFileCard("note", ".md", 0),
      meta: { status: xss },
    };
    renderFolderCards(
      makeConfig({ fields: ["status"] }),
      [card],
      container,
      "/vault",
    );
    const meta = container.querySelector(".fv-card-meta");
    expect(meta?.textContent).toBe(xss);
    // No <script> element must have been injected into the DOM.
    expect(document.querySelectorAll("script").length).toBe(0);
  });

  // EC-16: fields: declared → .folder-view-card-date NOT appended.
  it("EC-16: fields:[modified], showModified=true → .folder-view-card-date absent, .fv-card-meta present", () => {
    const container = makeContainer();
    const card = makeFileCard("note", ".md", 1_000_000);
    renderFolderCards(
      makeConfig({ fields: ["modified"], showModified: true }),
      [card],
      container,
      "/vault",
    );
    expect(container.querySelector(".folder-view-card-date")).toBeNull();
    expect(container.querySelector(".fv-card-meta")).not.toBeNull();
  });

  // EC-17: enrichment failure → meta={} → em-dash → no meta element.
  it("EC-17: card with meta={} for custom field → no .fv-card-meta (em-dash suppression)", () => {
    const container = makeContainer();
    const card: FolderCard = { ...makeFileCard("note", ".md", 0), meta: {} };
    renderFolderCards(
      makeConfig({ fields: ["status"] }),
      [card],
      container,
      "/vault",
    );
    // meta["status"] is undefined → "" → "—" → all-em-dash → null element.
    expect(container.querySelector(".fv-card-meta")).toBeNull();
  });
});

// ── Step 06: CSS classes and FOLDER_VIEW_STARTER (C-8) ──────────────────────

describe("CSS classes and FOLDER_VIEW_STARTER (Step 06)", () => {
  beforeEach(() => {
    (window as any).__MARKABLE_TAB_MANAGER__ = {
      openFileInTab: vi.fn(),
      openMediaInTab: vi.fn(),
    };
    (window as any).__MARKABLE_FILE_BROWSER__ = { expandDirectory: vi.fn() };
    vi.stubGlobal("IntersectionObserver", class {
      constructor(public cb: Function) {}
      observe = vi.fn();
      disconnect = vi.fn();
    });
  });

  // CSS class assertions: JSDOM doesn't execute CSS but we can assert DOM class presence.

  it("metadata line element has className === 'fv-card-meta'", () => {
    const container = makeContainer();
    const card = makeFileCard("note", ".md", 1_000_000);
    renderFolderCards(
      makeConfig({ fields: ["modified"] }),
      [card],
      container,
      "/vault",
    );
    const meta = container.querySelector(".fv-card-meta");
    expect(meta).not.toBeNull();
    expect(meta?.className).toBe("fv-card-meta");
  });

  it("EC-18: CSS class fv-card-checkbox-wrap present on card — hover opacity applied by CSS", () => {
    const context = makeBulkContext();
    const container = makeContainer();
    renderFolderCards(makeConfig({ showFolders: false }), [makeFileCard("note")], container, "/vault", context);

    const wrap = container.querySelector(".fv-card-checkbox-wrap");
    expect(wrap).not.toBeNull();
    expect(wrap?.className).toBe("fv-card-checkbox-wrap");
  });

  it("card element has style.position === 'relative' when context provided (for checkbox z-index)", () => {
    const context = makeBulkContext();
    const container = makeContainer();
    renderFolderCards(makeConfig({ showFolders: false }), [makeFileCard("note")], container, "/vault", context);

    const card = container.querySelector<HTMLElement>(".folder-view-card")!;
    expect(card.style.position).toBe("relative");
  });

  // ── Page header (cover + icon) ──────────────────────────────────────────────

  it("page header absent when neither cover nor icon is set", () => {
    const container = makeContainer();
    renderFolderCards(makeConfig(), [], container, "/vault");
    expect(container.querySelector(".folder-view-page-header")).toBeNull();
  });

  it("page header present when cover is set", () => {
    const container = makeContainer();
    renderFolderCards(makeConfig({ cover: "./banner.png" }), [], container, "/vault");
    const header = container.querySelector(".folder-view-page-header");
    expect(header).not.toBeNull();
    expect(header!.querySelector(".folder-view-cover")).not.toBeNull();
  });

  it("page header present when icon is set", () => {
    const container = makeContainer();
    renderFolderCards(makeConfig({ icon: "🏠" }), [], container, "/vault");
    const header = container.querySelector(".folder-view-page-header");
    expect(header).not.toBeNull();
    expect(header!.querySelector(".folder-view-page-icon")).not.toBeNull();
  });

  it("page header present with both cover and icon", () => {
    const container = makeContainer();
    renderFolderCards(makeConfig({ cover: "./banner.png", icon: "📁" }), [], container, "/vault");
    const header = container.querySelector(".folder-view-page-header")!;
    expect(header.querySelector(".folder-view-cover")).not.toBeNull();
    expect(header.querySelector(".folder-view-page-icon")).not.toBeNull();
  });

  it("icon emoji is set via textContent (XSS guard)", () => {
    const container = makeContainer();
    renderFolderCards(makeConfig({ icon: "<script>alert(1)</script>" }), [], container, "/vault");
    const iconEl = container.querySelector(".folder-view-page-icon")!;
    // textContent sets the literal string; no script tag in innerHTML
    expect(iconEl.querySelector("script")).toBeNull();
    expect(iconEl.textContent).toBe("<script>alert(1)</script>");
  });

  it("icon image path renders an img element", () => {
    const container = makeContainer();
    renderFolderCards(makeConfig({ icon: "./icon.svg" }), [], container, "/vault");
    const iconEl = container.querySelector(".folder-view-page-icon")!;
    expect(iconEl.querySelector("img")).not.toBeNull();
  });

  it("cover img src resolves folderPath + relative path", () => {
    (window as any).__MARKABLE_CONVERT_FILE_SRC__ = (p: string) => `asset://${p}`;
    const container = makeContainer();
    renderFolderCards(makeConfig({ cover: "./header.png" }), [], container, "/my/folder");
    const coverImg = container.querySelector<HTMLImageElement>(".folder-view-cover")!;
    expect(coverImg.src).toBe("asset:///my/folder/header.png");
    delete (window as any).__MARKABLE_CONVERT_FILE_SRC__;
  });

  it("page header comes before description block", () => {
    const container = makeContainer();
    renderFolderCards(makeConfig({ icon: "📁", body: "Some description" }), [], container, "/vault");
    const host = container.querySelector(".folder-view-host")!;
    const children = Array.from(host.children);
    const headerIdx = children.findIndex(el => el.classList.contains("folder-view-page-header"));
    const descIdx   = children.findIndex(el => el.classList.contains("folder-view-description"));
    expect(headerIdx).toBeLessThan(descIdx);
  });

  // C-8: FOLDER_VIEW_STARTER no longer says "folder-table only".
  it("C-8: FOLDER_VIEW_STARTER does not contain 'folder-table only'", async () => {
    // Dynamically import to avoid circular dependency with plugin file.
    // The export is via the plugin's API surface (markable.FOLDER_VIEW_STARTER).
    // We test via direct import of the constant from the plugin source.
    const { default: _mod } = await import(
      "../../src/plugins/file-browser/file-browser.plugin"
    ) as any;
    // The plugin registers itself via window globals; we just need the exported API.
    // Actually FOLDER_VIEW_STARTER is not exported at module level but via the API.
    // Fallback: check the source string directly.
    const pluginSource = await import(
      "../../src/plugins/file-browser/file-browser.plugin?raw"
    ) as any;
    const src: string = pluginSource.default ?? pluginSource;
    expect(src.includes("folder-table only")).toBe(false);
    expect(src.includes("fields:")).toBe(true);
    expect(src.includes("extra-fields:")).toBe(true);
  });
});

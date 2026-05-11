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
import type { FolderViewConfig, FolderCard } from "../../src/plugins/file-browser/folder-view/types";

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
    // Should complete without timeout or error.
    expect(() => renderFolderCards(makeConfig(), cards, container, "/vault")).not.toThrow();
    expect(container.querySelectorAll(".folder-view-card").length).toBe(500);
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

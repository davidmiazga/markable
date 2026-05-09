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
    columns: 3,
    showModified: true,
    body: "",
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

  it("FR-18: file cards appear in a section with heading 'Files'", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig(),
      [makeFileCard("note")],
      container,
      "/vault",
    );
    const headings = container.querySelectorAll(".folder-view-section-title");
    const texts = Array.from(headings).map(h => h.textContent);
    expect(texts).toContain("Files");
  });

  it("FR-18: subfolder section renders before file section", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig(),
      [makeDirCard("A"), makeFileCard("note")],
      container,
      "/vault",
    );
    const sections = container.querySelectorAll(".folder-view-section");
    expect(sections[0].querySelector(".folder-view-section-title")?.textContent).toBe("Folders");
    expect(sections[1].querySelector(".folder-view-section-title")?.textContent).toBe("Files");
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

  it("EC-07: only file cards, no dir cards → only Files section rendered", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig(),
      [makeFileCard("image", ".png")],
      container,
      "/vault",
    );
    const headings = Array.from(container.querySelectorAll(".folder-view-section-title"))
      .map(h => h.textContent);
    expect(headings).not.toContain("Folders");
    expect(headings).toContain("Files");
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

  it("EC-11: config.columns=4 → --fv-columns CSS property is '4' on the grid", () => {
    const container = makeContainer();
    renderFolderCards(
      makeConfig({ columns: 4 }),
      [makeFileCard("a")],
      container,
      "/vault",
    );
    const grid = container.querySelector<HTMLElement>(".folder-view-grid");
    expect(grid?.style.getPropertyValue("--fv-columns")).toBe("4");
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
});

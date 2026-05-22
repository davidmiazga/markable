/**
 * tests/folder-view/bookshelf-renderer.test.ts
 *
 * Unit tests for renderFolderBookshelf().
 *
 * Covers:
 *  - Skeleton paints synchronously, real shelves render after enrichment.
 *  - Card with `meta.cover` renders <img class="fv-book-cover">.
 *  - Card without cover renders <div class="fv-book-spine"> with title.
 *  - Spine includes author when `meta.author` is set.
 *  - `groupBy` produces one shelf per group with headings.
 *  - Absent `groupBy` produces a single ungrouped shelf with no heading.
 *  - Empty card list → `.folder-view-empty`.
 *  - `displayOption: library`/`compact` fall back to the covers renderer in Phase 2.
 *  - Modifier class on root reflects the chosen option.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the bridge readFile so the async enrichment phase resolves without Tauri.
// Each test seeds card.meta directly to bypass the YAML read path; readFile
// returning ok:false skips enrichment cleanly.
vi.mock("../../src/lib/bridge", () => ({
  readFile: vi.fn().mockResolvedValue({ ok: false, error: { message: "no-op" } }),
}));

// Mock convertFileSrc so resolveAssetSrc returns a deterministic stub.
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://${p}`,
  invoke: vi.fn(),
}));

import { renderFolderBookshelf } from "../../src/plugins/file-browser/folder-view/bookshelf-renderer";
import type {
  FolderViewConfig,
  FolderCard,
} from "../../src/plugins/file-browser/folder-view/types";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<FolderViewConfig> = {}): FolderViewConfig {
  return {
    layout: "view-bookshelf",
    title: "Library",
    sort: "name-asc",
    cardWidth: 160,
    layoutMode: "grid",
    showModified: false,
    body: "",
    aspectRatio: "1/1",
    fit: "cover",
    minHeight: 40,
    maxHeight: 200,
    showName: true,
    showPreview: true,
    showExtensions: false,
    showFolders: false,
    showFiles: true,
    foldersTitle: "Folders",
    filesTitle: "",
    showTags: false,
    showCount: false,
    exclude: [],
    contentAreaOverride: true,
    extraFields: [],
    fields: null,
    previewPane: false,
    previewHeight: "60%",
    // Most existing tests assert the "mixed cover-or-spine" behavior — that's
    // now Library. Covers + Compact modes have their own dedicated suites below.
    displayOption: "library",
    ...overrides,
  };
}

function makeBook(
  name: string,
  meta: Record<string, string> = {},
): FolderCard {
  return {
    path: `/vault/library/${name}.md`,
    name,
    kind: "file",
    ext: ".md",
    modified: 0,
    meta,
  };
}

/** Wait for the post-enrichment microtask + a tick so the DOM has settled. */
async function flush(): Promise<void> {
  // The renderer kicks off a Promise.all → .then chain. Two ticks is enough
  // because each .then queues a separate microtask.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("renderFolderBookshelf — skeleton + render lifecycle", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("paints a loading skeleton synchronously", () => {
    const cards = [makeBook("a"), makeBook("b"), makeBook("c")];
    renderFolderBookshelf(makeConfig(), cards, host, "/vault/library");
    // Skeleton shelf appears immediately, no wait needed.
    expect(host.querySelector(".fv-bookshelf-loading")).not.toBeNull();
    expect(host.querySelectorAll(".fv-book-skeleton").length).toBeGreaterThan(0);
  });

  it("replaces the skeleton with real shelves after enrichment", async () => {
    const cards = [
      makeBook("Hobbit",       { cover: "./hobbit.jpg" }),
      makeBook("Plain note",   {}),
    ];
    renderFolderBookshelf(makeConfig(), cards, host, "/vault/library");
    await flush();
    expect(host.querySelector(".fv-bookshelf-loading")).toBeNull();
    expect(host.querySelectorAll(".fv-shelf").length).toBe(1);
  });
});

describe("renderFolderBookshelf — cover vs spine (library mode)", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("renders <img class=fv-book-cover> when meta.cover is set", async () => {
    const cards = [makeBook("Hobbit", { cover: "./hobbit.jpg" })];
    renderFolderBookshelf(makeConfig(), cards, host, "/vault/library");
    await flush();
    const img = host.querySelector("img.fv-book-cover") as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.src).toContain("asset://");
    expect(img!.src).toContain("hobbit.jpg");
    // No .fv-book-spine in the new library — covers stand alone, no-cover
    // books use the rich .fv-book-title structure instead.
    expect(host.querySelector(".fv-book-spine")).toBeNull();
  });

  it("renders rich-spine content (title/author/date) when meta.cover is absent", async () => {
    const cards = [makeBook("Untitled note")];
    renderFolderBookshelf(makeConfig(), cards, host, "/vault/library");
    await flush();
    // New library puts the rich content directly in .fv-book — no inner spine wrapper.
    expect(host.querySelector(".fv-book-spine")).toBeNull();
    const book = host.querySelector(".fv-book") as HTMLElement;
    expect(book).not.toBeNull();
    // Title falls back to filename.
    expect(book.querySelector(".fv-book-title")?.textContent).toBe("Untitled note");
    // Author placeholder always renders for layout consistency, empty when absent.
    expect(book.querySelector(".fv-book-author")?.textContent).toBe("");
    // Date placeholder + rule always render too.
    expect(book.querySelector(".fv-book-date")).not.toBeNull();
    expect(book.querySelector(".fv-book-rule")).not.toBeNull();
  });

  it("includes author text when meta.author is set", async () => {
    const cards = [makeBook("Hobbit", { author: "Tolkien" })];
    renderFolderBookshelf(makeConfig(), cards, host, "/vault/library");
    await flush();
    expect(host.querySelector(".fv-book-author")?.textContent).toBe("Tolkien");
  });

  it("can render mixed covers and rich-spines on the same shelf", async () => {
    const cards = [
      makeBook("Hobbit", { cover: "./hobbit.jpg" }),
      makeBook("Notes"),
      makeBook("Dune",   { cover: "./dune.png" }),
    ];
    renderFolderBookshelf(makeConfig(), cards, host, "/vault/library");
    await flush();
    // 2 cover imgs + 1 rich-spine book (has .fv-book-title but no img).
    expect(host.querySelectorAll("img.fv-book-cover").length).toBe(2);
    // The no-cover book has the rich title element.
    const richBooks = [...host.querySelectorAll(".fv-book")].filter(
      (b) => !b.querySelector("img.fv-book-cover") && b.querySelector(".fv-book-title"),
    );
    expect(richBooks.length).toBe(1);
    // All three fit on a single shelf at the row budget (covers ~187px +
    // spines ~45px + gaps ≪ 750px row budget).
    expect(host.querySelectorAll(".fv-shelf").length).toBe(1);
  });

  it("width-chunks: many covers spill into multiple shelves", async () => {
    // 6 covers × ~187px + 5 × 16px gap ≈ 1202px → overflows 750px budget.
    // chunkLibrary should split into 2 shelves (4 + 2 covers).
    const cards = Array.from({ length: 6 }, (_, i) =>
      makeBook(`book-${i + 1}`, { cover: `./b${i + 1}.jpg` }),
    );
    renderFolderBookshelf(makeConfig(), cards, host, "/vault/library");
    await flush();
    expect(host.querySelectorAll(".fv-shelf").length).toBeGreaterThan(1);
    // Each shelf has its own rail.
    const shelfCount = host.querySelectorAll(".fv-shelf").length;
    expect(host.querySelectorAll(".fv-shelf-rail").length).toBe(shelfCount);
  });

  it("width-chunks: many rich-spines fit on fewer shelves (smaller widths)", async () => {
    // 12 spines × ~45px + 11 × 16px gap ≈ 716px → all 12 fit in one shelf.
    const cards = Array.from({ length: 12 }, (_, i) => makeBook(`book-${i + 1}`));
    renderFolderBookshelf(makeConfig(), cards, host, "/vault/library");
    await flush();
    // Should be 1 shelf — spines are much narrower than covers.
    expect(host.querySelectorAll(".fv-shelf").length).toBe(1);
  });
});

describe("renderFolderBookshelf — group-by", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("produces one shelf per group value when groupBy is set", async () => {
    const cards = [
      makeBook("a", { status: "reading" }),
      makeBook("b", { status: "to-read" }),
      makeBook("c", { status: "reading" }),
    ];
    renderFolderBookshelf(
      makeConfig({ groupBy: "status" }),
      cards,
      host,
      "/vault/library",
    );
    await flush();
    const shelves = host.querySelectorAll(".fv-shelf");
    expect(shelves.length).toBe(2);
    const headings = [...host.querySelectorAll(".fv-shelf-heading")].map((el) => el.textContent);
    expect(headings.sort()).toEqual(["reading", "to-read"]);
  });

  it("buckets missing/empty group values under 'Uncategorized'", async () => {
    const cards = [
      makeBook("a", { status: "reading" }),
      makeBook("b"), // no status
    ];
    renderFolderBookshelf(
      makeConfig({ groupBy: "status" }),
      cards,
      host,
      "/vault/library",
    );
    await flush();
    const headings = [...host.querySelectorAll(".fv-shelf-heading")].map((el) => el.textContent);
    expect(headings).toContain("Uncategorized");
  });

  it("renders a single ungrouped shelf with no heading when groupBy is absent", async () => {
    const cards = [makeBook("a"), makeBook("b")];
    renderFolderBookshelf(makeConfig(), cards, host, "/vault/library");
    await flush();
    expect(host.querySelectorAll(".fv-shelf").length).toBe(1);
    expect(host.querySelector(".fv-shelf-heading")).toBeNull();
  });
});

describe("renderFolderBookshelf — empty state and mode modifiers", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("renders the empty-state element when there are no cards", () => {
    renderFolderBookshelf(makeConfig(), [], host, "/vault/library");
    expect(host.querySelector(".folder-view-empty")).not.toBeNull();
  });

  it("library mode applies the --library modifier", () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "library" }),
      [makeBook("a")],
      host,
      "/vault/library",
    );
    const root = host.querySelector(".fv-bookshelf") as HTMLElement;
    expect(root.classList.contains("fv-bookshelf--library")).toBe(true);
    expect(root.classList.contains("fv-bookshelf--covers")).toBe(false);
    expect(root.classList.contains("fv-bookshelf--compact")).toBe(false);
  });

  it("compact mode applies the --compact modifier", () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "compact" }),
      [makeBook("a")],
      host,
      "/vault/library",
    );
    const root = host.querySelector(".fv-bookshelf") as HTMLElement;
    expect(root.classList.contains("fv-bookshelf--compact")).toBe(true);
    expect(root.classList.contains("fv-bookshelf--library")).toBe(false);
    expect(root.classList.contains("fv-bookshelf--covers")).toBe(false);
  });

  it("covers mode applies the --covers modifier", () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "covers" }),
      [makeBook("a")],
      host,
      "/vault/library",
    );
    const root = host.querySelector(".fv-bookshelf") as HTMLElement;
    expect(root.classList.contains("fv-bookshelf--covers")).toBe(true);
    expect(root.classList.contains("fv-bookshelf--library")).toBe(false);
    expect(root.classList.contains("fv-bookshelf--compact")).toBe(false);
  });

  it("unknown/missing displayOption falls back to compact (the default)", () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: undefined }),
      [makeBook("a")],
      host,
      "/vault/library",
    );
    const root = host.querySelector(".fv-bookshelf") as HTMLElement;
    expect(root.classList.contains("fv-bookshelf--compact")).toBe(true);
  });
});

describe("renderFolderBookshelf — compact mode", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("never renders cover images, even when meta.cover is set", async () => {
    const cards = [
      makeBook("Hobbit", { cover: "./hobbit.jpg", author: "Tolkien" }),
      makeBook("Notes"),
    ];
    renderFolderBookshelf(
      makeConfig({ displayOption: "compact" }),
      cards,
      host,
      "/vault/library",
    );
    await flush();
    expect(host.querySelector("img.fv-book-cover")).toBeNull();
  });

  it("renders the new structured book DOM (no inner spine wrapper)", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "compact" }),
      [makeBook("Hobbit", { author: "Tolkien", title: "The Hobbit", date: "1937" })],
      host,
      "/vault/library",
    );
    await flush();
    // Compact's book has no inner .fv-book-spine — the .fv-book IS the
    // colored block, with author/title/date as direct children.
    expect(host.querySelector(".fv-book-spine")).toBeNull();
    expect(host.querySelectorAll(".fv-book").length).toBe(1);
    expect(host.querySelector(".fv-book-author")?.textContent).toBe("Tolkien");
    expect(host.querySelector(".fv-book-title")?.textContent).toBe("The Hobbit");
    expect(host.querySelector(".fv-book-date")?.textContent).toContain("1937");
  });

  it("falls back to filename when meta.title is absent", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "compact" }),
      [makeBook("hobbit", {})],
      host,
      "/vault/library",
    );
    await flush();
    expect(host.querySelector(".fv-book-title")?.textContent).toBe("hobbit");
  });

  it("uses meta.title when present (overrides filename)", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "compact" }),
      [makeBook("hobbit-draft-v2", { title: "The Hobbit" })],
      host,
      "/vault/library",
    );
    await flush();
    expect(host.querySelector(".fv-book-title")?.textContent).toBe("The Hobbit");
  });

  it("renders author placeholder (empty) when meta.author is absent", async () => {
    // Empty placeholders keep flex space-between balanced so the title stays
    // centered on the spine regardless of which YAML keys are set.
    renderFolderBookshelf(
      makeConfig({ displayOption: "compact" }),
      [makeBook("Untitled", {})],
      host,
      "/vault/library",
    );
    await flush();
    const author = host.querySelector(".fv-book-author");
    expect(author).not.toBeNull();
    expect(author!.textContent).toBe("");
    // Title still renders.
    expect(host.querySelector(".fv-book-title")?.textContent).toBe("Untitled");
  });

  it("renders date placeholder (with rule, no text) when meta.date is absent", async () => {
    // The rule ALWAYS renders — its width (per :nth-child) controls the
    // spine width, so it must exist on every book regardless of date YAML.
    renderFolderBookshelf(
      makeConfig({ displayOption: "compact" }),
      [makeBook("Untitled", { author: "Someone" })],
      host,
      "/vault/library",
    );
    await flush();
    const date = host.querySelector(".fv-book-date");
    expect(date).not.toBeNull();
    expect(date!.querySelector(".fv-book-rule")).not.toBeNull();
    // No date text, but the rule is there.
    expect(date!.textContent).toBe("");
  });

  it("appends the date text alongside the rule when meta.date is set", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "compact" }),
      [makeBook("Hobbit", { date: "1937" })],
      host,
      "/vault/library",
    );
    await flush();
    const date = host.querySelector(".fv-book-date");
    expect(date).not.toBeNull();
    expect(date!.querySelector(".fv-book-rule")).not.toBeNull();
    expect(date!.textContent).toContain("1937");
  });
});

describe("renderFolderBookshelf — covers mode", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("renders cover images for items with meta.cover", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "covers" }),
      [makeBook("Hobbit", { cover: "./hobbit.jpg" })],
      host,
      "/vault/library",
    );
    await flush();
    const img = host.querySelector("img.fv-book-cover") as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img!.src).toContain("hobbit.jpg");
    // No spine in covers mode — items without a cover get placeholders instead.
    expect(host.querySelector(".fv-book-spine")).toBeNull();
  });

  it("renders a placeholder with centered title for items without meta.cover", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "covers" }),
      [makeBook("Untitled")],
      host,
      "/vault/library",
    );
    await flush();
    const placeholder = host.querySelector(".fv-book-placeholder");
    expect(placeholder).not.toBeNull();
    // Title is centered inside the placeholder via flex centering (CSS).
    const title = placeholder!.querySelector(".fv-book-placeholder-title");
    expect(title).not.toBeNull();
    expect(title!.textContent).toBe("Untitled");
    // Wrapper also keeps the title in tooltip + aria-label.
    const wrapper = host.querySelector(".fv-book") as HTMLElement;
    expect(wrapper.getAttribute("aria-label")).toBe("Untitled");
    expect(wrapper.title).toBe("Untitled");
    // Spines never appear in covers mode.
    expect(host.querySelector(".fv-book-spine")).toBeNull();
  });

  it("placeholder title falls back to filename when meta.title is absent", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "covers" }),
      [makeBook("hobbit-notes", {})],
      host,
      "/vault/library",
    );
    await flush();
    expect(host.querySelector(".fv-book-placeholder-title")?.textContent).toBe(
      "hobbit-notes",
    );
  });

  it("placeholder title uses meta.title when set (overrides filename)", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "covers" }),
      [makeBook("hobbit-draft-v2", { title: "The Hobbit" })],
      host,
      "/vault/library",
    );
    await flush();
    expect(host.querySelector(".fv-book-placeholder-title")?.textContent).toBe(
      "The Hobbit",
    );
  });

  it("cover images do NOT get a title overlay (image carries the title)", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "covers" }),
      [makeBook("Hobbit", { cover: "./hobbit.jpg", title: "The Hobbit" })],
      host,
      "/vault/library",
    );
    await flush();
    // Cover img present, no placeholder, no placeholder-title overlay.
    expect(host.querySelector("img.fv-book-cover")).not.toBeNull();
    expect(host.querySelector(".fv-book-placeholder")).toBeNull();
    expect(host.querySelector(".fv-book-placeholder-title")).toBeNull();
  });

  it("splits a single group of >COVERS_PER_SHELF books into multiple shelves", async () => {
    // 6 items > 4 per shelf → 2 shelves (4 + 2), each with its own rail.
    const cards = Array.from({ length: 6 }, (_, i) => makeBook(`book-${i + 1}`));
    renderFolderBookshelf(
      makeConfig({ displayOption: "covers" }),
      cards,
      host,
      "/vault/library",
    );
    await flush();
    const shelves = host.querySelectorAll(".fv-shelf");
    expect(shelves.length).toBe(2);
    // Each shelf has its own rail.
    expect(host.querySelectorAll(".fv-shelf-rail").length).toBe(2);
  });

  it("repeats group heading only on the FIRST chunk when a group splits", async () => {
    // 5 items grouped under one key → 2 shelves (4 + 1). Only the first
    // shelf shows the heading so the visual section reads as one group.
    const cards = Array.from({ length: 5 }, (_, i) =>
      makeBook(`book-${i + 1}`, { status: "reading" }),
    );
    renderFolderBookshelf(
      makeConfig({ displayOption: "covers", groupBy: "status" }),
      cards,
      host,
      "/vault/library",
    );
    await flush();
    expect(host.querySelectorAll(".fv-shelf").length).toBe(2);
    const headings = host.querySelectorAll(".fv-shelf-heading");
    expect(headings.length).toBe(1);
    expect(headings[0].textContent).toBe("reading");
  });

  it("can render covers and placeholders side by side in one row", async () => {
    const cards = [
      makeBook("Hobbit", { cover: "./hobbit.jpg" }),
      makeBook("Notes"),
      makeBook("Dune",   { cover: "./dune.png" }),
    ];
    renderFolderBookshelf(
      makeConfig({ displayOption: "covers" }),
      cards,
      host,
      "/vault/library",
    );
    await flush();
    expect(host.querySelectorAll("img.fv-book-cover").length).toBe(2);
    expect(host.querySelectorAll(".fv-book-placeholder").length).toBe(1);
  });
});

describe("renderFolderBookshelf — directories", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("filters out directory cards (bookshelf is for files only)", async () => {
    const cards: FolderCard[] = [
      makeBook("book-a"),
      { path: "/vault/library/subdir", name: "subdir", kind: "directory", ext: "", modified: 0 },
    ];
    renderFolderBookshelf(makeConfig(), cards, host, "/vault/library");
    await flush();
    expect(host.querySelectorAll(".fv-book").length).toBe(1);
  });
});

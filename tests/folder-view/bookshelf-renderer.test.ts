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

  it("renders the CLASSIC spine (author/title/rule+date) for short titles in Library", async () => {
    // Library's no-cover branch shares populateRichBookContent with Compact:
    // short titles get the classic single-color spine; long titles get the
    // two-zone variant. "Untitled note" is short → classic.
    const cards = [makeBook("Untitled note")];
    renderFolderBookshelf(makeConfig(), cards, host, "/vault/library");
    await flush();
    expect(host.querySelector(".fv-book-spine")).toBeNull();
    expect(host.querySelector(".fv-book-pattern")).toBeNull();
    expect(host.querySelector(".fv-book-label-zone")).toBeNull();
    const book = host.querySelector(".fv-book") as HTMLElement;
    expect(book).not.toBeNull();
    expect(book.classList.contains("fv-book-title-len-long")).toBe(false);
    // Classic spine: author + title + (rule + optional date).
    expect(book.querySelector(".fv-book-title")?.textContent).toBe("Untitled note");
    expect(book.querySelector(".fv-book-author")).not.toBeNull();
    expect(book.querySelector(".fv-book-rule")).not.toBeNull();
  });

  it("includes author text when meta.author is set (classic spine in Library)", async () => {
    const cards = [makeBook("Hobbit", { author: "Tolkien" })];
    renderFolderBookshelf(makeConfig(), cards, host, "/vault/library");
    await flush();
    expect(host.querySelector(".fv-book-author")?.textContent).toBe("Tolkien");
    // Short title → classic spine, no eyebrow.
    expect(host.querySelector(".fv-book-eyebrow")).toBeNull();
  });

  it("switches Library's no-cover spine to two-zone for long titles", async () => {
    const cards = [makeBook("Hobbit", { author: "Tolkien", title: "Design Beyond Thinking Foundation" })];
    renderFolderBookshelf(makeConfig(), cards, host, "/vault/library");
    await flush();
    const book = host.querySelector(".fv-book")!;
    expect(book.classList.contains("fv-book-title-len-long")).toBe(true);
    expect(book.querySelector(".fv-book-pattern")).not.toBeNull();
    expect(book.querySelector(".fv-book-label-zone")).not.toBeNull();
    expect(book.querySelector(".fv-book-eyebrow")?.textContent).toBe("Tolkien");
    expect(book.querySelector(".fv-book-author")).toBeNull();
    expect(book.querySelector(".fv-book-rule")).toBeNull();
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

  it("renders the CLASSIC spine DOM for short titles (no two-zone, no len-long)", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "compact" }),
      [makeBook("Hobbit", { author: "Tolkien", title: "The Hobbit", date: "1937" })],
      host,
      "/vault/library",
    );
    await flush();
    // Short titles keep the original single-color spine: author + title + (rule+date).
    // Two-zone elements MUST NOT appear.
    expect(host.querySelector(".fv-book-pattern")).toBeNull();
    expect(host.querySelector(".fv-book-label-zone")).toBeNull();
    expect(host.querySelector(".fv-book-eyebrow")).toBeNull();
    expect(host.querySelector(".fv-book-footer")).toBeNull();
    // .fv-book-spine retired in May 2026 redesign — never renders now.
    expect(host.querySelector(".fv-book-spine")).toBeNull();

    expect(host.querySelectorAll(".fv-book").length).toBe(1);
    const book = host.querySelector(".fv-book")!;
    expect(book.classList.contains("fv-book-title-len-long")).toBe(false);
    expect(host.querySelector(".fv-book-author")?.textContent).toBe("Tolkien");
    expect(host.querySelector(".fv-book-title")?.textContent).toBe("The Hobbit");
    expect(host.querySelector(".fv-book-date")?.textContent).toContain("1937");
    expect(host.querySelector(".fv-book-rule")).not.toBeNull();
  });

  it("renders the TWO-ZONE DOM only when the title is long", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "compact" }),
      [makeBook("long", { author: "Tolkien", title: "Design Beyond Thinking Foundation", date: "1937" })],
      host,
      "/vault/library",
    );
    await flush();
    const book = host.querySelector(".fv-book")!;
    expect(book.classList.contains("fv-book-title-len-long")).toBe(true);
    expect(host.querySelector(".fv-book-pattern")).not.toBeNull();
    expect(host.querySelector(".fv-book-label-zone")).not.toBeNull();
    expect(host.querySelector(".fv-book-eyebrow")?.textContent).toBe("Tolkien");
    expect(host.querySelector(".fv-book-title")?.textContent).toBe("Design Beyond Thinking Foundation");
    expect(host.querySelector(".fv-book-footer")?.textContent).toBe("1937");
    // Classic-spine children must NOT appear in two-zone variant.
    expect(host.querySelector(".fv-book-author")).toBeNull();
    expect(host.querySelector(".fv-book-date")).toBeNull();
    expect(host.querySelector(".fv-book-rule")).toBeNull();
  });

  it("tags the book wrapper with fv-book-pair-N (1..8) in BOTH variants", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "compact" }),
      [
        makeBook("short", { title: "Brief Title" }),
        makeBook("long",  { title: "Design Beyond Thinking Foundation" }),
      ],
      host,
      "/vault/library",
    );
    await flush();
    const books = host.querySelectorAll<HTMLElement>(".fv-book");
    for (const book of books) {
      const pairClass = [...book.classList].find((c) => c.startsWith("fv-book-pair-"));
      expect(pairClass, `book "${book.title}" missing fv-book-pair-N class`).toBeDefined();
      expect(pairClass).toMatch(/^fv-book-pair-[1-8]$/);
    }
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

  it("classic spine: author renders empty string when meta.author is absent (no eyebrow)", async () => {
    // Classic-spine layout always renders the .fv-book-author element to keep
    // flex space-between stable. Eyebrow is two-zone only and stays absent.
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
    expect(host.querySelector(".fv-book-eyebrow")).toBeNull();
  });

  it("classic spine: date placeholder (rule, no text) when meta.date is absent", async () => {
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
    expect(date!.textContent).toBe("");
  });

  it("two-zone variant: hides eyebrow row entirely when meta.author is absent", async () => {
    // In two-zone mode (long title), eyebrow/footer are conditional rather than
    // always-present placeholders.
    renderFolderBookshelf(
      makeConfig({ displayOption: "compact" }),
      [makeBook("Untitled", { title: "An Untitled Long Form Document" })],
      host,
      "/vault/library",
    );
    await flush();
    expect(host.querySelector(".fv-book-eyebrow")).toBeNull();
    expect(host.querySelector(".fv-book-title")?.textContent).toBe("An Untitled Long Form Document");
  });

  it("two-zone variant: hides footer row entirely when meta.date is absent", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "compact" }),
      [makeBook("title", { author: "Someone", title: "An Untitled Long Form Document" })],
      host,
      "/vault/library",
    );
    await flush();
    expect(host.querySelector(".fv-book-footer")).toBeNull();
    expect(host.querySelector(".fv-book-eyebrow")?.textContent).toBe("Someone");
  });

  it("tags long titles (4+ words) with fv-book-title-len-long; short ones stay untagged", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "compact" }),
      [
        makeBook("short", { title: "Brief Title" }),
        makeBook("long",  { title: "Design Beyond Thinking Foundation" }),
      ],
      host,
      "/vault/library",
    );
    await flush();
    const books = host.querySelectorAll<HTMLElement>(".fv-book");
    expect(books.length).toBe(2);
    const shortBook = [...books].find((b) => b.querySelector(".fv-book-title")?.textContent === "Brief Title")!;
    const longBook  = [...books].find((b) => b.querySelector(".fv-book-title")?.textContent === "Design Beyond Thinking Foundation")!;
    expect(shortBook.classList.contains("fv-book-title-len-long")).toBe(false);
    expect(longBook.classList.contains("fv-book-title-len-long")).toBe(true);
  });

  it("sets a data-URI SVG as --fv-pattern-url on the long-title pattern zone", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "compact" }),
      [makeBook("long", { title: "Design Beyond Thinking Foundation" })],
      host,
      "/vault/library",
    );
    await flush();
    const patternZone = host.querySelector<HTMLElement>(".fv-book-pattern");
    expect(patternZone).not.toBeNull();
    // The renderer sets --fv-pattern-url inline; CSS plugs it into
    // mask-image (so the visible color comes from background-color, not
    // from the SVG fill, which is currentColor-only).
    const url = patternZone!.style.getPropertyValue("--fv-pattern-url");
    expect(url).toContain("data:image/svg+xml");
    expect(url).toContain("svg");
    // No inline <svg> child — the SVG lives in the URL, not the DOM.
    expect(patternZone!.querySelector("svg")).toBeNull();
  });

  it("does NOT set a pattern URL on classic (short-title) spines", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "compact" }),
      [makeBook("short", { title: "Brief Title" })],
      host,
      "/vault/library",
    );
    await flush();
    // No pattern zone at all (the classic spine doesn't build .fv-book-pattern).
    expect(host.querySelector(".fv-book-pattern")).toBeNull();
    expect(host.querySelector("svg")).toBeNull();
  });

  it("varies pattern across long-title books (slot rotation)", async () => {
    // patternSlotFor hashes card.path → slot 1..7. With 8+ books of distinct
    // paths we expect to see at least 2 distinct pattern URLs. The exact
    // distribution depends on the hash, but with 7 slots and 8 unique paths
    // the pigeonhole math guarantees at least 2 unique URLs unless the hash
    // collapses (it won't — different paths give different hashes).
    const cards = Array.from({ length: 8 }, (_, i) =>
      makeBook(`book-${i}`, { title: "Design Beyond Thinking Foundation" }),
    );
    renderFolderBookshelf(
      makeConfig({ displayOption: "compact" }),
      cards,
      host,
      "/vault/library",
    );
    await flush();
    const urls = new Set<string>();
    for (const zone of host.querySelectorAll<HTMLElement>(".fv-book-pattern")) {
      const url = zone.style.getPropertyValue("--fv-pattern-url");
      expect(url).toContain("data:image/svg+xml");
      urls.add(url);
    }
    expect(urls.size).toBeGreaterThanOrEqual(2);
  });

  it("returns the same pattern URL for the same card across re-renders", async () => {
    // The pattern slot is deterministic in the card's path — re-rendering
    // must produce the same URL so books don't flicker between patterns.
    const renderOnce = (): string => {
      host.innerHTML = "";
      renderFolderBookshelf(
        makeConfig({ displayOption: "compact" }),
        [makeBook("stable", { title: "Design Beyond Thinking Foundation" })],
        host,
        "/vault/library",
      );
      return "";
    };
    renderOnce();
    await flush();
    const first = host.querySelector<HTMLElement>(".fv-book-pattern")!.style.getPropertyValue("--fv-pattern-url");
    renderOnce();
    await flush();
    const second = host.querySelector<HTMLElement>(".fv-book-pattern")!.style.getPropertyValue("--fv-pattern-url");
    expect(first).toBe(second);
  });

  it("sets an inline --fv-book-min-width in [75, 105] on long-title spines", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "compact" }),
      [
        makeBook("a", { title: "Design Beyond Thinking Foundation" }),
        makeBook("b", { title: "Introduction to a Complexity Language" }),
        makeBook("c", { title: "Towards a New Theory of Resonance" }),
      ],
      host,
      "/vault/library",
    );
    await flush();
    const books = host.querySelectorAll<HTMLElement>(".fv-book");
    expect(books.length).toBe(3);
    const widths = new Set<number>();
    for (const book of books) {
      const raw = book.style.getPropertyValue("--fv-book-min-width");
      expect(raw, `book missing --fv-book-min-width`).not.toBe("");
      const px = parseInt(raw.replace("px", ""), 10);
      expect(px).toBeGreaterThanOrEqual(75);
      expect(px).toBeLessThanOrEqual(105);
      widths.add(px);
    }
    // 6 discrete slots × 3 books → expect some variety (at least 1, often 2-3).
    expect(widths.size).toBeGreaterThanOrEqual(1);
  });

  it("does NOT set --fv-book-min-width on classic (short-title) spines", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "compact" }),
      [makeBook("short", { title: "Brief Title" })],
      host,
      "/vault/library",
    );
    await flush();
    const book = host.querySelector<HTMLElement>(".fv-book")!;
    expect(book.style.getPropertyValue("--fv-book-min-width")).toBe("");
  });

  it("tags long titles (25+ chars, single word) with fv-book-title-len-long", async () => {
    // No spaces → not 4+ words, but length triggers the tag.
    renderFolderBookshelf(
      makeConfig({ displayOption: "compact" }),
      [makeBook("long-name", { title: "supercalifragilisticexpialidocious" })],
      host,
      "/vault/library",
    );
    await flush();
    const book = host.querySelector(".fv-book")!;
    expect(book.classList.contains("fv-book-title-len-long")).toBe(true);
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

describe("renderFolderBookshelf — book-stack mode", () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("renders the .fv-bookshelf--book-stack modifier on the outer container", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "book-stack" }),
      [makeBook("a", { title: "Some Book" })],
      host,
      "/vault/library",
    );
    await flush();
    expect(host.querySelector(".fv-bookshelf--book-stack")).not.toBeNull();
  });

  it("renders one .fv-book bar per card inside .fv-stack-list", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "book-stack" }),
      [
        makeBook("a", { title: "First" }),
        makeBook("b", { title: "Second" }),
        makeBook("c", { title: "Third" }),
      ],
      host,
      "/vault/library",
    );
    await flush();
    const list = host.querySelector(".fv-stack-list");
    expect(list).not.toBeNull();
    expect(list!.querySelectorAll(".fv-book").length).toBe(3);
  });

  it("each book carries an fv-book-pair-N (1..8) class", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "book-stack" }),
      [makeBook("a", { title: "Tagged" })],
      host,
      "/vault/library",
    );
    await flush();
    const book = host.querySelector(".fv-book")!;
    const pairClass = [...book.classList].find((c) => c.startsWith("fv-book-pair-"));
    expect(pairClass).toBeDefined();
    expect(pairClass).toMatch(/^fv-book-pair-[1-8]$/);
  });

  it("title text lives in .fv-book-title and falls back to filename when no meta.title", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "book-stack" }),
      [
        makeBook("with-meta", { title: "Real" }),
        makeBook("filename-only", {}),
      ],
      host,
      "/vault/library",
    );
    await flush();
    const titles = host.querySelectorAll(".fv-book-title");
    expect(titles.length).toBe(2);
    const textContents = [...titles].map((el) => el.textContent);
    expect(textContents).toContain("Real");
    expect(textContents).toContain("filename-only");
  });

  it("renders eyebrow only when meta.author is present (short bars)", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "book-stack" }),
      [
        makeBook("with-author", { author: "Tolkien" }),
        makeBook("no-author", {}),
      ],
      host,
      "/vault/library",
    );
    await flush();
    const books = host.querySelectorAll<HTMLElement>(".fv-book");
    const withAuthor = [...books].find((b) =>
      b.querySelector(".fv-book-title")?.textContent === "with-author"
    )!;
    const noAuthor = [...books].find((b) =>
      b.querySelector(".fv-book-title")?.textContent === "no-author"
    )!;
    expect(withAuthor.querySelector(".fv-book-eyebrow")?.textContent).toBe("Tolkien");
    expect(noAuthor.querySelector(".fv-book-eyebrow")).toBeNull();
  });

  it("renders footer only when meta.date is present (short bars)", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "book-stack" }),
      [
        makeBook("with-date", { date: "1937" }),
        makeBook("no-date", {}),
      ],
      host,
      "/vault/library",
    );
    await flush();
    const books = host.querySelectorAll<HTMLElement>(".fv-book");
    const withDate = [...books].find((b) =>
      b.querySelector(".fv-book-title")?.textContent === "with-date"
    )!;
    const noDate = [...books].find((b) =>
      b.querySelector(".fv-book-title")?.textContent === "no-date"
    )!;
    expect(withDate.querySelector(".fv-book-footer")?.textContent).toBe("1937");
    expect(noDate.querySelector(".fv-book-footer")).toBeNull();
  });

  it("tags long-title bars with fv-book-title-len-long and renders the two-zone DOM", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "book-stack" }),
      [
        makeBook("short", { title: "Brief" }),
        makeBook("long",  { title: "Design Beyond Thinking Foundation" }),
      ],
      host,
      "/vault/library",
    );
    await flush();
    const books = host.querySelectorAll<HTMLElement>(".fv-book");
    const shortBook = [...books].find((b) =>
      b.querySelector(".fv-book-title")?.textContent === "Brief"
    )!;
    const longBook = [...books].find((b) =>
      b.querySelector(".fv-book-title")?.textContent === "Design Beyond Thinking Foundation"
    )!;

    // Short bar: no long class, no two-zone wrappers, no pattern.
    expect(shortBook.classList.contains("fv-book-title-len-long")).toBe(false);
    expect(shortBook.querySelector(".fv-book-label-zone")).toBeNull();
    expect(shortBook.querySelector(".fv-book-pattern")).toBeNull();
    expect(shortBook.querySelector(".fv-book-text-area")).toBeNull();

    // Long bar: gets the long class + two-zone DOM (same as Compact long).
    expect(longBook.classList.contains("fv-book-title-len-long")).toBe(true);
    expect(longBook.querySelector(".fv-book-label-zone")).not.toBeNull();
    expect(longBook.querySelector(".fv-book-pattern")).not.toBeNull();
    expect(longBook.querySelector(".fv-book-text-area")).not.toBeNull();
    // Title sits inside the text-area for long bars.
    expect(longBook.querySelector(".fv-book-text-area > .fv-book-title")?.textContent)
      .toBe("Design Beyond Thinking Foundation");
  });

  it("sets --fv-pattern-url on long-title bars (mask-image fed by patternSlotFor)", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "book-stack" }),
      [makeBook("long", { title: "Design Beyond Thinking Foundation" })],
      host,
      "/vault/library",
    );
    await flush();
    const pattern = host.querySelector<HTMLElement>(".fv-book-pattern")!;
    const url = pattern.style.getPropertyValue("--fv-pattern-url");
    expect(url).toContain("data:image/svg+xml");
  });

  it("sets --fv-book-min-height in [75, 105] on long-title bars (matches Compact's longTitleWidthFor)", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "book-stack" }),
      [
        makeBook("a", { title: "Design Beyond Thinking Foundation" }),
        makeBook("b", { title: "Introduction to a Complexity Language" }),
        makeBook("c", { title: "Towards a New Theory of Resonance" }),
      ],
      host,
      "/vault/library",
    );
    await flush();
    const books = host.querySelectorAll<HTMLElement>(".fv-book.fv-book-title-len-long");
    expect(books.length).toBe(3);
    for (const book of books) {
      const raw = book.style.getPropertyValue("--fv-book-min-height");
      expect(raw, `book missing --fv-book-min-height`).not.toBe("");
      const px = parseInt(raw.replace("px", ""), 10);
      expect(px).toBeGreaterThanOrEqual(75);
      expect(px).toBeLessThanOrEqual(105);
    }
  });

  it("does NOT set --fv-book-min-height on short-title bars", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "book-stack" }),
      [makeBook("short", { title: "Brief" })],
      host,
      "/vault/library",
    );
    await flush();
    const book = host.querySelector<HTMLElement>(".fv-book")!;
    expect(book.classList.contains("fv-book-title-len-long")).toBe(false);
    expect(book.style.getPropertyValue("--fv-book-min-height")).toBe("");
  });

  it("produces no .fv-stack-heading when group-by is unset", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "book-stack" }),
      [makeBook("a", { title: "Book A" }), makeBook("b", { title: "Book B" })],
      host,
      "/vault/library",
    );
    await flush();
    expect(host.querySelector(".fv-stack-heading")).toBeNull();
  });

  it("renders one .fv-stack-heading per group when group-by is set", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "book-stack", groupBy: "status" }),
      [
        makeBook("a", { title: "A", status: "todo" }),
        makeBook("b", { title: "B", status: "doing" }),
        makeBook("c", { title: "C", status: "todo" }),
      ],
      host,
      "/vault/library",
    );
    await flush();
    const headings = host.querySelectorAll(".fv-stack-heading");
    expect(headings.length).toBe(2);
    const texts = [...headings].map((el) => el.textContent);
    expect(texts).toContain("todo");
    expect(texts).toContain("doing");
  });

  it("shows the folder-view-empty placeholder when there are no files", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "book-stack" }),
      [],
      host,
      "/vault/library",
    );
    await flush();
    expect(host.querySelector(".folder-view-empty")).not.toBeNull();
  });

  it("does NOT render shelf-specific or classic-spine-specific classes", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "book-stack" }),
      [
        makeBook("short", { title: "Brief", author: "A" }),
      ],
      host,
      "/vault/library",
    );
    await flush();
    // No shelf rails / shelf rows in stack mode — it's a single column.
    expect(host.querySelector(".fv-shelf-rail")).toBeNull();
    expect(host.querySelector(".fv-shelf-row")).toBeNull();
    expect(host.querySelector(".fv-shelf-heading")).toBeNull();
    // No Compact classic-spine elements (rule + author/date wrappers).
    expect(host.querySelector(".fv-book-rule")).toBeNull();
    expect(host.querySelector(".fv-book-author")).toBeNull();
    expect(host.querySelector(".fv-book-date")).toBeNull();
    // Eyebrow IS present on the short bar (Book Stack uses the same
    // .fv-book-eyebrow class as Compact's two-zone variant — different
    // mode scope handles the styling).
    expect(host.querySelector(".fv-book-eyebrow")?.textContent).toBe("A");
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

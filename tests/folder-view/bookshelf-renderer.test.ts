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
    displayOption: "covers",
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

describe("renderFolderBookshelf — cover vs spine", () => {
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
    expect(host.querySelectorAll(".fv-book-spine").length).toBe(0);
  });

  it("renders a spine with title when meta.cover is absent", async () => {
    const cards = [makeBook("Untitled note")];
    renderFolderBookshelf(makeConfig(), cards, host, "/vault/library");
    await flush();
    const spine = host.querySelector(".fv-book-spine");
    expect(spine).not.toBeNull();
    const title = host.querySelector(".fv-book-title");
    expect(title?.textContent).toBe("Untitled note");
    expect(host.querySelector(".fv-book-author")).toBeNull();
  });

  it("includes author on the spine when meta.author is set", async () => {
    const cards = [makeBook("Hobbit", { author: "Tolkien" })];
    renderFolderBookshelf(makeConfig(), cards, host, "/vault/library");
    await flush();
    const author = host.querySelector(".fv-book-author");
    expect(author?.textContent).toBe("Tolkien");
  });

  it("can render mixed covers and spines in the same shelf row", async () => {
    const cards = [
      makeBook("Hobbit", { cover: "./hobbit.jpg" }),
      makeBook("Notes"),
      makeBook("Dune",   { cover: "./dune.png" }),
    ];
    renderFolderBookshelf(makeConfig(), cards, host, "/vault/library");
    await flush();
    expect(host.querySelectorAll(".fv-book-cover").length).toBe(2);
    expect(host.querySelectorAll(".fv-book-spine").length).toBe(1);
    // All three sit inside the same shelf row.
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

describe("renderFolderBookshelf — empty state and option fallback", () => {
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

  it("library option falls back to the covers renderer in Phase 2", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "library" }),
      [makeBook("a", { cover: "./a.jpg" })],
      host,
      "/vault/library",
    );
    await flush();
    const root = host.querySelector(".fv-bookshelf") as HTMLElement;
    // Modifier reflects the rendering option, not the requested one.
    expect(root.classList.contains("fv-bookshelf--covers")).toBe(true);
    expect(root.classList.contains("fv-bookshelf--library")).toBe(false);
  });

  it("compact option falls back to the covers renderer in Phase 2", async () => {
    renderFolderBookshelf(
      makeConfig({ displayOption: "compact" }),
      [makeBook("a")],
      host,
      "/vault/library",
    );
    await flush();
    const root = host.querySelector(".fv-bookshelf") as HTMLElement;
    expect(root.classList.contains("fv-bookshelf--covers")).toBe(true);
    expect(root.classList.contains("fv-bookshelf--compact")).toBe(false);
  });

  it("covers option (default) renders with the --covers modifier", () => {
    renderFolderBookshelf(makeConfig(), [makeBook("a")], host, "/vault/library");
    const root = host.querySelector(".fv-bookshelf") as HTMLElement;
    expect(root.classList.contains("fv-bookshelf--covers")).toBe(true);
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

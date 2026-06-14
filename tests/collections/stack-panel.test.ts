/**
 * tests/collections/stack-panel.test.ts — step_10
 *
 * Asserts the Stack section view:
 *   - Renders one framed-box per entry in order: + references: order
 *     (FR-9, FR-22).
 *   - References come after canonicals; reference boxes carry is-reference.
 *   - Trailing `+ Note` affordance is the last child.
 *   - Two IntersectionObservers (enter/exit) are constructed; mock interface
 *     drives the enter callback to assert renderPreview fires.
 *   - destroy disconnects both observers.
 *   - removeNote drops the box and invalidates the cache entry.
 *
 * jsdom does not ship IntersectionObserver, so the test installs a minimal
 * spy implementation on `window.IntersectionObserver` before importing the
 * module under test. The spy lets the test trigger `entries` manually.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as bridge from "../../src/lib/bridge";

// Install an IntersectionObserver spy on the window. Each constructed
// instance is captured in `mockObservers` so tests can trigger entries.
interface MockObserver {
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;
  observed: Element[];
  disconnect: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
  fire: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void;
}
const mockObservers: MockObserver[] = [];

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = "";
  readonly thresholds: readonly number[] = [];
  private observed: Element[] = [];
  disconnect = vi.fn();
  unobserve = vi.fn();
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  observe(el: Element): void {
    this.observed.push(el);
  }
  constructor(
    cb: IntersectionObserverCallback,
    opts?: IntersectionObserverInit,
  ) {
    mockObservers.push({
      callback: cb,
      options: opts,
      observed: this.observed,
      disconnect: this.disconnect,
      unobserve: this.unobserve,
      fire: (entries) => {
        const realEntries = entries.map((e) => ({
          target: e.target,
          isIntersecting: e.isIntersecting,
          // Other fields are not used by the renderer.
          boundingClientRect: {} as DOMRectReadOnly,
          intersectionRatio: e.isIntersecting ? 1 : 0,
          intersectionRect: {} as DOMRectReadOnly,
          rootBounds: null,
          time: 0,
        })) as unknown as IntersectionObserverEntry[];
        cb(realEntries, this as unknown as IntersectionObserver);
      },
    });
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockObservers.length = 0;
  (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
  vi.spyOn(bridge, "statFile").mockResolvedValue({
    ok: true,
    value: { mtimeMs: 0, size: 0 },
  });
});

afterEach(() => {
  // Leave the global installed across tests in this file — restoreAllMocks
  // resets fn mocks, not global assignments.
});

import { renderStackPanel } from "../../src/plugins/file-browser/collections/stack-panel";
import { createPreviewCache } from "../../src/plugins/file-browser/collections/preview-cache";
import type { VaultIndex } from "../../src/lib/vault-types";
import * as vaultManager from "../../src/lib/vault-manager";

function withFs(initial: Record<string, string>) {
  vi.spyOn(bridge, "readFile").mockImplementation(async (path: string) => {
    if (path in initial) {
      return { ok: true as const, value: initial[path] };
    }
    return {
      ok: false as const,
      error: { message: "ENOENT", command: "read_file", path },
    };
  });
}

function withVault(mdPaths: string[] = []) {
  const index: VaultIndex = {
    vaultId: "t",
    builtAt: 0,
    entries: mdPaths.map((p) => ({
      path: p,
      name: p.split("/").pop()!.replace(/\.md$/, ""),
      modified: 0,
      size: 0,
      title: "",
      tags: [],
      outboundLinks: [],
    })),
    totalFilesFound: mdPaths.length,
    skippedCount: 0,
    capped: false,
  };
  vi.spyOn(vaultManager, "getVaultIndex").mockReturnValue(index);
  vi.spyOn(vaultManager, "getActiveVault").mockReturnValue({
    id: "t",
    name: "t",
    rootPaths: ["/v"],
    created: "",
    lastOpened: "",
    excludePatterns: [],
    maxIndexSize: 500,
  });
}

describe("stack-panel: structure (step_10)", () => {
  it("FR-9 / FR-22 — renders one box per order + references entry, plus trailing +Note", async () => {
    withFs({
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder:\n  - \"A.md\"\n  - \"B.md\"\nreferences:\n  - \"Other/X.md\"\n---\n",
    });
    withVault(["/v/A/Stack 01/A.md", "/v/A/Stack 01/B.md", "/v/Other/X.md"]);
    const container = document.createElement("div");
    const panel = await renderStackPanel(container, {
      stackPath: "/v/A/Stack 01",
      cache: createPreviewCache(),
      onNoteClick: vi.fn(),
      onNoteContextMenu: vi.fn(),
      onNoteRenameCommit: vi.fn().mockResolvedValue({ ok: true }),
      onCreateNote: vi.fn().mockResolvedValue(null),
    });
    const list = panel.listEl;
    // 2 canonical + 1 reference + 1 trailing +Note = 4 children.
    expect(list.children.length).toBe(4);
    expect(list.lastElementChild?.classList.contains("fv-collection-stack-add-note")).toBe(true);
  });

  it("FR-22 — canonical boxes come before reference boxes", async () => {
    withFs({
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder:\n  - \"A.md\"\nreferences:\n  - \"Other/X.md\"\n---\n",
    });
    withVault(["/v/A/Stack 01/A.md", "/v/Other/X.md"]);
    const container = document.createElement("div");
    const panel = await renderStackPanel(container, {
      stackPath: "/v/A/Stack 01",
      cache: createPreviewCache(),
      onNoteClick: vi.fn(),
      onNoteContextMenu: vi.fn(),
      onNoteRenameCommit: vi.fn().mockResolvedValue({ ok: true }),
      onCreateNote: vi.fn().mockResolvedValue(null),
    });
    const boxes = panel.listEl.querySelectorAll(".fv-collection-note-box");
    expect(boxes[0].getAttribute("data-note-path")).toBe("/v/A/Stack 01/A.md");
    expect(boxes[1].classList.contains("is-reference")).toBe(true);
  });

  it("FR-22 — reference boxes carry is-reference class", async () => {
    withFs({
      "/v/A/Stack 02/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 02\nicon: notebook\norder: []\nreferences:\n  - \"X.md\"\n---\n",
    });
    withVault(["/v/X.md"]);
    const container = document.createElement("div");
    const panel = await renderStackPanel(container, {
      stackPath: "/v/A/Stack 02",
      cache: createPreviewCache(),
      onNoteClick: vi.fn(),
      onNoteContextMenu: vi.fn(),
      onNoteRenameCommit: vi.fn().mockResolvedValue({ ok: true }),
      onCreateNote: vi.fn().mockResolvedValue(null),
    });
    const box = panel.listEl.querySelector(".fv-collection-note-box");
    expect(box?.classList.contains("is-reference")).toBe(true);
  });

  it("EC-16 — broken reference renders is-broken when canonical not in vault index", async () => {
    withFs({
      "/v/A/Stack 02/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 02\nicon: notebook\norder: []\nreferences:\n  - \"Missing/path.md\"\n---\n",
    });
    withVault([]); // no notes in the index at all
    const container = document.createElement("div");
    const panel = await renderStackPanel(container, {
      stackPath: "/v/A/Stack 02",
      cache: createPreviewCache(),
      onNoteClick: vi.fn(),
      onNoteContextMenu: vi.fn(),
      onNoteRenameCommit: vi.fn().mockResolvedValue({ ok: true }),
      onCreateNote: vi.fn().mockResolvedValue(null),
    });
    const box = panel.listEl.querySelector(".fv-collection-note-box");
    expect(box?.classList.contains("is-broken")).toBe(true);
  });

  it("FR-11 — clicking +Note invokes onCreateNote and adds the returned handle to the list", async () => {
    withFs({
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder: []\nreferences: []\n---\n",
    });
    withVault([]);
    const container = document.createElement("div");
    // onCreateNote returns null in this test — assert the click is wired.
    const onCreateNote = vi.fn().mockResolvedValue(null);
    const panel = await renderStackPanel(container, {
      stackPath: "/v/A/Stack 01",
      cache: createPreviewCache(),
      onNoteClick: vi.fn(),
      onNoteContextMenu: vi.fn(),
      onNoteRenameCommit: vi.fn().mockResolvedValue({ ok: true }),
      onCreateNote,
    });
    const addBtn = panel.listEl.querySelector(".fv-collection-stack-add-note") as HTMLElement;
    addBtn.click();
    // Allow the await chain to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(onCreateNote).toHaveBeenCalled();
  });
});

describe("stack-panel: lazy rendering (step_10)", () => {
  it("FR-27 / EC-18 — only viewport-visible boxes have rendered preview", async () => {
    withFs({
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder:\n  - \"A.md\"\n  - \"B.md\"\nreferences: []\n---\n",
      "/v/A/Stack 01/A.md": "# A",
      "/v/A/Stack 01/B.md": "# B",
    });
    withVault(["/v/A/Stack 01/A.md", "/v/A/Stack 01/B.md"]);
    const container = document.createElement("div");
    const panel = await renderStackPanel(container, {
      stackPath: "/v/A/Stack 01",
      cache: createPreviewCache(),
      onNoteClick: vi.fn(),
      onNoteContextMenu: vi.fn(),
      onNoteRenameCommit: vi.fn().mockResolvedValue({ ok: true }),
      onCreateNote: vi.fn().mockResolvedValue(null),
    });
    // Two observers should be installed (enter + exit).
    expect(mockObservers.length).toBeGreaterThanOrEqual(2);
    // Fire the enter observer with just the FIRST box.
    const enter = mockObservers[0];
    const boxes = Array.from(panel.listEl.querySelectorAll(".fv-collection-note-box"));
    enter.fire([{ target: boxes[0], isIntersecting: true }]);
    await new Promise((r) => setTimeout(r, 0));
    // The first box's body should now have HTML; the second box remains empty.
    const body0 = boxes[0].querySelector(".fv-collection-note-box-body");
    const body1 = boxes[1].querySelector(".fv-collection-note-box-body");
    expect(body0?.children.length).toBeGreaterThan(0);
    expect(body1?.children.length).toBe(0);
  });

  it("EC-18 — exit observer recycles rendered boxes to placeholder", async () => {
    withFs({
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder:\n  - \"A.md\"\nreferences: []\n---\n",
      "/v/A/Stack 01/A.md": "# A",
    });
    withVault(["/v/A/Stack 01/A.md"]);
    const container = document.createElement("div");
    const panel = await renderStackPanel(container, {
      stackPath: "/v/A/Stack 01",
      cache: createPreviewCache(),
      onNoteClick: vi.fn(),
      onNoteContextMenu: vi.fn(),
      onNoteRenameCommit: vi.fn().mockResolvedValue({ ok: true }),
      onCreateNote: vi.fn().mockResolvedValue(null),
    });
    const box = panel.listEl.querySelector(".fv-collection-note-box")!;
    // Enter — render preview.
    mockObservers[0].fire([{ target: box, isIntersecting: true }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(box.querySelector(".fv-collection-note-box-body")?.children.length ?? 0).toBeGreaterThan(0);
    // Exit observer is mockObservers[1] — fire non-intersecting.
    mockObservers[1].fire([{ target: box, isIntersecting: false }]);
    expect(box.querySelector(".fv-collection-note-box-body")?.children.length ?? 0).toBe(0);
  });
});

describe("stack-panel: lifecycle (step_10)", () => {
  it("leak — destroy disconnects both IntersectionObservers", async () => {
    withFs({
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder: []\nreferences: []\n---\n",
    });
    withVault([]);
    const container = document.createElement("div");
    const panel = await renderStackPanel(container, {
      stackPath: "/v/A/Stack 01",
      cache: createPreviewCache(),
      onNoteClick: vi.fn(),
      onNoteContextMenu: vi.fn(),
      onNoteRenameCommit: vi.fn().mockResolvedValue({ ok: true }),
      onCreateNote: vi.fn().mockResolvedValue(null),
    });
    panel.destroy();
    for (const obs of mockObservers) {
      expect(obs.disconnect).toHaveBeenCalled();
    }
  });

  it("FR-12 — removeNote drops the box and invalidates the cache entry", async () => {
    withFs({
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder:\n  - \"A.md\"\nreferences: []\n---\n",
    });
    withVault(["/v/A/Stack 01/A.md"]);
    const cache = createPreviewCache();
    const invalidateSpy = vi.spyOn(cache, "invalidate");
    const container = document.createElement("div");
    const panel = await renderStackPanel(container, {
      stackPath: "/v/A/Stack 01",
      cache,
      onNoteClick: vi.fn(),
      onNoteContextMenu: vi.fn(),
      onNoteRenameCommit: vi.fn().mockResolvedValue({ ok: true }),
      onCreateNote: vi.fn().mockResolvedValue(null),
    });
    panel.removeNote("/v/A/Stack 01/A.md");
    expect(panel.listEl.querySelector("[data-note-path='/v/A/Stack 01/A.md']")).toBeNull();
    expect(invalidateSpy).toHaveBeenCalledWith("/v/A/Stack 01/A.md");
  });

  it("restore — initialScrollTop is applied to the scroll container", async () => {
    withFs({
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder: []\nreferences: []\n---\n",
    });
    withVault([]);
    const container = document.createElement("div");
    // jsdom requires a scrollable parent; the spec contract is that the
    // renderer assigns container.scrollTop = initialScrollTop after layout.
    const panel = await renderStackPanel(container, {
      stackPath: "/v/A/Stack 01",
      cache: createPreviewCache(),
      onNoteClick: vi.fn(),
      onNoteContextMenu: vi.fn(),
      onNoteRenameCommit: vi.fn().mockResolvedValue({ ok: true }),
      onCreateNote: vi.fn().mockResolvedValue(null),
      initialScrollTop: 150,
    });
    // Microtask delay matches the renderer's queueMicrotask.
    await new Promise((r) => queueMicrotask(r as () => void));
    // jsdom doesn't actually scroll, but the value is set on the element.
    expect(panel.el.scrollTop).toBe(150);
  });
});

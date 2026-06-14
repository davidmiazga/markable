/**
 * tests/collections/drag-reorder.test.ts — step_R06
 *
 * Asserts that drag-reorder wiring is in place on:
 *
 *   - Note boxes within a Stack panel → persisted via `store.reorderNote`.
 *   - Stack tiles on the Home canvas   → persisted via `store.reorderStack`.
 *
 * Cross-Stack drag-and-drop is structurally refused by
 * `attachFolderItemDrag`'s container scoping (`itemSelector` is scoped to
 * the container the util is called with). The tests cover the contract by
 * mocking the util and asserting which items the wiring attaches to and
 * which callback dispatches it makes.
 *
 * Strategy: `attachFolderItemDrag` is imported and mocked with `vi.mock`,
 * so the tests can capture the `(element, container, id, selector, onReorder)`
 * tuples and synthesise an `onReorder` invocation without exercising the
 * actual pointer-event drag machinery. This keeps the tests deterministic
 * and decoupled from JSDOM's pointer-event quirks.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as bridge from "../../src/lib/bridge";
import * as vaultManager from "../../src/lib/vault-manager";
import type { VaultIndex } from "../../src/lib/vault-types";

// Capture every attach call so each test can replay the `onReorder` callback.
const dragAttachCalls: Array<{
  el: HTMLElement;
  container: HTMLElement;
  id: string;
  selector: string;
  onReorder: (orderedIds: string[]) => void;
}> = [];

vi.mock(
  "../../src/plugins/file-browser/folder-view/folder-item-drag",
  () => ({
    attachFolderItemDrag: (
      el: HTMLElement,
      container: HTMLElement,
      id: string,
      selector: string,
      onReorder: (orderedIds: string[]) => void,
    ) => {
      dragAttachCalls.push({ el, container, id, selector, onReorder });
    },
  }),
);

// Import the modules under test AFTER vi.mock so the mock applies.
import { renderStackPanel } from "../../src/plugins/file-browser/collections/stack-panel";
import { renderHomeCanvas, type HomeCanvasOptions } from "../../src/plugins/file-browser/collections/home-canvas";
import { createPreviewCache } from "../../src/plugins/file-browser/collections/preview-cache";
import * as store from "../../src/plugins/file-browser/collections/store";

function withFs(initial: Record<string, string>): Map<string, string> {
  const fs = new Map(Object.entries(initial));
  vi.spyOn(bridge, "readFile").mockImplementation(async (path: string) => {
    if (fs.has(path)) {
      return { ok: true as const, value: fs.get(path)! };
    }
    return {
      ok: false as const,
      error: { message: "ENOENT", command: "read_file", path },
    };
  });
  vi.spyOn(bridge, "writeFile").mockImplementation(
    async (path: string, content: string) => {
      fs.set(path, content);
      return { ok: true as const, value: undefined };
    },
  );
  return fs;
}

function withVaultIndex(
  folders: string[],
  notes: { path: string; name: string }[] = [],
) {
  const index: VaultIndex = {
    vaultId: "t",
    builtAt: 0,
    entries: notes.map((n) => ({
      path: n.path,
      name: n.name,
      modified: 0,
      size: 0,
      title: n.name,
      tags: [],
      outboundLinks: [],
    })),
    totalFilesFound: notes.length,
    skippedCount: 0,
    capped: false,
    directories: folders,
  };
  vi.spyOn(vaultManager, "getVaultIndex").mockReturnValue(index);
}

function makeHomeOpts(overrides: Partial<HomeCanvasOptions> = {}): HomeCanvasOptions {
  return {
    collectionPath: "/v/A",
    onStackClick: vi.fn(),
    onCreateStack: vi.fn().mockResolvedValue(undefined),
    onCreateNotecard: vi.fn().mockResolvedValue(undefined),
    onNoteClick: vi.fn(),
    onNoteContextMenu: vi.fn(),
    onStackRename: vi.fn().mockResolvedValue(undefined),
    onStackReorder: vi.fn().mockResolvedValue(undefined),
    onStackDelete: vi.fn().mockResolvedValue(undefined),
    onStackSetIcon: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  dragAttachCalls.length = 0;
});

describe("drag-reorder: stack-panel (R06)", () => {
  it("FR-30 — every canonical note box has data-path = filename for the drag util", async () => {
    withFs({
      "/v/A/Stack 01/_folder.md":
        "---\nschemaVersion: 1\ndisplayName: Stack 01\nicon: notebook\norder:\n  - \"a.md\"\n  - \"b.md\"\n  - \"c.md\"\nreferences: []\n---\n",
    });
    withVaultIndex([], [
      { path: "/v/A/Stack 01/a.md", name: "a" },
      { path: "/v/A/Stack 01/b.md", name: "b" },
      { path: "/v/A/Stack 01/c.md", name: "c" },
    ]);
    const container = document.createElement("div");
    const cache = createPreviewCache();
    await renderStackPanel(container, {
      stackPath: "/v/A/Stack 01",
      cache,
      onNoteClick: vi.fn(),
      onNoteContextMenu: vi.fn(),
      onNoteRenameCommit: async () => ({ ok: true }),
      onCreateNote: async () => null,
    });
    const boxes = container.querySelectorAll(
      ".fv-collection-note-box[data-path]",
    );
    expect(boxes.length).toBe(3);
    const paths = Array.from(boxes).map((el) => el.getAttribute("data-path"));
    expect(paths).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("FR-30 / EC-10 — drag-reorder dispatches store.reorderNote with toIndex", async () => {
    withFs({
      "/v/A/Stack 01/_folder.md":
        "---\nschemaVersion: 1\ndisplayName: Stack 01\nicon: notebook\norder:\n  - \"a.md\"\n  - \"b.md\"\n  - \"c.md\"\nreferences: []\n---\n",
    });
    withVaultIndex([], [
      { path: "/v/A/Stack 01/a.md", name: "a" },
      { path: "/v/A/Stack 01/b.md", name: "b" },
      { path: "/v/A/Stack 01/c.md", name: "c" },
    ]);
    const reorderSpy = vi.spyOn(store, "reorderNote").mockResolvedValue({
      ok: true,
      value: undefined,
    });
    const container = document.createElement("div");
    const cache = createPreviewCache();
    await renderStackPanel(container, {
      stackPath: "/v/A/Stack 01",
      cache,
      onNoteClick: vi.fn(),
      onNoteContextMenu: vi.fn(),
      onNoteRenameCommit: async () => ({ ok: true }),
      onCreateNote: async () => null,
    });
    // The mock captured one attach call per canonical box (3 calls).
    expect(dragAttachCalls.length).toBe(3);
    // Find the attach call for `b.md` and replay onReorder with a new sequence
    // that moves `b.md` to position 0 (drag to top).
    const bCall = dragAttachCalls.find((c) => c.id === "b.md");
    expect(bCall).toBeDefined();
    bCall!.onReorder(["b.md", "a.md", "c.md"]);
    expect(reorderSpy).toHaveBeenCalledWith(
      "/v/A/Stack 01",
      "b.md",
      { toIndex: 0 },
    );
  });

  it("FR-30 — reorder persists across a re-read of the Stack", async () => {
    // No mock on reorderNote — we want the real store to round-trip through
    // the in-memory fs and verify the order: array is the new sequence on
    // the next readStack.
    const fs = withFs({
      "/v/A/Stack 01/_folder.md":
        "---\nschemaVersion: 1\ndisplayName: Stack 01\nicon: notebook\norder:\n  - \"a.md\"\n  - \"b.md\"\n  - \"c.md\"\nreferences: []\n---\n",
    });
    withVaultIndex([], [
      { path: "/v/A/Stack 01/a.md", name: "a" },
      { path: "/v/A/Stack 01/b.md", name: "b" },
      { path: "/v/A/Stack 01/c.md", name: "c" },
    ]);
    const container = document.createElement("div");
    const cache = createPreviewCache();
    await renderStackPanel(container, {
      stackPath: "/v/A/Stack 01",
      cache,
      onNoteClick: vi.fn(),
      onNoteContextMenu: vi.fn(),
      onNoteRenameCommit: async () => ({ ok: true }),
      onCreateNote: async () => null,
    });
    const cCall = dragAttachCalls.find((c) => c.id === "c.md");
    expect(cCall).toBeDefined();
    cCall!.onReorder(["c.md", "a.md", "b.md"]);
    // Wait one microtask flush so the async writeFile lands.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reread = await store.readStack("/v/A/Stack 01");
    if (!reread.ok) throw new Error("readStack failed");
    expect(reread.value.order).toEqual(["c.md", "a.md", "b.md"]);
    // Sanity: the underlying fs was actually written through.
    expect(fs.get("/v/A/Stack 01/_folder.md")).toContain("- \"c.md\"");
  });

  it("EC-12 / FR-33 — drag wiring is scoped to the Stack panel's list container", async () => {
    // The structural defence against cross-Stack drag: `attachFolderItemDrag`
    // receives the panel's `listEl` as the container scope. Any drag whose
    // drop target is outside that container is ignored by the util's sibling
    // lookup, so no `onReorder` is fired for an out-of-scope drop. This test
    // asserts the wiring contract — same container for every box.
    withFs({
      "/v/A/Stack 01/_folder.md":
        "---\nschemaVersion: 1\ndisplayName: Stack 01\nicon: notebook\norder:\n  - \"a.md\"\n  - \"b.md\"\nreferences: []\n---\n",
    });
    withVaultIndex([], [
      { path: "/v/A/Stack 01/a.md", name: "a" },
      { path: "/v/A/Stack 01/b.md", name: "b" },
    ]);
    const container = document.createElement("div");
    const cache = createPreviewCache();
    await renderStackPanel(container, {
      stackPath: "/v/A/Stack 01",
      cache,
      onNoteClick: vi.fn(),
      onNoteContextMenu: vi.fn(),
      onNoteRenameCommit: async () => ({ ok: true }),
      onCreateNote: async () => null,
    });
    const uniqueContainers = new Set(dragAttachCalls.map((c) => c.container));
    expect(uniqueContainers.size).toBe(1);
    // The container is the Stack panel's list element — verify by class.
    const listEl = [...uniqueContainers][0];
    expect(listEl.classList.contains("fv-collection-stack-list")).toBe(true);
  });

  it("data-path attribute is set on every canonical note box (sanity)", async () => {
    withFs({
      "/v/A/Stack 01/_folder.md":
        "---\nschemaVersion: 1\ndisplayName: Stack 01\nicon: notebook\norder:\n  - \"x.md\"\nreferences: []\n---\n",
    });
    const container = document.createElement("div");
    const cache = createPreviewCache();
    await renderStackPanel(container, {
      stackPath: "/v/A/Stack 01",
      cache,
      onNoteClick: vi.fn(),
      onNoteContextMenu: vi.fn(),
      onNoteRenameCommit: async () => ({ ok: true }),
      onCreateNote: async () => null,
    });
    const boxes = container.querySelectorAll(".fv-collection-note-box");
    for (const box of boxes) {
      const dp = box.getAttribute("data-path");
      expect(dp).toBeTruthy();
    }
  });
});

describe("drag-reorder: home-canvas (R06)", () => {
  it("FR-31 — every Stack tile has data-path = subfolder basename", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\nlayout: collection-home\ndisplayName: A\nstackOrder: []\n---\n",
    });
    withVaultIndex(["/v/A/Sub A", "/v/A/Sub B"]);
    const container = document.createElement("div");
    await renderHomeCanvas(container, makeHomeOpts());
    const tiles = container.querySelectorAll(".fv-collection-stack-glyph[data-path]");
    expect(tiles.length).toBe(2);
    const paths = Array.from(tiles).map((el) => el.getAttribute("data-path"));
    expect(paths).toEqual(["Sub A", "Sub B"]);
  });

  it("FR-31 / EC-11 — drag-reorder on a Stack tile persists the combined childOrder", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\nlayout: collection-home\ndisplayName: A\nstackOrder:\n  - \"S1\"\n  - \"S2\"\n  - \"S3\"\n---\n",
    });
    withVaultIndex(["/v/A/S1", "/v/A/S2", "/v/A/S3"]);
    const writeSpy = vi.spyOn(store, "writeCollectionMeta").mockResolvedValue({
      ok: true,
      value: undefined,
    });
    const container = document.createElement("div");
    await renderHomeCanvas(container, makeHomeOpts());
    // One attach per tile (3). Replay onReorder for the S2 tile dragged to
    // the head of the list.
    const tileCalls = dragAttachCalls.filter((c) =>
      c.el.classList.contains("fv-collection-stack-glyph"),
    );
    expect(tileCalls.length).toBe(3);
    const s2Call = tileCalls.find((c) => c.id === "S2");
    expect(s2Call).toBeDefined();
    s2Call!.onReorder(["S2", "S1", "S3"]);
    expect(writeSpy).toHaveBeenCalledWith(
      "/v/A",
      { childOrder: ["S2", "S1", "S3"] },
    );
  });

  it("EC-12 — a drag callback that yields no movement still rewrites childOrder idempotently", async () => {
    // If the drag util ever fires onReorder with the unchanged order, the
    // store call still executes (the new childOrder equals the current one,
    // an idempotent rewrite). Asserted explicitly so a future refactor does
    // not silently drop the call.
    withFs({
      "/v/A/_folder.md":
        "---\nlayout: collection-home\ndisplayName: A\nstackOrder:\n  - \"S1\"\n  - \"S2\"\n---\n",
    });
    withVaultIndex(["/v/A/S1", "/v/A/S2"]);
    const writeSpy = vi.spyOn(store, "writeCollectionMeta").mockResolvedValue({
      ok: true,
      value: undefined,
    });
    const container = document.createElement("div");
    await renderHomeCanvas(container, makeHomeOpts());
    const s1Call = dragAttachCalls.find(
      (c) => c.el.classList.contains("fv-collection-stack-glyph") && c.id === "S1",
    );
    s1Call!.onReorder(["S1", "S2"]);
    expect(writeSpy).toHaveBeenCalledWith(
      "/v/A",
      { childOrder: ["S1", "S2"] },
    );
  });

  it("FR-10 — parent-folder note boxes on the Home canvas carry data-path", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\nlayout: collection-home\ndisplayName: A\nstackOrder: []\n---\n",
    });
    withVaultIndex([], [{ path: "/v/A/Hello.md", name: "Hello" }]);
    const container = document.createElement("div");
    await renderHomeCanvas(container, makeHomeOpts());
    const box = container.querySelector(".fv-collection-note-box[data-path]");
    expect(box).not.toBeNull();
    expect(box?.getAttribute("data-path")).toBe("Hello.md");
  });

  it("parent-folder note drag persists the combined childOrder (Stacks and notes interleave)", async () => {
    // Refactor: previously the Home canvas separated stackOrder + noteOrder
    // and parent-folder note drag was a no-op (DW-R2). Now Stacks and notes
    // share one childOrder field so the user can freely interleave them.
    // Replaying onReorder on a note-box attach call should write the full
    // sibling sequence to childOrder via writeCollectionMeta.
    withFs({
      "/v/A/_folder.md":
        "---\nlayout: collection-home\ndisplayName: A\nstackOrder: []\n---\n",
    });
    withVaultIndex(
      [],
      [
        { path: "/v/A/N1.md", name: "N1" },
        { path: "/v/A/N2.md", name: "N2" },
      ],
    );
    const writeSpy = vi.spyOn(store, "writeCollectionMeta").mockResolvedValue({
      ok: true,
      value: undefined,
    });
    const container = document.createElement("div");
    await renderHomeCanvas(container, makeHomeOpts());
    const noteCall = dragAttachCalls.find(
      (c) => c.el.classList.contains("fv-collection-note-box"),
    );
    expect(noteCall).toBeDefined();
    noteCall!.onReorder(["N2.md", "N1.md"]);
    expect(writeSpy).toHaveBeenCalledWith(
      "/v/A",
      { childOrder: ["N2.md", "N1.md"] },
    );
  });
});

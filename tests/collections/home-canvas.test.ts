/**
 * tests/collections/home-canvas.test.ts — step_06
 *
 * Asserts the Home canvas renderer (frame 01 + frame 04):
 *   - Empty Collection → frame-01 dashed-rectangle with `+ Notecard/Stack`.
 *   - Populated Collection → one glyph per Stack in stackOrder order, badge
 *     showing noteCount = order.length + references.length, click-to-open,
 *     right-click context menu with exactly five items.
 *   - Stale `stackOrder` entries pointing to non-existent folders are dropped.
 *   - Empty `+ Notecard/Stack` popover offers Stack and Notecard buttons.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as bridge from "../../src/lib/bridge";
import * as vaultManager from "../../src/lib/vault-manager";
import {
  renderHomeCanvas,
  buildStackGlyphContextItems,
  type HomeCanvasOptions,
} from "../../src/plugins/file-browser/collections/home-canvas";
import { showNotecardStackPopover } from "../../src/plugins/file-browser/collections/popover";
import type { VaultIndex } from "../../src/lib/vault-types";

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
  // Refactor R05: tests now need to seed both directories AND .md files so
  // the Home canvas can render its mixed-grid (subfolder tiles + parent's
  // own note boxes). `notes[i].name` is the filename stem (without ".md");
  // `notes[i].path` is the absolute file path on disk.
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

function makeOpts(overrides: Partial<HomeCanvasOptions> = {}): HomeCanvasOptions {
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

beforeEach(() => vi.restoreAllMocks());

describe("home-canvas: empty state (step_06)", () => {
  it("FR-16 — empty Collection renders frame-01 empty state with + Notecard/Stack button", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\ntype: collection\ndisplayName: A\nstackOrder: []\n---\n",
    });
    withVaultIndex([]);
    const container = document.createElement("div");
    await renderHomeCanvas(container, makeOpts());
    const empty = container.querySelector(".fv-collection-empty-state");
    expect(empty).not.toBeNull();
    const btn = container.querySelector(".fv-collection-empty-state-button");
    expect(btn?.textContent).toContain("+ Notecard/Stack");
  });

  it("EC-9 — delete last Stack returns container to frame-01 empty state on next render", async () => {
    const fs = withFs({
      "/v/A/_folder.md":
        "---\ntype: collection\ndisplayName: A\nstackOrder:\n  - \"Stack 01\"\n---\n",
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder: []\nreferences: []\n---\n",
    });
    withVaultIndex(["/v/A/Stack 01"]);
    const container = document.createElement("div");
    await renderHomeCanvas(container, makeOpts());
    expect(container.querySelectorAll(".fv-collection-stack-glyph").length).toBe(1);
    // Simulate the last Stack being deleted.
    fs.set(
      "/v/A/_folder.md",
      "---\ntype: collection\ndisplayName: A\nstackOrder: []\n---\n",
    );
    withVaultIndex([]);
    await renderHomeCanvas(container, makeOpts());
    expect(container.querySelector(".fv-collection-empty-state")).not.toBeNull();
  });
});

describe("home-canvas: populated (step_06)", () => {
  it("FR-13 / FR-14 — renders one glyph per stack in stackOrder", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\ntype: collection\ndisplayName: A\nstackOrder:\n  - \"Stack 01\"\n  - \"Stack 02\"\n---\n",
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder: []\nreferences: []\n---\n",
      "/v/A/Stack 02/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 02\nicon: book\norder: []\nreferences: []\n---\n",
    });
    withVaultIndex(["/v/A/Stack 01", "/v/A/Stack 02"]);
    const container = document.createElement("div");
    await renderHomeCanvas(container, makeOpts());
    const glyphs = container.querySelectorAll(".fv-collection-stack-glyph");
    expect(glyphs.length).toBe(2);
    // DOM order matches stackOrder (Stack 01 first, Stack 02 second).
    expect(glyphs[0].textContent).toContain("Stack 01");
    expect(glyphs[1].textContent).toContain("Stack 02");
  });

  it("FR-13 — stack glyph noteCount = physical .md files in Stack + references.length", async () => {
    // 2026-06-09 update: the badge now counts physical .md children of
    // the Stack folder (filesystem truth), not the `order:` array.
    // Files dropped in via drag increment the badge immediately on
    // next render, even before the Stack's metadata is rewritten.
    withFs({
      "/v/A/_folder.md":
        "---\ntype: collection\ndisplayName: A\nstackOrder:\n  - \"Stack 01\"\n---\n",
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder:\n  - \"A.md\"\n  - \"B.md\"\nreferences:\n  - \"Other/X.md\"\n---\n",
    });
    // Two physical notes in the Stack + one reference = badge "3".
    withVaultIndex(["/v/A/Stack 01"], [
      { path: "/v/A/Stack 01/A.md", name: "A" },
      { path: "/v/A/Stack 01/B.md", name: "B" },
    ]);
    const container = document.createElement("div");
    await renderHomeCanvas(container, makeOpts());
    const badge = container.querySelector(".fv-collection-badge");
    expect(badge?.textContent).toBe("3");
  });

  it("EC-22 — stack glyph renders the canonical Stack SVG (icon-Stack.svg)", async () => {
    // Per the 2026-06-09 directive, Stack tiles use the fixed
    // icon-Stack.svg visual (5 curved stack lines + top-card outline).
    // Per-folder icon override for Stacks is regressed (DW-15) until
    // explicitly re-enabled.
    withFs({
      "/v/A/_folder.md":
        "---\ntype: collection\ndisplayName: A\nstackOrder:\n  - \"Stack 01\"\n---\n",
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder: []\nreferences: []\n---\n",
    });
    withVaultIndex(["/v/A/Stack 01"]);
    const container = document.createElement("div");
    await renderHomeCanvas(container, makeOpts());
    const iconWrap = container.querySelector(
      ".fv-collection-stack-glyph .fv-collection-note-box-icon",
    );
    expect(iconWrap).not.toBeNull();
    // The Stack SVG has 5 stroked stack-line paths + 1 top-card path = 6 total.
    expect(iconWrap?.querySelectorAll("svg path").length).toBe(6);
  });

  it("FR-15 — clicking a stack glyph calls onStackClick with the Stack's absolute path", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\ntype: collection\ndisplayName: A\nstackOrder:\n  - \"Stack 01\"\n---\n",
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder: []\nreferences: []\n---\n",
    });
    withVaultIndex(["/v/A/Stack 01"]);
    const onStackClick = vi.fn();
    const container = document.createElement("div");
    await renderHomeCanvas(container, makeOpts({ onStackClick }));
    const glyph = container.querySelector(".fv-collection-stack-glyph") as HTMLElement;
    glyph.click();
    expect(onStackClick).toHaveBeenCalledWith("/v/A/Stack 01");
  });

  it("FR-14 — clicking + affordance opens Note/Stack menu; picking Stack calls onCreateStack", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\ntype: collection\ndisplayName: A\nstackOrder:\n  - \"Stack 01\"\n---\n",
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder: []\nreferences: []\n---\n",
    });
    withVaultIndex(["/v/A/Stack 01"]);
    const onCreateStack = vi.fn().mockResolvedValue(undefined);
    const container = document.createElement("div");
    await renderHomeCanvas(container, makeOpts({ onCreateStack }));
    const addBtn = container.querySelector(".fv-collection-add-stack-affordance") as HTMLElement;
    addBtn.click();
    // The click now opens the popover menu (Note / Stack); user picks Stack.
    const items = document.querySelectorAll(".fv-collection-popover-item");
    const stackItem = Array.from(items).find((i) => i.textContent === "Stack") as HTMLElement;
    expect(stackItem).toBeDefined();
    stackItem.click();
    expect(onCreateStack).toHaveBeenCalled();
    document.querySelector(".fv-collection-popover")?.remove();
  });

  it("FR-14 — context items for a stack glyph are exactly Rename / Move up / Move down / Set folder icon… / Delete", () => {
    const items = buildStackGlyphContextItems();
    expect(items.map((i) => i.label)).toEqual([
      "Rename",
      "Move up",
      "Move down",
      "Set folder icon…",
      "Delete",
    ]);
  });

  it("FR-14 — stack glyph order matches stackOrder, not directory listing", async () => {
    // stackOrder lists Z then A; if the renderer sorted by name, the test
    // would fail. The store reads stackOrder verbatim.
    withFs({
      "/v/A/_folder.md":
        "---\ntype: collection\ndisplayName: A\nstackOrder:\n  - \"Z\"\n  - \"A\"\n---\n",
      "/v/A/Z/_folder.md":
        "---\ntype: stack\ndisplayName: Z\nicon: notebook\norder: []\nreferences: []\n---\n",
      "/v/A/A/_folder.md":
        "---\ntype: stack\ndisplayName: A\nicon: notebook\norder: []\nreferences: []\n---\n",
    });
    withVaultIndex(["/v/A/Z", "/v/A/A"]);
    const container = document.createElement("div");
    await renderHomeCanvas(container, makeOpts());
    const labels = Array.from(
      container.querySelectorAll(".fv-collection-stack-label"),
    ).map((el) => el.textContent);
    expect(labels).toEqual(["Z", "A"]);
  });

  it("EC-8 — stale stackOrder entries pointing to missing folders are silently dropped", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\ntype: collection\ndisplayName: A\nstackOrder:\n  - \"Stack 01\"\n  - \"Ghost\"\n---\n",
      "/v/A/Stack 01/_folder.md":
        "---\ntype: stack\ndisplayName: Stack 01\nicon: notebook\norder: []\nreferences: []\n---\n",
    });
    // "/v/A/Ghost" is NOT in the vault index — should be dropped from render.
    withVaultIndex(["/v/A/Stack 01"]);
    const container = document.createElement("div");
    await renderHomeCanvas(container, makeOpts());
    expect(container.querySelectorAll(".fv-collection-stack-glyph").length).toBe(1);
  });
});

describe("home-canvas: popover (step_06)", () => {
  it("FR-5 — + popover offers Note and Stack (context-menu chrome)", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    showNotecardStackPopover(anchor, { onStack: vi.fn(), onNotecard: vi.fn() });
    const items = document.querySelectorAll(".fv-collection-popover-item");
    const labels = Array.from(items).map((i) => i.textContent);
    expect(labels).toEqual(["Note", "Stack"]);
    // The menu reuses the file-browser context-menu chrome (FILE_BROWSER_CSS).
    expect(document.querySelector(".context-menu.fv-collection-popover")).not.toBeNull();
    anchor.remove();
    document.querySelector(".fv-collection-popover")?.remove();
  });

  it("EC-12 — popover Note item calls onCreateNotecard handler", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const onNotecard = vi.fn();
    showNotecardStackPopover(anchor, { onStack: vi.fn(), onNotecard });
    const items = document.querySelectorAll(".fv-collection-popover-item");
    const noteItem = Array.from(items).find(
      (i) => i.textContent === "Note",
    ) as HTMLElement;
    noteItem.click();
    expect(onNotecard).toHaveBeenCalled();
    anchor.remove();
    document.querySelector(".fv-collection-popover")?.remove();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Refactor R05 — filesystem-derived subfolder rendering.
//
// The Home canvas no longer derives the displayed tile list from `stackOrder:`
// membership. Instead, it iterates the parent folder's immediate subfolders
// from the vault index and applies `stackOrder:` as a manual-ordering array
// (head from order, tail in directory listing order, unknown entries dropped).
// Additionally, the parent's own immediate `.md` files render as note boxes
// alongside the Stack tiles (FR-10 group 2).
// ─────────────────────────────────────────────────────────────────────────────

describe("home-canvas: filesystem-derived subfolders (R05)", () => {
  it("FR-10 group 1 — subfolders render as Stack tiles when stackOrder is empty", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\nlayout: collection-home\ndisplayName: A\nstackOrder: []\n---\n",
    });
    withVaultIndex(["/v/A/Sub A", "/v/A/Sub B"]);
    const container = document.createElement("div");
    await renderHomeCanvas(container, makeOpts());
    const tiles = container.querySelectorAll(".fv-collection-stack-glyph");
    expect(tiles.length).toBe(2);
    // Each tile carries data-path = subfolder basename so step_R06's drag
    // wiring can read consistent IDs.
    expect(tiles[0].getAttribute("data-path")).toBe("Sub A");
    expect(tiles[1].getAttribute("data-path")).toBe("Sub B");
  });

  it("FR-10 group 1 — stackOrder reorders existing subfolders; unknown entries drop", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\nlayout: collection-home\ndisplayName: A\nstackOrder:\n  - \"B\"\n  - \"ZZZ\"\n---\n",
    });
    // Vault index has A, B, C; stackOrder: ["B", "ZZZ"]. Expected tile order:
    // B (from order), then A and C (auto-appended, in directory order). ZZZ
    // is dropped because no such subfolder exists.
    withVaultIndex(["/v/A/A", "/v/A/B", "/v/A/C"]);
    const container = document.createElement("div");
    await renderHomeCanvas(container, makeOpts());
    const tiles = container.querySelectorAll(".fv-collection-stack-glyph");
    const paths = Array.from(tiles).map((el) => el.getAttribute("data-path"));
    expect(paths).toEqual(["B", "A", "C"]);
  });

  it("EC-5 — subfolder without _folder.md renders as a Stack tile with basename label", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\nlayout: collection-home\ndisplayName: A\nstackOrder: []\n---\n",
      // No /v/A/Lonely/_folder.md — readFile for that path will return ENOENT,
      // and readStack falls back to defaults.
    });
    withVaultIndex(["/v/A/Lonely"]);
    const container = document.createElement("div");
    await renderHomeCanvas(container, makeOpts());
    const tile = container.querySelector(".fv-collection-stack-glyph");
    expect(tile).not.toBeNull();
    // Canonical icon-Stack.svg renders as 6 stroked paths in an inline SVG.
    expect(tile?.querySelectorAll("svg path").length).toBe(6);
    expect(tile?.textContent).toContain("Lonely");
  });

  it("EC-6 — subfolder with _folder.md but no layout: inherits Collections rendering", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\nlayout: collection-home\ndisplayName: A\nstackOrder: []\n---\n",
      "/v/A/Custom/_folder.md":
        "---\nschemaVersion: 1\ndisplayName: Custom\nicon: book\norder: []\nreferences: []\n---\n",
    });
    withVaultIndex(["/v/A/Custom"]);
    const container = document.createElement("div");
    await renderHomeCanvas(container, makeOpts());
    const tile = container.querySelector(".fv-collection-stack-glyph");
    expect(tile).not.toBeNull();
    // Subfolder displayName is used for the label. Icon is the canonical
    // Stack visual regardless of the subfolder's `icon:` frontmatter value
    // (per-folder icon override for Stacks is regressed — DW-15).
    expect(tile?.querySelectorAll("svg path").length).toBe(6);
    expect(tile?.textContent).toContain("Custom");
  });

  it("FR-10 group 2 — parent's own .md files render as note boxes alongside Stack tiles", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\nlayout: collection-home\ndisplayName: A\nstackOrder: []\n---\n",
    });
    withVaultIndex(
      ["/v/A/Sub A"],
      [
        { path: "/v/A/Note 1.md", name: "Note 1" },
        { path: "/v/A/Note 2.md", name: "Note 2" },
      ],
    );
    const container = document.createElement("div");
    await renderHomeCanvas(container, makeOpts());
    const tiles = container.querySelectorAll(".fv-collection-stack-glyph");
    const boxes = container.querySelectorAll(".fv-collection-note-box");
    expect(tiles.length).toBe(1);
    expect(boxes.length).toBe(2);
  });

  it("FR-23 — _folder.md is excluded from the rendered note-box list", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\nlayout: collection-home\ndisplayName: A\nstackOrder: []\n---\n",
    });
    // The vault indexer normally excludes `_folder.md` from `entries`, but if
    // a test (or buggy index build) included it, our renderer must still drop
    // it from the displayed list. We pass it explicitly to guard the behaviour.
    withVaultIndex(
      [],
      [
        { path: "/v/A/_folder.md", name: "_folder" },
        { path: "/v/A/Real Note.md", name: "Real Note" },
      ],
    );
    const container = document.createElement("div");
    await renderHomeCanvas(container, makeOpts());
    const boxes = container.querySelectorAll(".fv-collection-note-box");
    expect(boxes.length).toBe(1);
    expect(boxes[0].getAttribute("data-path")).toBe("Real Note.md");
  });

  it("EC-9 — folder with zero subfolders AND zero .md files renders the empty-state popover", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\nlayout: collection-home\ndisplayName: A\nstackOrder: []\n---\n",
    });
    withVaultIndex([]);
    const container = document.createElement("div");
    await renderHomeCanvas(container, makeOpts());
    expect(container.querySelector(".fv-collection-empty-state")).not.toBeNull();
    // No mixed grid in empty state.
    expect(container.querySelector(".fv-collection-glyph-grid")).toBeNull();
  });

  it("FR-11 — clicking + affordance opens menu; picking Stack calls onCreateStack", async () => {
    withFs({
      "/v/A/_folder.md":
        "---\nlayout: collection-home\ndisplayName: A\nstackOrder: []\n---\n",
    });
    withVaultIndex(["/v/A/Stack 01"]);
    const onCreateStack = vi.fn().mockResolvedValue(undefined);
    const container = document.createElement("div");
    await renderHomeCanvas(container, makeOpts({ onCreateStack }));
    const addBtn = container.querySelector(
      ".fv-collection-add-stack-affordance",
    ) as HTMLElement;
    addBtn.click();
    const items = document.querySelectorAll(".fv-collection-popover-item");
    const stackItem = Array.from(items).find((i) => i.textContent === "Stack") as HTMLElement;
    expect(stackItem).toBeDefined();
    stackItem.click();
    expect(onCreateStack).toHaveBeenCalled();
    document.querySelector(".fv-collection-popover")?.remove();
  });

  it("FR-10 — note-box data-path on the Home canvas is the filename (basename)", async () => {
    // The drag UI (R06) reads `data-path` to identify items. For parent-folder
    // notes on the Home canvas the value is the filename basename, matching
    // the semantics of stackOrder/order (basenames, not absolute paths).
    withFs({
      "/v/A/_folder.md":
        "---\nlayout: collection-home\ndisplayName: A\nstackOrder: []\n---\n",
    });
    withVaultIndex([], [{ path: "/v/A/Hello.md", name: "Hello" }]);
    const container = document.createElement("div");
    await renderHomeCanvas(container, makeOpts());
    const box = container.querySelector(".fv-collection-note-box");
    expect(box?.getAttribute("data-path")).toBe("Hello.md");
  });
});

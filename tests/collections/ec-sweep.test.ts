/**
 * tests/collections/ec-sweep.test.ts — step_18 + refactor R01–R08
 *
 * Final EC audit / gap-fill. Every EC-1..EC-28 is covered by an earlier step
 * (see `docs/specs/collections/00_index.md`). This file adds defensive
 * cross-checks for the items most likely to regress over time:
 *
 *   EC-14 / EC-16 — window-size invariant. Re-run alongside the Collections
 *           suite so a single `tests/collections/` invocation surfaces drift.
 *   EC-15 — vault-index excludes `_folder.md` (regression guard for
 *           buildFolderViewSet).
 *   EC-28 — "Make Collection" / "Unmake Collection" entries are absent from
 *           every entry surface (right-click, command-bar, keybindings, public
 *           API). Added in step_R01 of the refactor.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as bridge from "../../src/lib/bridge";
import * as vaultManager from "../../src/lib/vault-manager";
import { DEFAULT_SETTINGS } from "../../src/lib/settings";
import { newStack, createNoteInStack }
  from "../../src/plugins/file-browser/collections/commands";
import * as commandsModule
  from "../../src/plugins/file-browser/collections/commands";
import * as contextActionsModule
  from "../../src/plugins/file-browser/collections/context-actions";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function withFs(initial: Record<string, string>): Map<string, string> {
  const fs = new Map(Object.entries(initial));
  vi.spyOn(bridge, "readFile").mockImplementation(async (path: string) => {
    if (fs.has(path)) return { ok: true as const, value: fs.get(path)! };
    return { ok: false as const, error: { message: "ENOENT", command: "read_file", path } };
  });
  vi.spyOn(bridge, "writeFile").mockImplementation(
    async (path: string, content: string) => {
      fs.set(path, content);
      return { ok: true as const, value: undefined };
    },
  );
  vi.spyOn(bridge, "ensureDirectory").mockImplementation(async () => {});
  return fs;
}

function withVault(roots: string[] = ["/v"]) {
  vi.spyOn(vaultManager, "getActiveVault").mockReturnValue({
    id: "t",
    name: "t",
    rootPaths: roots,
    created: "",
    lastOpened: "",
    excludePatterns: [],
    maxIndexSize: 500,
  });
  vi.spyOn(vaultManager, "getVaultIndex").mockReturnValue({
    vaultId: "t",
    builtAt: 0,
    entries: [],
    totalFilesFound: 0,
    skippedCount: 0,
    capped: false,
  });
}

beforeEach(() => vi.restoreAllMocks());

describe("ec-sweep: invariants and round-trips (step_18 + refactor)", () => {
  it("EC-14 / EC-16 — DEFAULT_SETTINGS window invariant (sizeW='50%', sizeH='80%')", () => {
    expect(DEFAULT_SETTINGS.window.sizeW).toBe("50%");
    expect(DEFAULT_SETTINGS.window.sizeH).toBe("80%");
  });

  it("FR-23 — adding notes via newStack + createNoteInStack writes empty .md content (post-refactor data shape sanity)", async () => {
    // The pre-refactor EC-23 round-trip exercised Make → ... → Unmake which
    // no longer exist. This much simpler check confirms the create path still
    // writes empty Markdown files via the bridge — a load-bearing piece of the
    // surviving command surface.
    const fs = withFs({
      "/v/A/_folder.md":
        "---\nschemaVersion: 1\nlayout: collection-home\ndisplayName: A\nstackOrder: []\n---\n",
    });
    withVault();
    const r = await newStack("/v/A");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const noteRes = await createNoteInStack(r.value.stackPath);
    expect(noteRes.ok).toBe(true);
    if (!noteRes.ok) return;
    expect(fs.get(noteRes.value.notePath)).toBe("");
  });

  // EC-28 — the entire "Make Collection" ceremony is gone. The four
  // assertions below cover: (a) commands module no longer exports the symbols,
  // (b) context-actions module no longer exports the builder, (c) the
  // keybindings COMMANDS array no longer lists the make-collection id, and
  // (d) main.ts no longer dispatches the case label.
  it("EC-28 / FR-60 — commands.ts no longer exports makeCollection / unmakeCollection", () => {
    expect((commandsModule as Record<string, unknown>).makeCollection).toBeUndefined();
    expect((commandsModule as Record<string, unknown>).unmakeCollection).toBeUndefined();
  });

  it("EC-28 / FR-60 — context-actions.ts no longer exports buildMakeUnmakeCollectionItem", () => {
    expect(
      (contextActionsModule as Record<string, unknown>).buildMakeUnmakeCollectionItem,
    ).toBeUndefined();
  });

  it("EC-28 / FR-60 — keybindings COMMANDS array does NOT include collection:make-collection or collection:unmake-collection", async () => {
    const { COMMANDS } = await import("../../src/keybindings/keybindings-panel");
    expect(COMMANDS.find((c) => c.id === "collection:make-collection")).toBeUndefined();
    expect(COMMANDS.find((c) => c.id === "collection:unmake-collection")).toBeUndefined();
  });

  it("EC-28 / FR-60 — main.ts source no longer dispatches `collection:make-collection`", () => {
    // Read main.ts as raw text; assert the literal case-label string is gone.
    // This catches accidental reintroduction of the dispatcher case block.
    const mainPath = resolve(__dirname, "../../src/main.ts");
    const content = readFileSync(mainPath, "utf-8");
    expect(content).not.toContain('"collection:make-collection"');
    expect(content).not.toContain('"collection:unmake-collection"');
  });

  it("EC-1 — LAYOUT_RENDERERS does NOT have an entry for an invalid layout value (fallback path)", async () => {
    // EC-1 (refactor): a folder whose _folder.md sets `layout: <unknown>`
    // falls back to the standard fallback renderer in tab.ts. The dispatch
    // logic gates on `LAYOUT_RENDERERS[layoutKey]` being truthy; this
    // test asserts that nonsense layout keys are NOT present in the map,
    // so the dispatch will fall through to renderFallback as designed.
    const { LAYOUT_RENDERERS } = await import(
      "../../src/plugins/file-browser/folder-view/tab"
    );
    expect(LAYOUT_RENDERERS["zzz-nonsense"]).toBeUndefined();
    expect(LAYOUT_RENDERERS["definitely-not-a-real-layout"]).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Refactor R08 — consolidating EC audit. Each block below maps to an EC
  // from the refactor requirements doc and either references the dedicated
  // test that exercises the behaviour or asserts a public-surface contract
  // that catches accidental regressions.
  // ─────────────────────────────────────────────────────────────────────────

  it("EC-19 (refactor) — writeCollectionMeta refuses when on-disk schemaVersion is newer than the build", async () => {
    // EC-19 (refactor numbering = old EC-13 from the MVP). Direct assertion
    // here rather than relying on store.test.ts as the sole defence — a
    // future refactor touching the writer could silently regress this
    // contract without breaking the more narrowly-scoped store test.
    const { writeCollectionMeta } = await import(
      "../../src/plugins/file-browser/collections/store"
    );
    withFs({
      "/v/A/_folder.md":
        "---\nschemaVersion: 999\nlayout: collection-home\ndisplayName: A\nstackOrder: []\n---\n",
    });
    const r = await writeCollectionMeta("/v/A", { displayName: "Renamed" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toBe("schema-too-new");
  });

  it("EC-25 — Stack tile renders the canonical Stack SVG (icon-Stack.svg)", async () => {
    // Per the 2026-06-09 directive, Stack tiles always use the fixed
    // icon-Stack.svg visual regardless of the subfolder's `icon:`
    // frontmatter value. Per-folder icon override for Stacks is
    // regressed (DW-15) and tracked for future re-enablement.
    withFs({
      "/v/A/_folder.md":
        "---\nlayout: collection-home\ndisplayName: A\nstackOrder:\n  - \"S\"\n---\n",
      "/v/A/S/_folder.md":
        "---\nschemaVersion: 1\ndisplayName: S\nicon: bookshelf\norder: []\nreferences: []\n---\n",
    });
    vi.spyOn(vaultManager, "getVaultIndex").mockReturnValue({
      vaultId: "t",
      builtAt: 0,
      entries: [],
      totalFilesFound: 0,
      skippedCount: 0,
      capped: false,
      directories: ["/v/A/S"],
    });
    const { renderHomeCanvas } = await import(
      "../../src/plugins/file-browser/collections/home-canvas"
    );
    const container = document.createElement("div");
    await renderHomeCanvas(container, {
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
    });
    // icon-Stack.svg has 6 stroked paths total (5 stack lines + 1 top card).
    const tile = container.querySelector(".fv-collection-stack-glyph");
    expect(tile).not.toBeNull();
    expect(tile?.querySelectorAll("svg path").length).toBe(6);
    // Legacy folder-icon classes no longer apply to Stack tiles.
    expect(container.querySelector(".folder-icon-bookshelf")).toBeNull();
    expect(container.querySelector(".folder-icon-notebook")).toBeNull();
  });

  it("EC-27 — DISPLAY_REGISTRY exposes Collection as a pickable layout (active-pill smoke check)", async () => {
    // EC-27 — when a folder's _folder.md carries `layout: collection-home`,
    // the codeblock display picker shows "Collection" as the active pill.
    // Asserting the pill DOM here would require mounting the full
    // select-builder modal; the simpler equivalent contract is that the
    // registry entry exists with the right slug + label. The select-builder
    // looks up the entry by `state.display` and marks the matching pill
    // `is-active` — a one-line lookup in `select-builder.ts`.
    const { DISPLAY_REGISTRY } = await import(
      "../../src/plugins/file-browser/folder-view/display-options"
    );
    const entry = DISPLAY_REGISTRY.find((d) => d.slug === "collection-home");
    expect(entry).toBeDefined();
    expect(entry?.label).toBe("Collection");
  });

  it("EC-28 — main.ts source has no `Make Collection` / `Unmake Collection` literal strings", () => {
    // Belt-and-suspenders alongside the existing case-label assertion: the
    // human-facing strings themselves are gone too, so any future grep for
    // the feature name returns zero hits in main.ts.
    const mainPath = resolve(__dirname, "../../src/main.ts");
    const content = readFileSync(mainPath, "utf-8");
    expect(content).not.toContain("Make Collection");
    expect(content).not.toContain("Unmake Collection");
  });

  it("EC-28 — file-browser.plugin.ts has no `Make Collection` / `Unmake Collection` menu-item label", () => {
    // The right-click context menu source must not carry the legacy entry
    // labels as quoted menu-item labels. The step_R01 deletion left a
    // historical comment referencing the removed strings (intentional —
    // it explains the gap), so a plain `expect(content).not.toContain(...)`
    // would false-positive on that comment. Instead we assert the literal
    // menu-item shape (`label: "Make Collection"`) is absent — that's
    // what would actually re-introduce the entry to the right-click chrome.
    const pluginPath = resolve(
      __dirname,
      "../../src/plugins/file-browser/file-browser.plugin.ts",
    );
    const content = readFileSync(pluginPath, "utf-8");
    expect(content).not.toMatch(/label:\s*"Make Collection"/);
    expect(content).not.toMatch(/label:\s*"Unmake Collection"/);
  });

  it("EC-28 — detection-glue.ts no longer exists on disk", () => {
    // step_R03 deletes the file. A future patch that mistakenly re-creates
    // it would be caught here — the file's whole reason for existing was
    // the deleted short-circuit, so any new copy is a regression.
    const dgPath = resolve(
      __dirname,
      "../../src/plugins/file-browser/collections/detection-glue.ts",
    );
    expect(() => readFileSync(dgPath, "utf-8")).toThrow();
  });

  it("EC-15 regression — vault-index buildFolderViewSet still excludes _folder.md from .md enumeration", async () => {
    // Re-import the original detection.ts helper that's been shipped for a while
    // and verify Collections did not break it.
    const { buildFolderViewSet } = await import(
      "../../src/plugins/file-browser/folder-view/detection"
    );
    const set = buildFolderViewSet({
      vaultId: "t",
      builtAt: 0,
      entries: [
        {
          path: "/v/A/_folder.md",
          name: "_folder",
          modified: 0,
          size: 0,
          title: "",
          tags: [],
          outboundLinks: [],
        },
      ],
      totalFilesFound: 1,
      skippedCount: 0,
      capped: false,
    });
    expect(set.has("/v/A")).toBe(true);
    for (const p of set) expect(p.endsWith("_folder.md")).toBe(false);
  });
});

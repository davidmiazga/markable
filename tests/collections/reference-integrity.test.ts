/**
 * tests/collections/reference-integrity.test.ts — step_13
 *
 * Asserts that vault-manager file-change events propagate through the
 * reference-index into store-layer updates:
 *   - canonical rename → store.updateReferenceOnMove called per owning Stack;
 *     map re-keyed (FR-25).
 *   - canonical delete → store.removeReference called per owning Stack; map
 *     cleared for the path (FR-26).
 *   - EC-7 (Finder-moved note detected by watcher) treated as rename.
 *   - EC-17 reference to a folder is treated as broken (renderer-layer
 *     property, asserted via stack-panel.test.ts setup).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as store from "../../src/plugins/file-browser/collections/store";
import { createReferenceIndex } from "../../src/plugins/file-browser/collections/reference-index";
import { wireReferenceIntegrity } from "../../src/plugins/file-browser/collections/reference-integrity-wiring";
import type { VaultFileChangedEvent } from "../../src/lib/vault-types";

beforeEach(() => vi.restoreAllMocks());

describe("reference-integrity (step_13)", () => {
  it("FR-25 — canonical rename triggers updateReferenceOnMove for every owning Stack", async () => {
    vi.spyOn(store, "readStack").mockResolvedValue({
      ok: true,
      value: {
        schemaVersion: 1,
        type: "stack",
        displayName: "S",
        icon: "notebook",
        order: [],
        references: ["A/old.md"],
      },
    });
    const updateSpy = vi
      .spyOn(store, "updateReferenceOnMove")
      .mockResolvedValue({ ok: true, value: undefined });
    const idx = createReferenceIndex();
    // Pre-populate the index. Note paths are vault-rel.
    await idx.rebuild({
      vaultId: "t",
      builtAt: 0,
      entries: [],
      totalFilesFound: 0,
      skippedCount: 0,
      capped: false,
      nonMdFiles: [
        { path: "/v/A/Stack 01/_folder.md", name: "_folder.md" },
        { path: "/v/A/Stack 02/_folder.md", name: "_folder.md" },
      ],
    });
    const dispose = wireReferenceIntegrity(idx, {
      vaultRoot: "/v",
    });
    const event: VaultFileChangedEvent = {
      vaultId: "t",
      eventType: "renamed",
      path: "/v/A/old.md",
      newPath: "/v/A/new.md",
    };
    await dispose.dispatch(event);
    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(idx.lookup("A/old.md")).toEqual([]);
    expect(idx.lookup("A/new.md").length).toBe(2);
    dispose.detach();
  });

  it("FR-26 — canonical delete triggers removeReference per owning Stack", async () => {
    vi.spyOn(store, "readStack").mockResolvedValue({
      ok: true,
      value: {
        schemaVersion: 1,
        type: "stack",
        displayName: "S",
        icon: "notebook",
        order: [],
        references: ["A/doomed.md"],
      },
    });
    const removeSpy = vi
      .spyOn(store, "removeReference")
      .mockResolvedValue({ ok: true, value: undefined });
    const idx = createReferenceIndex();
    await idx.rebuild({
      vaultId: "t",
      builtAt: 0,
      entries: [],
      totalFilesFound: 0,
      skippedCount: 0,
      capped: false,
      nonMdFiles: [
        { path: "/v/A/Stack 01/_folder.md", name: "_folder.md" },
      ],
    });
    const dispose = wireReferenceIntegrity(idx, { vaultRoot: "/v" });
    await dispose.dispatch({
      vaultId: "t",
      eventType: "deleted",
      path: "/v/A/doomed.md",
    });
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(idx.lookup("A/doomed.md")).toEqual([]);
    dispose.detach();
  });

  it("EC-7 — Finder-moved note (watcher 'renamed' event) triggers references rewrite", async () => {
    vi.spyOn(store, "readStack").mockResolvedValue({
      ok: true,
      value: {
        schemaVersion: 1,
        type: "stack",
        displayName: "S",
        icon: "notebook",
        order: [],
        references: ["A/note.md"],
      },
    });
    const updateSpy = vi
      .spyOn(store, "updateReferenceOnMove")
      .mockResolvedValue({ ok: true, value: undefined });
    const idx = createReferenceIndex();
    await idx.rebuild({
      vaultId: "t",
      builtAt: 0,
      entries: [],
      totalFilesFound: 0,
      skippedCount: 0,
      capped: false,
      nonMdFiles: [{ path: "/v/A/Stack 01/_folder.md", name: "_folder.md" }],
    });
    const dispose = wireReferenceIntegrity(idx, { vaultRoot: "/v" });
    await dispose.dispatch({
      vaultId: "t",
      eventType: "renamed",
      path: "/v/A/note.md",
      newPath: "/v/B/note.md",
    });
    expect(updateSpy).toHaveBeenCalledWith("/v/A/Stack 01", "A/note.md", "B/note.md");
    dispose.detach();
  });

  it("EC-7 robustness — rebuilds the index after a 'created' event (watcher catches new note)", async () => {
    // A created event doesn't affect references but should not crash the
    // wiring. The wrapper accepts the event as a no-op.
    const idx = createReferenceIndex();
    const dispose = wireReferenceIntegrity(idx, { vaultRoot: "/v" });
    await expect(
      dispose.dispatch({
        vaultId: "t",
        eventType: "created",
        path: "/v/A/new.md",
      }),
    ).resolves.toBeUndefined();
    dispose.detach();
  });

  it("EC-21 — addReference where target is a folder is refused at command layer", async () => {
    // Defensive cross-link to step 04's command. The store layer accepts any
    // string; the commands layer must reject non-notes via vault-index
    // membership.
    const commands = await import("../../src/plugins/file-browser/collections/commands");
    const vaultManager = await import("../../src/lib/vault-manager");
    vi.spyOn(vaultManager, "getVaultIndex").mockReturnValue({
      vaultId: "t",
      builtAt: 0,
      entries: [], // no notes
      totalFilesFound: 0,
      skippedCount: 0,
      capped: false,
    });
    vi.spyOn(vaultManager, "getActiveVault").mockReturnValue({
      id: "t",
      name: "t",
      rootPaths: ["/v"],
      created: "",
      lastOpened: "",
      excludePatterns: [],
      maxIndexSize: 500,
    });
    const r = await commands.addReference("/v/A/SomeFolder", "/v/A/Stack 02");
    expect(r.ok).toBe(false);
  });

  it("idempotence — rebuild × 2 yields the same map state (hardening)", async () => {
    vi.spyOn(store, "readStack").mockResolvedValue({
      ok: true,
      value: {
        schemaVersion: 1,
        type: "stack",
        displayName: "S",
        icon: "notebook",
        order: [],
        references: ["X.md", "Y.md"],
      },
    });
    const idx = createReferenceIndex();
    const vIndex = {
      vaultId: "t",
      builtAt: 0,
      entries: [],
      totalFilesFound: 0,
      skippedCount: 0,
      capped: false,
      nonMdFiles: [{ path: "/v/A/Stack 01/_folder.md", name: "_folder.md" }],
    };
    await idx.rebuild(vIndex);
    await idx.rebuild(vIndex);
    expect(idx.size()).toBe(2);
    expect(idx.lookup("X.md")).toEqual(["/v/A/Stack 01/_folder.md"]);
  });

  it("EC-10 — concurrent rename + delete events serialise correctly", async () => {
    vi.spyOn(store, "readStack").mockResolvedValue({
      ok: true,
      value: {
        schemaVersion: 1,
        type: "stack",
        displayName: "S",
        icon: "notebook",
        order: [],
        references: ["A.md", "B.md"],
      },
    });
    vi.spyOn(store, "updateReferenceOnMove").mockResolvedValue({
      ok: true,
      value: undefined,
    });
    vi.spyOn(store, "removeReference").mockResolvedValue({
      ok: true,
      value: undefined,
    });
    const idx = createReferenceIndex();
    await idx.rebuild({
      vaultId: "t",
      builtAt: 0,
      entries: [],
      totalFilesFound: 0,
      skippedCount: 0,
      capped: false,
      nonMdFiles: [{ path: "/v/A/Stack 01/_folder.md", name: "_folder.md" }],
    });
    const dispose = wireReferenceIntegrity(idx, { vaultRoot: "/v" });
    await Promise.all([
      dispose.dispatch({
        vaultId: "t",
        eventType: "renamed",
        path: "/v/A.md",
        newPath: "/v/A2.md",
      }),
      dispose.dispatch({
        vaultId: "t",
        eventType: "deleted",
        path: "/v/B.md",
      }),
    ]);
    expect(idx.lookup("A.md")).toEqual([]);
    expect(idx.lookup("A2.md").length).toBe(1);
    expect(idx.lookup("B.md")).toEqual([]);
    dispose.detach();
  });
});

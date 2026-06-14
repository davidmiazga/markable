/**
 * tests/collections/settings-persistence.test.ts — step_16
 *
 * Asserts the additive `collections` field on MarkableSettings and the
 * load/save helpers:
 *   - DEFAULT_SETTINGS has no required collections field (absent or {})
 *   - loadCollectionsState returns {} when no settings present.
 *   - saveLastOpenedStack / saveScrollPosition write to the correct nested
 *     path and call saveSettings.
 *   - window-size invariant is unaffected by these changes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_SETTINGS, type MarkableSettings } from "../../src/lib/settings";
import {
  loadCollectionsState,
  saveLastOpenedStack,
  saveScrollPosition,
} from "../../src/plugins/file-browser/collections/settings-persistence";

// The persistence helpers consult the project's settings module. Mock it
// directly so the tests are decoupled from disk and IPC.
import * as settingsModule from "../../src/lib/settings";

let snapshot: MarkableSettings;
beforeEach(() => {
  vi.restoreAllMocks();
  snapshot = structuredClone(DEFAULT_SETTINGS);
  vi.spyOn(settingsModule, "getCurrentSettings").mockImplementation(() => snapshot);
  // updateSettings takes an updater callback; mirror the contract in the
  // mock so settings-persistence.ts exercises the real call shape.
  vi.spyOn(settingsModule, "updateSettings").mockImplementation(
    async (updater: (current: MarkableSettings) => MarkableSettings) => {
      snapshot = updater(snapshot);
    },
  );
});

describe("settings-persistence (step_16)", () => {
  it("additive default — collections is absent on DEFAULT_SETTINGS", () => {
    // The field is optional; absence is the safe default. Reads are null-safe.
    expect((DEFAULT_SETTINGS as unknown as { collections?: unknown }).collections).toBeUndefined();
  });

  it("safety — loadCollectionsState returns {} if nothing persisted", () => {
    const state = loadCollectionsState("vault-1");
    expect(state).toEqual({});
  });

  it("C-7 — saveLastOpenedStack writes the nested path correctly", async () => {
    await saveLastOpenedStack("vault-1", "/v/A", "/v/A/Stack 01");
    const reread = loadCollectionsState("vault-1");
    expect(reread.lastOpenedStackByCollection?.["/v/A"]).toBe("/v/A/Stack 01");
  });

  it("C-7 — saveScrollPosition writes the nested path correctly", async () => {
    await saveScrollPosition("vault-1", "/v/A/Stack 01", 250);
    const reread = loadCollectionsState("vault-1");
    expect(reread.scrollPositionByStack?.["/v/A/Stack 01"]).toBe(250);
  });

  it("NFR-3 / EC-14 — window-size invariant unchanged (sizeW='50%', sizeH='80%')", () => {
    // Strictly assert the two values match the canonical project invariant.
    expect(DEFAULT_SETTINGS.window.sizeW).toBe("50%");
    expect(DEFAULT_SETTINGS.window.sizeH).toBe("80%");
  });

  it("resilience — clearing the collections key entirely does not break the helpers", () => {
    // Simulate a settings file that was hand-edited to remove the collections key.
    const snapshotMut = snapshot as unknown as { collections?: unknown };
    snapshotMut.collections = undefined;
    expect(loadCollectionsState("vault-1")).toEqual({});
  });

  it("persistence — values for different vaults are isolated", async () => {
    await saveLastOpenedStack("vault-1", "/v/A", "/v/A/Stack 01");
    await saveLastOpenedStack("vault-2", "/u/B", "/u/B/Stack 03");
    const v1 = loadCollectionsState("vault-1");
    const v2 = loadCollectionsState("vault-2");
    expect(v1.lastOpenedStackByCollection?.["/v/A"]).toBe("/v/A/Stack 01");
    expect(v2.lastOpenedStackByCollection?.["/u/B"]).toBe("/u/B/Stack 03");
    // Cross-vault leakage is the bug we're guarding against.
    expect(v1.lastOpenedStackByCollection?.["/u/B"]).toBeUndefined();
  });
});

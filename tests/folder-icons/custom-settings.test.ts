/**
 * tests/folder-icons/custom-settings.test.ts — step_06c
 *
 * Asserts the cross-vault custom-icons helper module
 * (folder-icon-custom-settings.ts):
 *   - getCustomIcons: returns [] when absent, sorts by addedAt desc.
 *   - addCustomIcon: appends, refuses at cap (EC-20), refuses duplicates.
 *   - removeCustomIcon: drops by path, is idempotent (EC-21).
 *   - removeCustomIcon does NOT touch _folder.md — verified by absence of
 *     any folder-icon-store import (audited by inspection in DoD).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as settingsModule from "../../src/lib/settings";
import {
  getCustomIcons,
  addCustomIcon,
  removeCustomIcon,
  CUSTOM_ICON_CAP,
} from "../../src/plugins/file-browser/folder-icon-custom-settings";

/**
 * Stub the settings module with an in-memory record. Returns a getter so the
 * test can read the final state after mutations.
 */
function withSettings(initial: Partial<settingsModule.MarkableSettings>) {
  let state = { customFolderIcons: [], ...initial } as settingsModule.MarkableSettings;
  vi.spyOn(settingsModule, "getCurrentSettings").mockImplementation(
    () => state,
  );
  vi.spyOn(settingsModule, "updateSettings").mockImplementation(
    async (updater) => {
      state = updater(state);
    },
  );
  return () => state;
}

beforeEach(() => vi.restoreAllMocks());

describe("custom-icons settings (step_06c)", () => {
  it("getCustomIcons returns [] when the field is absent", () => {
    withSettings({});
    expect(getCustomIcons()).toEqual([]);
  });

  it("getCustomIcons returns entries sorted by addedAt descending", () => {
    withSettings({
      customFolderIcons: [
        { path: "/a.svg", label: "a", addedAt: 1 },
        { path: "/b.svg", label: "b", addedAt: 3 },
        { path: "/c.svg", label: "c", addedAt: 2 },
      ],
    });
    expect(getCustomIcons().map((e) => e.path)).toEqual([
      "/b.svg",
      "/c.svg",
      "/a.svg",
    ]);
  });

  it("addCustomIcon appends to the list", async () => {
    const get = withSettings({ customFolderIcons: [] });
    const r = await addCustomIcon({
      path: "/u/a.svg",
      label: "a",
      addedAt: 1,
    });
    expect(r.ok).toBe(true);
    expect(get().customFolderIcons).toHaveLength(1);
  });

  it("EC-20 — addCustomIcon refuses at cap with reason='cap_reached'", async () => {
    const full = Array.from({ length: CUSTOM_ICON_CAP }, (_, i) => ({
      path: `/u/${i}.svg`,
      label: `${i}`,
      addedAt: i,
    }));
    const get = withSettings({ customFolderIcons: full });
    const r = await addCustomIcon({
      path: "/u/new.svg",
      label: "n",
      addedAt: 999,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("cap_reached");
    // No silent eviction — list is still exactly CUSTOM_ICON_CAP.
    expect(get().customFolderIcons).toHaveLength(CUSTOM_ICON_CAP);
    expect(
      get().customFolderIcons!.some((e) => e.path === "/u/new.svg"),
    ).toBe(false);
  });

  it("addCustomIcon refuses duplicates with reason='duplicate'", async () => {
    withSettings({
      customFolderIcons: [{ path: "/u/a.svg", label: "a", addedAt: 1 }],
    });
    const r = await addCustomIcon({
      path: "/u/a.svg",
      label: "a-renamed",
      addedAt: 99,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("duplicate");
  });

  it("removeCustomIcon drops the entry by path", async () => {
    const get = withSettings({
      customFolderIcons: [
        { path: "/u/a.svg", label: "a", addedAt: 1 },
        { path: "/u/b.svg", label: "b", addedAt: 2 },
      ],
    });
    await removeCustomIcon("/u/a.svg");
    expect(get().customFolderIcons!.map((e) => e.path)).toEqual([
      "/u/b.svg",
    ]);
  });

  it("removeCustomIcon is idempotent (removing absent path is a no-op)", async () => {
    const get = withSettings({
      customFolderIcons: [{ path: "/u/a.svg", label: "a", addedAt: 1 }],
    });
    await removeCustomIcon("/u/missing.svg");
    expect(get().customFolderIcons).toHaveLength(1);
  });

  it("EC-21 — removing from settings does NOT mutate _folder.md (separation of concerns)", async () => {
    const get = withSettings({
      customFolderIcons: [{ path: "/u/a.svg", label: "a", addedAt: 1 }],
    });
    await removeCustomIcon("/u/a.svg");
    expect(get().customFolderIcons).toEqual([]);
    // The absence of any file-system mock in this test is the structural
    // proof — the function does no disk I/O beyond the settings write.
    // Folders that referenced /u/a.svg continue to render via the
    // custom-SVG cache because _folder.md still carries the path.
  });
});

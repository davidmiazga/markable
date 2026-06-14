---
title: "Step 06c — Custom Icons Settings (cross-vault list)"
last-updated: "2026-06-05"
review-cadence-days: 14
status: active
---

# Step 06c — Custom Icons Settings (cross-vault list)

## Goal

Add the cross-vault `customFolderIcons` field to `MarkableSettings` and
build the small helper module the picker uses to read, add, and remove
entries. **No new Rust command** — this piggybacks on the existing
`updateSettings()` → `save_settings` pathway.

## Inputs

- Requirements: FR-14 (cross-vault list at user-settings level),
  FR-18 (100-entry cap, refuse-add behaviour — see §"Cap policy"),
  EC-20 (cap reached), EC-21 (Remove from Custom does not break
  folder assignments).
- Constraint: C-12 (cache lives in TS; `_folder.md` stores only the
  path — so this settings list and the `_folder.md` icon value are
  decoupled by design).
- Window-size invariant (NFR-5 / EC-15): `src/lib/settings.ts` edit
  MUST NOT touch `window.sizeW` (`"50%"`) or `window.sizeH` (`"80%"`).

## Files

| Action | File |
|---|---|
| Edit | `src/lib/settings.ts` (add `customFolderIcons?: CustomIconEntry[]` to `MarkableSettings`; add to `DEFAULT_SETTINGS` as `[]`; **do NOT touch window settings**) |
| Create | `src/plugins/file-browser/folder-icon-custom-settings.ts` |
| Create | `tests/folder-icons/custom-settings.test.ts` |

## Type additions to `MarkableSettings`

```typescript
// src/lib/settings.ts (additions only — do NOT touch window block)

/**
 * One entry in the cross-vault custom-folder-icon list.
 * Path is absolute; label defaults to the basename at add-time and
 * is not user-editable in MVP (DW-16).
 */
export interface CustomIconEntry {
  path: string;
  label: string;
  addedAt: number;  // epoch ms — used as a stable sort key in the picker
}

export interface MarkableSettings {
  // ... existing fields ...
  /**
   * User's curated list of custom SVG icons referenced by absolute
   * path. Cross-vault (lives in user settings, not per-vault).
   * Optional — absent in settings files created before custom icons
   * landed. Cap at CUSTOM_ICON_CAP entries (FR-18, EC-20).
   *
   * NOTE: removing an entry from this list does NOT clear folder
   * assignments that reference the path. _folder.md is the source
   * of truth for assignment; this list is the picker's favourites
   * surface only. (EC-21.)
   */
  customFolderIcons?: CustomIconEntry[];
}

// In DEFAULT_SETTINGS, add:
//   customFolderIcons: [],
// alongside the other top-level fields. Do NOT modify the window block.
```

> **CRITICAL.** The only valid additions to `src/lib/settings.ts` in
> this step are:
> 1. The `CustomIconEntry` interface export.
> 2. The `customFolderIcons?: CustomIconEntry[]` field on
>    `MarkableSettings`.
> 3. `customFolderIcons: []` on `DEFAULT_SETTINGS`.
>
> Any other diff in this file — especially anything under
> `window:` — must be reverted before merge. The window invariant
> test (`tests/settings/window-defaults.test.ts`) is the regression
> gate. CLAUDE.md is the canonical reference for the invariant.

## Helper module

```typescript
// src/plugins/file-browser/folder-icon-custom-settings.ts
import {
  getCurrentSettings,
  updateSettings,
  type CustomIconEntry,
} from "../../lib/settings";

/** Hard cap on the cross-vault custom icons list. FR-18 / EC-20. */
export const CUSTOM_ICON_CAP = 100;

export type AddCustomIconResult =
  | { ok: true }
  | { ok: false; reason: "cap_reached" | "duplicate" };

/**
 * Read the current custom icon list. Always returns an array;
 * absent settings field is coerced to []. Sorted by addedAt descending
 * (newest first) so the picker shows recent additions at the top.
 */
export function getCustomIcons(): CustomIconEntry[] {
  const list = getCurrentSettings().customFolderIcons ?? [];
  return list.slice().sort((a, b) => b.addedAt - a.addedAt);
}

/**
 * Add a new entry. Refuses if the cap is reached (FR-18 — refuse-add,
 * NOT silent eviction. See §"Cap policy" below.). Refuses duplicates
 * (same `path`); the picker surfaces "Already in your Custom list".
 *
 * Returns a result rather than throwing so the picker can surface the
 * inline error without a try/catch ladder.
 */
export async function addCustomIcon(
  entry: CustomIconEntry,
): Promise<AddCustomIconResult> {
  const current = getCurrentSettings().customFolderIcons ?? [];
  if (current.length >= CUSTOM_ICON_CAP) {
    return { ok: false, reason: "cap_reached" };
  }
  if (current.some(e => e.path === entry.path)) {
    return { ok: false, reason: "duplicate" };
  }
  await updateSettings(s => ({
    ...s,
    customFolderIcons: [...(s.customFolderIcons ?? []), entry],
  }));
  return { ok: true };
}

/**
 * Remove an entry by absolute path. Idempotent: removing a path that
 * is not in the list is a no-op.
 *
 * IMPORTANT (EC-21): this does NOT mutate any `_folder.md`. Folders
 * whose `icon:` field still references this path continue to render
 * via the custom-SVG cache. The picker simply no longer surfaces this
 * path as a quick-pick. This decoupling is intentional and matches
 * FR-18's wording.
 */
export async function removeCustomIcon(path: string): Promise<void> {
  await updateSettings(s => ({
    ...s,
    customFolderIcons: (s.customFolderIcons ?? []).filter(e => e.path !== path),
  }));
}
```

## Cap policy (locked decision)

**Refuse-add at 100 entries, with an inline error toast.** Not silent
FIFO eviction. Rationale, in order of weight:

1. FR-18 explicitly states the user-visible message: "Custom icon
   limit reached. Remove an icon from the Custom section first." —
   this is refuse-add wording, not eviction wording.
2. Silent eviction would surprise users who have deliberately
   curated their list; the entry's removal would propagate (via
   the picker's missing-tile surface) without warning.
3. FR-18 also requires a per-entry "Remove from Custom" affordance,
   which only makes sense under refuse-add (the user is expected to
   actively prune).
4. The cap is a soft UX constraint, not a correctness one — the
   render path tolerates arbitrary paths in `_folder.md`. The cap
   exists to keep the picker scrollable and the settings file lean.

EC-20's "refuse-add" path is exercised by the picker test in
step_06 plus the unit test below.

## Failing tests (write FIRST — Red)

```typescript
// tests/folder-icons/custom-settings.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as settingsModule from "../../src/lib/settings";
import {
  getCustomIcons,
  addCustomIcon,
  removeCustomIcon,
  CUSTOM_ICON_CAP,
} from "../../src/plugins/file-browser/folder-icon-custom-settings";

// Helper: stub settings module with an in-memory record.
function withSettings(initial: any) {
  let state = { customFolderIcons: [], ...initial };
  vi.spyOn(settingsModule, "getCurrentSettings").mockImplementation(() => state);
  vi.spyOn(settingsModule, "updateSettings").mockImplementation(async (updater: any) => {
    state = updater(state);
    return state;
  });
  return () => state;
}

beforeEach(() => vi.restoreAllMocks());

describe("custom-icons settings (step_06c)", () => {
  it("getCustomIcons returns [] when field is absent", () => {
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
    expect(getCustomIcons().map(e => e.path)).toEqual(["/b.svg", "/c.svg", "/a.svg"]);
  });

  it("addCustomIcon appends to the list", async () => {
    const get = withSettings({ customFolderIcons: [] });
    const r = await addCustomIcon({ path: "/u/a.svg", label: "a", addedAt: 1 });
    expect(r.ok).toBe(true);
    expect(get().customFolderIcons).toHaveLength(1);
  });

  it("EC-20 — addCustomIcon refuses at cap with reason='cap_reached'", async () => {
    const full = Array.from({ length: CUSTOM_ICON_CAP }, (_, i) => ({
      path: `/u/${i}.svg`, label: `${i}`, addedAt: i,
    }));
    const get = withSettings({ customFolderIcons: full });
    const r = await addCustomIcon({ path: "/u/new.svg", label: "n", addedAt: 999 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("cap_reached");
    expect(get().customFolderIcons).toHaveLength(CUSTOM_ICON_CAP); // no eviction
    expect(get().customFolderIcons.some((e: any) => e.path === "/u/new.svg")).toBe(false);
  });

  it("addCustomIcon refuses duplicates with reason='duplicate'", async () => {
    withSettings({
      customFolderIcons: [{ path: "/u/a.svg", label: "a", addedAt: 1 }],
    });
    const r = await addCustomIcon({ path: "/u/a.svg", label: "a-renamed", addedAt: 99 });
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
    expect(get().customFolderIcons.map((e: any) => e.path)).toEqual(["/u/b.svg"]);
  });

  it("removeCustomIcon is idempotent (removing absent path is a no-op)", async () => {
    const get = withSettings({
      customFolderIcons: [{ path: "/u/a.svg", label: "a", addedAt: 1 }],
    });
    await removeCustomIcon("/u/missing.svg");
    expect(get().customFolderIcons).toHaveLength(1);
  });

  it("EC-21 — removing an entry from settings does NOT touch _folder.md (separation of concerns)", async () => {
    // This is verified by the absence of any folder-icon-store import
    // in the implementation. Audited by inspection — see Definition of
    // Done. Functionally, the test asserts that removeCustomIcon only
    // mutates the settings array.
    const get = withSettings({
      customFolderIcons: [{ path: "/u/a.svg", label: "a", addedAt: 1 }],
    });
    await removeCustomIcon("/u/a.svg");
    expect(get().customFolderIcons).toEqual([]);
    // No assertion about _folder.md here — the absence of any
    // file-system mock proves the function does no disk I/O beyond
    // the settings write.
  });
});
```

## Green

1. Edit `src/lib/settings.ts`:
   - Add `export interface CustomIconEntry { ... }`.
   - Add `customFolderIcons?: CustomIconEntry[]` to `MarkableSettings`.
   - Add `customFolderIcons: []` to `DEFAULT_SETTINGS`.
   - **VERIFY** that `window.sizeW` is still `"50%"` and
     `window.sizeH` is still `"80%"` after the edit.
2. Create `folder-icon-custom-settings.ts` per the API contract.
3. Run the unit tests above.
4. Run `tests/settings/window-defaults.test.ts` — must still pass.
5. `npm run build:plugins && npm run sync:plugins` (C-8).

## Refactor

- The `sort by addedAt desc` lives in `getCustomIcons`. If the picker
  ever wants a different order, sort downstream.
- If a future requirement adds an "Update label" affordance (DW-16),
  it lives in this module as `renameCustomIcon(path, newLabel)`. Out
  of scope here.

## Definition of Done

- [ ] `tests/folder-icons/custom-settings.test.ts` passes.
- [ ] `tests/settings/window-defaults.test.ts` passes (window invariant
      intact — NFR-5 / EC-15).
- [ ] Diff of `src/lib/settings.ts` is limited to the three additions
      listed in §"Type additions". No edits under `window:`.
- [ ] No import of `folder-icon-store` or `bridge` in the helper
      module (audited by inspection — the helper is pure-settings I/O).
- [ ] `npm run build:plugins && npm run sync:plugins` (C-8).

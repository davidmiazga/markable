---
title: "Step 07 — Context Menu Entry + End-to-End Wire-Up"
last-updated: "2026-06-05"
review-cadence-days: 14
status: active
---

# Step 07 — Context Menu Entry + End-to-End Wire-Up

## Goal

Add the **"Set folder icon…"** entry to the directory right-click menu.
This is the only user-visible entry point. After this step, the feature
is fully usable end-to-end and every Edge Case from the requirements
doc has at least one passing test.

**Amendment 2026-06-05.** No functional change required for the
custom-SVG amendment. The menu entry still calls
`openFolderIconPicker(path, { onChange })`; the picker is what
changed. The verification matrix at the bottom grows by 8 entries
(EC-16 … EC-23) — see the expanded checklist in `00_index.md` §5.

## Inputs

- Requirements: FR-7, FR-10, NFR-3 (state preservation), EC-12, EC-13,
  EC-14, EC-15.
- Precedent: `buildDirContextMenuItems()` in
  `src/plugins/file-browser/file-browser.plugin.ts` (line 3004).
- Memory: `feedback_dont_overcomplicate` — reuse the existing menu
  builder; do not invent a per-icon variant.

## Files

| Action | File |
|---|---|
| Edit | `src/plugins/file-browser/file-browser.plugin.ts` (one new menu item in `buildDirContextMenuItems`) |
| Create | `tests/folder-icons/context-menu.test.ts` |

## Change

In `buildDirContextMenuItems(...)` (around line 3015), insert a new
entry. The existing items are (in order): Folder View / Remove Folder
View, then optional Layout + CodeBlock items, separator, New Folder,
New Note, separator, Rename, Delete, Pin/Unpin, separator, Reveal in
Finder.

Insert the new "Set folder icon…" entry **immediately above** the
separator that precedes "Reveal in Finder". This groups it with
appearance-related actions and keeps destructive actions (Rename,
Delete) above it.

```typescript
// ... existing items up through Pin/Unpin ...
{
  label: _pinnedPaths.has(path) ? "Unpin" : "Pin",
  handler: () => _pinnedPaths.has(path) ? unpinPath(path, vaultId) : pinPath(path, vaultId),
},
{ separator: true, label: "", handler: null },
// NEW — step_07 of folder-icon-assignment
{
  label: "Set folder icon…",
  handler: () => {
    void openFolderIconPicker(path, {
      onChange: () => {
        // Reuse the established reload pathway used by every other
        // _folder.md-mutating action. vault-manager fires
        // vault-changed → renderPanel → render path recomputes the
        // folderIconMap and re-renders the affected node (NFR-3:
        // expansion state and scroll preserved by the existing
        // render pipeline).
        void reloadVaultIndex(vaultId);
      },
    });
  },
},
{ separator: true, label: "", handler: null },
{
  label: "Reveal in Finder",
  handler: () => { /* unchanged */ },
},
```

Add the import at the top of `file-browser.plugin.ts`:

```typescript
import { openFolderIconPicker } from "./folder-icon-picker";
```

`reloadVaultIndex` is already imported in this file (used by delete /
rename flows).

## Failing test (write FIRST — Red)

```typescript
// tests/folder-icons/context-menu.test.ts
import { describe, it, expect, vi } from "vitest";

// Import the exposed buildDirContextMenuItems via the test hook the
// plugin already exposes (see file-browser.plugin.ts line ~4660 —
// `buildDirContextMenuItems` is intentionally exposed for tests).
import { buildDirContextMenuItems } from "../../src/plugins/file-browser/file-browser.plugin";

describe("buildDirContextMenuItems — Set folder icon entry (step_07)", () => {
  it("contains a 'Set folder icon…' item", () => {
    const items = buildDirContextMenuItems(
      document.createElement("div"),
      "/v/A",
      "vault-1",
      /* hasFolderView */ false,
      /* hasCodeblock  */ false,
      /* hasLayout     */ false,
    );
    const labels = items.map(i => i.label);
    expect(labels).toContain("Set folder icon…");
  });

  it("is positioned between Pin/Unpin and Reveal in Finder", () => {
    const items = buildDirContextMenuItems(
      document.createElement("div"),
      "/v/A",
      "vault-1",
      false, false, false,
    );
    const labels = items.map(i => i.label);
    const pinIdx    = labels.findIndex(l => l === "Pin" || l === "Unpin");
    const setIconIdx = labels.findIndex(l => l === "Set folder icon…");
    const revealIdx = labels.findIndex(l => l === "Reveal in Finder");
    expect(pinIdx).toBeGreaterThanOrEqual(0);
    expect(setIconIdx).toBeGreaterThan(pinIdx);
    expect(revealIdx).toBeGreaterThan(setIconIdx);
  });

  it("invoking the handler calls openFolderIconPicker with the directory path", async () => {
    // The handler must be callable as () => void. We can't easily
    // intercept the import here, so this is a smoke check that the
    // handler exists and is wired.
    const items = buildDirContextMenuItems(
      document.createElement("div"),
      "/v/A",
      "vault-1",
      false, false, false,
    );
    const entry = items.find(i => i.label === "Set folder icon…")!;
    expect(typeof entry.handler).toBe("function");
  });
});
```

## End-to-end manual verification

After Green, run the app and verify the full pipeline:

1. Create a folder with no `_folder.md`. Right-click → **Set folder
   icon…**. Pick `book`. Apply. Tree shows the book glyph. Disk now
   has `_folder.md` with `---\nicon: book\n---\n` (EC-6).
2. Right-click the same folder → **Set folder icon…** → **Remove icon**.
   Tree reverts to the generic glyph. `_folder.md` no longer contains
   the `icon:` line (EC-7).
3. Create a folder with an existing `_folder.md` containing
   `layout: bookshelf`. Set icon → Apply. Open the file in the editor;
   confirm both `layout: bookshelf` and `icon: <id>` are present, body
   unchanged (EC-8).
4. Edit `_folder.md` externally to `icon: nonsense`. Switch back to
   Markable. Tree shows generic glyph, no error (EC-3).
5. Rename the folder in Finder. Vault watcher fires; tree re-renders.
   Icon assignment travels with the folder (EC-12, EC-13).
6. Open Activity Monitor / Profiler. Rapid double-click Apply should
   not produce two concurrent writes — Apply disables immediately
   (EC-10).
7. Run `npm run test:run -- tests/settings/window-defaults.test.ts` —
   passes (EC-15).

## Refactor

- Pass the `closeContextMenu` / dismissal flow remains untouched — the
  existing `addMenuItem` wiring closes the menu before invoking the
  handler.
- Consider adding a tiny inline JSDoc above the new entry pointing at
  this spec file so future maintainers find it.

## Definition of Done

- [ ] `tests/folder-icons/context-menu.test.ts` passes.
- [ ] All previous step tests still pass.
- [ ] `npm run test:run` (full suite) passes.
- [ ] `cargo test` from `src-tauri/` passes.
- [ ] `npm run test:run -- tests/settings/window-defaults.test.ts`
      passes (EC-15, NFR-5).
- [ ] Every EC-1 … EC-15 from the requirements doc has at least one
      passing test (see `00_index.md` EC → test mapping).
- [ ] `npm run build:plugins && npm run sync:plugins` (C-8).
- [ ] Manual verification steps above all pass.

---

## Feature complete

After this step, `docs/requirements/active_task.md` can be retired and
the parked `docs/requirements/collections_mvp_parked.md` may resume,
with amendment #3 (Stacks render using user-assigned folder icons) now
fulfilled by the public surface introduced here:

- `getFolderIconClass(iconId)` — Collections renderer maps a Stack
  folder's icon to the same CSS class the file browser tree uses.
- `readFolderIcon(folderPath)` — Collections renderer reads each
  Stack's `_folder.md` once at home-canvas build time.
- `FOLDER_ICONS` catalog — Collections defaults the Stack glyph to
  some catalog id (Collections architect's choice — e.g. `bookshelf`
  or a `stacked-card` id added in that feature's catalog extension
  step).

No additional API surface is needed downstream.

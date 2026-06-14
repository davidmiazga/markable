---
title: "Step 06 — Folder Icon Picker (modal)"
last-updated: "2026-06-05"
review-cadence-days: 14
status: active
---

# Step 06 — Folder Icon Picker (modal)

## Goal

Build the modal picker UI invoked by the right-click menu (step_07).
The picker shows the curated catalog as a grid, a divider, a "Custom"
section listing user-added SVGs, and an **"Add custom SVG…"** button.
It highlights the currently assigned icon, and offers Cancel / Remove
icon / Apply actions. On Apply, it calls `setFolderIcon()` and waits
for completion before closing. While the write is in flight, Apply is
disabled (EC-10).

**Amendment 2026-06-05.** Picker layout extended for custom-SVG
support:
- Section 1: curated catalog grid (unchanged, 24 tiles).
- Divider (`<hr class="folder-icon-picker-divider">`).
- Section 2: "Custom" — one tile per entry in
  `settings.customFolderIcons`. Each tile shows the SVG inline
  (sanitised via `getCustomSvg(path)` — same pipeline the tree uses)
  and a small × ("Remove from Custom") affordance on hover.
- Footer button row: "Add custom SVG…" on the left of the Remove
  Icon / Cancel / Apply triplet.

## Inputs

- Requirements: FR-7, FR-8, FR-9, FR-13, FR-14, FR-16, FR-18, EC-9,
  EC-10, EC-18, EC-19, EC-20, EC-21, NFR-8 (picker paints within
  100ms — trivial at 24 + ≤100 icons).
- Constraint: C-10 (reuse `stripScripts`; no DOMPurify), C-11 (reuse
  `openAssetDialog` — no new dialog command).
- Precedent: `src/plugins/file-browser/smart-folders/editor-ui.ts` uses
  `settings-overlay` / `settings-panel` / `settings-footer` /
  `attachModalKeyboard` and is the canonical modal pattern in the file
  browser plugin tree.
- Dependencies: `step_06b` (`svg-validator.ts`) and `step_06c`
  (`folder-icon-custom-settings.ts`) MUST be implemented first.
- Project memory: `feedback_look_first` — reuse the exact same modal
  chrome classes. Don't invent new modal CSS.
- Project memory: `feedback_modal_top_anchor` — top-anchor pattern is
  for height-changing content. The Custom section can vary in size as
  entries are added/removed, so **apply the top-anchor pattern** to
  the picker overlay (`align-items: flex-start; padding-top: 8vh`).
  This deviates from the original "fixed height, centered" plan and
  is now load-bearing.

## Files

| Action | File |
|---|---|
| Create | `src/plugins/file-browser/folder-icon-picker.ts` |
| Create | `tests/folder-icons/picker.test.ts` |
| Add CSS | A small `folder-icon-picker-*` block inside
            `src/plugins/file-browser/file-browser.css` (grid layout only;
            inherit chrome from `settings-*` classes) |

## API Contract

```typescript
// src/plugins/file-browser/folder-icon-picker.ts
import { FOLDER_ICONS, interpretIconValue } from "./folder-icons";
import { readFolderIcon, setFolderIcon } from "./folder-icon-store";
import { getCustomSvg } from "./folder-icon-custom-cache";
import { validateSvgFile } from "./svg-validator";
import {
  getCustomIcons,
  addCustomIcon,
  removeCustomIcon,
  CUSTOM_ICON_CAP,
} from "./folder-icon-custom-settings";
import { openAssetDialog } from "../../lib/dialogs";
import { readFile } from "../../lib/bridge";
import { attachModalKeyboard } from "../../lib/modal-keyboard";

/** Visible side-effects: appends and later removes a single overlay
 *  element from document.body. The returned promise resolves when the
 *  modal closes (after Apply success, Remove, or Cancel/backdrop/Escape).
 */
export async function openFolderIconPicker(
  folderPath: string,
  opts?: {
    /** Called after a successful Apply/Remove so the caller can reload
     *  the vault index. Defaults to a no-op. */
    onChange?: () => void;
  },
): Promise<void>;
```

Behavior:

1. Read current icon assignment via `readFolderIcon(folderPath)`.
   The value is opaque — could be catalog iconId or custom path.
2. Build the overlay (`.settings-overlay folder-icon-picker-overlay`).
3. Render the **curated section** as a `.folder-icon-picker-grid`,
   one tile per `FOLDER_ICONS` entry. The tile shows the inline SVG
   (via `wrapSvg(def.svg, 24)`) and `title={def.label}` and a
   `data-icon-id="<id>"` attribute.
4. Render a `<hr class="folder-icon-picker-divider">`.
5. Render the **Custom section** — a heading "Custom" plus a grid
   of `.folder-icon-tile.folder-icon-tile-custom` tiles. Each tile
   has `data-icon-path="<absolute path>"`, shows the SVG inline (via
   `getCustomSvg(path)` from the same cache the tree uses), and a
   hover-visible `<button class="folder-icon-tile-remove">×</button>`
   that calls `removeCustomIcon(path)` and re-renders the section.
   Tile title attribute = the custom icon's stored label (basename
   at add-time per FR-14).
6. Apply a `.folder-icon-tile-selected` class to the tile (curated
   OR custom) whose data attribute matches the current icon's
   resolved kind (EC-9). If no current icon, no tile is selected.
7. Footer has the **"Add custom SVG…"** button on the left, then a
   spacer, then the existing three-button cluster:
   - **Remove icon** (`.btn .btn-tertiary` — only enabled when a
     current icon exists)
   - **Cancel** (`.btn .btn-secondary`)
   - **Apply** (`.btn .btn-primary` — disabled until a selection has
     been made AND that selection differs from the current; also
     disabled while a write is in flight).
8. Clicking a tile (curated or custom) sets the local "selected"
   state — for curated tiles the selection is the iconId; for
   custom tiles the selection is the absolute path. Updates
   highlights and re-evaluates Apply enabled state.
9. **Apply** → disable Apply+Remove+Cancel+Add → call
   `setFolderIcon(folderPath, selectedValue)` → on `ok: true`,
   invoke `opts?.onChange?.()` → close overlay → resolve the
   promise. On `ok: false`, re-enable buttons and surface the
   error inline (`<span class="folder-icon-picker-error">`).
10. **Remove icon** → identical flow but with
    `setFolderIcon(folderPath, undefined)`.
11. **Cancel / backdrop / Escape** → close overlay, resolve.
12. **"Add custom SVG…"** flow (FR-13, FR-16, FR-18):
    a. If `getCustomIcons().length >= CUSTOM_ICON_CAP`, show the
       inline error "Custom icon limit reached. Remove an icon
       from the Custom section first." and DO NOT open the dialog
       (EC-20, refuse-add per FR-18).
    b. Call `openAssetDialog()`. If cancelled, no-op.
    c. Reject if the chosen file's extension is not `.svg` (case-
       insensitive). Error: "Only SVG files are supported." (covers
       the case where the user picks a `.png` via the "All Files"
       filter — `openAssetDialog` accepts all images).
    d. Read the file via `readFile(path)`. If !ok, surface
       "Could not read file."
    e. Call `validateSvgFile(content, content.length)` (step_06b).
       If invalid, surface the validator's error message ("Not a
       valid SVG file." for parse failures, "SVG too large (max
       32 KB)." for size violations).
    f. On pass, call `addCustomIcon({ path, label: basename(path),
       addedAt: Date.now() })`. Re-render the Custom section. Select
       the new tile (set local selection state to the path). Apply
       button becomes enabled.

## Keyboard handling

Reuse `attachModalKeyboard(overlay, { onEscape, onEnter })`:
- Escape → close (Cancel).
- Enter → if Apply is enabled, click it.

## CSS additions

Add to `src/plugins/file-browser/file-browser.css`:

```css
/* Step 06 — folder icon picker */
.folder-icon-picker-overlay {
  /* feedback_modal_top_anchor — content height varies as Custom
     section grows/shrinks. Don't vertically jolt the modal. */
  align-items: flex-start;
  padding-top: 8vh;
}
.folder-icon-picker-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 8px;
  padding: 8px 0;
}
.folder-icon-picker-divider {
  border: 0;
  border-top: 1px solid var(--border-color, currentColor);
  margin: 12px 0 8px;
  opacity: .4;
}
.folder-icon-picker-section-heading {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .04em;
  opacity: .7;
  margin: 4px 0;
}
.folder-icon-tile {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 1 / 1;
  border: 1px solid var(--border-color, transparent);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  color: currentColor;
}
.folder-icon-tile:hover { background: var(--hover-bg, rgba(128,128,128,.08)); }
.folder-icon-tile-selected {
  border-color: var(--accent-color, currentColor);
  background: var(--hover-bg, rgba(128,128,128,.08));
}
.folder-icon-tile-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  line-height: 14px;
  padding: 0;
  border-radius: 50%;
  border: 0;
  background: var(--danger-color, #c33);
  color: white;
  font-size: 11px;
  cursor: pointer;
  opacity: 0;
  transition: opacity .12s ease;
}
.folder-icon-tile:hover .folder-icon-tile-remove { opacity: 1; }
.folder-icon-picker-error {
  color: var(--danger-color, #c33);
  margin-right: auto;
  font-size: 12px;
}
.folder-icon-picker-add {
  /* Sits at the LEFT of the footer; pushes the other buttons right. */
  margin-right: auto;
}
```

> Theme tokens only. Per `feedback_theme_carries_through` and
> `project_theme_system`: if `--danger-color` is not yet in the
> canonical token catalog, leave the fallback `#c33` only as a
> defensive fallback, but file a deferred-work note (DW-12: add
> `--danger-color` to the canonical token catalog).
>
> **Architect decision:** check `src/styles.css` first. If
> `--danger-color` or `--accent-color` already exist, drop the
> fallback. If not, the fallback stays because we are explicitly not
> introducing new tokens in this feature (out of scope).

## Failing tests (write FIRST — Red)

```typescript
// tests/folder-icons/picker.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as store from "../../src/plugins/file-browser/folder-icon-store";

describe("openFolderIconPicker (step_06)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("EC-9 — highlights the currently assigned icon when the modal opens", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue("book");
    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    void openFolderIconPicker("/v/A");
    // Allow the read promise to resolve and DOM to update.
    await new Promise(r => setTimeout(r, 0));
    const selected = document.querySelector(".folder-icon-tile-selected");
    expect(selected?.getAttribute("data-icon-id")).toBe("book");
  });

  it("no tile selected when no current icon", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue(undefined);
    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    void openFolderIconPicker("/v/A");
    await new Promise(r => setTimeout(r, 0));
    expect(document.querySelectorAll(".folder-icon-tile-selected").length).toBe(0);
  });

  it("Apply disabled until the user picks a different icon", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue("book");
    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    void openFolderIconPicker("/v/A");
    await new Promise(r => setTimeout(r, 0));
    const apply = document.querySelector(".folder-icon-picker-apply") as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    // Click a different tile.
    (document.querySelector(`.folder-icon-tile[data-icon-id="lightbulb"]`) as HTMLElement).click();
    expect(apply.disabled).toBe(false);
  });

  it("EC-10 — Apply is disabled while the write is in flight", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue(undefined);
    let resolveWrite: (() => void) | null = null;
    vi.spyOn(store, "setFolderIcon").mockImplementation(
      () => new Promise(res => { resolveWrite = () => res({ ok: true, value: undefined } as any); }),
    );
    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    const onChange = vi.fn();
    const done = openFolderIconPicker("/v/A", { onChange });
    await new Promise(r => setTimeout(r, 0));
    (document.querySelector(`.folder-icon-tile[data-icon-id="book"]`) as HTMLElement).click();
    const apply = document.querySelector(".folder-icon-picker-apply") as HTMLButtonElement;
    apply.click();
    expect(apply.disabled).toBe(true);
    resolveWrite!();
    await done;
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".folder-icon-picker-overlay")).toBeNull();
  });

  it("Remove button calls setFolderIcon with undefined", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue("book");
    const setSpy = vi.spyOn(store, "setFolderIcon")
      .mockResolvedValue({ ok: true, value: undefined } as any);
    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    const done = openFolderIconPicker("/v/A");
    await new Promise(r => setTimeout(r, 0));
    (document.querySelector(".folder-icon-picker-remove") as HTMLButtonElement).click();
    await done;
    expect(setSpy).toHaveBeenCalledWith("/v/A", undefined);
  });

  it("Cancel closes without calling setFolderIcon", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue("book");
    const setSpy = vi.spyOn(store, "setFolderIcon");
    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    const done = openFolderIconPicker("/v/A");
    await new Promise(r => setTimeout(r, 0));
    (document.querySelector(".folder-icon-picker-cancel") as HTMLButtonElement).click();
    await done;
    expect(setSpy).not.toHaveBeenCalled();
  });
});

describe("openFolderIconPicker — Custom section (step_06 amendment)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders one tile per entry in customFolderIcons", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue(undefined);
    const settings = await import("../../src/plugins/file-browser/folder-icon-custom-settings");
    vi.spyOn(settings, "getCustomIcons").mockReturnValue([
      { path: "/u/a.svg", label: "a", addedAt: 1 },
      { path: "/u/b.svg", label: "b", addedAt: 2 },
    ]);
    const cache = await import("../../src/plugins/file-browser/folder-icon-custom-cache");
    vi.spyOn(cache, "getCustomSvg").mockResolvedValue(`<svg><circle r="3"/></svg>`);

    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    void openFolderIconPicker("/v/A");
    await new Promise(r => setTimeout(r, 10));
    const tiles = document.querySelectorAll(".folder-icon-tile-custom");
    expect(tiles.length).toBe(2);
    expect((tiles[0] as HTMLElement).dataset.iconPath).toBe("/u/a.svg");
  });

  it("EC-9 — highlights the custom tile when current icon is a custom path", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue("/u/a.svg");
    const settings = await import("../../src/plugins/file-browser/folder-icon-custom-settings");
    vi.spyOn(settings, "getCustomIcons").mockReturnValue([
      { path: "/u/a.svg", label: "a", addedAt: 1 },
    ]);
    const cache = await import("../../src/plugins/file-browser/folder-icon-custom-cache");
    vi.spyOn(cache, "getCustomSvg").mockResolvedValue(`<svg/>`);

    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    void openFolderIconPicker("/v/A");
    await new Promise(r => setTimeout(r, 10));
    const selected = document.querySelector(".folder-icon-tile-selected") as HTMLElement;
    expect(selected.dataset.iconPath).toBe("/u/a.svg");
  });

  it("EC-18 — Add custom SVG with invalid file shows validator error and does not call addCustomIcon", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue(undefined);
    const settings = await import("../../src/plugins/file-browser/folder-icon-custom-settings");
    vi.spyOn(settings, "getCustomIcons").mockReturnValue([]);
    const addSpy = vi.spyOn(settings, "addCustomIcon");

    const dialogs = await import("../../src/lib/dialogs");
    vi.spyOn(dialogs, "openAssetDialog").mockResolvedValue({ cancelled: false, path: "/u/bad.svg" });

    const bridge = await import("../../src/lib/bridge");
    vi.spyOn(bridge, "readFile").mockResolvedValue({ ok: true, value: "not an svg" });

    const validator = await import("../../src/plugins/file-browser/svg-validator");
    vi.spyOn(validator, "validateSvgFile").mockReturnValue({ ok: false, reason: "parse_error" });

    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    void openFolderIconPicker("/v/A");
    await new Promise(r => setTimeout(r, 0));
    (document.querySelector(".folder-icon-picker-add") as HTMLButtonElement).click();
    await new Promise(r => setTimeout(r, 10));
    expect(addSpy).not.toHaveBeenCalled();
    const err = document.querySelector(".folder-icon-picker-error");
    expect(err?.textContent).toMatch(/not a valid svg/i);
  });

  it("EC-19 — Add custom SVG above 32 KB shows size error", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue(undefined);
    const settings = await import("../../src/plugins/file-browser/folder-icon-custom-settings");
    vi.spyOn(settings, "getCustomIcons").mockReturnValue([]);
    const addSpy = vi.spyOn(settings, "addCustomIcon");
    const dialogs = await import("../../src/lib/dialogs");
    vi.spyOn(dialogs, "openAssetDialog").mockResolvedValue({ cancelled: false, path: "/u/big.svg" });
    const bridge = await import("../../src/lib/bridge");
    vi.spyOn(bridge, "readFile").mockResolvedValue({ ok: true, value: "x".repeat(33 * 1024) });
    const validator = await import("../../src/plugins/file-browser/svg-validator");
    vi.spyOn(validator, "validateSvgFile").mockReturnValue({ ok: false, reason: "too_large" });

    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    void openFolderIconPicker("/v/A");
    await new Promise(r => setTimeout(r, 0));
    (document.querySelector(".folder-icon-picker-add") as HTMLButtonElement).click();
    await new Promise(r => setTimeout(r, 10));
    expect(addSpy).not.toHaveBeenCalled();
    const err = document.querySelector(".folder-icon-picker-error");
    expect(err?.textContent).toMatch(/32 ?kb/i);
  });

  it("EC-20 — Add custom SVG at cap surfaces refuse-add error and does not open dialog", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue(undefined);
    const settings = await import("../../src/plugins/file-browser/folder-icon-custom-settings");
    const full = Array.from({ length: 100 }, (_, i) => ({
      path: `/u/${i}.svg`, label: `${i}`, addedAt: i,
    }));
    vi.spyOn(settings, "getCustomIcons").mockReturnValue(full);
    const dialogs = await import("../../src/lib/dialogs");
    const dlgSpy = vi.spyOn(dialogs, "openAssetDialog");

    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    void openFolderIconPicker("/v/A");
    await new Promise(r => setTimeout(r, 0));
    (document.querySelector(".folder-icon-picker-add") as HTMLButtonElement).click();
    await new Promise(r => setTimeout(r, 0));
    expect(dlgSpy).not.toHaveBeenCalled();
    const err = document.querySelector(".folder-icon-picker-error");
    expect(err?.textContent).toMatch(/limit reached/i);
  });

  it("Remove-from-Custom × button calls removeCustomIcon and re-renders without that tile", async () => {
    vi.spyOn(store, "readFolderIcon").mockResolvedValue(undefined);
    const settings = await import("../../src/plugins/file-browser/folder-icon-custom-settings");
    const stub = [{ path: "/u/a.svg", label: "a", addedAt: 1 }];
    vi.spyOn(settings, "getCustomIcons").mockImplementation(() => stub.slice());
    const removeSpy = vi.spyOn(settings, "removeCustomIcon").mockImplementation((p) => {
      const i = stub.findIndex(e => e.path === p);
      if (i >= 0) stub.splice(i, 1);
    });
    const cache = await import("../../src/plugins/file-browser/folder-icon-custom-cache");
    vi.spyOn(cache, "getCustomSvg").mockResolvedValue(`<svg/>`);

    const { openFolderIconPicker } = await import(
      "../../src/plugins/file-browser/folder-icon-picker"
    );
    void openFolderIconPicker("/v/A");
    await new Promise(r => setTimeout(r, 10));
    (document.querySelector(".folder-icon-tile-remove") as HTMLButtonElement).click();
    await new Promise(r => setTimeout(r, 10));
    expect(removeSpy).toHaveBeenCalledWith("/u/a.svg");
    expect(document.querySelectorAll(".folder-icon-tile-custom").length).toBe(0);
  });
});
```

## Green

Implement the picker per the API contract above. Key implementation
hints:

- Build with plain DOM, no framework (matches plugin idioms).
- Tile elements are `<button class="folder-icon-tile" data-icon-id="...">`
  for accessibility and easy querying in tests.
- Apply button is `<button class="btn btn-primary folder-icon-picker-apply">`.
- Cancel button is `.folder-icon-picker-cancel`.
- Remove button is `.folder-icon-picker-remove`.
- Use `attachModalKeyboard` from `src/lib/modal-keyboard.ts` for
  Escape/Enter.

## Refactor

- After tests pass, factor the tile-builder into a small helper if the
  function exceeds ~120 lines.
- Verify accessibility: each tile has an `aria-label={def.label}`
  attribute. The grid has `role="listbox"` and tiles have
  `role="option"`.

## Definition of Done

- [ ] `tests/folder-icons/picker.test.ts` passes.
- [ ] `tests/settings/window-defaults.test.ts` still passes.
- [ ] Manual: open picker → grid renders all catalog icons → highlight
      matches current → pick + Apply → modal closes → tree updates
      (after step_07 wires `onChange` to reloadVaultIndex).
- [ ] No raw `invoke()` calls in the picker (C-4).
- [ ] `npm run build:plugins && npm run sync:plugins` (C-8).

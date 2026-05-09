---
title: Step 04 — folder_managed icon (Material Symbols)
last-updated: "2026-05-08"
review-cadence-days: 30
status: active
---

# Step 04 — `folder_managed` icon (Material Symbols)

## Goal

Add the Material Symbols `folder_managed` glyph used by Smart Folder
tree nodes (FR-17 / Locked #7). Wire it to the `.folder-smart` CSS
class so step_03's tree-injection renders a visible icon.

This is a **mechanical, low-risk step** — no logic, just files and a
script re-run.

---

## Files to modify

1. `scripts/fetch-material-icons.mjs` — add `FOLDER_MANAGED:
   "folder_managed"` to the ICONS map.
2. `src/plugins/file-browser/icons/material/index.ts` — auto-regenerated
   by re-running the script (do not hand-edit).
3. `src/plugins/file-browser/file-browser.plugin.ts` — import
   `ICON_FOLDER_MANAGED` and inject it into the icon-class lookup used
   by `appendIconAndLabel`.
4. CSS — add `.folder-smart` mapping to render the icon SVG.

---

## 1. Update the fetch script

In `scripts/fetch-material-icons.mjs`, around line 21:

```javascript
const ICONS = {
  VAULT:          "inventory_2",
  FOLDER:         "folder",
  FOLDER_OPEN:    "folder_open",
  FOLDER_MANAGED: "folder_managed",   // NEW — for Smart Folders (FR-17)
  FILE:           "description",
  FILE_MD:        "article",
  FILE_IMAGE:     "image",
  FILE_JSON:      "data_object",
  FILE_CODE:      "code",
  CHEVRON:        "chevron_right",
  EXPAND:         "keyboard_arrow_down",
  // UNMOUNT key already exists in current code — preserve.
};
```

Preserve all existing entries verbatim (the file-browser plugin imports
several others such as `ICON_UNMOUNT` that may not appear in the
snippet above — do not remove what's already there).

---

## 2. Re-run the fetch script

```bash
node scripts/fetch-material-icons.mjs
```

Expected:

- New file: `src/plugins/file-browser/icons/material/folder_managed.svg`
- Regenerated: `src/plugins/file-browser/icons/material/index.ts` now
  exports `ICON_FOLDER_MANAGED` alongside the existing icons.

**If the script fails** (network down, Material Symbols version
changed): record the failure and **do not** proceed. The script is the
source of truth — hand-writing the SVG would break reproducibility.
Surface the issue to the architect.

---

## 3. Wire the icon class in `file-browser.plugin.ts`

### Change 1 — extend the icon import block

Around line 33:

```typescript
import {
  ICON_VAULT,
  ICON_FOLDER,
  ICON_FOLDER_OPEN,
  ICON_FOLDER_MANAGED,   // NEW
  ICON_FILE,
  ICON_FILE_MD,
  ICON_FILE_IMAGE,
  ICON_FILE_JSON,
  ICON_FILE_CODE,
  ICON_CHEVRON,
  ICON_UNMOUNT,
} from "./icons/material/index";
```

### Change 2 — extend `appendIconAndLabel`

Locate the function that builds the icon `<span>` (search for usage of
`ICON_FOLDER`). Add a branch:

```typescript
if (node.iconClass === "folder-smart") {
  iconSpan.innerHTML = wrapSvg(ICON_FOLDER_MANAGED, 16);
  iconSpan.classList.add("folder-icon");      // reuse existing folder sizing
  iconSpan.classList.add("folder-icon-smart");
} else if (node.type === "directory") {
  // existing folder branch …
}
```

The `folder-icon-smart` modifier exists so step_05's editor can style
the icon distinctively (e.g. accent color) without touching the SVG.

### Change 3 — append the match-count suffix (forward-declared here, fully wired in step_07)

In `appendIconAndLabel`, after the label span is appended:

```typescript
if (node.smartFolderId !== undefined && node.matchCount !== undefined) {
  const suffix = document.createElement("span");
  suffix.className = "tree-node-smart-suffix";
  suffix.textContent = ` (${node.matchCount})`;
  labelEl.appendChild(suffix);     // visually adjacent to the name
}
```

**Note**: this code runs harmlessly even before step_07 because no
smart-folder nodes exist in the tree yet — the conditional simply never
fires. Adding it here keeps the icon-and-label rendering co-located.

---

## 4. CSS additions

Add to `FILE_BROWSER_CSS` (or `file-browser.css`):

```css
/* Smart folder icon: same size grid as regular folders, slightly tinted. */
.folder-icon-smart svg { fill: var(--accent-color, currentColor); opacity: .85; }

/* Match-count suffix: faint, smaller, monospace numerals. */
.tree-node-smart-suffix {
  margin-left: 4px;
  font-size: 11px;
  opacity: .55;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}
```

The accent fallback (`currentColor`) ensures the icon is still visible
when the theme has not defined `--accent-color`.

---

## Tests to pass after this step

Create `tests/plugins/file-browser/smart-folders.icon.test.ts` (or
fold into the existing tree-injection test):

| Test name | Asserts |
|---|---|
| `ICON_FOLDER_MANAGED is exported` | `index.ts` named export exists and is non-empty SVG string |
| `folder-smart class renders folder_managed SVG` | `buildNodeEl(smartFolderNode)` produces a span with `folder-icon-smart` class and contains the expected `<svg>` |
| `non-smart-folder dirs still render folder.svg` | regression check |
| `match-count suffix renders when matchCount defined` | `buildNodeEl` adds `(12)` after the label |
| `match-count suffix omitted when matchCount undefined` | regular dirs don't get a suffix |

---

## Done when

- [ ] Re-run script committed `folder_managed.svg` and updated
      `index.ts`.
- [ ] Plugin builds and syncs.
- [ ] Smart folders (when wired in step_07) display the
      `folder_managed` icon. Until then, this step is a no-op visually.
- [ ] All tests green.

---

## Constraints

- **Do not hand-edit `index.ts`** — re-run the script.
- **Do not introduce a new size** — use 16 px to match existing folder
  rows.
- The icon class string `"folder-smart"` is the **canonical key** —
  step_03 already emits it; do not rename in this step.

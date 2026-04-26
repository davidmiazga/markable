# Step 03: Toolbar Removal & Cleanup

**Phase:** 2B -- Native Menu System
**Depends on:** Step 02 (menu shortcuts working)
**Modifies:** `index.html`, `src/styles.css`, `src/main.ts`

---

## Overview

Remove the HTML toolbar (Open/Save buttons + file name display) now that all file operations are accessible via the native menu bar and keyboard shortcuts. Clean up associated CSS and JavaScript event listeners.

---

## Task 1: Remove Toolbar HTML from index.html

Remove this block from `index.html`:

```html
<!-- Toolbar with file operations -->
<div class="toolbar">
  <button id="btn-open" class="btn" title="Open file (Cmd+O)">
    Open
  </button>
  <button id="btn-save" class="btn" title="Save file (Cmd+S)">
    Save
  </button>
  <span id="file-name" class="file-name"></span>
</div>
```

The resulting body should be:

```html
<body>
  <div id="titlebar" data-tauri-drag-region>
    <span id="titlebar-title" data-tauri-drag-region>Untitled</span>
  </div>
  <div id="app">
    <div id="editor" role="textbox" aria-label="Markdown editor for Markable"></div>
  </div>
</body>
```

---

## Task 2: Remove Toolbar CSS from styles.css

Remove these CSS blocks:
- `.toolbar { ... }`
- `.btn { ... }`
- `.btn:hover { ... }`
- `.btn:active { ... }`
- `.btn:disabled { ... }`
- `.file-name { ... }`

---

## Task 3: Clean Up main.ts

Remove the toolbar button event listener setup:

```typescript
// REMOVE these lines:
const openBtn = document.getElementById("btn-open");
const saveBtn = document.getElementById("btn-save");

if (openBtn) {
  openBtn.addEventListener("click", openFile);
}

if (saveBtn) {
  saveBtn.addEventListener("click", saveFile);
}
```

Also remove the `file-name` span update from `updateTitleBar()` -- the `fileNameEl` / `"Editing: ..."` logic is no longer needed since the toolbar is gone. The title bar title element is the only place the filename is displayed.

---

## Acceptance Criteria

- [ ] No toolbar visible in the app
- [ ] Editor area fills from title bar to bottom of window (no gap)
- [ ] All file operations work via menu: Cmd-N, Cmd-O, Cmd-S, Cmd-Shift-S
- [ ] Title bar still shows "Untitled" or filename correctly
- [ ] No console errors or warnings
- [ ] No orphaned CSS rules or unused JavaScript references
- [ ] `tsc --noEmit` passes
- [ ] `cargo check` passes

---

## Troubleshooting

**Editor doesn't fill space**: The `#app` container uses `flex: 1` which should expand to fill available space. If there's a gap, check that the toolbar div is fully removed (no empty div left behind).

**File name not showing anywhere**: Ensure `updateTitleBar()` still updates the `#titlebar-title` element. Only the `#file-name` span in the toolbar is being removed.

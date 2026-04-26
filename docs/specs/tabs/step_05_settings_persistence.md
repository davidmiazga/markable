---
title: "Tabs Step 05 — Settings Persistence + Session Restore"
last-updated: "2026-04-13"
review-cadence-days: 14
status: active
---

# Step 05 — Settings Persistence + Session Restore

**Goal:** Add tab settings fields to `MarkableSettings`; ensure session restore works end-to-end; add a "Tab Mode" selector to the Settings panel; wire all `saveSession()` trigger points.

**App state after this step:** Tab mode persists across restarts. Previously open files are restored on next launch. The Settings panel has a "Tab Mode" segmented control.

---

## Rust Side: No Changes Required

As noted in `00_index.md`, the Rust `save_settings` command writes raw JSON without deserializing. New TypeScript-only fields (`tabMode`, `openFiles`, `activeTabIndex`) are preserved transparently by `write_raw_settings_to_disk`. No Rust struct changes are needed.

**Migration strategy for existing users:** On first launch with tabs:
- `tabMode` will be absent from `settings.json` → `getCurrentSettings().tabMode` returns `undefined` → TypeScript defaults to `"minimal"` in `init()`. No migration function needed.
- `openFiles` will be absent → defaults to `[]` → one untitled tab is created (FR-6.5).
- `activeTabIndex` will be absent → defaults to `0`.

This is zero-migration: the fields are optional with fallback defaults everywhere they are read.

---

## Modify: `src/lib/settings.ts`

### Add fields to `MarkableSettings` interface

```typescript
export interface SessionTabEntry {
  filePath: string;
  scrollTop: number;
}

export interface MarkableSettings {
  // ... existing fields ...

  /**
   * Tab strip display mode.
   * "minimal" = dot/pill strip (default).
   * "regular" = filename bar with close buttons.
   * "vertical" = left-side vertical strip.
   *
   * Optional — absent in settings files from before tab support. TabManager
   * defaults to "minimal" when this field is absent.
   */
  tabMode?: "minimal" | "regular" | "vertical";

  /**
   * Session restore: open files at last session end.
   * Contains only tabs that had a non-null filePath (FR-6.3).
   * Absent or empty = start fresh with one untitled tab (FR-6.5).
   */
  openFiles?: SessionTabEntry[];

  /**
   * Session restore: index of the active tab at last session end.
   * Clamped to actual tab count on restore (FR-6.6).
   */
  activeTabIndex?: number;
}
```

### No change to `DEFAULT_SETTINGS`

The fields are optional (`?`). `TabManager` applies defaults when they are absent. `DEFAULT_SETTINGS` does not need to include them because `loadSettings()` uses `{ ...structuredClone(DEFAULT_SETTINGS), ...result.value }` spread which leaves absent optional fields as `undefined`.

---

## Session Save Trigger Points

`TabManager.saveSession()` is already implemented in step_01. The trigger points (FR-6.7) are wired across multiple steps:

| Trigger | Where wired |
|---|---|
| Tab opened | `openNewTab()` and `openFileInTab()` already call `saveSession()` |
| Tab closed | `closeTab()` already calls `saveSession()` |
| Active tab changed | `activateTab()` already calls `saveSession()` |
| File path changed (save-as) | `saveActiveTabAs()` already calls `saveSession()` |
| `close-requested` event | Wire in this step (see below) |

### Wire `close-requested` in `main.ts`

In `initApp()`, add a Tauri `close-requested` listener after the existing window event listeners:

```typescript
// Save tab session on window close-requested (FR-6.7d)
const appWindow = getCurrentWebviewWindow();
await appWindow.listen("tauri://close-requested", async () => {
  await tabManager.saveSession();
  await appWindow.destroy();
});
```

**Note:** Listening on `close-requested` requires setting `"closeRequestedEvent": true` in `tauri.conf.json` under `app.windows[0]`. Check whether this is already configured. If not, add it. The pattern must call `appWindow.destroy()` after the save, or the window will not close.

---

## Settings Panel: Tab Mode Selector

Modify `src/settings/settings-panel.ts` to add a "Tabs" section.

### Where to add

Find the section creation pattern in `settings-panel.ts` (each section is a `<div class="settings-section">` with a header and controls). Add a new "Tabs" section.

### Control: segmented control (three buttons)

```html
<div class="settings-section">
  <h3 class="settings-section-title">Tabs</h3>

  <div class="settings-row">
    <label class="settings-label">Tab bar style</label>
    <div class="settings-segmented" id="tab-mode-control">
      <button data-mode="minimal">Minimal</button>
      <button data-mode="regular">Regular</button>
      <button data-mode="vertical">Vertical</button>
    </div>
  </div>
</div>
```

### JavaScript wiring in settings panel

The settings panel is created once (`createSettingsPanel()`) and needs to read current mode on open. Approach:

1. After building the segmented control, add a `click` handler on the container that reads `btn.dataset.mode` and calls `tabManager.setMode(mode)`.
2. When the settings panel opens (`openSettingsPanel()`), sync the active button to `getCurrentSettings().tabMode ?? "minimal"`.

Import `tabManager` at the top of `settings-panel.ts`:
```typescript
import { tabManager } from "../tabs";
```

**EC-18:** If `tabManager` has not yet been initialized (race between settings panel open and init), `tabManager.setMode()` is a no-op (renderer is null). The mode is still persisted via `updateSettings`. The renderer picks it up the next time `init()` runs (next launch). This is acceptable — the user cannot open the Settings panel before `initApp()` completes.

---

## Session Restore: Full Flow in `TabManager.init()`

Step_01 describes the session restore logic. This step confirms the complete sequence including error handling:

```typescript
async init(editorView: EditorView): Promise<void> {
  this.editorView = editorView;

  // 1. Find #tab-strip
  this.tabStripEl = document.getElementById("tab-strip");
  if (!this.tabStripEl) {
    console.error("[TabManager] #tab-strip not found. Tabs disabled.");
    return;
  }

  // 2. Read settings
  const settings = getCurrentSettings();
  this.mode = settings.tabMode ?? "minimal";
  const openFiles: SessionTabEntry[] = settings.openFiles ?? [];
  const savedActiveIndex: number = settings.activeTabIndex ?? 0;

  // 3. Restore tabs from session (FR-6)
  for (const entry of openFiles) {
    const result = await readFile(entry.filePath);
    if (!result.ok) {
      // EC-1, EC-6: skip missing / unreadable files silently
      console.warn("[TabManager] Session restore: skipping", entry.filePath, result.error?.message);
      continue;
    }
    this.tabs.push({
      id: crypto.randomUUID(),
      filePath: entry.filePath,
      title: this._titleFromPath(entry.filePath),
      isDirty: false,
      editorState: EditorState.create({ doc: result.value }),
      scrollTop: entry.scrollTop,
    });
  }

  // 4. Fallback: untitled tab if nothing restored (FR-6.5)
  if (this.tabs.length === 0) {
    this.tabs.push(this._createUntitledTab());
  }

  // 5. Clamp activeIndex (FR-6.6)
  this.activeIndex = Math.min(savedActiveIndex, this.tabs.length - 1);
  this.activeIndex = Math.max(0, this.activeIndex);

  // 6. Sidebar: if vertical mode saved, hide left sidebar before rendering
  if (this.mode === "vertical") {
    const sidebarLeft = document.getElementById("sidebar-left");
    if (sidebarLeft && sidebarLeft.style.display !== "none") {
      toggleSide("left");
    }
  }

  // 7. Mount renderer
  this._instantiateRenderer();
  if (this.renderer && this.tabStripEl) {
    this.renderer.mount(this.tabStripEl, this.tabs, this.activeIndex);
  }

  // 8. Apply active tab to EditorView
  this._applyActiveTab();
}
```

---

## Tests to Write (`tests/tabs/session-restore.test.ts`)

| Test | Covers |
|---|---|
| `init` with valid `openFiles` creates correct tab count | FR-6.1, FR-6.2 |
| `init` skips file path whose `readFile` returns error | EC-1, EC-6 |
| `init` with all files missing creates one untitled tab | FR-6.5 |
| `init` clamps `activeTabIndex` to last tab when too large | FR-6.6 |
| `init` with empty `openFiles` creates one untitled tab | FR-6.5 |
| `saveSession` excludes untitled tabs from `openFiles` | FR-6.3 |
| `saveSession` persists `activeTabIndex` | FR-6.7 |
| Settings `tabMode` field defaults to "minimal" when absent | EC-18 |
| Corrupt settings (EC-7): `init` falls back gracefully | EC-7 |

---

## Verification

After implementing step_05:
1. Open three files. Close app. Reopen — all three files are restored in the same order.
2. Change tab mode to "regular" in Settings. Close app. Reopen — mode is still "regular".
3. Open an untitled tab (step_07 wires this properly, but the tab is already created by `openNewTab()`). Close app. Reopen — untitled tab is not restored; a fresh untitled tab is created.
4. Delete one of the restored files from the filesystem. Reopen — remaining files restore; missing file is silently skipped.

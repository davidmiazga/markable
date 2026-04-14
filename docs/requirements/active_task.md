---
title: "Multi-Document Tabs — Core Infrastructure"
last-updated: "2026-04-13"
review-cadence-days: 14
status: active
---

# Active Task: Multi-Document Tabs — Core Infrastructure

**Status: VALIDATED**
**Date: 2026-04-13**

---

## Summary

As a Markable user, I want to open multiple Markdown files simultaneously as tabs within a single window, with a visual tab strip that supports three display modes (minimal dot-strip, regular filename bar, and vertical sidebar strip), so that I can switch between documents without opening multiple windows.

---

## Background and Constraints from Existing Architecture

### DOM Layout (locked)

Current layout at the time this spec is written:

```
<body>
  #titlebar
  #tab-strip           ← NEW — inserted between titlebar and content-row
  #content-row
    #sidebar-left      ← hidden when vertical tabs mode is active
    #editor-wrap
      #editor
      #status-bar
    #sidebar-right
```

The `#tab-strip` element is owned entirely by `TabManager`. It is inserted into the DOM at application startup and is always present. It is never removed.

### Single EditorView Constraint (locked)

There is exactly one `EditorView` instance for the lifetime of the application. Tab switching is implemented by calling `editorView.setState(savedState)` — it swaps the CM6 `EditorState` object (doc, selection, history, scroll). A new `EditorView` is never created per tab. This is architecturally locked.

### Core Infrastructure (locked)

Tabs are core application infrastructure, not a plugin. The feature:

- Does NOT use `UnifiedPlugin`, `MarkablePluginAPI`, `api.loadSettings()`, or `api.saveSettings()`.
- Does NOT modify `PluginManager` or `MarkablePluginAPI`.
- Lives in `src/editor/tab-manager.ts` (or `src/tabs/`), compiled as part of the main application bundle.

### Settings Persistence (locked)

- Tab mode (`"minimal"` | `"regular"` | `"vertical"`) is stored as a field on `MarkableSettings` in `src/lib/settings.ts` (field name TBD by architecture phase, e.g. `tabMode`).
- Session-restore data (open file paths, active tab index) is also stored in `MarkableSettings` / `settings.json`, not in a plugin settings file.
- `MarkableSettings` IS modified by this feature (Rust struct + TypeScript type both updated).

### Sidebar Interaction (locked)

When vertical tabs mode is active:

- `TabManager` calls the existing `toggleSide("left", false)` from `SidebarManager` to hide `#sidebar-left`. It does not manipulate sidebar DOM directly.
- On mode switch away from vertical, `TabManager` calls `toggleSide("left", true)` to restore the left sidebar.
- The vertical strip is not a sidebar panel; it is a peer element in `#content-row`.

### Renderer Architecture (locked)

The three display modes are implemented as separate renderer classes/modules:

- `MinimalTabBar` — dot/pill strip
- `RegularTabBar` — standard filename bar with close buttons
- `VerticalTabStrip` — vertical left-side strip

A `TabManager` singleton coordinates all tab state and delegates rendering to the currently active renderer. Mode switches replace the active renderer instance; the `#tab-strip` element is reused.

---

## Functional Requirements

### FR-1: Tab Data Model

Each tab record holds:
- `id`: string (UUID, generated at tab creation time)
- `filePath`: string | null (null for untitled documents)
- `title`: string (filename without extension, or "Untitled" for null paths)
- `isDirty`: boolean
- `editorState`: CM6 `EditorState` snapshot (captured on tab-away, applied on tab-switch)
- `scrollTop`: number (pixel offset, captured on tab-away, restored on tab-switch)

### FR-2: TabManager Initialization

`TabManager` is a singleton initialized at application startup (not on demand). It:

- Inserts `#tab-strip` into the DOM between `#titlebar` and `#content-row`.
- Reads `tabMode` and session-restore data from `MarkableSettings`.
- Instantiates the appropriate renderer for the configured mode.
- Restores the previous session (see FR-6).

The tab bar is always present and cannot be disabled.

### FR-3: Display Modes

The application supports three display modes, selectable from the Settings panel:

**FR-3.1 Minimal (default)**
- A horizontal strip of dots/pills rendered in `#tab-strip`, positioned below `#titlebar`.
- Inactive tabs are rendered as small gray circles.
- The active tab is rendered as a wider pill shape (black fill in light theme, white fill in dark theme).
- No text is visible in the strip itself.
- Hovering a dot displays a tooltip showing the filename after an 800 ms delay.
- Dirty state indicator: a small dot overlay on the circle (a second, smaller dot or color shift — exact visual TBD at design phase).
- Dots are clickable to switch tabs.

**FR-3.2 Regular**
- A standard horizontal tab bar rendered in `#tab-strip`.
- Each tab shows the filename and an "x" close button.
- A "+" button sits at the right end of the tab bar.
- The active tab is visually distinguished (accent underline or background).
- Dirty state: a dot indicator on the tab label (e.g., a bullet before the filename).

**FR-3.3 Vertical**
- A narrow vertical strip rendered on the LEFT side of the editor, replacing the left sidebar.
- Filenames are displayed as rotated text (CSS `writing-mode: vertical-rl` or equivalent).
- The active tab is visually distinguished with a background or accent color.
- The strip is positioned as a flex sibling of `#editor-wrap`, occupying the same horizontal space `#sidebar-left` normally uses.
- `#sidebar-left` is hidden by calling `toggleSide("left", false)` while this mode is active.
- Dirty state: a dot indicator alongside the rotated filename.

### FR-4: Mode Switching

- The current mode is stored in `MarkableSettings` under a field such as `tabMode` with values `"minimal"` | `"regular"` | `"vertical"`.
- The Settings panel exposes a segmented control or radio selector for tab mode inside a "Tabs" section.
- Changing the mode immediately re-renders the tab strip without requiring a restart.
- When switching away from vertical mode, `toggleSide("left", true)` is called to restore the left sidebar.

### FR-5: Tab Operations

**FR-5.1 Open New Tab**
- Triggered by `Cmd-T` or `Cmd-N` (both are equivalent — see OD-2) or the "+" button (regular mode only).
- Creates a new untitled tab with an empty CM6 EditorState.
- The new tab becomes the active tab.

**FR-5.2 Close Tab**
- Triggered by `Cmd-W` or the "x" button on a tab (regular and vertical modes).
- If the tab is dirty, a confirmation dialog is shown before closing ("You have unsaved changes. Close anyway?").
- If only one tab remains, closing it closes the window (same behavior as current single-document close).
- After closing, the adjacent tab (preferring the tab to the right, falling back to the left) becomes active.

**FR-5.3 Switch Tab by Index**
- `Cmd-1` through `Cmd-9` activate the tab at that 1-based index.
- `Cmd-9` always activates the last tab (matching macOS/browser convention).
- If fewer tabs exist than the index, the shortcut is a no-op.

**FR-5.4 Tab-Switch State Swap**
- On leaving a tab: capture current `EditorState` via `editorView.state` and scroll position via `editorView.scrollDOM.scrollTop`. Store both in the tab record.
- On entering a tab: call `editorView.setState(tab.editorState)`, then set `editorView.scrollDOM.scrollTop = tab.scrollTop`.
- The live preview file path is updated to `tab.filePath` (calls the existing `setLivePreviewFilePath()`).
- The window title bar is updated to reflect the incoming tab's filename.

**FR-5.5 Open File into Tab**
- When a file is opened via `Cmd-O` or "Open Recent", it opens in a new tab rather than replacing the current document.
- If the file is already open in an existing tab, that tab is activated (no duplicate).

**FR-5.6 Save**
- `Cmd-S` saves the currently active tab's document.
- If the active tab is untitled, `Cmd-S` triggers a Save As dialog.
- `Cmd-Shift-S` always triggers Save As (assigns or reassigns a file path to the current tab).
- After a successful save, the tab's `isDirty` flag is cleared and the dirty indicator is removed.

### FR-6: Session Restore

**FR-6.1** On application startup, `TabManager` reads session-restore data from `MarkableSettings`.

**FR-6.2** The saved session data stored in `MarkableSettings` includes:
- `openFiles`: array of `{ filePath: string; scrollTop: number }` for all tabs that had a non-null `filePath` at last session end.
- `activeTabIndex`: number — index of the active tab from the last session.

**FR-6.3** Untitled (unsaved) tabs are NOT included in session restore — they are silently dropped.

**FR-6.4** If a file in `openFiles` no longer exists on disk at restore time, that tab is skipped silently (no error dialog). The remaining files are restored.

**FR-6.5** If `openFiles` is empty or absent after filtering, a single empty untitled tab is created.

**FR-6.6** The restored `activeTabIndex` is clamped to the actual number of restored tabs. If clamping reduces it to 0 and no tabs exist, one untitled tab is created.

**FR-6.7** Session data is saved to `MarkableSettings` when: (a) a tab is closed, (b) a tab's file path changes (save-as), (c) the active tab changes, or (d) the app window receives the Tauri `close-requested` event.

### FR-7: Dirty State Tracking

- `TabManager` subscribes to CM6 document change transactions via an `EditorView` update listener (registered via `api.addExtensions()` or equivalent direct CM6 integration at startup).
- On each transaction that modifies the document, the active tab's `isDirty` is set to `true`.
- On successful save, the active tab's `isDirty` is set to `false`.
- The tab strip UI re-renders the active tab's indicator immediately on dirty state change.
- The window title bar dirty indicator (bullet or dot prefix) is updated to match the active tab's `isDirty` state, consistent with existing single-document behavior.

### FR-8: Keyboard Shortcuts Summary

| Action | Shortcut |
|---|---|
| New tab | Cmd-T |
| New tab (equivalent) | Cmd-N |
| Close tab | Cmd-W |
| Switch to tab 1–8 | Cmd-1 through Cmd-8 |
| Switch to last tab | Cmd-9 |

All shortcuts are registered via the existing `resolveAction()` / keybindings system.

### FR-9: Soft Tab Count Warning

When the number of open tabs exceeds the soft warning threshold (candidate: 30, pending OD-4 confirmation), a visual indicator is shown in the tab strip. The exact form of the indicator (e.g., a small badge, a color shift on the "+" button) is deferred to the architecture phase. No hard cap is enforced; the user can continue opening tabs beyond the threshold.

---

## Non-Functional Requirements

### NFR-1: Performance
- Tab switching must complete within 100 ms as perceived by the user (no visible flash or layout reflow visible to the naked eye).
- Session restore must not block the window-show sequence — file reads are async and the window shows as soon as the first tab is ready.

### NFR-2: Memory
- Closed tabs must release their CM6 `EditorState` reference from memory immediately.
- `TabManager` must not accumulate stale EditorState snapshots for tabs that have been closed.

### NFR-3: Accessibility
- Tab elements must have `role="tab"` and `aria-selected` attributes.
- The tab strip container must have `role="tablist"`.
- Tooltips (minimal mode) must be attached via `title` attribute or ARIA `aria-describedby` with a visually positioned tooltip element.

### NFR-4: Theme Compatibility
- The tab strip must read active CSS custom properties (`--settings-base-font-size`, theme color variables) so it respects both light and dark themes and custom user themes.
- No hardcoded color values — all colors must reference CSS variables or theme-provided classes.

### NFR-5: No DOM Leaks
- All DOM nodes created by `TabManager` at startup persist for the application lifetime (the tab bar is always present).
- All event listeners attached to `document` or `window` by `TabManager` must be removable (stored as named references) for future testability, even if teardown is not a runtime requirement.

---

## Architecture Decisions

| # | Decision | Status | Rationale |
|---|---|---|---|
| AD-1 | Single EditorView; tab switching uses `setState()` | Locked | Avoids multiple view initialization costs; CM6 EditorState is lightweight to snapshot |
| AD-2 | Session data stored in `MarkableSettings` / `settings.json` | Locked | Tabs are core infrastructure; plugin-scoped persistence is not appropriate |
| AD-3 | `#tab-strip` is a permanent DOM element inserted between `#titlebar` and `#content-row` | Locked | Always-present core UI; no lifecycle management needed |
| AD-4 | Vertical mode calls `toggleSide("left", false/true)` on `SidebarManager` | Locked | Reuses existing sidebar API; avoids direct DOM coupling |
| AD-5 | `TabManager` does not interact with `PluginManager` or `MarkablePluginAPI` | Locked | Tabs are not a plugin; no plugin API changes required |
| AD-6 | Dirty state tracked via CM6 update listener extension registered at startup | Locked | Consistent with how other observers watch editor changes; no additional Tauri bridge calls needed |
| AD-7 | `Cmd-T` and `Cmd-N` are equivalent; both open a new blank untitled tab | Locked (OD-2 resolved) | Preserves existing muscle memory for `Cmd-N`; no suppression or redirect logic needed |
| AD-8 | Three renderer classes (`MinimalTabBar`, `RegularTabBar`, `VerticalTabStrip`) delegated from `TabManager` singleton | Locked | Separates rendering concerns; mode switches swap the active renderer without touching state |

---

## Out of Scope (Deferred)

- **Drag-to-reorder tabs** — deferred; requires pointer drag logic and state reordering.
- **Tab overflow / scrolling tab bar** — if more tabs are open than the bar can display, overflow behavior (scroll arrows, dropdown) is deferred; horizontal overflow hidden with CSS `overflow: hidden` for now.
- **Detach tab to new window** — multi-window support is out of scope for this feature.
- **Tab groups / colored tabs** — deferred.
- **Pin tab** — deferred.
- **Right-click context menu on tabs** — deferred.
- **Synced scroll position for vertical mode resize** — the vertical strip width is fixed; drag-to-resize is deferred.
- **File-watching / external change detection** — out of scope; user sees stale content until they close and reopen the file.
- **Auto-save** — out of scope for this feature.

---

## Edge Case Inventory

| # | Scenario | Expected Behavior |
|---|---|---|
| EC-1 | App launches and all previously open files have been deleted from disk | All missing files are silently skipped. If no files survive restore, one untitled tab is created. No error dialog. |
| EC-2 | User closes the last tab | Window close is triggered (same as existing single-document Cmd-W). If the last tab is dirty, the existing unsaved-changes dialog fires first. |
| EC-3 | User presses Cmd-W with one tab remaining and that tab is dirty | Unsaved-changes dialog shown. On "Close Anyway", window closes. On "Cancel", tab remains open. |
| EC-4 | User opens a file via Cmd-O that is already open in another tab | The existing tab for that file is activated; no duplicate tab is created. A duplicate-prevention check runs by comparing resolved file paths. |
| EC-5 | User switches tabs while a CM6 transaction is in flight (e.g., autocomplete open) | The in-flight transaction is committed to the current tab's EditorState snapshot before the state swap. `editorView.state` always returns the post-transaction state. |
| EC-6 | Session restore reads a file path that exists but the user has no read permission | `readFile()` Tauri command returns an error; that tab is skipped silently. No error dialog. |
| EC-7 | `MarkableSettings` is corrupt or unparseable on restore | Settings load returns default values; TabManager starts with one untitled tab and minimal mode. No crash. |
| EC-8 | `Cmd-1` through `Cmd-9` pressed when fewer tabs exist than the index | Shortcut is a no-op. No error. |
| EC-9 | `Cmd-9` pressed when exactly one tab is open | Activates tab index 0 (last tab convention: always the last, even if that is also the first). |
| EC-10 | Tab mode switched from vertical to minimal/regular | `toggleSide("left", true)` is called to restore the left sidebar to its managed state. |
| EC-11 | Tab mode switched to vertical while a left sidebar panel is in mid-render or mid-animation | `toggleSide("left", false)` is called synchronously after the mode setting is persisted. Any in-progress sidebar animation is cut short. Acceptable — mode switches are explicit user actions. |
| EC-12 | Save As is triggered on an untitled tab; user cancels the dialog | The tab remains untitled and dirty. No file path is assigned. No crash. |
| EC-13 | Two tabs have the same file open (could occur if duplicate detection is bypassed via a race) | The second open attempt activates the existing tab. Files opened via OS drag-and-drop or "Open Recent" must also pass through the duplicate check. |
| EC-14 | User drags a file onto the editor window while multiple tabs are open | The file opens in a new tab (not replacing the current tab). Duplicate check applies. |
| EC-15 | App is force-quit (SIGKILL) between tab operations | Session data from the last successful settings save is restored. Work since the last save is lost. Acceptable — no auto-save is in scope. |
| EC-16 | `Cmd-T` or `Cmd-N` is pressed when vertical tabs mode is active | New untitled tab is created and appended to the vertical strip. |
| EC-17 | Session restore produces more tabs than the UI can reasonably display (e.g., 20+ tabs or beyond soft-warning threshold) | All tabs are restored. If count exceeds soft-warning threshold, the warning indicator is shown. No cap is enforced. |
| EC-18 | The Settings panel is opened before `TabManager` has fully initialized (async startup) | The settings panel must not crash; the tab mode selector reads the default mode from `MarkableSettings` or defaults to `"minimal"`. |
| EC-19 | `Cmd-N` is pressed (pre-existing shortcut) | Behaves identically to `Cmd-T`: opens a new blank untitled tab. No suppression, no redirect logic — both bindings map to the same action in `resolveAction()`. |
| EC-20 | The active tab's file is modified externally (outside of Markable) while the tab is open | Out of scope. User sees stale content until they close and reopen the file. |

---

## Open Decisions

| # | Question | Status | Default Assumption |
|---|---|---|---|
| OD-1 | Is Tabs core infrastructure or a plugin? | **RESOLVED** | Core infrastructure. No plugin API involved. Tab bar is always present and cannot be disabled. |
| OD-2 | Does `Cmd-N` open a new tab or is it suppressed in favor of `Cmd-T`? | **RESOLVED** | `Cmd-N` and `Cmd-T` are fully equivalent. Both open a new blank untitled tab. No suppression or redirect needed. |
| OD-3 | On fresh install (no session data), does the app open to a single untitled tab or attempt to reopen the last used file from `recentFiles`? | **RESOLVED** | Single untitled tab. The `recentFiles` list is not consumed by tab restore on first run. |
| OD-4 | What is the exact tab count at which the soft warning indicator appears? | **OPEN** | Candidate: 30 tabs. Pending user confirmation. Architect must flag this as a configurable constant. |

---

## Files That Will Be Created or Modified

| File | Change |
|---|---|
| `src/editor/tab-manager.ts` (or `src/tabs/tab-manager.ts`) | New — `TabManager` singleton; tab state management; renderer delegation |
| `src/tabs/renderers/minimal-tab-bar.ts` | New — `MinimalTabBar` renderer |
| `src/tabs/renderers/regular-tab-bar.ts` | New — `RegularTabBar` renderer |
| `src/tabs/renderers/vertical-tab-strip.ts` | New — `VerticalTabStrip` renderer |
| `src/lib/settings.ts` | Modified — add `tabMode`, `openFiles`, `activeTabIndex` fields to `MarkableSettings` |
| `src-tauri/src/` (Rust settings struct) | Modified — add corresponding fields to the Rust `MarkableSettings` struct |
| `src/main.ts` | Modified — initialize `TabManager` at startup; wire `Cmd-N` to same action as `Cmd-T` |
| `src/keybindings/keybindings-panel.ts` | Possibly modified — `resolveAction()` updated for new tab actions |
| `src/plugins/markable-plugin-api.ts` | No changes required |
| `src/plugins/index.ts` | No changes required |

---

## Reviewer Checklist (Edge Cases That Must Have Test Coverage)

All 20 edge cases in the Edge Case Inventory (EC-1 through EC-20) are the mandatory test checklist for the Code Reviewer phase. No PR may be approved until each EC item has either a passing automated test or a documented manual verification note explaining why automation is not feasible.

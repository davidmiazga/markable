---
title: "Sidebar Panel System"
last-updated: "2026-04-13"
review-cadence-days: 14
status: active
---

# Active Task: Sidebar Panel System

**Status: VALIDATED**
**Date: 2026-04-13**
**Supersedes:** Auto TOC Plugin Phase 1 task (complete; sidebar infrastructure is the prerequisite for all future panel-bearing plugins)

---

## Summary

As a Markable user, I want a reusable sidebar infrastructure that any plugin can register a panel into — on either the left or right side of the editor — so that future panel-bearing plugins (TOC, Backlinks, etc.) gain a consistent home without each one hacking the DOM individually.

---

## Background and Constraints from Existing Architecture

### Layout (locked)

The current DOM structure is:

```
<body>
  #titlebar
  #app  (flex: column)
    #editor
    #statusbar
```

The Auto TOC plugin currently wraps `#editor` in a `.toc-editor-row` flex row. That bespoke wrapper must be removed and replaced by the shared sidebar infrastructure.

### Plugin API (locked)

- All plugins are IIFE `.js` files that receive a `MarkablePluginAPI` in `onEnable` / `onDisable`.
- The API is defined in `src/plugins/markable-plugin-api.ts`. New sidebar methods must be added to the `MarkablePluginAPI` interface and to `buildMarkablePluginAPI()`.
- Every API addition must be mirrored in the `buildMarkablePluginAPI()` factory.
- Plugins may not import app-internal modules directly (no `import` of `bridge`, `settings`, `main`, etc.).
- The raw `EditorView` is not exposed through the API.

### Settings (locked)

- The authoritative settings type is `MarkableSettings` in `src/lib/settings.ts`.
- Persistence uses `updateSettings()` (immediate write) or `updateSettingsDebounced()` (1 s window) which both ultimately call the Rust `save_settings` command.
- The Rust backend does a raw-JSON pass-through, so adding optional TypeScript-only fields to `MarkableSettings` (without touching Rust structs) is safe and established precedent (`findWidget`, `keybindings`, `plugins`, etc.).
- Sidebar state does not currently exist in `MarkableSettings` — it must be added as an optional field.

### Keyboard shortcuts (locked)

- `Cmd-[` is already in use: it is the standard macOS "Decrease Indent" action. Confirm whether it is currently bound in `formatKeymap` before assigning sidebar shortcuts.
- `Cmd-]` similarly. These may conflict; the Architect must audit `src/editor/format.ts` and `src/keybindings/`.
- All keybindings must be registered via the existing keybindings system (`src/keybindings/`) so they appear in the Keyboard Shortcuts panel and can be customised by the user.

### Auto TOC migration (locked)

- The Auto TOC plugin (`src/plugins/auto-toc/auto-toc.plugin.ts`) must be migrated to use the new sidebar API.
- Its current DOM-manipulation code (`enableLayout`, `disableLayout`, `.toc-editor-row`, `#toc-sidebar`, `TOC_CSS` for layout only) must be removed.
- Only its pure logic (`scanHeadings`, `findActiveIndex`, `rebuildTOC`) and CM6 update listener must be retained; the panel content area is provided by the sidebar infrastructure.
- Existing tests for `scanHeadings` and `findActiveIndex` must continue to pass without modification.

---

## Functional Requirements

### FR-1: Left and Right Sidebar Slots

The layout must provide exactly two sidebar slots: `left` and `right`. Each slot can be independently shown or hidden. The editor (`#editor`) occupies the remaining horizontal space between the two visible sidebars. The status bar (`#statusbar`) always spans full width below all sidebars (it is a direct child of `#app`, not of the row container).

### FR-2: Plugin Panel Registration API

A plugin calls `api.registerSidebarPanel(descriptor)` in `onEnable` to register its panel, and `api.unregisterSidebarPanel(panelId)` in `onDisable` to remove it. The descriptor must include:

- `id: string` — unique panel identifier (must be unique across all registered panels; kebab-case recommended).
- `title: string` — short label displayed in the tab bar and accordion header.
- `side: "left" | "right"` — which slot the panel requests.
- `render(container: HTMLElement): void` — called by the infrastructure when the panel needs to be (re-)drawn into the provided container element. The plugin is responsible for all DOM inside `container`.
- `destroy(container: HTMLElement): void` — called when the panel is unregistered or the plugin is disabled; the plugin must clean up all DOM and event listeners it placed inside `container`.
- `defaultWidth?: number` — optional preferred width in pixels (default: 220 px if absent).

### FR-3: Tab Bar (Multiple Panels on the Same Side)

When two or more panels are registered to the same side, a horizontal tab bar appears at the top of that sidebar. Each tab shows the panel's `title`. Only one panel is active (visible) at a time per side. Clicking a tab makes it active. When only one panel is registered on a side, no tab bar is rendered — the panel header text (if shown via accordion) or side-indicator suffices.

### FR-4: Accordion Fold per Panel

Each panel within a sidebar has a fold toggle button (chevron up/down icon). Clicking it collapses or expands the panel content area. When collapsed, only the panel header row (containing the title and fold button) is visible; the content area has `display: none`. This is distinct from hiding the entire sidebar: an accordion-collapsed panel still counts as "open" for sidebar visibility purposes.

**Clarification on interaction with tabs:** In a tabbed sidebar (FR-3), the accordion toggle controls the content area of the currently active tab only. Switching to a different tab shows that tab's last-known accordion state.

### FR-5: Show/Hide Sidebar via Keyboard Shortcuts

Two keyboard shortcuts must be registered through the existing keybindings system:

- Toggle left sidebar visibility: default binding to be determined after conflict audit (see Unknowns), command-id `sidebar.toggleLeft`.
- Toggle right sidebar visibility: default binding to be determined after conflict audit, command-id `sidebar.toggleRight`.

"Hidden" means the entire sidebar slot (including its tab bar if present) has `display: none`. The editor expands to fill the freed space. Toggling a hidden sidebar back to visible restores it to its previous width.

### FR-6: Persist Sidebar State

The following state must survive app restart. It is stored under a new optional field `sidebar` in `MarkableSettings`:

- Per side (`left`, `right`): open/closed (boolean).
- Per side: active tab panel id (string, or null if no panels registered).
- Per side: accordion expanded/collapsed state per registered panel id (Record<string, boolean>).
- Per side: width in pixels (number).

On cold start, if `sidebar` is absent from settings (migration case — all existing installs), both sidebars default to closed. The active tab defaults to the first registered panel on each side. Accordion state defaults to expanded.

### FR-7: Default Side and Width

Each panel descriptor declares a preferred `side`. The sidebar infrastructure honours this preference on first registration. If the user later drags or otherwise moves a panel (out of scope for this release — see NFR-5), the persisted side is used instead. For this release, panels always appear on their declared side.

The default sidebar width is 220 px if `defaultWidth` is not specified in the descriptor and no persisted width exists.

### FR-8: Auto TOC Migration

The Auto TOC plugin's `onEnable` must call `api.registerSidebarPanel(...)` with `side: "right"`, providing a `render` callback that creates the `.toc-list` DOM and starts the CM6 update listener. The `destroy` callback must cancel any pending debounce timer, remove the CM6 extension (via `api.removeExtensions()`), and clear internal state. All current `.toc-editor-row` and bespoke layout code must be removed from the plugin.

### FR-9: No-Panel State

When no panels are registered to a side, that sidebar slot does not exist in the DOM. Keyboard shortcuts for that side are no-ops (they do not throw errors).

### FR-10: Plugin Enable/Disable During Sidebar Open

If a plugin is disabled while its sidebar panel is visible, the infrastructure calls `descriptor.destroy(container)` and removes the panel's tab (if in a tabbed sidebar). If that panel was the active tab, the sidebar switches focus to the next available tab. If it was the last panel on that side, the sidebar hides itself. If a plugin is re-enabled, its panel is re-registered and the sidebar shows it again.

### FR-11: Sidebar Width

The sidebar width is user-resizable via a drag handle on the inner edge of each sidebar (right edge of the left sidebar; left edge of the right sidebar). The width is clamped between 150 px and 600 px. Width changes are persisted using `updateSettings()`.

### FR-12: Theme Compatibility

All sidebar chrome (tab bar, accordion header, drag handle, borders) must use CSS custom properties (`var(--bg-titlebar)`, `var(--border-color)`, `var(--text-primary)`, `var(--text-secondary)`, `var(--link-color)`, `var(--selection-bg)`) so that it automatically adopts hot-swapped themes. Panels themselves are responsible for their own internal CSS using the same variables.

### FR-13: Sidebar Infrastructure Module Location

The sidebar infrastructure must live in a dedicated module `src/sidebar/` (exact structure to be decided by the Architect), not inside `src/plugins/`. The `MarkablePluginAPI` calls `registerSidebarPanel` / `unregisterSidebarPanel` which delegate to the sidebar module, following the same pattern as `ensureStatusBar` / `hideStatusBarIfUnused` delegate to `src/plugins/status-bar/status-bar.ts`.

---

## Non-Functional Requirements

### NFR-1: Zero Layout Flash on Plugin Toggle

Enabling or disabling a plugin with a sidebar panel must not produce a visible flash or reflow of the editor content beyond the deliberate sidebar slide (or snap) into/out of view. The Auto TOC migration must not be perceptibly slower than its current direct DOM approach.

### NFR-2: No Leaked DOM After Disable

After `api.unregisterSidebarPanel()` completes, no DOM nodes introduced by that panel must remain in the document. The sidebar infrastructure must guarantee container cleanup by calling `descriptor.destroy(container)` before removing the container.

### NFR-3: Toggle Cycle Stability

A plugin that registers a panel, then unregisters it, then registers it again must produce identical visual and functional results to the first registration. The infrastructure must not accumulate duplicate DOM elements or duplicate event listeners across toggle cycles.

### NFR-4: Settings Write Efficiency

Accordion state changes must be persisted using `updateSettings()` immediately (user has expressed an intent). Width changes during drag must use `updateSettingsDebounced()` (high-frequency event) with the existing 1 s debounce. Open/closed toggle must use `updateSettings()` immediately.

### NFR-5: Panel Repositioning Out of Scope

Moving panels from one side to the other at runtime is deferred to a future release. The `side` field in the descriptor is fixed for the lifetime of the plugin's registration.

### NFR-6: Vitest Test Coverage

The sidebar infrastructure core logic (panel registration, tab management, accordion state, settings serialisation) must have unit test coverage in `tests/`. Auto TOC migration tests (currently passing) must continue to pass without modification.

### NFR-7: No Hardcoded Pixel Values Outside CSS Custom Properties

Sidebar chrome sizing (border width, header height, chevron button dimensions) must be defined in CSS, not hardcoded in TypeScript, to allow theme overrides.

---

## Settings Schema Addition

The following optional field is added to `MarkableSettings` in `src/lib/settings.ts`. The Rust backend's raw-JSON pass-through makes this safe without touching Rust code.

```typescript
export interface SidebarPanelState {
  accordionExpanded: boolean;
}

export interface SidebarSlotState {
  open: boolean;
  activeTabId: string | null;
  width: number;
  panels: Record<string, SidebarPanelState>;
}

export interface SidebarSettings {
  left: SidebarSlotState;
  right: SidebarSlotState;
}

// Added to MarkableSettings:
sidebar?: SidebarSettings;
```

Default (applied when `sidebar` is absent from the loaded settings file):

```typescript
const DEFAULT_SIDEBAR_SLOT: SidebarSlotState = {
  open: false,
  activeTabId: null,
  width: 220,
  panels: {},
};
```

---

## API Surface Addition (MarkablePluginAPI)

The following two methods must be added to the `MarkablePluginAPI` interface in `src/plugins/markable-plugin-api.ts` and implemented in `buildMarkablePluginAPI()`:

```typescript
/**
 * Register a sidebar panel for this plugin. Call in onEnable.
 * The panel appears in the sidebar slot specified by descriptor.side.
 * Idempotent: calling again with the same id replaces the previous registration.
 */
registerSidebarPanel(descriptor: SidebarPanelDescriptor): void;

/**
 * Unregister the sidebar panel with the given id. Call in onDisable.
 * Triggers descriptor.destroy(container) before removing the DOM.
 * No-op if panelId was not registered by this plugin.
 */
unregisterSidebarPanel(panelId: string): void;
```

The `SidebarPanelDescriptor` type must be exported from the sidebar module and re-exported from `src/plugins/markable-plugin-api.ts` for plugin author convenience.

---

## Edge Case Inventory

**EC-1: No panels registered on either side.**
Both sidebar slots are absent from the DOM. Keyboard shortcuts `sidebar.toggleLeft` and `sidebar.toggleRight` are both no-ops. No visual chrome is rendered. The editor occupies full width. No errors thrown.

**EC-2: Single panel registered on one side only.**
No tab bar is rendered for that side (single-panel rule, FR-3). The sidebar is shown immediately when the plugin enables. The other side remains absent from the DOM.

**EC-3: Multiple panels registered to the same side (tab scenario).**
A tab bar appears. The first registered panel is active. Switching tabs must update `activeTabId` in settings and call `render` on the newly active panel's container if it has not yet been rendered. The previously active panel's container remains in the DOM but is hidden (`display: none`) to avoid destroying state unnecessarily.

**EC-4: Active tab panel is unregistered while visible.**
The infrastructure switches to the next available tab (by registration order). If no other panels exist on that side, the sidebar hides itself and `open` is set to `false` in settings.

**EC-5: Last panel on a side is unregistered.**
The entire sidebar slot is removed from the DOM. The `#editor` expands to fill the space. Persisted `open` state for that side is set to `false`. On next app launch with no panels registered, sidebar defaults to closed.

**EC-6: Accordion collapsed, then panel unregistered.**
`descriptor.destroy(container)` is called regardless of accordion state. The infrastructure must not skip destroy because the content area was hidden.

**EC-7: Plugin disabled while accordion is collapsed.**
Same as EC-6. Destroy must fire. The accordion state (collapsed) is preserved in settings so that if the plugin is re-enabled, the panel re-opens in collapsed state.

**EC-8: Keyboard shortcut fires when target sidebar has no panels registered.**
No-op. No error. No DOM mutation.

**EC-9: Keyboard shortcut fires when target sidebar is already in the requested state.**
Toggle is idempotent: toggling an open sidebar with `toggleRight` closes it; toggling a closed sidebar opens it. No error if called redundantly (e.g. two rapid keypresses).

**EC-10: Settings file predates sidebar field (migration).**
`MarkableSettings.sidebar` is absent. Both slots default to closed, width 220 px, no active tab, all panels expanded. This is the common case for all existing installs on first upgrade.

**EC-11: `sidebar.open` is `true` in persisted settings but the plugin that owned the panel is disabled on launch.**
On launch, plugins are restored before sidebar state is applied. If no panels are registered to a slot by the time sidebar restoration runs, the slot is not shown regardless of persisted `open: true`. No error.

**EC-12: Two plugins attempt to register panels with the same `id`.**
The second registration must log a console warning and be rejected (not silently overwrite). The first registration remains active.

**EC-13: `render` callback throws during panel creation.**
The infrastructure catches the error, logs it to the console with the panel id, and renders an error placeholder ("Panel failed to load") inside the container instead of propagating the exception.

**EC-14: `destroy` callback throws during teardown.**
The infrastructure catches the error, logs it, and proceeds with DOM removal regardless. A throwing `destroy` must never prevent the panel from being removed from the DOM.

**EC-15: Sidebar resize drag below minimum width (150 px).**
Drag is clamped at 150 px. The width CSS is updated in real time during drag but settings are only written on drag end (mouseup / pointerup). The editor does not reflow below the minimum sidebar width; it reaches its own minimum usable width constraint (out of scope for this feature).

**EC-16: Sidebar resize drag above maximum width (600 px).**
Clamped at 600 px. Same behaviour as EC-15.

**EC-17: App closes during a debounced sidebar width save.**
The debounce is 1 s. If the window closes before the timer fires, the last persisted width is the one from the previous completed save. This is acceptable (consistent with existing behaviour for window move/resize).

**EC-18: `registerSidebarPanel` called from `onDisable` (programming error).**
The infrastructure logs a warning and no-ops. Panels should only be registered from `onEnable`.

**EC-19: `unregisterSidebarPanel` called with an id not owned by the calling plugin.**
No-op. The infrastructure does not allow one plugin to unregister another plugin's panel. Ownership is tracked by `pluginId` (same closure-capture pattern as `addExtensions`/`removeExtensions`).

**EC-20: Auto TOC plugin toggled off and on rapidly (toggle cycle).**
The sidebar infrastructure must not produce duplicate tab entries, duplicate DOM containers, or duplicate event listeners after a rapid disable/re-enable cycle (leverages NFR-3).

**EC-21: Auto TOC plugin enabled, then sidebar hidden via keyboard shortcut.**
The CM6 update listener inside the panel continues to run (it is still registered). On sidebar show, the TOC content is already current. No stale-data flash.

**EC-22: Auto TOC panel render called when `window.__MARKABLE_EDITOR_VIEW__` is not yet set.**
The panel renders the empty state (no headings). The CM6 update listener populates it on the first transaction, consistent with current behaviour.

**EC-23: Sidebar open state restored before any panels are registered.**
The sidebar infrastructure must defer showing the sidebar until at least one panel has been registered to the relevant side, even if persisted state says `open: true`.

---

## Out of Scope (this release)

- Moving a panel from one side to the other at runtime (NFR-5).
- Detachable/floating sidebar panels.
- Stacked (non-tabbed) panel layout (all panels visible simultaneously on the same side).
- Per-panel resize handles (only the sidebar slot as a whole is resizable).
- Nested accordions.
- Sidebar panels contributed by user plugins (infrastructure supports it technically, but no test user-plugin is required).

---

## Files to Create / Modify

| File | Action |
|---|---|
| `src/sidebar/` | Create new module (structure TBD by Architect) |
| `src/plugins/markable-plugin-api.ts` | Add `registerSidebarPanel`, `unregisterSidebarPanel`; re-export `SidebarPanelDescriptor` |
| `src/lib/settings.ts` | Add `SidebarSettings`, `SidebarSlotState`, `SidebarPanelState` types; add `sidebar?` field to `MarkableSettings`; add default in `DEFAULT_SETTINGS` |
| `src/plugins/auto-toc/auto-toc.plugin.ts` | Migrate to `api.registerSidebarPanel`; remove `enableLayout`, `disableLayout`, `.toc-editor-row`, layout CSS |
| `src/keybindings/` | Register `sidebar.toggleLeft` and `sidebar.toggleRight` commands |
| `tests/` | Add sidebar infrastructure unit tests; verify Auto TOC tests still pass |

---
title: "Step 01 — Settings Types and Defaults"
last-updated: "2026-04-13"
review-cadence-days: 14
status: active
---

# Step 01 — Settings Types and Defaults

## Goal

Add the three new settings interfaces and the `sidebar?` optional field to `MarkableSettings`. This step has zero runtime side-effects: it is purely additive TypeScript. All existing tests must continue to pass without modification.

---

## Files Changed

| File | Action |
|---|---|
| `src/lib/settings.ts` | Add interfaces + field + default |

---

## Exact Changes

### 1. Add interfaces after the `PluginEnableRecord` interface (after line 35)

Insert the following block immediately before the `MarkableSettings` interface declaration:

```typescript
// ── Sidebar settings ──────────────────────────────────────────────────────────

/**
 * Per-panel accordion state for one registered panel.
 * Keyed by panelId in SidebarSlotState.panels.
 */
export interface SidebarPanelState {
  accordionExpanded: boolean;
}

/**
 * Persisted state for one sidebar slot (left or right).
 *
 * open           — whether the slot is currently visible.
 * activeTabId    — id of the panel whose content is shown; null if no panels
 *                  were registered when the settings were last written.
 * width          — slot width in pixels (clamped 150–600 at write time).
 * panels         — per-panel accordion state map (key = panelId).
 */
export interface SidebarSlotState {
  open: boolean;
  activeTabId: string | null;
  width: number;
  panels: Record<string, SidebarPanelState>;
}

/**
 * Top-level sidebar settings object stored under MarkableSettings.sidebar.
 * The Rust backend's raw-JSON pass-through makes this field safe without
 * touching Rust structs (same precedent as findWidget, keybindings, plugins).
 */
export interface SidebarSettings {
  left: SidebarSlotState;
  right: SidebarSlotState;
}

/**
 * Default state for one sidebar slot. Used when the settings file predates
 * the sidebar field (EC-10 migration case) and as the factory default.
 *
 * Both sidebars default to closed on first run (FR-6, EC-10).
 */
export const DEFAULT_SIDEBAR_SLOT: SidebarSlotState = {
  open: false,
  activeTabId: null,
  width: 220,
  panels: {},
};
```

### 2. Add `sidebar?` to `MarkableSettings` interface

Inside the `MarkableSettings` interface, after the `plugins?` field, add:

```typescript
  /**
   * Sidebar slot state for left and right sidebars.
   *
   * Optional — absent in settings files created before sidebar support was
   * added. SidebarManager.init() applies DEFAULT_SIDEBAR_SLOT for each side
   * that is absent. The Rust raw-JSON pass-through means this field is safe
   * to add without modifying any Rust struct.
   */
  sidebar?: SidebarSettings;
```

### 3. Add `sidebar` default to `DEFAULT_SETTINGS`

Inside the `DEFAULT_SETTINGS` constant, after the `keybindings` entry, add:

```typescript
  sidebar: {
    left: { ...DEFAULT_SIDEBAR_SLOT },
    right: { ...DEFAULT_SIDEBAR_SLOT },
  },
```

Note: the spread ensures each default is a new object, not a shared reference. The `DEFAULT_SIDEBAR_SLOT` constant is used for the per-side entry only — do not reference it directly as both `.left` and `.right` (that would share the same object across sides).

---

## Acceptance Criteria

1. TypeScript compiler (`npx tsc --noEmit`) reports zero new errors after this change.
2. `tests/settings.test.ts` passes without modification.
3. `DEFAULT_SETTINGS.sidebar.left` and `DEFAULT_SETTINGS.sidebar.right` are distinct object references (`DEFAULT_SETTINGS.sidebar.left !== DEFAULT_SETTINGS.sidebar.right`).
4. `DEFAULT_SETTINGS.sidebar.left.open === false` and `.width === 220`.
5. The `loadSettings()` function in `settings.ts` already uses `{ ...structuredClone(DEFAULT_SETTINGS), ...result.value }` spread, which means a settings file without the `sidebar` key will automatically receive the default value from `DEFAULT_SETTINGS`. No additional migration code is needed in `loadSettings()` for this step.

---

## Notes

- Do not add `sidebar` to the Rust `MarkableSettings` struct. The raw-JSON pass-through pattern (see `settings.ts` comments, line 233) is the established precedent for TypeScript-only fields.
- `SidebarPanelDescriptor` is NOT defined here — it belongs to `src/sidebar/sidebar-manager.ts` (step_02) and is re-exported through the plugin API (step_04).

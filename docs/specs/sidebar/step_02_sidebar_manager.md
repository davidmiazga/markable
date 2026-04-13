---
title: "Step 02 — SidebarManager Core Module"
last-updated: "2026-04-13"
review-cadence-days: 14
status: active
---

# Step 02 — SidebarManager Core Module

## Goal

Create `src/sidebar/sidebar-manager.ts` and `src/sidebar/index.ts`. This is the heart of the feature: it owns all DOM lifecycle (create/destroy sidebar slots, tab bars, accordion headers, panel containers, resize handles), all runtime state, and all settings persistence for the sidebar.

This step has no visual output yet — CSS is added in step_03. However, the module must be fully functional (all methods correct) because step_04 wires it into the live app.

**Dependency:** step_01 must be complete (settings interfaces defined).

---

## Files Changed

| File | Action |
|---|---|
| `src/sidebar/sidebar-manager.ts` | Create |
| `src/sidebar/index.ts` | Create |

---

## `src/sidebar/sidebar-manager.ts` — Full Specification

### Imports

```typescript
import {
  getCurrentSettings,
  updateSettings,
  updateSettingsInMemory,
  saveSettingsDebounced,
} from "../lib/settings";
import type {
  SidebarSettings,
  SidebarSlotState,
  DEFAULT_SIDEBAR_SLOT,
} from "../lib/settings";
```

Note: `DEFAULT_SIDEBAR_SLOT` is imported as a value (not just a type) because it is used to construct defaults for missing slots.

### Exported Type: `SidebarPanelDescriptor`

```typescript
export interface SidebarPanelDescriptor {
  /**
   * Unique panel id (kebab-case recommended). Must be unique across all
   * registered panels — EC-12: duplicate id causes a warning + rejection.
   */
  id: string;

  /** Short title shown in tab bar and accordion header. */
  title: string;

  /**
   * Which sidebar slot this panel requests.
   * Fixed for the lifetime of the registration (NFR-5).
   */
  side: "left" | "right";

  /**
   * Called by the infrastructure to (re-)draw the panel into container.
   * The plugin owns all DOM inside container. The infrastructure wraps
   * this call in try/catch — a throw renders an error placeholder (EC-13).
   */
  render(container: HTMLElement): void;

  /**
   * Called before the panel is removed. The plugin must clean up all DOM
   * and event listeners it placed inside container. The infrastructure
   * wraps this call in try/catch — a throw is logged but does not prevent
   * DOM removal (EC-14).
   */
  destroy(container: HTMLElement): void;

  /**
   * Preferred initial width in pixels. Used only when no persisted width
   * exists for this side. Default: 220 px.
   */
  defaultWidth?: number;
}
```

### Private Types

```typescript
/** Runtime record stored per registered panel. */
interface RegisteredPanel {
  pluginId: string;
  descriptor: SidebarPanelDescriptor;
  /** The div passed to render() / destroy(). Populated by createPanelContainer(). */
  contentEl: HTMLDivElement;
  /** The outer wrapper: .sidebar-panel-wrapper (contains header + contentEl). */
  wrapperEl: HTMLDivElement;
  /** The tab button. Null until the side has ≥2 panels (at which point all tabs are created). */
  tabEl: HTMLButtonElement | null;
  /** True after render() has been called at least once without throwing. */
  rendered: boolean;
}

/** Runtime DOM state for one sidebar slot. */
interface SlotRuntime {
  /** The #sidebar-left or #sidebar-right element. Null until first panel registered on this side. */
  el: HTMLDivElement | null;
  /** The .sidebar-tab-bar element. Null when side has 0 or 1 panel. */
  tabBarEl: HTMLDivElement | null;
  /** The resize handle element. */
  resizeHandleEl: HTMLDivElement | null;
  /** panelIds in registration order for this side. */
  panelIds: string[];
}
```

### Module-level State

```typescript
/** All registered panels across both sides. */
const registeredPanels = new Map<string, RegisteredPanel>();

/** Runtime DOM state per side. */
const slotRuntime: Record<"left" | "right", SlotRuntime> = {
  left:  { el: null, tabBarEl: null, resizeHandleEl: null, panelIds: [] },
  right: { el: null, tabBarEl: null, resizeHandleEl: null, panelIds: [] },
};

/** The #app-row flex row containing #sidebar-left, #editor, #sidebar-right. */
let appRowEl: HTMLDivElement | null = null;

/** True after init() has been called. Guards against double-init. */
let initialized = false;
```

### `init(): void`

Purpose: create the `#app-row` wrapper and move `#editor` into it. Idempotent.

```
1. If initialized === true, return immediately.
2. Query #app and #editor; throw if absent (programming error — app not ready).
3. Create appRowEl = div#app-row.
4. Get #statusbar from #app (may be null).
5. If statusbar exists: app.insertBefore(appRowEl, statusbar).
   Else: app.appendChild(appRowEl).
6. appRowEl.appendChild(editor).
7. Set initialized = true.
```

The `#sidebar-left` and `#sidebar-right` elements are NOT created here — they are created lazily in `register()` when the first panel for each side arrives.

### `register(pluginId: string, descriptor: SidebarPanelDescriptor): void`

```
1. If registeredPanels.has(descriptor.id):
     console.warn(`[SidebarManager] Panel id "${descriptor.id}" is already registered. ` +
                  `Ignoring duplicate registration from plugin "${pluginId}".`);
     return.                                                          ← EC-12

2. Ensure init() has been called (call it if not).

3. Determine side = descriptor.side ("left" | "right").
4. Get runtime = slotRuntime[side].

5. If runtime.el === null (first panel on this side):
   a. Create runtime.el = div#sidebar-left or div#sidebar-right.
   b. Set inline style width from persisted settings or descriptor.defaultWidth ?? 220.
   c. Create resize handle (see "Resize Handle" section below).
   d. runtime.resizeHandleEl = handle.
   e. If side === "left": appRowEl.prepend(runtime.el).
      If side === "right": appRowEl.appendChild(runtime.el).

6. Create wrapperEl = div.sidebar-panel-wrapper with data-panel-id=descriptor.id.
7. Create panel header:
   - headerEl = div.sidebar-panel-header
   - titleEl = span.sidebar-panel-title with textContent = descriptor.title
   - toggleBtn = button.sidebar-accordion-toggle (aria-label "Toggle panel")
   - headerEl.appendChild(titleEl); headerEl.appendChild(toggleBtn)
   - wrapperEl.appendChild(headerEl)
8. Create contentEl = div.sidebar-panel-content.
   wrapperEl.appendChild(contentEl).
9. runtime.el.appendChild(wrapperEl).  (inserts before resize handle — see step_03 for z-order)

10. Wire accordion toggle:
    - toggleBtn.addEventListener("click", () => _handleAccordionToggle(descriptor.id))

11. Create RegisteredPanel entry and store in registeredPanels Map:
    { pluginId, descriptor, contentEl, wrapperEl, tabEl: null, rendered: false }

12. runtime.panelIds.push(descriptor.id).

13. Reconcile tab bar for this side (see "Tab Bar Reconciliation" below).

14. Render the panel content (see "Render Invocation" below).

15. Read persisted accordion state and apply:
    const settings = getCurrentSettings();
    const panelState = settings.sidebar?.[side]?.panels?.[descriptor.id];
    const expanded = panelState?.accordionExpanded ?? true;   ← default expanded
    _setAccordionState(descriptor.id, expanded, /* persist= */ false);

16. If side is currently open in persisted settings and has panels:
    Show the slot (runtime.el.style.display = "flex" or equivalent).
    (If settings.sidebar?.[side]?.open !== true, the slot remains visible but
    whether the overall sidebar is shown is controlled by restoreFromSettings() later.
    For the registration path, always show the slot — restoreFromSettings() will
    hide it if needed before the window is shown.)

17. Persist updated settings:
    updateSettings(s => ({
      ...s,
      sidebar: {
        ...s.sidebar,
        [side]: {
          ...(s.sidebar?.[side] ?? DEFAULT_SIDEBAR_SLOT),
          activeTabId: _getActiveTabId(side),
          panels: _buildPanelsRecord(side),
        }
      }
    }));
```

### `unregister(pluginId: string, panelId: string): void`

```
1. If !registeredPanels.has(panelId): return (no-op, EC-19 ownership mismatch also handled here).
2. const panel = registeredPanels.get(panelId)!.
3. If panel.pluginId !== pluginId:
     console.warn(`[SidebarManager] Plugin "${pluginId}" attempted to unregister ` +
                  `panel "${panelId}" owned by "${panel.pluginId}". Ignoring.`);
     return.                                                          ← EC-19
4. const side = panel.descriptor.side.
5. const runtime = slotRuntime[side].

6. Determine if this panel is currently active:
   const settings = getCurrentSettings();
   const wasActive = settings.sidebar?.[side]?.activeTabId === panelId;

7. Call descriptor.destroy(contentEl) inside try/catch:
   try { panel.descriptor.destroy(panel.contentEl); }
   catch (err) { console.error(`[SidebarManager] destroy() threw for panel "${panelId}":`, err); }
                                                                      ← EC-14

8. Remove wrapperEl from DOM: panel.wrapperEl.remove().
9. Remove from registeredPanels: registeredPanels.delete(panelId).
10. Remove from runtime.panelIds: runtime.panelIds = runtime.panelIds.filter(id => id !== panelId).

11. Reconcile tab bar for this side.

12. If runtime.panelIds.length === 0:
    a. runtime.el?.remove();  runtime.el = null.
    b. runtime.resizeHandleEl = null.
    c. Persist: sidebar[side].open = false, sidebar[side].activeTabId = null.
    EC-5

13. Else if wasActive (there are still panels remaining):
    a. Switch active tab to runtime.panelIds[0].
    b. _setActivePanel(side, runtime.panelIds[0]).
    EC-4

14. Persist updated settings (sidebar[side].panels, activeTabId, open).
```

### `toggleSide(side: "left" | "right"): void`

```
1. If slotRuntime[side].panelIds.length === 0: return (no-op, EC-8, EC-1).
2. const el = slotRuntime[side].el; if (!el) return.
3. const currentlyOpen = getCurrentSettings().sidebar?.[side]?.open ?? false.
4. const nextOpen = !currentlyOpen.
5. el.style.display = nextOpen ? "" : "none".
6. updateSettings(s => ({ ...s, sidebar: { ...s.sidebar, [side]: { ...s.sidebar?.[side], open: nextOpen } } })).
```

### `restoreFromSettings(): void`

Purpose: called from `main.ts` after all plugins have been restored. Applies persisted open/closed state to the sidebars without firing their render again (render was already called during register).

```
1. For each side in ["left", "right"]:
   a. const runtime = slotRuntime[side].
   b. If runtime.el === null (no panels registered): continue.  ← EC-11, EC-23
   c. const slotSettings = getCurrentSettings().sidebar?.[side].
   d. const shouldOpen = slotSettings?.open ?? false.
   e. runtime.el.style.display = shouldOpen ? "" : "none".
   f. If slotSettings?.activeTabId exists and is registered: _setActivePanel(side, slotSettings.activeTabId).
```

### Private Helper: Tab Bar Reconciliation

Called after any registration or unregistration on a side.

```
_reconcileTabBar(side: "left" | "right"): void

const runtime = slotRuntime[side];
const count = runtime.panelIds.length;

if (count <= 1):
  // Remove tab bar entirely; all wrappers become visible directly.
  runtime.tabBarEl?.remove(); runtime.tabBarEl = null.
  // Null out tabEl on all RegisteredPanel entries for this side.
  runtime.panelIds.forEach(id => { const p = registeredPanels.get(id); if (p) p.tabEl = null; });
  // If count === 1: show the single wrapper; the header title serves as the label.
  if (count === 1): _setActivePanel(side, runtime.panelIds[0]).

else (count >= 2):
  // Ensure tab bar exists.
  if (!runtime.tabBarEl):
    runtime.tabBarEl = document.createElement("div");
    runtime.tabBarEl.className = "sidebar-tab-bar";
    runtime.el!.prepend(runtime.tabBarEl);
  // Rebuild tab bar contents from scratch (simple and stable).
  runtime.tabBarEl.innerHTML = "";
  runtime.panelIds.forEach(id => {
    const panel = registeredPanels.get(id)!;
    const tab = document.createElement("button");
    tab.className = "sidebar-tab";
    tab.dataset.panelId = id;
    tab.textContent = panel.descriptor.title;
    tab.addEventListener("click", () => _handleTabClick(side, id));
    runtime.tabBarEl!.appendChild(tab);
    panel.tabEl = tab;
  });
  // Determine which panel should be active after reconciliation.
  const currentActiveId = getCurrentSettings().sidebar?.[side]?.activeTabId;
  const activeId = (currentActiveId && runtime.panelIds.includes(currentActiveId))
    ? currentActiveId
    : runtime.panelIds[0];
  _setActivePanel(side, activeId).
```

### Private Helper: Set Active Panel

```
_setActivePanel(side: "left" | "right", panelId: string): void

runtime.panelIds.forEach(id => {
  const panel = registeredPanels.get(id)!;
  const isActive = id === panelId;
  panel.wrapperEl.style.display = isActive ? "" : "none";
  panel.tabEl?.classList.toggle("sidebar-tab-active", isActive);
});
```

This sets `display: none` on inactive panel wrappers (not just their content), so accordion state of inactive panels is preserved but not visible. Switching tabs shows the wrapper and applies the last-known accordion state.

Persist activeTabId after calling this from a user interaction (tab click):
```
updateSettings(s => ({ ...s, sidebar: { ...s.sidebar, [side]: { ...s.sidebar?.[side], activeTabId: panelId } } }));
```
Do NOT persist when called during restoreFromSettings() — persistence is read-only in that path.

### Private Helper: Accordion Toggle

```
_handleAccordionToggle(panelId: string): void

const panel = registeredPanels.get(panelId); if (!panel) return;
const contentEl = panel.contentEl;
const expanded = contentEl.style.display === "none";  // currently collapsed → expand
_setAccordionState(panelId, expanded, /* persist= */ true);
```

```
_setAccordionState(panelId: string, expanded: boolean, persist: boolean): void

const panel = registeredPanels.get(panelId); if (!panel) return;
panel.contentEl.style.display = expanded ? "" : "none";
// Rotate chevron: aria-expanded attribute drives CSS transform in sidebar.css.
panel.wrapperEl.querySelector(".sidebar-accordion-toggle")
  ?.setAttribute("aria-expanded", String(expanded));

if (persist):
  const side = panel.descriptor.side;
  updateSettings(s => ({
    ...s,
    sidebar: {
      ...s.sidebar,
      [side]: {
        ...(s.sidebar?.[side] ?? DEFAULT_SIDEBAR_SLOT),
        panels: {
          ...(s.sidebar?.[side]?.panels ?? {}),
          [panelId]: { accordionExpanded: expanded },
        }
      }
    }
  }));
```

### Private Helper: Render Invocation

```
_renderPanel(panelId: string): void

const panel = registeredPanels.get(panelId); if (!panel) return;
try {
  panel.descriptor.render(panel.contentEl);
  panel.rendered = true;
} catch (err) {
  console.error(`[SidebarManager] render() threw for panel "${panelId}":`, err);
  panel.contentEl.innerHTML = "";
  const errorEl = document.createElement("div");
  errorEl.className = "sidebar-panel-error";
  errorEl.textContent = "Panel failed to load";
  panel.contentEl.appendChild(errorEl);
}
```

### Resize Handle

The resize handle is a `div.sidebar-resize-handle` appended as the last child of the sidebar slot element. For `#sidebar-left` it sits on the right edge; for `#sidebar-right` it sits on the left edge (CSS positions it via `right: 0` or `left: 0`).

```
_attachResizeHandle(side: "left" | "right", slotEl: HTMLDivElement): HTMLDivElement

const handle = document.createElement("div");
handle.className = "sidebar-resize-handle";
handle.dataset.side = side;
slotEl.appendChild(handle);

let startX = 0;
let startWidth = 0;
const MIN_WIDTH = 150;
const MAX_WIDTH = 600;

handle.addEventListener("pointerdown", (e: PointerEvent) => {
  e.preventDefault();
  handle.setPointerCapture(e.pointerId);
  startX = e.clientX;
  startWidth = slotEl.offsetWidth;
});

handle.addEventListener("pointermove", (e: PointerEvent) => {
  if (!handle.hasPointerCapture(e.pointerId)) return;
  const delta = side === "left" ? e.clientX - startX : startX - e.clientX;
  const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta));
  slotEl.style.width = `${newWidth}px`;
  // Update in memory only during drag (NFR-4 — debounce for high-frequency).
  updateSettingsInMemory(s => ({
    ...s,
    sidebar: { ...s.sidebar, [side]: { ...(s.sidebar?.[side] ?? DEFAULT_SIDEBAR_SLOT), width: newWidth } }
  }));
});

handle.addEventListener("pointerup", (e: PointerEvent) => {
  if (!handle.hasPointerCapture(e.pointerId)) return;
  handle.releasePointerCapture(e.pointerId);
  const newWidth = slotEl.offsetWidth;
  // Persist on drag end using debounced save (NFR-4).
  saveSettingsDebounced();
});

return handle;
```

---

## `src/sidebar/index.ts` — Full Specification

```typescript
/**
 * Public re-export facade for the sidebar module.
 *
 * Consumers (markable-plugin-api.ts, main.ts) import from "src/sidebar/"
 * without knowing the internal file layout.
 */
export type { SidebarPanelDescriptor } from "./sidebar-manager";
export {
  init as initSidebar,
  register as registerSidebarPanel,
  unregister as unregisterSidebarPanel,
  toggleSide as toggleSidebarSide,
  restoreFromSettings as restoreSidebarFromSettings,
} from "./sidebar-manager";
```

The `init`, `register`, `unregister`, `toggleSide`, and `restoreFromSettings` are the named exports from `sidebar-manager.ts`. The re-export names are chosen to be self-documenting at the call site in `main.ts`.

---

## Acceptance Criteria

1. TypeScript compiler reports zero errors.
2. `initSidebar()` creates `#app-row` and moves `#editor` into it; calling it twice is a no-op.
3. `registerSidebarPanel("p1", { ..., side: "right" })` creates `#sidebar-right` and calls `descriptor.render(container)`.
4. `registerSidebarPanel("p1", ...)` twice with same id logs a warning and the second call is rejected (original panel unaffected).
5. After two panels registered on the same side, a `.sidebar-tab-bar` element exists with two `.sidebar-tab` children.
6. After two panels registered, only the active panel's `.sidebar-panel-wrapper` has `display` unset; the inactive one has `display: none`.
7. `unregisterSidebarPanel("p1", "some-panel")` calls `descriptor.destroy(container)` even when the panel's content area is `display: none` (accordion collapsed).
8. After the last panel on a side is unregistered, `#sidebar-right` (or `#sidebar-left`) is removed from the DOM and `slotRuntime[side].el === null`.
9. `toggleSide("right")` when no panels are registered is a no-op (no error thrown).
10. `toggleSide("right")` when panels exist toggles `display` on `#sidebar-right` and persists `open` in settings.
11. Width drag clamps at 150 px (below minimum) and 600 px (above maximum).
12. `_setAccordionState(panelId, false, true)` sets `contentEl.style.display = "none"` and persists `accordionExpanded: false`.

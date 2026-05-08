/**
 * SidebarManager — core module for the Sidebar Panel System.
 *
 * Owns all DOM lifecycle: creating and destroying sidebar slots, tab bars,
 * accordion headers, panel content containers, and resize handles. Persists
 * all sidebar state (open/closed, active tab, accordion, width) via the
 * settings module's raw-JSON pass-through layer.
 *
 * Plugins interact exclusively through the two API methods exposed in
 * markable-plugin-api.ts — no direct DOM access to sidebar internals is
 * permitted from plugin code.
 */

import "./sidebar.css";
import {
  getCurrentSettings,
  updateSettings,
  updateSettingsInMemory,
  saveSettingsDebounced,
  DEFAULT_SIDEBAR_SLOT,
} from "../lib/settings";
import type { SidebarSettings, SidebarSlotState } from "../lib/settings";
import { attachPanelReorderDrag } from "./panel-reorder-drag";
import { PANEL_ICONS } from "./panel-icons";

// ── Material icon SVGs ────────────────────────────────────────────────────────
// Inline SVG paths sourced from the Material Symbols / Material Icons library
// (Apache-2.0 licensed). Using inline SVG avoids a font dependency.

// ── Public API type ───────────────────────────────────────────────────────────

/**
 * Descriptor passed to registerSidebarPanel(). The plugin provides this
 * object once in onEnable; SidebarManager owns the lifetime of the DOM it
 * creates from it.
 */
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
   *
   * @param container  The div the plugin should populate.
   */
  render(container: HTMLElement): void;

  /**
   * Called before the panel is removed. The plugin must clean up all DOM
   * and event listeners it placed inside container. The infrastructure
   * wraps this call in try/catch — a throw is logged but does not prevent
   * DOM removal (EC-14).
   *
   * @param container  The same div passed to render().
   */
  destroy(container: HTMLElement): void;

  /**
   * Preferred initial width in pixels. Used only when no persisted width
   * exists for this side. Default: 220 px.
   */
  defaultWidth?: number;

  /**
   * Emoji, single letter, or short text shown in the icon strip button.
   * Falls back to title.charAt(0) when absent.
   */
  icon?: string;

  /**
   * Optional action buttons rendered in the accordion header, after the title
   * and before the move/toggle buttons. Each button shows its icon as text and
   * its title as a tooltip.
   */
  headerActions?: Array<{ id?: string; icon: string; iconHTML?: string; title: string; onClick: () => void }>;
}

// ── Private types ─────────────────────────────────────────────────────────────

/** Runtime record stored per registered panel. */
interface RegisteredPanel {
  /** Id of the plugin that registered this panel (used for ownership checks, EC-19). */
  pluginId: string;
  descriptor: SidebarPanelDescriptor;
  /**
   * The div passed to render() / destroy(). Lives inside .sidebar-panel-content
   * which lives inside the wrapperEl.
   */
  contentEl: HTMLDivElement;
  /** The outer wrapper: .sidebar-panel-wrapper (contains accordion header + contentEl). */
  wrapperEl: HTMLDivElement;
  /**
   * The tab button element. Null until the side has ≥2 panels, at which point
   * _reconcileTabBar creates tab buttons for all panels on the side.
   */
  tabEl: HTMLButtonElement | null;
  /**
   * The icon strip button for this panel. Always present after register().
   */
  iconBtnEl: HTMLButtonElement | null;
  /**
   * The side this panel is currently placed on. Starts as descriptor.side
   * but may be overridden by the user via movePanel(). Always reflects the
   * actual DOM placement — use this instead of descriptor.side for any slot
   * lookup after the initial registration.
   */
  effectiveSide: "left" | "right";
}

/** Runtime DOM state for one sidebar slot (left or right). */
interface SlotRuntime {
  /**
   * The #sidebar-left or #sidebar-right element.
   * Null until the first panel is registered on this side.
   */
  el: HTMLDivElement | null;
  /**
   * The .sidebar-tab-bar element inside this slot.
   * Null when the side has 0 or 1 panel (tab bar is hidden for single panels).
   */
  tabBarEl: HTMLDivElement | null;
  /** The resize handle element. Null until the sidebar slot is created. */
  resizeHandleEl: HTMLDivElement | null;
  /** The icon strip element (44px column, outer edge). Null until slot is created. */
  iconStripEl: HTMLDivElement | null;
  /** The content area element (flex:1, holds tab bar, panels, resize handle). Null until slot is created. */
  contentAreaEl: HTMLDivElement | null;
  /** Cycle chevron button (right sidebar only). Re-appended to the tab bar on every reconcile. */
  cycleBtnEl: HTMLButtonElement | null;
  /** Panel ids in registration order for this side. */
  panelIds: string[];
}

// ── Module-level state ────────────────────────────────────────────────────────

/** All registered panels across both sides, keyed by panelId. */
const registeredPanels = new Map<string, RegisteredPanel>();

/**
 * Runtime DOM state per side.
 *
 * Initialised to a "nothing registered" state. Each side's el is lazily
 * created in register() when the first panel for that side arrives.
 */
const slotRuntime: Record<"left" | "right", SlotRuntime> = {
  left:  { el: null, tabBarEl: null, resizeHandleEl: null, iconStripEl: null, contentAreaEl: null, cycleBtnEl: null, panelIds: [] },
  right: { el: null, tabBarEl: null, resizeHandleEl: null, iconStripEl: null, contentAreaEl: null, cycleBtnEl: null, panelIds: [] },
};

/** The #app-row flex row that contains #sidebar-left, #editor, #sidebar-right. */
let appRowEl: HTMLDivElement | null = null;

/** True after init() has been called. Guards against double-init (idempotency). */
let initialized = false;

// ── Public: init ──────────────────────────────────────────────────────────────

/**
 * Create the #app-row flex wrapper and both sidebar slot elements, then move
 * #editor into the row between the two slots.
 *
 * Must be called after #editor is mounted in the DOM and before any plugin
 * calls registerSidebarPanel(). Idempotent — calling it twice is a no-op.
 *
 * Design change from lazy-slot to eager-slot: both #sidebar-left and
 * #sidebar-right are created immediately at init() time so that
 * toggleSide() and movePanelToSide() work even before any panels are
 * registered. Both slots start with display:none (closed).
 *
 * @throws Error if #app or #editor are not found in the DOM.
 */
export function init(): void {
  // Idempotency guard — calling init twice must be a no-op.
  if (initialized) return;

  const app = document.getElementById("app");
  const editor = document.getElementById("editor");

  // These elements must exist before init() is called. A missing element
  // is a programming error in the startup sequence, not a user error.
  if (!app || !editor) {
    throw new Error(
      "[SidebarManager] init() called before #app or #editor exists in DOM."
    );
  }

  // Create the row wrapper that holds sidebars and the editor side by side.
  appRowEl = document.createElement("div");
  appRowEl.id = "app-row";

  // The statusbar must remain a direct child of #app (not inside #app-row)
  // so it spans the full window width (consistent with pre-sidebar layout).
  const statusbar = document.getElementById("statusbar");
  if (statusbar) {
    app.insertBefore(appRowEl, statusbar);
  } else {
    app.appendChild(appRowEl);
  }

  // Create both sidebar slots eagerly. Both start hidden (display:none).
  // This allows toggleSide() to operate before any panels are registered,
  // and eliminates the lazy-creation complexity inside register().
  _createSlotElement("left");
  appRowEl.appendChild(slotRuntime.left.el!);

  // #editor and #custom-tab-host both occupy the center content slot.
  // Moving #custom-tab-host here (out of #app) means it only fills the editor
  // column — sidebars, titlebar, and statusbar are never covered.
  appRowEl.appendChild(editor);
  const customTabHost = document.getElementById("custom-tab-host");
  if (customTabHost) appRowEl.appendChild(customTabHost);

  _createSlotElement("right");
  appRowEl.appendChild(slotRuntime.right.el!);

  initialized = true;
}

// ── Public: register ──────────────────────────────────────────────────────────

/**
 * Register a sidebar panel for a plugin.
 *
 * Creates the sidebar slot element on first registration for the side, builds
 * the panel wrapper with an accordion header, calls descriptor.render(), and
 * reconciles the tab bar. Persists the updated state to settings.
 *
 * Ownership: pluginId is stored so that unregister() can enforce that only
 * the registering plugin can unregister its own panels (EC-19).
 *
 * @param pluginId    The id of the plugin performing the registration.
 * @param descriptor  Panel configuration describing id, title, side, and render/destroy callbacks.
 */
export function register(pluginId: string, descriptor: SidebarPanelDescriptor): void {
  // EC-12: duplicate panel id — warn and reject the second registration.
  if (registeredPanels.has(descriptor.id)) {
    console.warn(
      `[SidebarManager] Panel id "${descriptor.id}" is already registered. ` +
      `Ignoring duplicate registration from plugin "${pluginId}".`
    );
    return;
  }

  // Ensure the app-row wrapper exists. Under normal startup sequence init() is
  // already called; calling it here is a safety guard for unusual call orders.
  if (!initialized) init();

  // Determine which side the panel should land on. The user may have previously
  // moved this panel via movePanel(), in which case a persisted override takes
  // precedence over the descriptor's declared default side.
  const settings = getCurrentSettings();
  const effectiveSide: "left" | "right" =
    settings.sidebar?.panelSides?.[descriptor.id] ?? descriptor.side;

  const runtime = slotRuntime[effectiveSide];

  // Slot always exists after init() — no lazy creation needed.
  // Apply the panel's defaultWidth to the slot only when:
  //   (a) no persisted width exists for this side, AND
  //   (b) this is the first panel being registered on the side.
  // This avoids overwriting a user-resized width on subsequent registrations.
  if (!settings.sidebar?.[effectiveSide]?.width && runtime.panelIds.length === 0) {
    const w = descriptor.defaultWidth ?? 220;
    runtime.el!.style.width = `${w}px`;
  }

  const { wrapperEl, contentEl } = _buildPanelWrapper(descriptor, effectiveSide);

  // Store the runtime panel record, including the resolved effectiveSide so
  // that all subsequent slot lookups use the live placement rather than the
  // descriptor default.
  const panelRecord: RegisteredPanel = {
    pluginId,
    descriptor,
    contentEl,
    wrapperEl,
    tabEl: null,
    iconBtnEl: null,
    effectiveSide,
  };
  registeredPanels.set(descriptor.id, panelRecord);
  runtime.panelIds.push(descriptor.id);

  // Honour any user-defined stack order from settings.
  _applyPersistedOrder(effectiveSide);

  // Reconcile the tab bar for this side (creates tab bar if needed).
  _reconcileTabBar(effectiveSide);

  // All panels are rendered eagerly at registration time.
  _renderPanel(descriptor.id);

  _restoreAccordionFromSettings(descriptor.id, effectiveSide);

  // Build and wire the icon strip button.
  const iconBtn = _buildIconButton(descriptor.id, panelRecord, effectiveSide);
  runtime.iconStripEl!.appendChild(iconBtn);
  panelRecord.iconBtnEl = iconBtn;

  // Restore iconized/pinned visual state from persisted settings.
  _restoreIconizedFromSettings(descriptor.id, effectiveSide);

  // Persist the updated sidebar state for this side.
  // Always set open: true on registration — enabling a plugin always shows its
  // sidebar. The user can close it manually via Cmd-Shift-[ / Cmd-Shift-].
  updateSettings((s) => ({
    ...s,
    sidebar: _buildSidebarSettings(s.sidebar, effectiveSide, {
      ...(s.sidebar?.[effectiveSide] ?? { ...DEFAULT_SIDEBAR_SLOT }),
      open: true,
      activeTabId: _getActiveTabId(effectiveSide),
      panels: _buildPanelsRecord(effectiveSide),
    }),
  }));
}

// ── Public: unregister ────────────────────────────────────────────────────────

/**
 * Unregister a sidebar panel.
 *
 * Calls descriptor.destroy() (EC-14 — errors are caught and logged but do not
 * prevent DOM removal), removes the wrapper from the DOM, reconciles the tab
 * bar, and removes the sidebar slot if it is now empty (EC-5).
 *
 * No-op if panelId is not registered or if pluginId does not match the
 * registering plugin (EC-19 ownership check).
 *
 * @param pluginId  The id of the plugin requesting the unregistration.
 * @param panelId   The id that was used in the original SidebarPanelDescriptor.
 */
export function unregister(pluginId: string, panelId: string): void {
  if (!registeredPanels.has(panelId)) return;

  const panel = registeredPanels.get(panelId)!;

  // EC-19: ownership check — only the registering plugin may unregister.
  if (panel.pluginId !== pluginId) {
    console.warn(
      `[SidebarManager] Plugin "${pluginId}" attempted to unregister ` +
      `panel "${panelId}" owned by "${panel.pluginId}". Ignoring.`
    );
    return;
  }

  // Use effectiveSide — not descriptor.side — because the user may have moved
  // this panel to the other side via movePanel() after initial registration.
  const side = panel.effectiveSide;
  const runtime = slotRuntime[side];
  const settings = getCurrentSettings();
  const wasActive = settings.sidebar?.[side]?.activeTabId === panelId;

  _destroyPanelDOM(panel, panelId);

  // Remove icon strip button.
  panel.iconBtnEl?.remove();
  panel.iconBtnEl = null;

  // Remove from registry and the side's ordered panel list.
  registeredPanels.delete(panelId);
  runtime.panelIds = runtime.panelIds.filter((id) => id !== panelId);

  // Reconcile the tab bar now that panel count has changed.
  _reconcileTabBar(side);

  _persistAfterUnregister(side, runtime, wasActive);
}

// ── Public: toggleSide ────────────────────────────────────────────────────────

/**
 * Toggle the visibility of one sidebar side.
 *
 * Works regardless of whether any panels are registered — the slot is always
 * present in the DOM after init() (eager-slot design). Persists the new open
 * state to settings.
 *
 * @param side  The sidebar side to toggle.
 */
export function toggleSide(side: "left" | "right"): void {
  // With eager-slot init, the element always exists after init(). Guard only
  // against the pathological case of toggleSide being called before init().
  const el = slotRuntime[side].el;
  if (!el) return;

  // Use the DOM display property as the authoritative source of truth rather
  // than settings. During the window between register() (which writes
  // open:true to settings) and restoreFromSettings() (which applies it to the
  // DOM), settings already say open:true but the sidebar is not yet visible.
  // Reading settings in that window would flip the direction incorrectly.
  // The DOM is always in sync with what the user actually sees.
  const currentlyOpen = el.style.display !== "none";
  const nextOpen = !currentlyOpen;

  // Toggle visibility via display style (not CSS class) to avoid conflicts
  // with the CSS-defined display:flex on #sidebar-left / #sidebar-right.
  el.style.display = nextOpen ? "" : "none";

  // When opening, ensure the content area is visible even if it was hidden
  // because all panels were previously iconized.
  if (nextOpen) {
    const runtime = slotRuntime[side];
    if (runtime.contentAreaEl) runtime.contentAreaEl.style.display = "";
  }

  updateSettings((s) => ({
    ...s,
    sidebar: _buildSidebarSettings(s.sidebar, side, {
      ...(s.sidebar?.[side] ?? { ...DEFAULT_SIDEBAR_SLOT }),
      open: nextOpen,
    }),
  }));
}

// ── Public: movePanel ─────────────────────────────────────────────────────────

/**
 * Reassign a registered panel from its current sidebar side to the opposite side.
 *
 * Convenience wrapper around movePanelToSide() that always flips to the
 * opposite side. The header move-button (⇄) calls this function.
 *
 * No-op when panelId is not registered.
 *
 * @param panelId  The id of the panel to move.
 */
export function movePanel(panelId: string): void {
  const panel = registeredPanels.get(panelId);
  if (!panel) return;

  // Flip to the opposite side.
  const newSide: "left" | "right" = panel.effectiveSide === "left" ? "right" : "left";
  movePanelToSide(panelId, newSide);
}

/**
 * Move a registered panel to a SPECIFIC sidebar side.
 *
 * Both the old and new side tab bars are reconciled. When the old side becomes
 * empty after the move its slot element stays in the DOM (empty, possibly
 * closed) — no teardown. The settings panelSides override map is persisted so
 * the placement survives app restarts.
 *
 * No-op when panelId is not registered, or when the panel is already on the
 * requested side (moving to same side is a no-op).
 *
 * @param panelId  The id of the panel to move.
 * @param newSide  The destination sidebar side.
 */
export function movePanelToSide(panelId: string, newSide: "left" | "right"): void {
  // No-op: panel not found.
  const panel = registeredPanels.get(panelId);
  if (!panel) return;

  const oldSide = panel.effectiveSide;

  // No-op: panel is already on the requested side.
  if (oldSide === newSide) return;

  // Update the effective side on the record immediately so all subsequent slot
  // lookups in this call (reconcile, getActiveTabId, etc.) see the new value.
  panel.effectiveSide = newSide;

  // Remove the panel id from the old side's panel list before reconciliation.
  slotRuntime[oldSide].panelIds = slotRuntime[oldSide].panelIds.filter(
    (id) => id !== panelId
  );

  // Reconcile the old side's tab bar now that panel count may have dropped.
  _reconcileTabBar(oldSide);

  // When the old side now has 0 panels, update its settings to reflect the
  // empty state (no activeTabId, no panels record). The slot element stays in
  // the DOM — only the settings record is cleared.
  if (slotRuntime[oldSide].panelIds.length === 0) {
    updateSettings((s) => ({
      ...s,
      sidebar: _buildSidebarSettings(s.sidebar, oldSide, {
        ...(s.sidebar?.[oldSide] ?? { ...DEFAULT_SIDEBAR_SLOT }),
        open: false,
        activeTabId: null,
        panels: {},
      }),
    }));
  }

  // Persist the panelSides override map so placement survives a reload.
  updateSettings((s) => {
    const updatedPanelSides: Record<string, "left" | "right"> = {
      ...(s.sidebar?.panelSides ?? {}),
      [panelId]: newSide,
    };
    return {
      ...s,
      sidebar: {
        left:       s.sidebar?.left  ?? { ...DEFAULT_SIDEBAR_SLOT },
        right:      s.sidebar?.right ?? { ...DEFAULT_SIDEBAR_SLOT },
        panelSides: updatedPanelSides,
      },
    };
  });

  // Move the wrapper DOM node and reconcile the new side's tab bar.
  _moveWrapperToSlot(panel, panelId, newSide);

  // Ensure the destination slot is visible.
  _openSideIfClosed(newSide);
}

// ── Private: movePanel helpers ────────────────────────────────────────────────

/**
 * Move a panel's wrapper element into the destination sidebar slot.
 *
 * The slot always exists after init() (eager-slot design) so no lazy creation
 * is needed. Inserts the wrapper before the resize handle (so the handle stays
 * the last child), adds the panel id to the new slot's panelIds list, and
 * reconciles the new side's tab bar to reflect the updated panel count.
 *
 * @param panel    The panel record whose wrapperEl will be re-parented.
 * @param panelId  The panel's id (used when pushing to panelIds).
 * @param newSide  The destination sidebar side.
 */
function _moveWrapperToSlot(
  panel: RegisteredPanel,
  panelId: string,
  newSide: "left" | "right"
): void {
  // Slot always exists after init() — no lazy creation needed.
  const newRuntime = slotRuntime[newSide];

  // Insert into contentAreaEl before the resize handle so the handle stays last.
  if (newRuntime.resizeHandleEl) {
    newRuntime.contentAreaEl!.insertBefore(panel.wrapperEl, newRuntime.resizeHandleEl);
  } else {
    newRuntime.contentAreaEl!.appendChild(panel.wrapperEl);
  }

  // Register the panel id on the new side and reconcile its tab bar.
  newRuntime.panelIds.push(panelId);
  _reconcileTabBar(newSide);
}

/**
 * Ensure a sidebar slot is visible after a panel has been moved into it.
 *
 * Sets the slot element's display style to "" (restoring flex from CSS) and
 * persists open: true along with the current active tab id and panels record.
 *
 * Called as the final step of movePanel so the user immediately sees the panel
 * on the new side without needing to manually open the sidebar.
 *
 * @param side  The sidebar side to open.
 */
function _openSideIfClosed(side: "left" | "right"): void {
  const runtime = slotRuntime[side];

  // Make the slot visible (may already be visible if side had other panels).
  runtime.el!.style.display = "";

  updateSettings((s) => ({
    ...s,
    sidebar: _buildSidebarSettings(s.sidebar, side, {
      ...(s.sidebar?.[side] ?? { ...DEFAULT_SIDEBAR_SLOT }),
      open: true,
      activeTabId: _getActiveTabId(side),
      panels: _buildPanelsRecord(side),
    }),
  }));
}

// ── Public: restoreFromSettings ───────────────────────────────────────────────

/**
 * Apply persisted sidebar state (open/closed, active tab) after all plugins
 * have been restored.
 *
 * Must be called AFTER pluginManager.restoreAll() so that panels registered
 * by enabled plugins are present before we decide whether to show each slot.
 *
 * EC-11, EC-23: if a side has no registered panels, we skip restoring open
 * state regardless of what settings say — a sidebar without panels must not
 * show as an empty box.
 */
/**
 * Bring a registered panel into view:
 *   - If the panel's side is closed, open it.
 *   - Set the panel as the active tab on its side.
 *
 * No-op when panelId is not registered.
 * Used by plugins whose commands need to reveal their sidebar panel.
 */
export function focusSidebarPanel(panelId: string): void {
  const panel = registeredPanels.get(panelId);
  if (!panel) return;

  const side = panel.effectiveSide;
  const el = slotRuntime[side].el;
  if (!el) return;

  // Open the side if it is currently hidden.
  if (el.style.display === "none") {
    el.style.display = "";
    updateSettings((s) => ({
      ...s,
      sidebar: _buildSidebarSettings(s.sidebar, side, {
        ...(s.sidebar?.[side] ?? { ...DEFAULT_SIDEBAR_SLOT }),
        open: true,
      }),
    }));
  }

  // Make this panel the active tab.
  _setActivePanel(side, panelId, /* persist= */ true);
}

/**
 * Toggle the sidebar side that contains the given panel — the same action as
 * pressing Cmd-Shift-[ / Cmd-Shift-].
 *
 * Looks up the panel's effectiveSide and delegates to toggleSide(), so the
 * behaviour is identical to the keyboard shortcut regardless of whether the
 * panel has been moved to the opposite side by the user.
 *
 * No-op when panelId is not registered.
 */
export function toggleSidebarPanel(panelId: string): void {
  const panel = registeredPanels.get(panelId);
  if (!panel) return;
  toggleSide(panel.effectiveSide);
}

export function restoreFromSettings(): void {
  const sides: Array<"left" | "right"> = ["left", "right"];

  for (const side of sides) {
    const runtime = slotRuntime[side];

    // EC-11, EC-23: no panels registered on this side → keep the slot hidden
    // regardless of what the persisted open state says. An empty sidebar must
    // not be shown as a visible empty box. The slot element itself stays in
    // the DOM (eager-slot design) — we only skip applying the open state.
    if (runtime.panelIds.length === 0) continue;

    const slotSettings = getCurrentSettings().sidebar?.[side];
    // Default to open (true) when no persisted state exists — a newly-enabled
    // plugin should show its sidebar immediately on first use.
    const shouldOpen = slotSettings?.open ?? true;

    // Apply open/closed state. During the registration phase all slots are
    // shown unconditionally; restoreFromSettings() is the authority on whether
    // a slot should be visible on load. runtime.el is always non-null after
    // init() (eager-slot design), but we guard for TypeScript narrowing.
    if (!runtime.el) continue;
    runtime.el.style.display = shouldOpen ? "" : "none";

    // Restore the previously active tab if it is still registered.
    if (slotSettings?.activeTabId && runtime.panelIds.includes(slotSettings.activeTabId)) {
      _setActivePanel(side, slotSettings.activeTabId, /* persist= */ false);
    }

    // Hide contentAreaEl when all panels on this side are iconized.
    const allIconized = runtime.panelIds.length > 0 && runtime.panelIds.every(
      (id) => registeredPanels.get(id)?.wrapperEl.classList.contains("is-iconized") ?? false
    );
    if (runtime.contentAreaEl && allIconized) {
      runtime.contentAreaEl.style.display = "none";
    }
  }
}

// ── Private: settings merge helper ───────────────────────────────────────────

/**
 * Build a fully-typed SidebarSettings object by merging an update for one side.
 *
 * TypeScript requires both `left` and `right` to be non-optional in
 * SidebarSettings. Spreading `s.sidebar` (which may be undefined) loses that
 * guarantee. This helper ensures both sides are always present by falling back
 * to DEFAULT_SIDEBAR_SLOT for whichever side is not being updated.
 *
 * The panelSides field is always carried forward from the existing settings so
 * that a slot-state write never silently clears the user's side overrides.
 *
 * @param existing  The current s.sidebar value (may be undefined).
 * @param side      The side being updated.
 * @param update    The new SidebarSlotState for that side.
 * @param panelSidesOverride  Optional replacement for the panelSides map. When
 *   absent, the existing panelSides is preserved unchanged.
 * @returns         A fully-typed SidebarSettings with both sides populated.
 */
function _buildSidebarSettings(
  existing: SidebarSettings | undefined,
  side: "left" | "right",
  update: SidebarSlotState,
  panelSidesOverride?: Record<string, "left" | "right">
): SidebarSettings {
  return {
    left:  side === "left"  ? update : (existing?.left  ?? { ...DEFAULT_SIDEBAR_SLOT }),
    right: side === "right" ? update : (existing?.right ?? { ...DEFAULT_SIDEBAR_SLOT }),
    // Preserve the panelSides override map. If a caller supplies a replacement
    // map (e.g. movePanel), use it; otherwise forward the existing value so
    // a slot-state write never silently resets user side choices.
    panelSides: panelSidesOverride ?? existing?.panelSides,
  };
}

// ── Test-only reset ───────────────────────────────────────────────────────────

/**
 * @internal Test-only reset. Do not call in production code.
 *
 * Resets all module-level state to its initial values so that each test can
 * start from a clean slate without needing to reimport the module.
 */
export function _resetForTests(): void {
  registeredPanels.clear();
  slotRuntime.left  = { el: null, tabBarEl: null, resizeHandleEl: null, iconStripEl: null, contentAreaEl: null, cycleBtnEl: null, panelIds: [] };
  slotRuntime.right = { el: null, tabBarEl: null, resizeHandleEl: null, iconStripEl: null, contentAreaEl: null, cycleBtnEl: null, panelIds: [] };
  appRowEl = null;
  initialized = false;
}

// ── Private helpers: register decomposition ───────────────────────────────────

/**
 * Create the sidebar slot element (#sidebar-left or #sidebar-right) and
 * attach the resize handle. Called once per side from init().
 *
 * Width is set from persisted settings (if available) or falls back to the
 * 220 px default. The slot starts hidden (display:none) — it becomes visible
 * when a panel is registered on the side or when the user calls toggleSide().
 *
 * The created element is NOT appended to #app-row here — init() handles the
 * insertion order so the left slot always precedes #editor and #editor
 * always precedes the right slot.
 *
 * @param side  The sidebar side being initialised.
 */
function _createSlotElement(side: "left" | "right"): void {
  const runtime = slotRuntime[side];

  const slotEl = document.createElement("div");
  slotEl.id = side === "left" ? "sidebar-left" : "sidebar-right";

  const settings = getCurrentSettings();
  const persistedWidth = settings.sidebar?.[side]?.width;
  const width = persistedWidth ?? 220;
  slotEl.style.width = `${width}px`;
  slotEl.style.display = "none";

  // Icon strip — fixed-width column on the outer edge.
  // Default: ghost (opacity 0, 25px). Hover: 30% opacity hint.
  // Click on the strip → expand to full width. Click on background → collapse.
  const iconStripEl = document.createElement("div");
  iconStripEl.className = "sidebar-icon-strip";
  iconStripEl.addEventListener("click", (e) => {
    if (!iconStripEl.classList.contains("is-expanded")) {
      e.stopPropagation();
      iconStripEl.classList.add("is-expanded");
    } else if (e.target === iconStripEl) {
      iconStripEl.classList.remove("is-expanded");
    }
  });
  slotEl.appendChild(iconStripEl);

  // Content area — holds the tab bar, panel wrappers, and resize handle.
  const contentAreaEl = document.createElement("div");
  contentAreaEl.className = "sidebar-content-area";
  slotEl.appendChild(contentAreaEl);

  // Attach resize handle inside contentAreaEl so it positions relative to it.
  const handle = _attachResizeHandle(side, slotEl, contentAreaEl);

  runtime.el = slotEl;
  runtime.iconStripEl = iconStripEl;
  runtime.contentAreaEl = contentAreaEl;
  runtime.cycleBtnEl = null;
  runtime.resizeHandleEl = handle;
}

/**
 * Build the .sidebar-panel-wrapper DOM subtree for one panel registration.
 *
 * Creates the accordion header (title label + move button + chevron toggle
 * button), the content container div, wires the toggle click handler, and
 * inserts the wrapper into the sidebar slot before the resize handle so the
 * handle stays the last child.
 *
 * The `side` parameter is the resolved effectiveSide — it may differ from
 * descriptor.side when the user has previously moved the panel via movePanel().
 *
 * @param descriptor  The panel descriptor providing id, title, render/destroy.
 * @param side        The sidebar side into which the wrapper should be inserted.
 * @returns           The created wrapperEl and contentEl.
 */
function _buildPanelWrapper(
  descriptor: SidebarPanelDescriptor,
  side: "left" | "right"
): { wrapperEl: HTMLDivElement; contentEl: HTMLDivElement } {
  const runtime = slotRuntime[side];

  // Outer wrapper carries data-panel-id so tests and CSS can address it.
  const wrapperEl = document.createElement("div");
  wrapperEl.className = "sidebar-panel-wrapper";
  wrapperEl.dataset.panelId = descriptor.id;

  // Accordion header row: drag-handle (icon + title) + chevron toggle button.
  const headerEl = document.createElement("div");
  headerEl.className = "sidebar-panel-header";

  // Single drag handle wrapping both icon and title — grabbing either grabs both.
  const dragHandleEl = document.createElement("span");
  dragHandleEl.className = "sidebar-panel-drag-handle";

  const iconSvg = PANEL_ICONS[descriptor.id];
  if (iconSvg) {
    const iconEl = document.createElement("span");
    iconEl.className = "sidebar-panel-icon";
    iconEl.setAttribute("aria-hidden", "true");
    iconEl.innerHTML = iconSvg;
    dragHandleEl.appendChild(iconEl);
  }

  const titleEl = document.createElement("span");
  titleEl.className = "sidebar-panel-title";
  titleEl.textContent = descriptor.title;
  dragHandleEl.appendChild(titleEl);

  // Move button — reassigns the panel to the opposite sidebar side when clicked.
  // Positioned between the title label and the accordion chevron so it is easy
  // to discover without interfering with the collapse action.
  const moveBtn = document.createElement("button");
  moveBtn.className = "sidebar-move-btn";
  moveBtn.setAttribute("aria-label", "Move panel to other sidebar");
  moveBtn.textContent = "⇄";
  moveBtn.addEventListener("click", () => movePanel(descriptor.id));

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "sidebar-accordion-toggle";
  toggleBtn.setAttribute("aria-label", "Toggle panel");
  // Start expanded; aria-expanded drives the CSS chevron rotation (step_03).
  toggleBtn.setAttribute("aria-expanded", "true");

  headerEl.appendChild(dragHandleEl);

  // Optional header action buttons (e.g. "+" on the Properties panel).
  // Rendered after the title, before the move/toggle buttons.
  if (descriptor.headerActions) {
    for (const action of descriptor.headerActions) {
      const actionBtn = document.createElement("button");
      actionBtn.className = "sidebar-header-action-btn";
      if (action.id) actionBtn.id = action.id;
      if (action.iconHTML) {
        actionBtn.innerHTML = action.iconHTML;
      } else {
        actionBtn.textContent = action.icon;
      }
      actionBtn.title = action.title;
      actionBtn.setAttribute("aria-label", action.title);
      actionBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // prevent accordion toggle
        action.onClick();
      });
      headerEl.appendChild(actionBtn);
    }
  }

  headerEl.appendChild(moveBtn);   // between title and accordion chevron
  headerEl.appendChild(toggleBtn);
  wrapperEl.appendChild(headerEl);

  // The content container is the div passed to render() / destroy().
  const contentEl = document.createElement("div");
  contentEl.className = "sidebar-panel-content";
  wrapperEl.appendChild(contentEl);

  // Insert into contentAreaEl before the resize handle so the handle stays last.
  if (runtime.resizeHandleEl) {
    runtime.contentAreaEl!.insertBefore(wrapperEl, runtime.resizeHandleEl);
  } else {
    runtime.contentAreaEl!.appendChild(wrapperEl);
  }

  // Wire accordion toggle click → _handleAccordionToggle.
  toggleBtn.addEventListener("click", () => _handleAccordionToggle(descriptor.id));

  // Right-click on panel header → pin/unpin context menu.
  headerEl.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    _showPanelContextMenu(descriptor.id, e.clientX, e.clientY);
  });

  // Drag the icon-or-title (the whole drag handle) to reorder this panel.
  attachPanelReorderDrag(
    dragHandleEl,
    descriptor.id,
    `#sidebar-${side} .sidebar-panel-wrapper[data-panel-id]`,
    (fromId, insertBeforeId) => _reorderPanel(side, fromId, insertBeforeId),
  );

  return { wrapperEl, contentEl };
}

/**
 * Restore the accordion open/closed state from persisted settings for a panel
 * that was just registered. Defaults to expanded when no persisted state exists.
 *
 * @param panelId  The panel whose accordion state should be restored.
 * @param side     The sidebar side the panel was registered on.
 */
function _restoreAccordionFromSettings(panelId: string, side: "left" | "right"): void {
  const settings = getCurrentSettings();
  const panelState = settings.sidebar?.[side]?.panels?.[panelId];
  // Default to expanded (true) for panels with no persisted state.
  const expanded = panelState?.accordionExpanded ?? true;
  _setAccordionState(panelId, expanded, /* persist= */ false);
}

/**
 * Invoke the panel's destroy() callback and remove the wrapper from the DOM.
 *
 * EC-14: destroy() is called inside try/catch — errors are logged but do not
 * prevent the DOM removal from proceeding.
 *
 * @param panel    The registered panel record.
 * @param panelId  The panel id (used in error messages).
 */
function _destroyPanelDOM(panel: RegisteredPanel, panelId: string): void {
  try {
    panel.descriptor.destroy(panel.contentEl);
  } catch (err) {
    console.error(`[SidebarManager] destroy() threw for panel "${panelId}":`, err);
  }

  // Remove the wrapper element and its children from the DOM.
  panel.wrapperEl.remove();
}

/**
 * Persist sidebar state after a panel has been unregistered.
 *
 * If no panels remain on the side the slot settings are cleared (EC-5).
 * If panels remain and the removed panel was the active one, switch to the
 * first remaining panel first (EC-4).
 *
 * @param side      The sidebar side.
 * @param runtime   The slot runtime (already updated: panelIds has the removed panel filtered out).
 * @param wasActive True if the removed panel was the currently-active tab.
 */
function _persistAfterUnregister(
  side: "left" | "right",
  runtime: SlotRuntime,
  wasActive: boolean
): void {
  if (runtime.panelIds.length === 0) {
    // Last panel removed from this side. With the eager-slot design the DOM
    // element stays in the DOM (empty, hidden). Only the tab bar is removed
    // (already handled by _reconcileTabBar above). Update settings to reflect
    // the empty, closed state without touching runtime.el or resizeHandleEl.
    runtime.tabBarEl = null; // _reconcileTabBar already removed it from DOM

    updateSettings((s) => ({
      ...s,
      sidebar: _buildSidebarSettings(s.sidebar, side, {
        ...(s.sidebar?.[side] ?? { ...DEFAULT_SIDEBAR_SLOT }),
        open: false,
        activeTabId: null,
        panels: {},
      }),
    }));
  } else {
    if (wasActive) {
      // EC-4: removed panel was active — switch to the first remaining panel.
      _setActivePanel(side, runtime.panelIds[0], /* persist= */ true);
    }

    updateSettings((s) => ({
      ...s,
      sidebar: _buildSidebarSettings(s.sidebar, side, {
        ...(s.sidebar?.[side] ?? { ...DEFAULT_SIDEBAR_SLOT }),
        activeTabId: _getActiveTabId(side),
        panels: _buildPanelsRecord(side),
      }),
    }));
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Build and attach the drag-to-resize handle for a sidebar slot.
 *
 * The handle is a thin absolutely-positioned div on the interior edge of the
 * slot. CSS (sidebar.css) positions it at right:0 for #sidebar-left and
 * left:0 for #sidebar-right.
 *
 * Clamping: new width is clamped to [MIN_WIDTH, MAX_WIDTH] on every
 * pointermove event (EC-15, EC-16).
 *
 * Persistence: width is written to memory (updateSettingsInMemory) during
 * the drag for performance (NFR-4), then durably saved with
 * saveSettingsDebounced() on pointerup.
 *
 * @param side    Which sidebar side this handle belongs to.
 * @param slotEl  The sidebar slot div to which the handle is appended.
 * @returns       The created handle element.
 */
function _attachResizeHandle(
  side: "left" | "right",
  slotEl: HTMLDivElement,
  contentAreaEl: HTMLDivElement
): HTMLDivElement {
  const handle = document.createElement("div");
  handle.className = "sidebar-resize-handle";
  handle.dataset.side = side;
  contentAreaEl.appendChild(handle);

  let startX = 0;
  let startWidth = 0;
  const MIN_WIDTH = 150;
  const MAX_WIDTH = 600;

  /**
   * Capture the drag start position and initial sidebar width so that
   * subsequent pointermove events can compute a delta relative to drag origin.
   */
  function onPointerDown(e: PointerEvent): void {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    startX = e.clientX;
    // offsetWidth reflects the rendered pixel width at drag start.
    startWidth = slotEl.offsetWidth;
  }

  /**
   * Compute the new clamped width and apply it to the sidebar on each move.
   *
   * Left sidebar grows rightward (+delta); right sidebar grows leftward
   * (-delta), so the sign is flipped for the right side. Width is clamped
   * to [MIN_WIDTH, MAX_WIDTH] on every event (EC-15, EC-16).
   */
  function onPointerMove(e: PointerEvent): void {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    const delta = side === "left" ? e.clientX - startX : startX - e.clientX;
    const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startWidth + delta));
    slotEl.style.width = `${newWidth}px`;

    // Update in memory only during drag (NFR-4 — debounce for high-frequency).
    updateSettingsInMemory((s) => ({
      ...s,
      sidebar: _buildSidebarSettings(s.sidebar, side, {
        ...(s.sidebar?.[side] ?? { ...DEFAULT_SIDEBAR_SLOT }),
        width: newWidth,
      }),
    }));
  }

  /**
   * Release pointer capture and durably persist the final width on drag end.
   */
  function onPointerUp(e: PointerEvent): void {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    handle.releasePointerCapture(e.pointerId);
    // Persist on drag end using debounced save (NFR-4).
    saveSettingsDebounced();
  }

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", onPointerUp);

  return handle;
}

/**
 * Reconcile panel display for a side after registration / unregistration.
 *
 * Stacked mode: no tab bar exists. All non-iconized panels are shown vertically.
 * Each panel has its own accordion header (panel title + collapse chevron).
 * Iconized panels are hidden — only their icon strip button remains.
 *
 * @param side  The sidebar side to reconcile.
 */
function _reconcileTabBar(side: "left" | "right"): void {
  const runtime = slotRuntime[side];

  // Strip any leftover tab bar (this build no longer uses one).
  runtime.tabBarEl?.remove();
  runtime.tabBarEl = null;
  runtime.contentAreaEl?.classList.remove("has-tab-bar");

  // Null out stale tabEl refs so _setActivePanel never touches a detached node.
  runtime.panelIds.forEach((id) => {
    const p = registeredPanels.get(id);
    if (p) p.tabEl = null;
  });

  // Show all non-iconized panels.
  runtime.panelIds.forEach((id) => {
    const panel = registeredPanels.get(id);
    if (!panel) return;
    const isIconized = panel.wrapperEl.classList.contains("is-iconized");
    panel.wrapperEl.style.display = isIconized ? "none" : "";
  });
}

/**
 * Reorder a panel within its side's stack. Updates `panelIds`, reorders DOM
 * children of `contentAreaEl`, and persists the new order to settings.
 *
 * @param side            Sidebar side.
 * @param fromId          Panel being moved.
 * @param insertBeforeId  Panel id the moved panel should be inserted before;
 *                        null means drop at the end of the stack.
 */
function _reorderPanel(
  side: "left" | "right",
  fromId: string,
  insertBeforeId: string | null,
): void {
  const runtime = slotRuntime[side];
  const fromIdx = runtime.panelIds.indexOf(fromId);
  if (fromIdx < 0) return;

  // Compute new index in the panelIds array.
  let toIdx: number;
  if (insertBeforeId === null) {
    toIdx = runtime.panelIds.length - 1; // end of list (after removal)
  } else {
    const beforeIdx = runtime.panelIds.indexOf(insertBeforeId);
    if (beforeIdx < 0) return;
    toIdx = beforeIdx > fromIdx ? beforeIdx - 1 : beforeIdx;
  }
  if (toIdx === fromIdx) return;

  // Reorder panelIds: remove and re-insert.
  runtime.panelIds.splice(fromIdx, 1);
  runtime.panelIds.splice(toIdx, 0, fromId);

  // Reorder DOM to match — both the stacked wrappers AND the icon strip buttons.
  const movedPanel = registeredPanels.get(fromId);
  if (movedPanel && runtime.contentAreaEl) {
    const beforeEl = insertBeforeId
      ? registeredPanels.get(insertBeforeId)?.wrapperEl ?? null
      : runtime.resizeHandleEl;
    runtime.contentAreaEl.insertBefore(movedPanel.wrapperEl, beforeEl);
  }
  if (movedPanel?.iconBtnEl && runtime.iconStripEl) {
    const beforeBtn = insertBeforeId
      ? registeredPanels.get(insertBeforeId)?.iconBtnEl ?? null
      : null;
    runtime.iconStripEl.insertBefore(movedPanel.iconBtnEl, beforeBtn);
  }

  // Persist the new order.
  updateSettings((s) => ({
    ...s,
    sidebar: _buildSidebarSettings(s.sidebar, side, {
      ...(s.sidebar?.[side] ?? { ...DEFAULT_SIDEBAR_SLOT }),
      panelOrder: [...runtime.panelIds],
    }),
  }));
}

/**
 * Apply the persisted panelOrder for a side to both `panelIds` and the DOM.
 * Panels not in the persisted list keep their relative order at the end.
 */
function _applyPersistedOrder(side: "left" | "right"): void {
  const runtime = slotRuntime[side];
  const persisted = getCurrentSettings().sidebar?.[side]?.panelOrder;
  if (!persisted || persisted.length === 0) return;

  const known = new Set(runtime.panelIds);
  const ordered = [
    ...persisted.filter((id) => known.has(id)),
    ...runtime.panelIds.filter((id) => !persisted.includes(id)),
  ];
  if (ordered.join("|") === runtime.panelIds.join("|")) return;

  runtime.panelIds = ordered;

  // Reorder DOM — both the stacked panel wrappers and the icon-strip buttons.
  for (const id of ordered) {
    const panel = registeredPanels.get(id);
    if (!panel) continue;
    if (runtime.contentAreaEl) {
      runtime.contentAreaEl.insertBefore(panel.wrapperEl, runtime.resizeHandleEl);
    }
    if (panel.iconBtnEl && runtime.iconStripEl) {
      runtime.iconStripEl.appendChild(panel.iconBtnEl);
    }
  }
}

/**
 * Update display of all panels on the side. In stacked mode every non-iconized
 * panel is visible — `panelId` is no longer used to choose a single visible
 * panel, but it is still persisted as `activeTabId` so other code paths that
 * read it (e.g. focus restoration) keep working.
 *
 * @param side      The sidebar side.
 * @param panelId   The panel id to record as "active" in settings.
 * @param persist   If true, write activeTabId to settings immediately.
 */
function _setActivePanel(
  side: "left" | "right",
  panelId: string,
  persist: boolean
): void {
  const runtime = slotRuntime[side];

  runtime.panelIds.forEach((id) => {
    const panel = registeredPanels.get(id);
    if (!panel) return;
    const isIconized = panel.wrapperEl.classList.contains("is-iconized");
    panel.wrapperEl.style.display = isIconized ? "none" : "";
  });

  if (persist) {
    updateSettings((s) => ({
      ...s,
      sidebar: _buildSidebarSettings(s.sidebar, side, {
        ...(s.sidebar?.[side] ?? { ...DEFAULT_SIDEBAR_SLOT }),
        activeTabId: panelId,
      }),
    }));
  }
}

/**
 * Handle a click on the accordion toggle chevron button.
 *
 * Reads the current collapsed/expanded state from contentEl.style.display
 * and flips it. Persists the new state to settings.
 *
 * @param panelId  The panel whose chevron was clicked.
 */
function _handleAccordionToggle(panelId: string): void {
  const panel = registeredPanels.get(panelId);
  if (!panel) return;

  // If display is "none" the panel is currently collapsed — expand it.
  // Otherwise it is expanded — collapse it.
  const expanded = panel.contentEl.style.display === "none";
  _setAccordionState(panelId, expanded, /* persist= */ true);
}

/**
 * Apply accordion state (expanded / collapsed) to a panel.
 *
 * The chevron direction is driven entirely by the aria-expanded attribute
 * on the toggle button — no JavaScript-driven class toggling needed (step_03
 * CSS uses the attribute selector).
 *
 * @param panelId   The panel to update.
 * @param expanded  True = content visible; false = content hidden.
 * @param persist   If true, write accordionExpanded to settings immediately.
 */
function _setAccordionState(
  panelId: string,
  expanded: boolean,
  persist: boolean
): void {
  const panel = registeredPanels.get(panelId);
  if (!panel) return;

  // Show or hide the content area.
  panel.contentEl.style.display = expanded ? "" : "none";

  // Rotate the chevron via aria-expanded (CSS transform in sidebar.css).
  panel.wrapperEl
    .querySelector(".sidebar-accordion-toggle")
    ?.setAttribute("aria-expanded", String(expanded));

  if (persist) {
    // Use effectiveSide — not descriptor.side — because the user may have
    // moved this panel via movePanel() after initial registration. Writing to
    // descriptor.side after a move would save the state to the old (wrong) side
    // slot, causing the accordion state to be lost on next restart.
    const side = panel.effectiveSide;
    updateSettings((s) => ({
      ...s,
      sidebar: _buildSidebarSettings(s.sidebar, side, {
        ...(s.sidebar?.[side] ?? { ...DEFAULT_SIDEBAR_SLOT }),
        panels: {
          ...(s.sidebar?.[side]?.panels ?? {}),
          [panelId]: { accordionExpanded: expanded },
        },
      }),
    }));
  }
}

/**
 * Call the panel's render() callback inside a try/catch.
 *
 * If render() throws, an error placeholder div (.sidebar-panel-error) is
 * shown inside the content container so the user sees something informative
 * rather than a blank area (EC-13).
 *
 * @param panelId  The panel to render.
 */
function _renderPanel(panelId: string): void {
  const panel = registeredPanels.get(panelId);
  if (!panel) return;

  try {
    panel.descriptor.render(panel.contentEl);
  } catch (err) {
    console.error(`[SidebarManager] render() threw for panel "${panelId}":`, err);
    panel.contentEl.innerHTML = "";
    const errorEl = document.createElement("div");
    errorEl.className = "sidebar-panel-error";
    errorEl.textContent = "Panel failed to load";
    panel.contentEl.appendChild(errorEl);
  }
}

/**
 * Return the currently-active panel id for a side, or null if no panels exist.
 *
 * Used when building the settings object to persist after registration or
 * tab switching.
 *
 * @param side  The sidebar side to query.
 * @returns     The active panelId, or null if the side has no panels.
 */
function _getActiveTabId(side: "left" | "right"): string | null {
  const runtime = slotRuntime[side];
  if (runtime.panelIds.length === 0) return null;

  // Find the first panel whose wrapperEl is not hidden (display !== "none").
  const activeId = runtime.panelIds.find((id) => {
    const p = registeredPanels.get(id);
    return p && p.wrapperEl.style.display !== "none";
  });

  // Fall back to the first panel if no visible wrapper found.
  return activeId ?? runtime.panelIds[0];
}

// ── Private helpers: icon strip ───────────────────────────────────────────────

/**
 * Show a minimal right-click context menu on a panel header.
 * Currently offers only Pin / Unpin — the one action not reachable from the
 * panel chrome without the now-removed pin button.
 */
function _showPanelContextMenu(panelId: string, x: number, y: number): void {
  document.querySelector(".sidebar-panel-ctx-menu")?.remove();

  const panel = registeredPanels.get(panelId);
  if (!panel) return;

  const side = panel.effectiveSide;
  const isPinned = getCurrentSettings().sidebar?.[side]?.panels?.[panelId]?.pinned ?? false;

  const menu = document.createElement("ul");
  menu.className = "sidebar-panel-ctx-menu";
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:9999;` +
    `background:var(--bg-secondary,#252526);border:1px solid var(--border-color,rgba(128,128,128,.2));` +
    `border-radius:6px;padding:4px 0;list-style:none;margin:0;min-width:130px;` +
    `box-shadow:0 4px 12px rgba(0,0,0,.35);`;

  const item = document.createElement("li");
  item.style.cssText = `padding:6px 14px;cursor:pointer;font-family:var(--ui-font);` +
    `font-size:12px;color:var(--text-primary,#ccc);user-select:none;`;
  item.textContent = isPinned ? "Unpin panel" : "Pin panel";
  item.addEventListener("mouseenter", () => { item.style.background = "var(--code-bg,rgba(128,128,128,.1))"; });
  item.addEventListener("mouseleave", () => { item.style.background = ""; });
  item.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    _handlePinToggle(panelId);
    menu.remove();
    document.removeEventListener("mousedown", outside);
  });
  menu.appendChild(item);
  document.body.appendChild(menu);

  function outside(e: MouseEvent): void {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      document.removeEventListener("mousedown", outside);
    }
  }
  setTimeout(() => document.addEventListener("mousedown", outside), 0);
}

/**
 * Build a single icon strip button for a panel.
 */
function _buildIconButton(
  panelId: string,
  panel: RegisteredPanel,
  side: "left" | "right"
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "sidebar-icon-btn";
  btn.dataset.panelId = panelId;

  // Icon priority: shared PANEL_ICONS map → descriptor.icon (legacy emoji/SVG/letter)
  // → first letter of title. PANEL_ICONS keeps the strip and panel header in sync.
  const sharedSvg = PANEL_ICONS[panelId];
  const icon = panel.descriptor.icon;
  if (sharedSvg) {
    btn.innerHTML = sharedSvg;
  } else if (icon && icon.trimStart().startsWith("<")) {
    btn.innerHTML = icon;
  } else if (icon) {
    btn.textContent = icon;
  } else {
    btn.textContent = panel.descriptor.title.charAt(0).toUpperCase();
  }
  btn.title = panel.descriptor.title;
  btn.addEventListener("click", () => _handleIconBtnClick(side, panelId));
  return btn;
}

/**
 * Handle a click on an icon strip button.
 *
 * If the panel is iconized → un-iconize and activate it.
 * If the panel is expanded and not pinned → iconize it.
 * If the panel is expanded and pinned → no-op.
 */
function _handleIconBtnClick(side: "left" | "right", panelId: string): void {
  const panel = registeredPanels.get(panelId);
  if (!panel) return;

  const settings = getCurrentSettings();
  const isPinned = settings.sidebar?.[side]?.panels?.[panelId]?.pinned ?? false;
  const isIconized = panel.wrapperEl.classList.contains("is-iconized");

  if (isIconized) {
    _setIconized(side, panelId, false);
    _setActivePanel(side, panelId, /* persist= */ true);
  } else if (!isPinned) {
    _setIconized(side, panelId, true);
  }
}

/**
 * Set the iconized state of a panel, updating DOM and persisting to settings.
 *
 * When all panels on a side become iconized, the contentAreaEl is hidden so
 * only the icon strip remains visible.
 */
function _setIconized(side: "left" | "right", panelId: string, iconized: boolean): void {
  const panel = registeredPanels.get(panelId);
  if (!panel) return;

  panel.wrapperEl.classList.toggle("is-iconized", iconized);
  panel.wrapperEl.style.display = iconized ? "none" : "";
  panel.iconBtnEl?.classList.toggle("is-active", !iconized);

  // Hide contentAreaEl when all panels on this side are now iconized.
  const runtime = slotRuntime[side];
  const allIconized = runtime.panelIds.every((id) => {
    if (id === panelId) return iconized;
    return registeredPanels.get(id)?.wrapperEl.classList.contains("is-iconized") ?? false;
  });
  if (runtime.contentAreaEl) {
    runtime.contentAreaEl.style.display = allIconized ? "none" : "";
  }

  updateSettings((s) => ({
    ...s,
    sidebar: _buildSidebarSettings(s.sidebar, side, {
      ...(s.sidebar?.[side] ?? { ...DEFAULT_SIDEBAR_SLOT }),
      panels: {
        ...(s.sidebar?.[side]?.panels ?? {}),
        [panelId]: {
          ...(s.sidebar?.[side]?.panels?.[panelId] ?? { accordionExpanded: true }),
          iconized,
        },
      },
    }),
  }));
}

/**
 * Toggle the pinned state of a panel.
 *
 * A pinned panel cannot be iconized via the icon strip button. Pinned state is
 * shown via an accent dot on the icon button and by the pin button in the header.
 */
function _handlePinToggle(panelId: string): void {
  const panel = registeredPanels.get(panelId);
  if (!panel) return;

  const side = panel.effectiveSide;
  const settings = getCurrentSettings();
  const currentPinned = settings.sidebar?.[side]?.panels?.[panelId]?.pinned ?? false;
  const newPinned = !currentPinned;

  panel.iconBtnEl?.classList.toggle("is-pinned", newPinned);
  panel.wrapperEl.classList.toggle("is-pinned", newPinned);

  updateSettings((s) => ({
    ...s,
    sidebar: _buildSidebarSettings(s.sidebar, side, {
      ...(s.sidebar?.[side] ?? { ...DEFAULT_SIDEBAR_SLOT }),
      panels: {
        ...(s.sidebar?.[side]?.panels ?? {}),
        [panelId]: {
          ...(s.sidebar?.[side]?.panels?.[panelId] ?? { accordionExpanded: true }),
          pinned: newPinned,
        },
      },
    }),
  }));
}

/**
 * Restore iconized and pinned visual state from persisted settings for a panel.
 *
 * Called from register() after the icon button is created.
 */
function _restoreIconizedFromSettings(panelId: string, side: "left" | "right"): void {
  const panel = registeredPanels.get(panelId);
  if (!panel) return;

  const panelState = getCurrentSettings().sidebar?.[side]?.panels?.[panelId];
  const iconized = panelState?.iconized ?? false;
  const pinned = panelState?.pinned ?? false;

  if (iconized) {
    panel.wrapperEl.classList.add("is-iconized");
    panel.wrapperEl.style.display = "none";
    panel.iconBtnEl?.classList.remove("is-active");
  } else {
    panel.iconBtnEl?.classList.add("is-active");
  }

  if (pinned) {
    panel.iconBtnEl?.classList.add("is-pinned");
    panel.wrapperEl.classList.add("is-pinned");
  }
}

// ── Public: iconizeNonPinnedOrToggle ──────────────────────────────────────────

/**
 * Iconize all non-pinned panels on the given side.
 *
 * If all panels on the side are pinned, falls back to a full toggleSide().
 * Called by the Cmd-Shift-[ / Cmd-Shift-] keyboard shortcuts in main.ts so that
 * pinned panels remain visible when the user collapses the sidebar.
 *
 * @param side  The sidebar side to act on.
 */
export function iconizeNonPinnedOrToggle(side: "left" | "right"): void {
  const runtime = slotRuntime[side];

  if (!runtime.el || runtime.panelIds.length === 0) {
    toggleSide(side);
    return;
  }

  const settings = getCurrentSettings();
  const allPinned = runtime.panelIds.every(
    (id) => settings.sidebar?.[side]?.panels?.[id]?.pinned ?? false
  );

  if (allPinned) {
    toggleSide(side);
    return;
  }

  for (const id of runtime.panelIds) {
    const isPinned = settings.sidebar?.[side]?.panels?.[id]?.pinned ?? false;
    const isIconized = registeredPanels.get(id)?.wrapperEl.classList.contains("is-iconized") ?? false;
    if (!isPinned && !isIconized) {
      _setIconized(side, id, true);
    }
  }
}

/**
 * Build the panels Record<string, SidebarPanelState> for persisting one side.
 *
 * Reads the current accordion state from each registered panel on the side.
 * An expanded panel (contentEl.style.display !== "none") maps to
 * accordionExpanded: true.
 *
 * @param side  The sidebar side to inspect.
 * @returns     A record suitable for SidebarSlotState.panels.
 */
function _buildPanelsRecord(
  side: "left" | "right"
): Record<string, { accordionExpanded: boolean; iconized?: boolean; pinned?: boolean }> {
  const record: Record<string, { accordionExpanded: boolean; iconized?: boolean; pinned?: boolean }> = {};
  const runtime = slotRuntime[side];
  const settings = getCurrentSettings();

  runtime.panelIds.forEach((id) => {
    const p = registeredPanels.get(id);
    if (!p) return;
    const existing = settings.sidebar?.[side]?.panels?.[id];
    record[id] = {
      accordionExpanded: p.contentEl.style.display !== "none",
      iconized: p.wrapperEl.classList.contains("is-iconized"),
      pinned: existing?.pinned ?? false,
    };
  });

  return record;
}

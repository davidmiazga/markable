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
  left:  { el: null, tabBarEl: null, resizeHandleEl: null, panelIds: [] },
  right: { el: null, tabBarEl: null, resizeHandleEl: null, panelIds: [] },
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

  // #editor goes between the two sidebar slots.
  appRowEl.appendChild(editor);

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
    effectiveSide,
  };
  registeredPanels.set(descriptor.id, panelRecord);
  runtime.panelIds.push(descriptor.id);

  // Reconcile the tab bar for this side (creates tab bar if needed).
  _reconcileTabBar(effectiveSide);

  // All panels are rendered eagerly at registration time.
  _renderPanel(descriptor.id);

  _restoreAccordionFromSettings(descriptor.id, effectiveSide);

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

  // Insert before the resize handle so the handle remains the last child —
  // consistent with the insertion order used in _buildPanelWrapper.
  if (newRuntime.resizeHandleEl) {
    newRuntime.el!.insertBefore(panel.wrapperEl, newRuntime.resizeHandleEl);
  } else {
    newRuntime.el!.appendChild(panel.wrapperEl);
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
  slotRuntime.left  = { el: null, tabBarEl: null, resizeHandleEl: null, panelIds: [] };
  slotRuntime.right = { el: null, tabBarEl: null, resizeHandleEl: null, panelIds: [] };
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

  // Apply the persisted width, falling back to the 220 px default.
  // (Plugin-supplied defaultWidth is applied at register() time when this
  // is the first panel for the side and no persisted width exists.)
  const settings = getCurrentSettings();
  const persistedWidth = settings.sidebar?.[side]?.width;
  const width = persistedWidth ?? 220;
  slotEl.style.width = `${width}px`;

  // Start hidden. Both sidebars are closed by default until a plugin is
  // enabled or the user explicitly opens one with Cmd-Shift-[ / Cmd-Shift-].
  slotEl.style.display = "none";

  // Attach the resize handle (appended as last child of slotEl).
  const handle = _attachResizeHandle(side, slotEl);
  runtime.resizeHandleEl = handle;
  runtime.el = slotEl;
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

  // Accordion header row: title label + chevron toggle button.
  const headerEl = document.createElement("div");
  headerEl.className = "sidebar-panel-header";

  const titleEl = document.createElement("span");
  titleEl.className = "sidebar-panel-title";
  titleEl.textContent = descriptor.title;

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

  headerEl.appendChild(titleEl);
  headerEl.appendChild(moveBtn);   // between title and accordion chevron
  headerEl.appendChild(toggleBtn);
  wrapperEl.appendChild(headerEl);

  // The content container is the div passed to render() / destroy().
  const contentEl = document.createElement("div");
  contentEl.className = "sidebar-panel-content";
  wrapperEl.appendChild(contentEl);

  // Insert before the resize handle so the handle stays last.
  if (runtime.resizeHandleEl) {
    runtime.el!.insertBefore(wrapperEl, runtime.resizeHandleEl);
  } else {
    runtime.el!.appendChild(wrapperEl);
  }

  // Wire accordion toggle click → _handleAccordionToggle.
  toggleBtn.addEventListener("click", () => _handleAccordionToggle(descriptor.id));

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

/**
 * Build a single tab button for the tab bar.
 *
 * Extracted from _reconcileTabBar to keep the rebuild loop readable and to
 * keep _reconcileTabBar under the 30-line limit.
 *
 * @param id     The panel id this tab button represents.
 * @param panel  The registered panel record (used for the button label).
 * @param side   The sidebar side (passed to the click handler).
 * @returns      The created tab button element.
 */
function _buildTabButton(
  id: string,
  panel: RegisteredPanel,
  side: "left" | "right"
): HTMLButtonElement {
  const tab = document.createElement("button");
  tab.className = "sidebar-tab";
  tab.dataset.panelId = id;
  tab.textContent = panel.descriptor.title;
  tab.addEventListener("click", () => _handleTabClick(side, id));
  return tab;
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
  slotEl: HTMLDivElement
): HTMLDivElement {
  const handle = document.createElement("div");
  handle.className = "sidebar-resize-handle";
  handle.dataset.side = side;
  slotEl.appendChild(handle);

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
 * Reconcile the tab bar for a side after any registration or unregistration.
 *
 * Single-panel sides: no tab bar (tab bar removed if it existed).
 * Multi-panel sides: tab bar is created or rebuilt from scratch.
 *
 * "Rebuilt from scratch" means innerHTML = "" plus fresh button elements.
 * This is simple and safe: clicking an old button reference would be a no-op
 * because the element is detached from the DOM (EC-20).
 *
 * @param side  The sidebar side to reconcile.
 */
function _reconcileTabBar(side: "left" | "right"): void {
  const runtime = slotRuntime[side];
  const count = runtime.panelIds.length;

  if (count <= 1) {
    // Remove tab bar; single-panel mode: header title serves as the label.
    runtime.tabBarEl?.remove();
    runtime.tabBarEl = null;

    // Null out stale tabEl references so we don't try to toggle classes
    // on detached buttons in _setActivePanel.
    runtime.panelIds.forEach((id) => {
      const p = registeredPanels.get(id);
      if (p) p.tabEl = null;
    });

    // Show the single panel if there is one.
    if (count === 1) {
      _setActivePanel(side, runtime.panelIds[0], /* persist= */ false);
    }
  } else {
    // Ensure the tab bar element exists, prepended inside the slot.
    if (!runtime.tabBarEl) {
      const bar = document.createElement("div");
      bar.className = "sidebar-tab-bar";
      runtime.el!.prepend(bar);
      runtime.tabBarEl = bar;
    }

    // Rebuild tab bar contents from scratch (simple, avoids stale listeners).
    runtime.tabBarEl.innerHTML = "";
    runtime.panelIds.forEach((id) => {
      const panel = registeredPanels.get(id)!;
      const tab = _buildTabButton(id, panel, side);
      runtime.tabBarEl!.appendChild(tab);
      panel.tabEl = tab;
    });

    // Determine active panel: honour persisted activeTabId if still valid,
    // otherwise default to the first panel.
    const currentActiveId = getCurrentSettings().sidebar?.[side]?.activeTabId;
    const activeId =
      currentActiveId && runtime.panelIds.includes(currentActiveId)
        ? currentActiveId
        : runtime.panelIds[0];

    _setActivePanel(side, activeId, /* persist= */ false);
  }
}

/**
 * Show a specific panel and hide all other panels on the same side.
 *
 * For multi-panel sides: marks the tab button with the .sidebar-tab-active
 * class and sets display:none on inactive wrapper elements.
 *
 * For single-panel sides: tabEl is null, so the class toggle is skipped and
 * only the display logic applies.
 *
 * @param side      The sidebar side.
 * @param panelId   The panel that should become active.
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

    const isActive = id === panelId;
    // Show the active panel wrapper; hide inactive ones.
    panel.wrapperEl.style.display = isActive ? "" : "none";
    // Toggle tab active class (no-op when tabEl is null — single-panel mode).
    panel.tabEl?.classList.toggle("sidebar-tab-active", isActive);
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
 * Handle a click on a tab button.
 *
 * Switches to the clicked panel and persists the new activeTabId.
 *
 * @param side     The sidebar side that owns the tab bar.
 * @param panelId  The panel whose tab was clicked.
 */
function _handleTabClick(side: "left" | "right", panelId: string): void {
  _setActivePanel(side, panelId, /* persist= */ true);
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
): Record<string, { accordionExpanded: boolean }> {
  const record: Record<string, { accordionExpanded: boolean }> = {};
  const runtime = slotRuntime[side];

  runtime.panelIds.forEach((id) => {
    const p = registeredPanels.get(id);
    if (!p) return;
    // A non-"none" display means expanded; anything else (including "") means
    // the content area is visible (flex takes over from CSS).
    record[id] = { accordionExpanded: p.contentEl.style.display !== "none" };
  });

  return record;
}

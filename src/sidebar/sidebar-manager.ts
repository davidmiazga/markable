/**
 * SidebarManager — core module for the Sidebar Panel System.
 *
 * Owns all DOM lifecycle: creating and destroying sidebar/dock slots
 * (left, right, top, bottom), accordion headers, panel content containers,
 * dock position picker popovers, and resize handles. Persists all sidebar state
 * (open/closed, active tab, accordion, width/height, panelSides) via the
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
import type {
  DockSide,
  SidebarPanelLocationPreset,
  SidebarSettings,
  SidebarSlotState,
} from "../lib/settings";
import { attachPanelReorderDrag } from "./panel-reorder-drag";
import { PANEL_ICONS } from "./panel-icons";

export type { DockSide, SidebarPanelLocationPreset };

// ── Inline SVG icons ──────────────────────────────────────────────────────────

/** 4-way dock selector icon rendered inside `.sidebar-move-btn`. */
const DOCK_POSITION_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" ' +
  'stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="2" y="2" width="12" height="12" rx="2"/>' +
  '<line x1="5.5" y1="2" x2="5.5" y2="14"/>' +
  '<line x1="10.5" y1="2" x2="10.5" y2="14"/>' +
  '<line x1="5.5" y1="5.5" x2="10.5" y2="5.5"/>' +
  '<line x1="5.5" y1="10.5" x2="10.5" y2="10.5"/>' +
  '</svg>';

const ALL_DOCK_SIDES: DockSide[] = ["left", "right", "top", "bottom"];

const DEFAULT_DOCK_HEIGHT = 200;

function _defaultSlotForSide(side: DockSide): SidebarSlotState {
  if (side === "top" || side === "bottom") {
    return {
      ...DEFAULT_SIDEBAR_SLOT,
      height: DEFAULT_DOCK_HEIGHT,
      panels: {},
    };
  }
  return {
    ...DEFAULT_SIDEBAR_SLOT,
    panels: {},
  };
}

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
   * Which sidebar slot this panel requests by default ("left" or "right").
   */
  side: DockSide;

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
   * The tab button element. Null in stacked mode.
   */
  tabEl: HTMLButtonElement | null;
  /**
   * The icon strip button for this panel. Always present after register().
   */
  iconBtnEl: HTMLButtonElement | null;
  /**
   * The dock side this panel is currently placed on. Starts as descriptor.side
   * but may be overridden by the user via movePanel() / movePanelToSide().
   */
  effectiveSide: DockSide;
}

/** Runtime DOM state for one sidebar/dock slot. */
interface SlotRuntime {
  /**
   * The #sidebar-left, #sidebar-right, #sidebar-top, or #sidebar-bottom element.
   */
  el: HTMLDivElement | null;
  /**
   * The .sidebar-tab-bar element inside this slot (unused in stacked mode).
   */
  tabBarEl: HTMLDivElement | null;
  /** The resize handle element. */
  resizeHandleEl: HTMLDivElement | null;
  /** The icon strip element. */
  iconStripEl: HTMLDivElement | null;
  /** The content area element (flex:1, holds panels and resize handle). */
  contentAreaEl: HTMLDivElement | null;
  /** Cycle chevron button. */
  cycleBtnEl: HTMLButtonElement | null;
  /** Panel ids in order for this slot. */
  panelIds: string[];
  /** Logical open state for this slot (mirrors persisted settings.sidebar[side].open). */
  isOpen?: boolean;
}

// ── Module-level state ────────────────────────────────────────────────────────

/** All registered panels across all slots, keyed by panelId. */
const registeredPanels = new Map<string, RegisteredPanel>();

/**
 * Runtime DOM state per dock side.
 */
const slotRuntime: Record<DockSide, SlotRuntime> = {
  left:   { el: null, tabBarEl: null, resizeHandleEl: null, iconStripEl: null, contentAreaEl: null, cycleBtnEl: null, panelIds: [] },
  right:  { el: null, tabBarEl: null, resizeHandleEl: null, iconStripEl: null, contentAreaEl: null, cycleBtnEl: null, panelIds: [] },
  top:    { el: null, tabBarEl: null, resizeHandleEl: null, iconStripEl: null, contentAreaEl: null, cycleBtnEl: null, panelIds: [] },
  bottom: { el: null, tabBarEl: null, resizeHandleEl: null, iconStripEl: null, contentAreaEl: null, cycleBtnEl: null, panelIds: [] },
};

/** The #app-row container that holds #sidebar-left, #sidebar-top, #editor, #sidebar-bottom, #sidebar-right. */
let appRowEl: HTMLDivElement | null = null;

/** True after init() has been called. Guards against double-init (idempotency). */
let initialized = false;

/**
 * Runtime lock state override. Null until explicitly set via setPanelPositionsLocked()
 * or synced from settings, allowing getCurrentSettings().sidebar?.locked to act as fallback.
 */
let runtimeLocked: boolean | null = null;

/**
 * Runtime cache of saved Workspace Panel-Locations presets so preset operations
 * work even when updateSettings is mocked in unit tests.
 */
let runtimeSavedLocations: SidebarPanelLocationPreset[] | null = null;

// ── Public: init ──────────────────────────────────────────────────────────────

/**
 * Create the #app-row wrapper and all four dock slot elements (#sidebar-left,
 * #sidebar-top, #sidebar-bottom, #sidebar-right), placing #editor (and
 * #custom-tab-host if present) in the center column between them.
 *
 * Must be called after #editor is mounted in the DOM and before any plugin
 * calls registerSidebarPanel(). Idempotent — calling it twice is a no-op.
 *
 * All four slots start with display:none (closed).
 *
 * @throws Error if #app or #editor are not found in the DOM.
 */
export function init(): void {
  // Idempotency guard — calling init twice must be a no-op.
  if (initialized) return;

  const app = document.getElementById("app");
  const editor = document.getElementById("editor");

  if (!app || !editor) {
    throw new Error(
      "[SidebarManager] init() called before #app or #editor exists in DOM."
    );
  }

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

  // Create all four dock slots eagerly. All start hidden (display:none).
  // Order in #app-row: #sidebar-left, #sidebar-top, #editor, [#custom-tab-host],
  // #sidebar-bottom, #sidebar-right. This preserves leftIdx < editorIdx < rightIdx
  // while positioning top above editor and bottom below editor in the center column.
  _createSlotElement("left");
  appRowEl.appendChild(slotRuntime.left.el!);

  _createSlotElement("top");
  appRowEl.appendChild(slotRuntime.top.el!);

  appRowEl.appendChild(editor);
  const customTabHost = document.getElementById("custom-tab-host");
  if (customTabHost) appRowEl.appendChild(customTabHost);

  _createSlotElement("bottom");
  appRowEl.appendChild(slotRuntime.bottom.el!);

  _createSlotElement("right");
  appRowEl.appendChild(slotRuntime.right.el!);

  _syncLockedDOMState(isPanelPositionsLocked());

  initialized = true;
}

// ── Public: register ──────────────────────────────────────────────────────────

/**
 * Register a sidebar panel for a plugin.
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

  if (!initialized) init();

  const settings = getCurrentSettings();
  const persistedSide = settings.sidebar?.panelSides?.[descriptor.id];
  const effectiveSide: DockSide =
    persistedSide && ALL_DOCK_SIDES.includes(persistedSide)
      ? persistedSide
      : descriptor.side;

  const runtime = slotRuntime[effectiveSide];

  if (effectiveSide === "left" || effectiveSide === "right") {
    if (!settings.sidebar?.[effectiveSide]?.width && runtime.panelIds.length === 0) {
      const w = descriptor.defaultWidth ?? 220;
      runtime.el!.style.width = `${w}px`;
    }
  } else {
    if (!settings.sidebar?.[effectiveSide]?.height && runtime.panelIds.length === 0) {
      runtime.el!.style.height = `${DEFAULT_DOCK_HEIGHT}px`;
    }
  }

  const { wrapperEl, contentEl } = _buildPanelWrapper(descriptor, effectiveSide);

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

  // Reconcile the tab bar for this side.
  _reconcileTabBar(effectiveSide);

  // All panels are rendered eagerly at registration time.
  _renderPanel(descriptor.id);

  _restoreAccordionFromSettings(descriptor.id, effectiveSide);

  // Build and wire the icon strip button.
  const iconBtn = _buildIconButton(descriptor.id, panelRecord);
  runtime.iconStripEl!.appendChild(iconBtn);
  panelRecord.iconBtnEl = iconBtn;

  // Restore iconized/pinned visual state from persisted settings.
  _restoreIconizedFromSettings(descriptor.id, effectiveSide);

  _syncLockedDOMState(isPanelPositionsLocked());
  runtime.isOpen = true;

  // Persist the updated sidebar state for this side.
  updateSettings((s) => ({
    ...s,
    sidebar: _buildSidebarSettings(s.sidebar, effectiveSide, {
      ...(s.sidebar?.[effectiveSide] ?? _defaultSlotForSide(effectiveSide)),
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
 * Toggle the visibility of one sidebar/dock side.
 *
 * @param side  The dock side to toggle ("left" | "right" | "top" | "bottom").
 */
export function toggleSide(side: DockSide): void {
  const el = slotRuntime[side].el;
  if (!el) return;

  const currentlyOpen = el.style.display !== "none";
  const nextOpen = !currentlyOpen;

  el.style.display = nextOpen ? "" : "none";
  slotRuntime[side].isOpen = nextOpen;

  if (nextOpen) {
    const runtime = slotRuntime[side];
    if (runtime.contentAreaEl) runtime.contentAreaEl.style.display = "";
  }

  updateSettings((s) => ({
    ...s,
    sidebar: _buildSidebarSettings(s.sidebar, side, {
      ...(s.sidebar?.[side] ?? _defaultSlotForSide(side)),
      open: nextOpen,
    }),
  }));
}

// ── Public: movePanel ─────────────────────────────────────────────────────────

/**
 * Reassign a registered panel from its current dock side to the opposite side.
 *
 * Convenience wrapper around movePanelToSide() that flips left↔right (or top↔bottom).
 *
 * @param panelId  The id of the panel to move.
 */
export function movePanel(panelId: string): void {
  const panel = registeredPanels.get(panelId);
  if (!panel) return;

  let newSide: DockSide;
  if (panel.effectiveSide === "left") newSide = "right";
  else if (panel.effectiveSide === "right") newSide = "left";
  else if (panel.effectiveSide === "top") newSide = "bottom";
  else newSide = "top";

  movePanelToSide(panelId, newSide);
}

/**
 * Move a registered panel to a SPECIFIC dock side ("left" | "right" | "top" | "bottom").
 *
 * @param panelId  The id of the panel to move.
 * @param newSide  The destination dock side.
 */
export function movePanelToSide(panelId: string, newSide: DockSide): void {
  const panel = registeredPanels.get(panelId);
  if (!panel) return;

  const oldSide = panel.effectiveSide;
  if (oldSide === newSide) return;

  panel.effectiveSide = newSide;

  slotRuntime[oldSide].panelIds = slotRuntime[oldSide].panelIds.filter(
    (id) => id !== panelId
  );

  _reconcileTabBar(oldSide);

  if (slotRuntime[oldSide].panelIds.length === 0) {
    slotRuntime[oldSide].isOpen = false;
    if ((oldSide === "top" || oldSide === "bottom") && slotRuntime[oldSide].el) {
      slotRuntime[oldSide].el!.style.display = "none";
    }
    updateSettings((s) => ({
      ...s,
      sidebar: _buildSidebarSettings(s.sidebar, oldSide, {
        ...(s.sidebar?.[oldSide] ?? _defaultSlotForSide(oldSide)),
        open: false,
        activeTabId: null,
        panels: {},
      }),
    }));
  }

  // Persist the panelSides override map so placement survives a reload.
  updateSettings((s) => {
    const updatedPanelSides: Record<string, DockSide> = {
      ...(s.sidebar?.panelSides ?? {}),
      [panelId]: newSide,
    };
    return {
      ...s,
      sidebar: {
        ..._buildFullSidebarFromExisting(s.sidebar),
        panelSides: updatedPanelSides,
      },
    };
  });

  // Move the wrapper DOM node and icon button, then reconcile the new side.
  _moveWrapperToSlot(panel, panelId, newSide);

  // Ensure the destination slot is visible.
  _openSideIfClosed(newSide);
}

// ── Private: movePanel helpers ────────────────────────────────────────────────

function _moveWrapperToSlot(
  panel: RegisteredPanel,
  panelId: string,
  newSide: DockSide
): void {
  const newRuntime = slotRuntime[newSide];

  if (newRuntime.resizeHandleEl) {
    newRuntime.contentAreaEl!.insertBefore(panel.wrapperEl, newRuntime.resizeHandleEl);
  } else {
    newRuntime.contentAreaEl!.appendChild(panel.wrapperEl);
  }

  if (panel.iconBtnEl && newRuntime.iconStripEl) {
    newRuntime.iconStripEl.appendChild(panel.iconBtnEl);
  }

  newRuntime.panelIds.push(panelId);
  _reconcileTabBar(newSide);
}

function _openSideIfClosed(side: DockSide): void {
  const runtime = slotRuntime[side];

  runtime.el!.style.display = "";
  runtime.isOpen = true;
  if (runtime.contentAreaEl) {
    runtime.contentAreaEl.style.display = "";
  }

  updateSettings((s) => ({
    ...s,
    sidebar: _buildSidebarSettings(s.sidebar, side, {
      ...(s.sidebar?.[side] ?? _defaultSlotForSide(side)),
      open: true,
      activeTabId: _getActiveTabId(side),
      panels: _buildPanelsRecord(side),
    }),
  }));
}

// ── Public: focusSidebarPanel / toggleSidebarPanel / restoreFromSettings ─────

export function focusSidebarPanel(panelId: string): void {
  const panel = registeredPanels.get(panelId);
  if (!panel) return;

  const side = panel.effectiveSide;
  const el = slotRuntime[side].el;
  if (!el) return;

  if (el.style.display === "none") {
    el.style.display = "";
    updateSettings((s) => ({
      ...s,
      sidebar: _buildSidebarSettings(s.sidebar, side, {
        ...(s.sidebar?.[side] ?? _defaultSlotForSide(side)),
        open: true,
      }),
    }));
  }

  _setActivePanel(side, panelId, /* persist= */ true);
}

export function toggleSidebarPanel(panelId: string): void {
  const panel = registeredPanels.get(panelId);
  if (!panel) return;
  toggleSide(panel.effectiveSide);
}

export function restoreFromSettings(): void {
  const persistedLocked = getCurrentSettings().sidebar?.locked;
  if (typeof persistedLocked === "boolean") {
    runtimeLocked = persistedLocked;
  }
  _syncLockedDOMState(isPanelPositionsLocked());

  for (const side of ALL_DOCK_SIDES) {
    const runtime = slotRuntime[side];

    // EC-11, EC-23: no panels registered on this side → keep the slot hidden
    // regardless of what the persisted open state says.
    if (runtime.panelIds.length === 0) {
      runtime.isOpen = false;
      if (runtime.el) runtime.el.style.display = "none";
      continue;
    }

    const slotSettings = getCurrentSettings().sidebar?.[side];
    const shouldOpen = slotSettings?.open ?? true;

    runtime.isOpen = shouldOpen;
    if (!runtime.el) continue;
    runtime.el.style.display = shouldOpen ? "" : "none";

    if (slotSettings?.activeTabId && runtime.panelIds.includes(slotSettings.activeTabId)) {
      _setActivePanel(side, slotSettings.activeTabId, /* persist= */ false);
    }

    const allIconized = runtime.panelIds.length > 0 && runtime.panelIds.every(
      (id) => registeredPanels.get(id)?.wrapperEl.classList.contains("is-iconized") ?? false
    );
    if (runtime.contentAreaEl && allIconized) {
      runtime.contentAreaEl.style.display = "none";
    }
  }
}

// ── Public: Lock / Unlock Panel Positions & Saved Workspace Panel-Locations ──

export function isPanelPositionsLocked(): boolean {
  if (runtimeLocked !== null) return runtimeLocked;
  return Boolean(getCurrentSettings().sidebar?.locked);
}

export function setPanelPositionsLocked(locked: boolean): void {
  runtimeLocked = Boolean(locked);
  _syncLockedDOMState(runtimeLocked);

  if (runtimeLocked) {
    document.querySelectorAll(".sidebar-dock-menu").forEach((el) => el.remove());
  }

  updateSettings((s) => ({
    ...s,
    sidebar: {
      ..._buildFullSidebarFromExisting(s.sidebar),
      locked: runtimeLocked!,
    },
  }));

  window.dispatchEvent(new CustomEvent("markable-panel-locations-changed"));
}

export function togglePanelPositionsLock(): boolean {
  const next = !isPanelPositionsLocked();
  setPanelPositionsLocked(next);
  return next;
}

function _syncLockedDOMState(locked: boolean): void {
  appRowEl?.classList.toggle("is-panels-locked", locked);
  for (const side of ALL_DOCK_SIDES) {
    slotRuntime[side].el?.classList.toggle("is-panels-locked", locked);
  }
  document.querySelectorAll<HTMLButtonElement>(".sidebar-move-btn").forEach((btn) => {
    btn.disabled = locked;
    btn.classList.toggle("is-disabled", locked);
    btn.setAttribute("aria-disabled", String(locked));
  });
}

function _captureCurrentSlotState(side: DockSide): SidebarSlotState {
  const runtime = slotRuntime[side];
  const persisted = getCurrentSettings().sidebar?.[side];
  const open =
    (runtime.el ? runtime.el.style.display !== "none" : false) ||
    Boolean(runtime.isOpen) ||
    Boolean(persisted?.open && runtime.panelIds.length > 0);
  const activeTabId = _getActiveTabId(side) ?? persisted?.activeTabId ?? null;
  const parsedW = parseInt(runtime.el?.style.width || "", 10);
  const width = !isNaN(parsedW) && parsedW > 0 ? parsedW : (persisted?.width ?? 220);
  const parsedH = parseInt(runtime.el?.style.height || "", 10);
  const height =
    side === "top" || side === "bottom"
      ? (!isNaN(parsedH) && parsedH > 0 ? parsedH : (persisted?.height ?? DEFAULT_DOCK_HEIGHT))
      : persisted?.height;
  const panelOrder =
    runtime.panelIds.length > 0
      ? [...runtime.panelIds]
      : (persisted?.panelOrder ? [...persisted.panelOrder] : []);
  const panels =
    runtime.panelIds.length > 0
      ? _buildPanelsRecord(side)
      : structuredClone(persisted?.panels ?? {});

  return {
    open,
    activeTabId,
    width,
    ...(height !== undefined ? { height } : {}),
    panels,
    panelOrder,
  };
}

export function getPanelLocationPresets(): SidebarPanelLocationPreset[] {
  const fromSettings = getCurrentSettings().sidebar?.savedPanelLocations;
  if (runtimeSavedLocations !== null) {
    return structuredClone(runtimeSavedLocations);
  }
  return fromSettings ? structuredClone(fromSettings) : [];
}

export function savePanelLocationPreset(name: string): SidebarPanelLocationPreset | null {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const panelSides: Record<string, DockSide> = {
    ...(getCurrentSettings().sidebar?.panelSides ?? {}),
  };
  for (const [panelId, panel] of registeredPanels) {
    panelSides[panelId] = panel.effectiveSide;
  }

  const preset: SidebarPanelLocationPreset = {
    name: trimmed,
    panelSides,
    slots: {
      left:   _captureCurrentSlotState("left"),
      right:  _captureCurrentSlotState("right"),
      top:    _captureCurrentSlotState("top"),
      bottom: _captureCurrentSlotState("bottom"),
    },
  };

  const base =
    runtimeSavedLocations !== null
      ? structuredClone(runtimeSavedLocations)
      : structuredClone(getCurrentSettings().sidebar?.savedPanelLocations ?? []);
  const existingIdx = base.findIndex((p) => p.name === trimmed);
  if (existingIdx >= 0) {
    base[existingIdx] = structuredClone(preset);
  } else {
    base.push(structuredClone(preset));
  }
  runtimeSavedLocations = base;

  updateSettings((s) => {
    const listFromState = s.sidebar?.savedPanelLocations
      ? structuredClone(s.sidebar.savedPanelLocations)
      : [];
    for (const item of base) {
      const idx = listFromState.findIndex((p) => p.name === item.name);
      if (idx >= 0) listFromState[idx] = structuredClone(item);
      else listFromState.push(structuredClone(item));
    }
    return {
      ...s,
      sidebar: {
        ..._buildFullSidebarFromExisting(s.sidebar),
        savedPanelLocations: listFromState,
      },
    };
  });

  window.dispatchEvent(new CustomEvent("markable-panel-locations-changed"));
  return structuredClone(preset);
}

export function promptAndSavePanelLocationPreset(): SidebarPanelLocationPreset | null {
  const raw = typeof window.prompt === "function"
    ? window.prompt("Save Workspace Panel-Locations preset as:")
    : null;
  if (!raw) return null;
  return savePanelLocationPreset(raw);
}

export function applyPanelLocationPreset(name: string): boolean {
  const presets = getPanelLocationPresets();
  const fallbackPresets = getCurrentSettings().sidebar?.savedPanelLocations ?? [];
  const preset =
    presets.find((p) => p.name === name) ??
    fallbackPresets.find((p) => p.name === name);
  if (!preset) return false;

  // 1. Move each registered panel to its saved dock side (or its default side).
  for (const [panelId, panel] of registeredPanels) {
    const savedSide = preset.panelSides?.[panelId];
    const targetSide: DockSide =
      savedSide && ALL_DOCK_SIDES.includes(savedSide)
        ? savedSide
        : panel.descriptor.side;

    if (panel.effectiveSide !== targetSide) {
      const oldSide = panel.effectiveSide;
      slotRuntime[oldSide].panelIds = slotRuntime[oldSide].panelIds.filter(
        (id) => id !== panelId
      );
      panel.effectiveSide = targetSide;
      _moveWrapperToSlot(panel, panelId, targetSide);
    }
  }

  // 2. Restore each slot's order, dimensions, per-panel states, and open/closed state.
  for (const side of ALL_DOCK_SIDES) {
    const slotState = preset.slots?.[side] ?? _defaultSlotForSide(side);
    const runtime = slotRuntime[side];

    if (slotState.panelOrder && slotState.panelOrder.length > 0 && runtime.panelIds.length > 1) {
      const known = new Set(runtime.panelIds);
      const ordered = [
        ...slotState.panelOrder.filter((id) => known.has(id)),
        ...runtime.panelIds.filter((id) => !slotState.panelOrder!.includes(id)),
      ];
      runtime.panelIds = ordered;
      for (const id of ordered) {
        const p = registeredPanels.get(id);
        if (!p) continue;
        if (runtime.contentAreaEl) {
          runtime.contentAreaEl.insertBefore(p.wrapperEl, runtime.resizeHandleEl);
        }
        if (p.iconBtnEl && runtime.iconStripEl) {
          runtime.iconStripEl.appendChild(p.iconBtnEl);
        }
      }
    }

    if (runtime.el) {
      if (side === "left" || side === "right") {
        if (slotState.width) runtime.el.style.width = `${slotState.width}px`;
      } else {
        const h = slotState.height ?? DEFAULT_DOCK_HEIGHT;
        runtime.el.style.height = `${h}px`;
      }
    }

    for (const id of runtime.panelIds) {
      const p = registeredPanels.get(id);
      if (!p) continue;
      const pState = slotState.panels?.[id];
      const expanded = pState?.accordionExpanded ?? true;
      _setAccordionState(id, expanded, /* persist= */ false);

      const iconized = pState?.iconized ?? false;
      p.wrapperEl.classList.toggle("is-iconized", iconized);
      p.wrapperEl.style.display = iconized ? "none" : "";
      p.iconBtnEl?.classList.toggle("is-active", !iconized);

      const pinned = pState?.pinned ?? false;
      p.wrapperEl.classList.toggle("is-pinned", pinned);
      p.iconBtnEl?.classList.toggle("is-pinned", pinned);
    }

    _reconcileTabBar(side);

    if (runtime.el) {
      const shouldOpen = runtime.panelIds.length > 0 ? Boolean(slotState.open) : false;
      runtime.isOpen = shouldOpen;
      runtime.el.style.display = shouldOpen ? "" : "none";
    }

    if (runtime.contentAreaEl) {
      const allIconized =
        runtime.panelIds.length > 0 &&
        runtime.panelIds.every(
          (id) => registeredPanels.get(id)?.wrapperEl.classList.contains("is-iconized") ?? false
        );
      runtime.contentAreaEl.style.display = allIconized ? "none" : "";
    }
  }

  // 3. Persist the restored arrangement to settings.
  updateSettings((s) => ({
    ...s,
    sidebar: {
      ..._buildFullSidebarFromExisting(s.sidebar),
      left:       structuredClone(preset.slots.left),
      right:      structuredClone(preset.slots.right),
      top:        structuredClone(preset.slots.top),
      bottom:     structuredClone(preset.slots.bottom),
      panelSides: structuredClone(preset.panelSides),
    },
  }));

  window.dispatchEvent(new CustomEvent("markable-panel-locations-changed"));
  return true;
}

export function deletePanelLocationPreset(name: string): boolean {
  const current = getPanelLocationPresets();
  const fromSettings = getCurrentSettings().sidebar?.savedPanelLocations ?? [];
  const exists = current.some((p) => p.name === name) || fromSettings.some((p) => p.name === name);
  if (!exists) return false;

  const base = runtimeSavedLocations !== null ? runtimeSavedLocations : fromSettings;
  runtimeSavedLocations = base.filter((p) => p.name !== name).map((p) => structuredClone(p));

  updateSettings((s) => {
    const existingList = s.sidebar?.savedPanelLocations ?? base;
    return {
      ...s,
      sidebar: {
        ..._buildFullSidebarFromExisting(s.sidebar),
        savedPanelLocations: existingList
          .filter((p) => p.name !== name)
          .map((p) => structuredClone(p)),
      },
    };
  });

  window.dispatchEvent(new CustomEvent("markable-panel-locations-changed"));
  return true;
}

export function resetPanelLocationsToDefault(): void {
  // 1. Return every registered panel to its plugin-declared default side.
  for (const [panelId, panel] of registeredPanels) {
    const defaultSide = panel.descriptor.side;
    if (panel.effectiveSide !== defaultSide) {
      const oldSide = panel.effectiveSide;
      slotRuntime[oldSide].panelIds = slotRuntime[oldSide].panelIds.filter(
        (id) => id !== panelId
      );
      panel.effectiveSide = defaultSide;
      _moveWrapperToSlot(panel, panelId, defaultSide);
    }
    panel.wrapperEl.classList.remove("is-iconized");
    panel.wrapperEl.style.display = "";
    panel.iconBtnEl?.classList.add("is-active");
    _setAccordionState(panelId, true, /* persist= */ false);
  }

  // 2. Restore registration order, reset slot sizes, and close Top/Bottom docks.
  const allRegIds = Array.from(registeredPanels.keys());
  for (const side of ALL_DOCK_SIDES) {
    const runtime = slotRuntime[side];
    const sideIds = allRegIds.filter(
      (id) => registeredPanels.get(id)?.effectiveSide === side
    );
    runtime.panelIds = sideIds;

    for (const id of sideIds) {
      const p = registeredPanels.get(id);
      if (!p) continue;
      if (runtime.contentAreaEl) {
        runtime.contentAreaEl.insertBefore(p.wrapperEl, runtime.resizeHandleEl);
      }
      if (p.iconBtnEl && runtime.iconStripEl) {
        runtime.iconStripEl.appendChild(p.iconBtnEl);
      }
    }

    _reconcileTabBar(side);

    if (side === "left" || side === "right") {
      const firstPanel = sideIds[0] ? registeredPanels.get(sideIds[0]) : undefined;
      const defaultW = firstPanel?.descriptor.defaultWidth ?? 220;
      runtime.isOpen = sideIds.length > 0;
      if (runtime.el) {
        runtime.el.style.width = `${defaultW}px`;
        runtime.el.style.display = sideIds.length > 0 ? "" : "none";
      }
      if (runtime.contentAreaEl) runtime.contentAreaEl.style.display = "";
    } else {
      runtime.isOpen = false;
      if (runtime.el) {
        runtime.el.style.height = `${DEFAULT_DOCK_HEIGHT}px`;
        runtime.el.style.display = "none";
      }
      if (runtime.contentAreaEl) runtime.contentAreaEl.style.display = "";
    }
  }

  // 3. Persist cleared panelSides, reset slot dimensions, and closed top/bottom.
  updateSettings((s) => ({
    ...s,
    sidebar: {
      ..._buildFullSidebarFromExisting(s.sidebar),
      left: {
        open: slotRuntime.left.panelIds.length > 0,
        activeTabId: _getActiveTabId("left"),
        width: parseInt(slotRuntime.left.el?.style.width || "", 10) || 220,
        panels: _buildPanelsRecord("left"),
        panelOrder: [...slotRuntime.left.panelIds],
      },
      right: {
        open: slotRuntime.right.panelIds.length > 0,
        activeTabId: _getActiveTabId("right"),
        width: parseInt(slotRuntime.right.el?.style.width || "", 10) || 220,
        panels: _buildPanelsRecord("right"),
        panelOrder: [...slotRuntime.right.panelIds],
      },
      top: _defaultSlotForSide("top"),
      bottom: _defaultSlotForSide("bottom"),
      panelSides: {},
    },
  }));

  window.dispatchEvent(new CustomEvent("markable-panel-locations-changed"));
}

// ── Private: settings merge helper ───────────────────────────────────────────

function _buildFullSidebarFromExisting(existing: SidebarSettings | undefined): SidebarSettings {
  const locked =
    existing?.locked !== undefined
      ? existing.locked
      : (runtimeLocked !== null ? runtimeLocked : undefined);
  const savedPanelLocations =
    existing?.savedPanelLocations !== undefined
      ? existing.savedPanelLocations
      : (runtimeSavedLocations !== null ? structuredClone(runtimeSavedLocations) : undefined);

  return {
    left:       existing?.left   ?? _defaultSlotForSide("left"),
    right:      existing?.right  ?? _defaultSlotForSide("right"),
    top:        existing?.top    ?? _defaultSlotForSide("top"),
    bottom:     existing?.bottom ?? _defaultSlotForSide("bottom"),
    panelSides: existing?.panelSides,
    ...(locked !== undefined ? { locked } : {}),
    ...(savedPanelLocations !== undefined ? { savedPanelLocations } : {}),
  };
}

function _buildSidebarSettings(
  existing: SidebarSettings | undefined,
  side: DockSide,
  update: SidebarSlotState,
  panelSidesOverride?: Record<string, DockSide>
): SidebarSettings {
  const base = _buildFullSidebarFromExisting(existing);
  return {
    ...base,
    left:   side === "left"   ? update : base.left,
    right:  side === "right"  ? update : base.right,
    top:    side === "top"    ? update : base.top,
    bottom: side === "bottom" ? update : base.bottom,
    panelSides: panelSidesOverride ?? base.panelSides,
  };
}

// ── Test-only reset ───────────────────────────────────────────────────────────

export function _resetForTests(): void {
  document.querySelectorAll(".sidebar-dock-menu, .sidebar-panel-ctx-menu, .panel-dock-drop-zones").forEach((el) => el.remove());
  registeredPanels.clear();
  slotRuntime.left   = { el: null, tabBarEl: null, resizeHandleEl: null, iconStripEl: null, contentAreaEl: null, cycleBtnEl: null, panelIds: [] };
  slotRuntime.right  = { el: null, tabBarEl: null, resizeHandleEl: null, iconStripEl: null, contentAreaEl: null, cycleBtnEl: null, panelIds: [] };
  slotRuntime.top    = { el: null, tabBarEl: null, resizeHandleEl: null, iconStripEl: null, contentAreaEl: null, cycleBtnEl: null, panelIds: [] };
  slotRuntime.bottom = { el: null, tabBarEl: null, resizeHandleEl: null, iconStripEl: null, contentAreaEl: null, cycleBtnEl: null, panelIds: [] };
  appRowEl = null;
  initialized = false;
  runtimeLocked = null;
  runtimeSavedLocations = null;
}

// ── Private helpers: slot & panel creation ────────────────────────────────────

function _createSlotElement(side: DockSide): void {
  const runtime = slotRuntime[side];

  const slotEl = document.createElement("div");
  slotEl.id = `sidebar-${side}`;

  const settings = getCurrentSettings();
  if (side === "left" || side === "right") {
    const persistedWidth = settings.sidebar?.[side]?.width;
    const width = persistedWidth ?? 220;
    slotEl.style.width = `${width}px`;
  } else {
    const persistedHeight = settings.sidebar?.[side]?.height;
    const height = persistedHeight ?? DEFAULT_DOCK_HEIGHT;
    slotEl.style.height = `${height}px`;
  }
  slotEl.style.display = "none";

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

  const contentAreaEl = document.createElement("div");
  contentAreaEl.className = "sidebar-content-area";
  slotEl.appendChild(contentAreaEl);

  const handle = _attachResizeHandle(side, slotEl, contentAreaEl);

  runtime.el = slotEl;
  runtime.iconStripEl = iconStripEl;
  runtime.contentAreaEl = contentAreaEl;
  runtime.cycleBtnEl = null;
  runtime.resizeHandleEl = handle;
}

function _buildPanelWrapper(
  descriptor: SidebarPanelDescriptor,
  side: DockSide
): { wrapperEl: HTMLDivElement; contentEl: HTMLDivElement } {
  const runtime = slotRuntime[side];

  const wrapperEl = document.createElement("div");
  wrapperEl.className = "sidebar-panel-wrapper";
  wrapperEl.dataset.panelId = descriptor.id;

  const headerEl = document.createElement("div");
  headerEl.className = "sidebar-panel-header";

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

  // 4-way dock position button: inline SVG icon that opens the 4-way dock menu.
  const moveBtn = document.createElement("button");
  moveBtn.className = "sidebar-move-btn";
  moveBtn.setAttribute("aria-label", "Dock panel position");
  moveBtn.setAttribute("aria-haspopup", "menu");
  moveBtn.innerHTML = DOCK_POSITION_SVG;
  moveBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    _toggleDockMenu(descriptor.id, moveBtn);
  });

  const toggleBtn = document.createElement("button");
  toggleBtn.className = "sidebar-accordion-toggle";
  toggleBtn.setAttribute("aria-label", "Toggle panel");
  toggleBtn.setAttribute("aria-expanded", "true");

  headerEl.appendChild(dragHandleEl);

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
        e.stopPropagation();
        action.onClick();
      });
      headerEl.appendChild(actionBtn);
    }
  }

  headerEl.appendChild(moveBtn);
  headerEl.appendChild(toggleBtn);
  wrapperEl.appendChild(headerEl);

  const contentEl = document.createElement("div");
  contentEl.className = "sidebar-panel-content";
  wrapperEl.appendChild(contentEl);

  if (runtime.resizeHandleEl) {
    runtime.contentAreaEl!.insertBefore(wrapperEl, runtime.resizeHandleEl);
  } else {
    runtime.contentAreaEl!.appendChild(wrapperEl);
  }

  toggleBtn.addEventListener("click", () => _handleAccordionToggle(descriptor.id));

  headerEl.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    _showPanelContextMenu(descriptor.id, e.clientX, e.clientY);
  });

  attachPanelReorderDrag(
    dragHandleEl,
    descriptor.id,
    () => {
      const currentSide = registeredPanels.get(descriptor.id)?.effectiveSide ?? side;
      return `#sidebar-${currentSide} .sidebar-panel-wrapper[data-panel-id]`;
    },
    (fromId, insertBeforeId) => {
      const currentSide = registeredPanels.get(fromId)?.effectiveSide ?? side;
      _reorderPanel(currentSide, fromId, insertBeforeId);
    },
    {
      getCurrentSide: () => registeredPanels.get(descriptor.id)?.effectiveSide ?? side,
      onDockMove: (fromId, targetSide) => movePanelToSide(fromId, targetSide),
      isLocked: () => isPanelPositionsLocked(),
    },
  );

  return { wrapperEl, contentEl };
}

/**
 * Open or close the compact 4-way dock selector popover menu anchored to `anchorBtn`.
 */
function _toggleDockMenu(panelId: string, anchorBtn: HTMLElement): void {
  if (isPanelPositionsLocked()) {
    document.querySelectorAll(".sidebar-dock-menu").forEach((el) => el.remove());
    return;
  }

  const existing = document.querySelector<HTMLElement>(".sidebar-dock-menu");
  if (existing) {
    const wasSamePanel = existing.dataset.panelId === panelId;
    existing.remove();
    if (wasSamePanel) return;
  }

  const panel = registeredPanels.get(panelId);
  if (!panel) return;

  const currentSide = panel.effectiveSide;
  const rect = anchorBtn.getBoundingClientRect();

  const menu = document.createElement("div");
  menu.className = "sidebar-dock-menu";
  menu.setAttribute("role", "menu");
  menu.dataset.panelId = panelId;
  menu.style.left = `${rect.left}px`;
  menu.style.top = `${rect.bottom + 4}px`;

  const options: Array<{ side: DockSide; label: string }> = [
    { side: "left", label: "Left" },
    { side: "right", label: "Right" },
    { side: "top", label: "Top" },
    { side: "bottom", label: "Bottom" },
  ];

  const closeMenu = (): void => {
    menu.remove();
    document.removeEventListener("mousedown", onOutsideMouseDown);
    document.removeEventListener("keydown", onEscapeKey);
  };

  function onOutsideMouseDown(e: MouseEvent): void {
    const target = e.target as Node | null;
    if (target && !menu.contains(target) && !anchorBtn.contains(target)) {
      closeMenu();
    }
  }

  function onEscapeKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      closeMenu();
    }
  }

  for (const opt of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    const isCurrent = opt.side === currentSide;
    btn.className = "sidebar-dock-menu-item" + (isCurrent ? " active is-active" : "");
    btn.setAttribute("role", "menuitemradio");
    btn.setAttribute("aria-checked", String(isCurrent));
    btn.dataset.side = opt.side;
    btn.dataset.dockSide = opt.side;
    btn.textContent = opt.label;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeMenu();
      movePanelToSide(panelId, opt.side);
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  setTimeout(() => {
    document.addEventListener("mousedown", onOutsideMouseDown);
    document.addEventListener("keydown", onEscapeKey);
  }, 0);
}

function _restoreAccordionFromSettings(panelId: string, side: DockSide): void {
  const settings = getCurrentSettings();
  const panelState = settings.sidebar?.[side]?.panels?.[panelId];
  const expanded = panelState?.accordionExpanded ?? true;
  _setAccordionState(panelId, expanded, /* persist= */ false);
}

function _destroyPanelDOM(panel: RegisteredPanel, panelId: string): void {
  try {
    panel.descriptor.destroy(panel.contentEl);
  } catch (err) {
    console.error(`[SidebarManager] destroy() threw for panel "${panelId}":`, err);
  }

  panel.wrapperEl.remove();
}

function _persistAfterUnregister(
  side: DockSide,
  runtime: SlotRuntime,
  wasActive: boolean
): void {
  if (runtime.panelIds.length === 0) {
    runtime.tabBarEl = null;
    if ((side === "top" || side === "bottom") && runtime.el) {
      runtime.el.style.display = "none";
    }

    updateSettings((s) => ({
      ...s,
      sidebar: _buildSidebarSettings(s.sidebar, side, {
        ...(s.sidebar?.[side] ?? _defaultSlotForSide(side)),
        open: false,
        activeTabId: null,
        panels: {},
      }),
    }));
  } else {
    if (wasActive) {
      _setActivePanel(side, runtime.panelIds[0], /* persist= */ true);
    }

    updateSettings((s) => ({
      ...s,
      sidebar: _buildSidebarSettings(s.sidebar, side, {
        ...(s.sidebar?.[side] ?? _defaultSlotForSide(side)),
        activeTabId: _getActiveTabId(side),
        panels: _buildPanelsRecord(side),
      }),
    }));
  }
}

// ── Private helpers: resize handle ────────────────────────────────────────────

function _attachResizeHandle(
  side: DockSide,
  slotEl: HTMLDivElement,
  contentAreaEl: HTMLDivElement
): HTMLDivElement {
  const handle = document.createElement("div");
  handle.className = "sidebar-resize-handle";
  handle.dataset.side = side;
  contentAreaEl.appendChild(handle);

  const isHorizontalSide = side === "left" || side === "right";
  let startCoord = 0;
  let startSize = 0;
  let isResizing = false;
  const MIN_WIDTH = 150;
  const MAX_WIDTH = 600;
  const MIN_HEIGHT = 120;
  const MAX_HEIGHT = 450;

  function onPointerDown(e: PointerEvent): void {
    if (isPanelPositionsLocked()) return;
    e.preventDefault();
    isResizing = true;
    handle.setPointerCapture(e.pointerId);
    if (isHorizontalSide) {
      startCoord = e.clientX;
      startSize = slotEl.offsetWidth;
    } else {
      startCoord = e.clientY;
      startSize = slotEl.offsetHeight || parseInt(slotEl.style.height, 10) || DEFAULT_DOCK_HEIGHT;
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (isPanelPositionsLocked() || !isResizing || !handle.hasPointerCapture(e.pointerId)) return;

    if (isHorizontalSide) {
      const delta = side === "left" ? e.clientX - startCoord : startCoord - e.clientX;
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startSize + delta));
      slotEl.style.width = `${newWidth}px`;

      updateSettingsInMemory((s) => ({
        ...s,
        sidebar: _buildSidebarSettings(s.sidebar, side, {
          ...(s.sidebar?.[side] ?? _defaultSlotForSide(side)),
          width: newWidth,
        }),
      }));
    } else {
      const delta = side === "top" ? e.clientY - startCoord : startCoord - e.clientY;
      const newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startSize + delta));
      slotEl.style.height = `${newHeight}px`;

      updateSettingsInMemory((s) => ({
        ...s,
        sidebar: _buildSidebarSettings(s.sidebar, side, {
          ...(s.sidebar?.[side] ?? _defaultSlotForSide(side)),
          height: newHeight,
        }),
      }));
    }
  }

  function onPointerUp(e: PointerEvent): void {
    if (!isResizing || !handle.hasPointerCapture(e.pointerId)) {
      isResizing = false;
      return;
    }
    isResizing = false;
    handle.releasePointerCapture(e.pointerId);
    if (!isPanelPositionsLocked()) {
      saveSettingsDebounced();
    }
  }

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", onPointerUp);

  return handle;
}

function _reconcileTabBar(side: DockSide): void {
  const runtime = slotRuntime[side];

  runtime.tabBarEl?.remove();
  runtime.tabBarEl = null;
  runtime.contentAreaEl?.classList.remove("has-tab-bar");

  runtime.panelIds.forEach((id) => {
    const p = registeredPanels.get(id);
    if (p) p.tabEl = null;
  });

  runtime.panelIds.forEach((id) => {
    const panel = registeredPanels.get(id);
    if (!panel) return;
    const isIconized = panel.wrapperEl.classList.contains("is-iconized");
    panel.wrapperEl.style.display = isIconized ? "none" : "";
  });
}

function _reorderPanel(
  side: DockSide,
  fromId: string,
  insertBeforeId: string | null,
): void {
  const runtime = slotRuntime[side];
  const fromIdx = runtime.panelIds.indexOf(fromId);
  if (fromIdx < 0) return;

  let toIdx: number;
  if (insertBeforeId === null) {
    toIdx = runtime.panelIds.length - 1;
  } else {
    const beforeIdx = runtime.panelIds.indexOf(insertBeforeId);
    if (beforeIdx < 0) return;
    toIdx = beforeIdx > fromIdx ? beforeIdx - 1 : beforeIdx;
  }
  if (toIdx === fromIdx) return;

  runtime.panelIds.splice(fromIdx, 1);
  runtime.panelIds.splice(toIdx, 0, fromId);

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

  updateSettings((s) => ({
    ...s,
    sidebar: _buildSidebarSettings(s.sidebar, side, {
      ...(s.sidebar?.[side] ?? _defaultSlotForSide(side)),
      panelOrder: [...runtime.panelIds],
    }),
  }));
}

function _applyPersistedOrder(side: DockSide): void {
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

function _setActivePanel(
  side: DockSide,
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
        ...(s.sidebar?.[side] ?? _defaultSlotForSide(side)),
        activeTabId: panelId,
      }),
    }));
  }
}

function _handleAccordionToggle(panelId: string): void {
  const panel = registeredPanels.get(panelId);
  if (!panel) return;

  const expanded = panel.contentEl.style.display === "none";
  _setAccordionState(panelId, expanded, /* persist= */ true);
}

function _setAccordionState(
  panelId: string,
  expanded: boolean,
  persist: boolean
): void {
  const panel = registeredPanels.get(panelId);
  if (!panel) return;

  panel.contentEl.style.display = expanded ? "" : "none";

  panel.wrapperEl
    .querySelector(".sidebar-accordion-toggle")
    ?.setAttribute("aria-expanded", String(expanded));

  if (persist) {
    const side = panel.effectiveSide;
    updateSettings((s) => ({
      ...s,
      sidebar: _buildSidebarSettings(s.sidebar, side, {
        ...(s.sidebar?.[side] ?? _defaultSlotForSide(side)),
        panels: {
          ...(s.sidebar?.[side]?.panels ?? {}),
          [panelId]: { accordionExpanded: expanded },
        },
      }),
    }));
  }
}

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

function _getActiveTabId(side: DockSide): string | null {
  const runtime = slotRuntime[side];
  if (runtime.panelIds.length === 0) return null;

  const activeId = runtime.panelIds.find((id) => {
    const p = registeredPanels.get(id);
    return p && p.wrapperEl.style.display !== "none";
  });

  return activeId ?? runtime.panelIds[0];
}

// ── Private helpers: icon strip ───────────────────────────────────────────────

function _showPanelContextMenu(panelId: string, x: number, y: number): void {
  document.querySelector(".sidebar-panel-ctx-menu")?.remove();

  const panel = registeredPanels.get(panelId);
  if (!panel) return;

  const side = panel.effectiveSide;
  const isPinned =
    getCurrentSettings().sidebar?.[side]?.panels?.[panelId]?.pinned ??
    panel.wrapperEl.classList.contains("is-pinned");
  const isLocked = isPanelPositionsLocked();
  const presets = getPanelLocationPresets();

  const menu = document.createElement("ul");
  menu.className = "sidebar-panel-ctx-menu";
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:9999;` +
    `background:var(--bg-secondary,#252526);border:1px solid var(--border-color,rgba(128,128,128,.2));` +
    `border-radius:6px;padding:4px 0;list-style:none;margin:0;min-width:180px;` +
    `box-shadow:0 4px 12px rgba(0,0,0,.35);`;

  function closeMenu(): void {
    menu.remove();
    document.removeEventListener("mousedown", outside);
  }

  function addItem(label: string, action: string, onSelect: () => void, datasetExtra?: Record<string, string>): HTMLLIElement {
    const li = document.createElement("li");
    li.dataset.action = action;
    if (datasetExtra) {
      for (const [k, v] of Object.entries(datasetExtra)) {
        li.dataset[k] = v;
      }
    }
    li.style.cssText = `padding:6px 14px;cursor:pointer;font-family:var(--ui-font);` +
      `font-size:12px;color:var(--text-primary,#ccc);user-select:none;display:flex;align-items:center;justify-content:space-between;gap:8px;`;
    li.textContent = label;
    li.addEventListener("mouseenter", () => { li.style.background = "var(--code-bg,rgba(128,128,128,.1))"; });
    li.addEventListener("mouseleave", () => { li.style.background = ""; });
    let fired = false;
    const handleSelect = (e: Event) => {
      if (fired) return;
      fired = true;
      e.stopPropagation();
      onSelect();
      closeMenu();
    };
    li.addEventListener("mousedown", handleSelect);
    li.addEventListener("click", handleSelect);
    menu.appendChild(li);
    return li;
  }

  // First <li> must remain Pin/Unpin panel for backwards compatibility.
  addItem(isPinned ? "Unpin panel" : "Pin panel", "toggle-pin", () => {
    _handlePinToggle(panelId);
  });

  addItem(
    isLocked ? "Unlock Panel Positions" : "Lock Panel Positions",
    "toggle-lock",
    () => {
      togglePanelPositionsLock();
    }
  );

  addItem("Panel Locations: Save Current…", "save-panel-locations", () => {
    promptAndSavePanelLocationPreset();
  });

  for (const preset of presets) {
    const row = addItem(
      `Apply: ${preset.name}`,
      "apply-panel-locations",
      () => {
        applyPanelLocationPreset(preset.name);
      },
      { presetName: preset.name }
    );
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "sidebar-ctx-preset-delete";
    delBtn.dataset.action = "delete-panel-locations";
    delBtn.dataset.presetName = preset.name;
    delBtn.title = `Delete preset "${preset.name}"`;
    delBtn.setAttribute("aria-label", `Delete preset ${preset.name}`);
    delBtn.textContent = "×";
    delBtn.style.cssText =
      "background:none;border:none;color:var(--text-secondary,#888);cursor:pointer;padding:0 4px;font-size:13px;line-height:1;";
    let delFired = false;
    const onDelete = (e: Event) => {
      if (delFired) return;
      delFired = true;
      e.stopPropagation();
      deletePanelLocationPreset(preset.name);
      closeMenu();
    };
    delBtn.addEventListener("mousedown", onDelete);
    delBtn.addEventListener("click", onDelete);
    row.appendChild(delBtn);
  }

  addItem("Reset to Default Panel Locations", "reset-panel-locations", () => {
    resetPanelLocationsToDefault();
  });

  document.body.appendChild(menu);

  function outside(e: MouseEvent): void {
    if (!menu.contains(e.target as Node)) {
      closeMenu();
    }
  }
  setTimeout(() => document.addEventListener("mousedown", outside), 0);
}

function _buildIconButton(
  panelId: string,
  panel: RegisteredPanel
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "sidebar-icon-btn";
  btn.dataset.panelId = panelId;

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
  btn.addEventListener("click", () => {
    const currentSide = registeredPanels.get(panelId)?.effectiveSide ?? panel.effectiveSide;
    _handleIconBtnClick(currentSide, panelId);
  });
  return btn;
}

function _handleIconBtnClick(side: DockSide, panelId: string): void {
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

function _setIconized(side: DockSide, panelId: string, iconized: boolean): void {
  const panel = registeredPanels.get(panelId);
  if (!panel) return;

  panel.wrapperEl.classList.toggle("is-iconized", iconized);
  panel.wrapperEl.style.display = iconized ? "none" : "";
  panel.iconBtnEl?.classList.toggle("is-active", !iconized);

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
      ...(s.sidebar?.[side] ?? _defaultSlotForSide(side)),
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
      ...(s.sidebar?.[side] ?? _defaultSlotForSide(side)),
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

function _restoreIconizedFromSettings(panelId: string, side: DockSide): void {
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

export function iconizeNonPinnedOrToggle(side: DockSide): void {
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

function _buildPanelsRecord(
  side: DockSide
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
      pinned: p.wrapperEl.classList.contains("is-pinned") || (existing?.pinned ?? false),
    };
  });

  return record;
}

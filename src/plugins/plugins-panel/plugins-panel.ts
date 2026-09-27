/**
 * Plugins Panel — pack sections from flavors/packs.json, then User Plugins.
 *
 * Each flavor shows the same packs; `enabledPacks` only changes order and
 * which sections start expanded. Core plugins show a version badge and may
 * show an "Overridden" badge when a user file shadows them. Pack headers
 * have an Off / Default / All preset. The User Plugins section has Reload,
 * not a preset.
 *
 * Public API (unchanged from step_03b):
 *   - createPluginsPanel(defs, states, toggle, reloadPlugins?)
 *   - openPluginsPanel(states)
 *   - closePluginsPanel()
 *   - togglePluginsPanel(states)
 *   - updatePluginStates(partial)
 *   - updateUserPluginDefs(defs, states)
 */

import "./plugins-panel.css";
import type { UnifiedPluginDef } from "../index";
import {
  PACKS,
  getActiveFlavor,
  orderedPluginPackIds,
  pluginDefaultEnabled,
  pluginSectionStartsCollapsed,
} from "../../lib/flavor";
import { getCurrentSettings } from "../../lib/settings";
import { movePanelToSide } from "../../sidebar";
import { attachModalKeyboard } from "../../lib/modal-keyboard";

// ── Module-level state ────────────────────────────────────────────────────────

/** The panel overlay element (null until createPluginsPanel is called). */
let panelElement: HTMLElement | null = null;
let bodyElement: HTMLElement | null = null;
let titleElement: HTMLElement | null = null;
let isOpen = false;
let currentView: "list" | "detail" = "list";

/** All plugin definitions, in load order. */
let definitions: UnifiedPluginDef[] = [];
/** Current enable/disable state map. */
let currentStates: Record<string, boolean> = {};
/** Toggle callback wired by createPluginsPanel. */
let onToggle: ((id: string, enabled: boolean) => Promise<void>) | null = null;
/** Reload callback wired by createPluginsPanel (optional). */
let onReload: (() => Promise<void>) | null = null;

/** Detach handle for the keyboard helper while the panel is open. */
let keyboardDetach: (() => void) | null = null;

/**
 * Per-section collapsed state (session-only, not persisted to settings).
 * Keys are pack ids plus `"user"`. A missing key means "use the first-run
 * default": first-run packs start open; other packs and User start collapsed.
 */
const sectionCollapsed: Record<string, boolean> = {};

function isSectionCollapsed(sectionId: string): boolean {
  if (Object.prototype.hasOwnProperty.call(sectionCollapsed, sectionId)) {
    return sectionCollapsed[sectionId];
  }
  return pluginSectionStartsCollapsed(sectionId);
}

function pluginFilenameStem(filename: string): string {
  return filename.replace(/\.js$/i, "");
}

type SectionPreset = "off" | "default" | "all";

function isToggleable(def: UnifiedPluginDef): boolean {
  return def.status === "loaded";
}

function defDefaultEnabled(def: UnifiedPluginDef): boolean {
  if (pluginDefaultEnabled(def.id)) return true;
  const stem = pluginFilenameStem(def.filename);
  return stem !== def.id && pluginDefaultEnabled(stem);
}

function sectionPresetState(defs: UnifiedPluginDef[]): SectionPreset | "custom" | "empty" {
  const toggleable = defs.filter(isToggleable);
  if (toggleable.length === 0) return "empty";
  const allOff = toggleable.every((d) => !currentStates[d.id]);
  const allOn = toggleable.every((d) => currentStates[d.id]);
  const isDefault = toggleable.every((d) => currentStates[d.id] === defDefaultEnabled(d));
  if (allOff) return "off";
  if (allOn) return "all";
  if (isDefault) return "default";
  return "custom";
}

function applySectionPresetButtons(group: HTMLElement, defs: UnifiedPluginDef[]): void {
  const state = sectionPresetState(defs);
  const empty = state === "empty";
  for (const btn of group.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
    btn.disabled = empty;
    btn.classList.toggle("active", !empty && btn.dataset.preset === state);
  }
}

function presetTarget(def: UnifiedPluginDef, preset: SectionPreset): boolean {
  if (preset === "all") return true;
  if (preset === "off") return false;
  return defDefaultEnabled(def);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Inject the plugins panel into the DOM. Call once during initApp().
 * The panel is hidden by default; open it with togglePluginsPanel().
 *
 * @param defs          Unified plugin metadata from pluginManager.getDefinitions().
 * @param states        Current plugin states from pluginManager.getStates().
 * @param toggle        Called when user toggles a plugin (unified callback).
 * @param reloadPlugins Optional: called when user clicks "Reload" in User Plugins section.
 *                      When omitted the Reload button is rendered but disabled.
 */
export function createPluginsPanel(
  defs: UnifiedPluginDef[],
  states: Record<string, boolean>,
  toggle: (id: string, enabled: boolean) => Promise<void>,
  reloadPlugins?: () => Promise<void>,
): void {
  definitions = defs;
  currentStates = { ...states };
  onToggle = toggle;
  onReload = reloadPlugins ?? null;

  const overlay = document.createElement("div");
  overlay.id = "plugins-overlay";
  overlay.className = "settings-overlay hidden";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Plugins");
  overlay.setAttribute("aria-hidden", "true");

  overlay.innerHTML = `
    <div class="settings-backdrop"></div>
    <div class="settings-panel" tabindex="-1">
      <div class="settings-header">
        <h2 class="settings-title" id="plugins-title">Plugins</h2>
        <button class="settings-close-btn" aria-label="Close">&times;</button>
      </div>
      <div class="settings-body" id="plugins-body"></div>
    </div>
  `;

  document.body.appendChild(overlay);
  panelElement = overlay;
  bodyElement = overlay.querySelector("#plugins-body");
  titleElement = overlay.querySelector("#plugins-title");

  overlay.querySelector(".settings-backdrop")
    ?.addEventListener("click", closePluginsPanel);
  overlay.querySelector(".settings-close-btn")
    ?.addEventListener("click", closePluginsPanel);

}

/**
 * Open the panel, seeding it with current plugin states.
 *
 * @param states  Map of plugin id → enabled boolean (unified).
 */
export function openPluginsPanel(states: Record<string, boolean>): void {
  if (!panelElement) return;
  currentStates = { ...states };
  showListView();
  panelElement.classList.remove("hidden");
  panelElement.setAttribute("aria-hidden", "false");
  isOpen = true;
  keyboardDetach = attachModalKeyboard({
    modal: panelElement,
    // In detail view, Escape steps back to the list before fully closing.
    onClose: () => {
      if (currentView === "detail") showListView();
      else closePluginsPanel();
    },
  });
}

/** Close the plugins panel. */
export function closePluginsPanel(): void {
  if (!panelElement) return;
  panelElement.classList.add("hidden");
  panelElement.setAttribute("aria-hidden", "true");
  isOpen = false;
  currentView = "list";
  keyboardDetach?.();
  keyboardDetach = null;
}

/**
 * Toggle the plugins panel open/closed.
 *
 * @param states  Current plugin states (only used when opening).
 */
export function togglePluginsPanel(states: Record<string, boolean>): void {
  if (isOpen) closePluginsPanel();
  else openPluginsPanel(states);
}

/**
 * Update internal plugin states from outside (e.g. when a plugin auto-enables
 * another). If the panel is currently showing the list view, re-renders it so
 * toggles reflect the new state immediately.
 *
 * EC-10: Guards on panelElement — safe to call before createPluginsPanel has run.
 *
 * @param partial  Partial state update (merged into currentStates).
 */
export function updatePluginStates(partial: Record<string, boolean>): void {
  if (!panelElement) return;
  Object.assign(currentStates, partial);
  if (isOpen && currentView === "list") {
    showListView();
  }
}

/**
 * Update plugin definitions and states without closing the panel.
 *
 * Called by main.ts after a Reload completes to refresh the plugin list.
 * Safe to call before createPluginsPanel has been called (guard on panelElement).
 *
 * @param defs       New plugin definitions from pluginManager.getDefinitions().
 * @param states     New plugin states from pluginManager.getStates().
 */
export function updateUserPluginDefs(
  defs: UnifiedPluginDef[],
  states: Record<string, boolean>,
): void {
  definitions = defs;
  Object.assign(currentStates, states);
  if (isOpen && currentView === "list") {
    showListView();
  }
}

// ── List View ─────────────────────────────────────────────────────────────────

/**
 * Build a footer row containing the "Manage Vaults" button.
 *
 * The button delegates to the file-browser plugin via the window global
 * __MARKABLE_OPEN_MANAGE_VAULTS__ so plugins-panel.ts has no direct import
 * dependency on file-browser.plugin.ts. This follows the same decoupling
 * pattern used by __MARKABLE_COMMAND_BAR_OPEN__ and __MARKABLE_TEMPLATES__.
 *
 * EC-VUX-09: closePluginsPanel() is called first so the two panels do not
 * overlap. openManageVaultsModal() appends to document.body which is always
 * accessible regardless of panel state.
 *
 * This function is only called from showListView() when the global is present,
 * so the button is hidden automatically when the file-browser plugin is off.
 */
function buildManageVaultsFooter(): HTMLElement {
  const footer = document.createElement("div");
  footer.className = "plugin-panel-footer";

  const btn = document.createElement("button");
  btn.className = "btn btn-tertiary plugin-panel-footer-btn";
  btn.textContent = "Manage Vaults";
  btn.addEventListener("click", () => {
    closePluginsPanel();
    const openVaultFn = (window as any).__MARKABLE_OPEN_MANAGE_VAULTS__;
    if (typeof openVaultFn === "function") openVaultFn();
  });

  footer.appendChild(btn);
  return footer;
}

/**
 * Render pack sections (flavor order) then User Plugins.
 * Each section is collapsible (session state in sectionCollapsed).
 *
 * Pack membership comes from packs.json. Unlisted core IIFEs append to Base
 * so they stay visible. User IIFEs always stay in User.
 */
function showListView(): void {
  if (!bodyElement || !titleElement) return;
  currentView = "list";
  titleElement.textContent = "Plugins";
  bodyElement.innerHTML = "";

  const flavor = getActiveFlavor();
  const packIds = orderedPluginPackIds(flavor);
  const assigned = new Set<string>();
  const leftover: UnifiedPluginDef[] = [];
  const byPack = new Map<string, UnifiedPluginDef[]>();

  for (const packId of packIds) {
    const pack = PACKS.packs[packId];
    const defs: UnifiedPluginDef[] = [];
    if (pack !== undefined) {
      for (const pluginId of pack.plugins) {
        const def = definitions.find((d) =>
          d.kind !== "user" &&
          (d.id === pluginId || pluginFilenameStem(d.filename) === pluginId),
        );
        if (def === undefined) continue;
        defs.push(def);
        assigned.add(def.id);
      }
    }
    byPack.set(packId, defs);
  }

  for (const def of definitions) {
    if (def.kind === "user") continue;
    if (assigned.has(def.id)) continue;
    leftover.push(def);
  }
  if (leftover.length > 0) {
    const base = byPack.get("base") ?? [];
    base.push(...leftover);
    byPack.set("base", base);
  }

  for (const packId of packIds) {
    const pack = PACKS.packs[packId];
    const label = pack?.displayName ?? packId;
    bodyElement.appendChild(buildSection(packId, label, byPack.get(packId) ?? []));
  }

  const userDefs = definitions.filter((d) => d.kind === "user");
  bodyElement.appendChild(buildSection("user", "User Plugins", userDefs));

  /*
   * step_05: Append the "Manage Vaults" footer button only when the file-browser
   * plugin is enabled (i.e. the global is registered). The panel re-renders each
   * time it opens via showListView(), so the footer tracks the plugin's live state
   * without explicit enable/disable hooks here.
   */
  const openFn = (window as any).__MARKABLE_OPEN_MANAGE_VAULTS__;
  if (typeof openFn === "function") {
    bodyElement.appendChild(buildManageVaultsFooter());
  }
}

// ── Section builder ───────────────────────────────────────────────────────────

/**
 * Build a collapsible section for a pack id or `"user"`.
 *
 * Section layout:
 *   [header: chevron + label  |  (Off/Default/All if pack) (Reload if user)]
 *   [body: plugin rows or empty placeholder]
 *
 * The left portion of the header is clickable to toggle collapse.
 * The preset control and Reload stop propagation so they do not collapse.
 */
function buildSection(
  sectionId: string,
  label: string,
  defs: UnifiedPluginDef[],
): HTMLElement {
  const isUser = sectionId === "user";
  const collapsed = isSectionCollapsed(sectionId);
  const section = document.createElement("div");
  section.className = "plugin-section";
  section.dataset.sectionId = sectionId;

  const header = document.createElement("div");
  header.className = "plugin-section-header";

  const leftGroup = document.createElement("div");
  leftGroup.className = "plugin-section-header-left";

  const chevron = document.createElement("span");
  chevron.className = "plugin-section-chevron";
  chevron.textContent = collapsed ? "\u25B6" : "\u25BC";

  const title = document.createElement("span");
  title.className = "plugin-section-title";
  title.textContent = label;

  leftGroup.append(chevron, title);
  header.appendChild(leftGroup);

  if (!isUser) {
    header.appendChild(buildSectionPreset(label, defs));
  }

  if (isUser) {
    const reloadBtn = document.createElement("button");
    reloadBtn.className = "plugin-reload-btn";
    reloadBtn.textContent = "Reload";
    reloadBtn.disabled = onReload === null;
    reloadBtn.title = onReload === null
      ? "Reload not available"
      : "Rescan the user plugins directory";
    reloadBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!onReload) return;
      reloadBtn.disabled = true;
      reloadBtn.textContent = "Reloading\u2026";
      try {
        await onReload();
      } finally {
        reloadBtn.disabled = false;
        reloadBtn.textContent = "Reload";
      }
    });
    header.appendChild(reloadBtn);
  }

  const body = document.createElement("div");
  body.className = "plugin-section-body";
  if (collapsed) {
    body.classList.add("plugin-section-body--collapsed");
  }

  leftGroup.addEventListener("click", () => {
    const next = !isSectionCollapsed(sectionId);
    sectionCollapsed[sectionId] = next;
    chevron.textContent = next ? "\u25B6" : "\u25BC";
    body.classList.toggle("plugin-section-body--collapsed", next);
  });

  if (defs.length === 0) {
    const placeholder = document.createElement("p");
    placeholder.className = "plugin-empty-placeholder";
    placeholder.textContent = isUser
      ? "No user plugins installed."
      : `No ${label} plugins loaded.`;
    body.appendChild(placeholder);
  } else {
    const syncPreset = (): void => {
      const group = section.querySelector(".plugin-section-preset");
      if (group instanceof HTMLElement) applySectionPresetButtons(group, defs);
    };
    for (const def of defs) {
      body.appendChild(buildRow(def, !isUser, syncPreset));
    }
  }

  section.append(header, body);
  return section;
}

/**
 * Pack-section Off / Default / All control. Lives on the header right so it
 * does not steal the collapse click.
 */
function buildSectionPreset(label: string, defs: UnifiedPluginDef[]): HTMLElement {
  const group = document.createElement("div");
  group.className = "plugin-section-preset";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", `${label} section preset`);

  const labels: Array<[SectionPreset, string]> = [
    ["off", "Off"],
    ["default", "Default"],
    ["all", "All"],
  ];
  for (const [preset, text] of labels) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "plugin-section-preset-btn";
    btn.dataset.preset = preset;
    btn.textContent = text;
    btn.title =
      preset === "off" ? "Turn all plugins in this section off"
      : preset === "all" ? "Turn all plugins in this section on"
      : "Restore this section's first-run defaults";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const toggleable = defs.filter(isToggleable);
      if (toggleable.length === 0) return;
      void (async () => {
        for (const def of toggleable) {
          const target = presetTarget(def, preset);
          if (currentStates[def.id] === target) continue;
          currentStates[def.id] = target;
          await onToggle?.(def.id, target);
        }
        showListView();
      })();
    });
    group.appendChild(btn);
  }

  applySectionPresetButtons(group, defs);
  group.addEventListener("click", (e) => {
    e.stopPropagation();
  });
  return group;
}

// ── Row dispatcher ─────────────────────────────────────────────────────────────

/**
 * Dispatch to the appropriate row builder based on status.
 *
 * @param def          Plugin definition to render.
 * @param showVersion  Whether to show the version badge (pack sections).
 * @param onToggled    Called after a loaded-row toggle so the master can resync.
 */
function buildRow(
  def: UnifiedPluginDef,
  showVersion: boolean,
  onToggled?: () => void,
): HTMLElement {
  if (def.status === "failed") {
    return buildFailedRow(def);
  }
  if (def.status === "missing") {
    return buildMissingRow(def);
  }
  if (def.status === "overridden") {
    return buildOverriddenRow(def);
  }
  const enabled = currentStates[def.id] ?? false;
  return buildPluginRow(def, enabled, showVersion, onToggled);
}

// ── Row builders ──────────────────────────────────────────────────────────────

/**
 * Build a standard loaded plugin row: name (clickable → detail view),
 * optional version badge (core plugins only), and a toggle switch.
 *
 * The version badge is shown only for core plugins because user plugins may
 * not declare a version and its absence would be confusing in context.
 *
 * @param def          The plugin definition to render.
 * @param enabled      Whether the plugin is currently enabled.
 * @param showVersion  Whether to show the version badge (pack sections).
 * @param onToggled    Called after the row toggle so the section master can resync.
 */
function buildPluginRow(
  def: UnifiedPluginDef,
  enabled: boolean,
  showVersion: boolean,
  onToggled?: () => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "plugin-row";

  const nameEl = document.createElement("div");
  nameEl.className = "plugin-name plugin-name-clickable";

  const nameText = document.createElement("span");
  nameText.textContent = def.name;
  nameEl.appendChild(nameText);

  if (showVersion && def.version) {
    const versionBadge = document.createElement("span");
    versionBadge.className = "plugin-version-badge";
    versionBadge.textContent = `v${def.version}`;
    nameEl.appendChild(versionBadge);
  }

  nameEl.addEventListener("click", () => showDetailView(def));

  const toggle = document.createElement("label");
  toggle.className = "plugin-toggle";
  toggle.innerHTML = `
    <input type="checkbox" ${enabled ? "checked" : ""}>
    <span class="plugin-toggle-track"></span>
    <span class="plugin-toggle-thumb"></span>
  `;

  const checkbox = toggle.querySelector("input") as HTMLInputElement;
  checkbox.addEventListener("change", () => {
    currentStates[def.id] = checkbox.checked;
    void onToggle?.(def.id, checkbox.checked);
    onToggled?.();
  });

  row.append(nameEl, toggle);
  return row;
}

/**
 * Build a failed-plugin row: name text + red "(failed)" badge.
 * Clicking opens the detail view showing the error text.
 * No toggle — the plugin cannot be enabled.
 */
function buildFailedRow(def: UnifiedPluginDef): HTMLElement {
  const row = document.createElement("div");
  row.className = "plugin-row plugin-row-failed";

  const nameEl = document.createElement("div");
  nameEl.className = "plugin-name plugin-name-clickable";

  const nameText = document.createElement("span");
  nameText.textContent = def.name;

  const badge = document.createElement("span");
  badge.className = "plugin-status-badge plugin-status-failed";
  badge.textContent = "failed";
  if (def.failReason) badge.title = def.failReason;

  nameEl.append(nameText, badge);
  nameEl.addEventListener("click", () => showDetailView(def));
  row.appendChild(nameEl);
  return row;
}

/**
 * Build a missing-plugin row: name text + grey "(missing)" badge.
 * No toggle and no click handler — the file no longer exists on disk.
 */
function buildMissingRow(def: UnifiedPluginDef): HTMLElement {
  const row = document.createElement("div");
  row.className = "plugin-row plugin-row-missing";

  const nameEl = document.createElement("div");
  nameEl.className = "plugin-name";

  const nameText = document.createElement("span");
  nameText.textContent = def.name;

  const badge = document.createElement("span");
  badge.className = "plugin-status-badge plugin-status-missing";
  badge.textContent = "missing";
  badge.title = "Plugin file was deleted. Entry will be removed on next launch.";

  nameEl.append(nameText, badge);
  row.appendChild(nameEl);
  return row;
}

/**
 * Build an overridden core-plugin row: name text + amber "(overridden)" badge.
 * No toggle — the core slot is superseded by a user file with the same filename.
 * The greyed text communicates that this row is inactive.
 *
 * FR-9: The badge tooltip must name the specific user file that is shadowing
 * this core slot so the user knows exactly which file to look at. The filename
 * is available on UnifiedPluginDef.filename (added in Chunk 4 review fix).
 *
 * @param def  The core plugin definition whose slot has been overridden.
 */
function buildOverriddenRow(def: UnifiedPluginDef): HTMLElement {
  const row = document.createElement("div");
  row.className = "plugin-row plugin-row-overridden";

  const nameEl = document.createElement("div");
  nameEl.className = "plugin-name";

  const nameText = document.createElement("span");
  nameText.textContent = def.name;

  const badge = document.createElement("span");
  badge.className = "plugin-status-badge plugin-status-overridden";
  badge.textContent = "overridden";
  // FR-9: include the specific filename so the user immediately knows which
  // file in their user/ directory is shadowing this core slot.
  badge.title = `Overridden by user plugin: ${def.filename}`;

  nameEl.append(nameText, badge);
  row.appendChild(nameEl);
  return row;
}

// ── Detail View ───────────────────────────────────────────────────────────────

/**
 * Render the detail view for a single plugin: back button, description text,
 * optional version line (loaded plugins), and — for loaded plugins — a toggle.
 *
 * For failed plugins, shows the error text instead of a toggle.
 * For missing/overridden plugins, shows a status message.
 *
 * @param def  The plugin definition whose detail to display.
 */
function showDetailView(def: UnifiedPluginDef): void {
  if (!bodyElement || !titleElement) return;
  currentView = "detail";
  titleElement.textContent = def.name;
  bodyElement.innerHTML = "";

  const backBtn = document.createElement("button");
  backBtn.className = "plugin-back-btn";
  backBtn.textContent = "\u2190 Back";
  backBtn.addEventListener("click", showListView);

  const detail = document.createElement("div");
  detail.className = "plugin-detail";
  detail.textContent = def.detail ?? def.description;

  bodyElement.append(backBtn, detail);

  // Version line shown for all loaded plugins (core and user) that have a version.
  if (def.status === "loaded" && def.version) {
    const versionLine = document.createElement("div");
    versionLine.className = "plugin-detail-version";
    versionLine.textContent = `Version: ${def.version}`;
    bodyElement.appendChild(versionLine);
  }

  // Failed plugins: show error text instead of a toggle.
  if (def.status === "failed") {
    const errorEl = document.createElement("div");
    errorEl.className = "plugin-detail-error";
    errorEl.textContent = def.failReason ?? "Unknown load error.";
    bodyElement.appendChild(errorEl);
    return;
  }

  // Missing plugins: no toggle — the file is gone.
  if (def.status === "missing") {
    const msgEl = document.createElement("div");
    msgEl.className = "plugin-detail-error";
    msgEl.textContent =
      "Plugin file no longer exists on disk. This entry will be removed on next app launch.";
    bodyElement.appendChild(msgEl);
    return;
  }

  // Overridden core slots: no toggle.
  if (def.status === "overridden") {
    const msgEl = document.createElement("div");
    msgEl.className = "plugin-detail-error";
    msgEl.textContent =
      "This core plugin slot is overridden by a user plugin with the same filename.";
    bodyElement.appendChild(msgEl);
    return;
  }

  // Loaded plugins: show a toggle in the detail view.
  const enabled = currentStates[def.id] ?? false;

  const toggleRow = document.createElement("div");
  toggleRow.className = "plugin-detail-toggle";
  toggleRow.innerHTML = `
    <span class="plugin-detail-status">${enabled ? "Enabled" : "Disabled"}</span>
    <label class="plugin-toggle">
      <input type="checkbox" ${enabled ? "checked" : ""}>
      <span class="plugin-toggle-track"></span>
      <span class="plugin-toggle-thumb"></span>
    </label>
  `;

  const checkbox = toggleRow.querySelector("input") as HTMLInputElement;
  const statusEl = toggleRow.querySelector(".plugin-detail-status") as HTMLElement;
  checkbox.addEventListener("change", () => {
    statusEl.textContent = checkbox.checked ? "Enabled" : "Disabled";
    currentStates[def.id] = checkbox.checked;
    void onToggle?.(def.id, checkbox.checked);
  });

  bodyElement.appendChild(toggleRow);

  // ── Sidebar assignment section ──────────────────────────────────────────
  // Only rendered when the plugin declares a sidebarPanelId AND does not
  // supply its own renderDetailExtra (which takes full responsibility for
  // position controls).
  if (def.sidebarPanelId && typeof def.renderDetailExtra !== "function") {
    const panelId = def.sidebarPanelId;

    // Read the persisted side override from settings. When no override exists
    // we don't know the current side without asking SidebarManager, so we
    // default to "right" (the most common default in plugin descriptors).
    //
    // Declared as `let` (not `const`) so click handlers can update it after
    // the user moves the panel. A `const` would keep the stale initial value
    // for the rest of the detail-view session, silently ignoring moves back
    // to the original side because the guard `activeSide !== side` would
    // always evaluate to false after the first successful click.
    let activeSide: "left" | "right" =
      getCurrentSettings().sidebar?.panelSides?.[panelId] ?? "right";

    // Container row: label on the left, two toggle buttons on the right.
    const sideSection = document.createElement("div");
    sideSection.className = "plugin-detail-sidebar-section";

    const label = document.createElement("span");
    label.className = "plugin-detail-sidebar-label";
    label.textContent = "Sidebar";

    const btnLeft = document.createElement("button");
    btnLeft.className =
      "plugin-detail-sidebar-btn" + (activeSide === "left" ? " active" : "");
    btnLeft.textContent = "Left";

    const btnRight = document.createElement("button");
    btnRight.className =
      "plugin-detail-sidebar-btn" + (activeSide === "right" ? " active" : "");
    btnRight.textContent = "Right";

    // Clicking a button moves the panel to the selected side, updates
    // activeSide so subsequent clicks resolve the correct direction, and
    // reflects the new active state on both buttons immediately.
    btnLeft.addEventListener("click", () => {
      if (activeSide !== "left") {
        movePanelToSide(panelId, "left");
        activeSide = "left";
        btnLeft.classList.add("active");
        btnRight.classList.remove("active");
      }
    });

    btnRight.addEventListener("click", () => {
      if (activeSide !== "right") {
        movePanelToSide(panelId, "right");
        activeSide = "right";
        btnRight.classList.add("active");
        btnLeft.classList.remove("active");
      }
    });

    sideSection.appendChild(label);
    sideSection.appendChild(btnLeft);
    sideSection.appendChild(btnRight);
    bodyElement.appendChild(sideSection);
  }

  // ── Plugin-defined extra settings ──────────────────────────────────────
  // Plugins may supply a renderDetailExtra() function to append custom
  // settings rows (e.g. a mode toggle). Called last so it appears below
  // the standard sidebar assignment section.
  if (typeof def.renderDetailExtra === "function") {
    try {
      def.renderDetailExtra(bodyElement);
    } catch (err) {
      console.warn(`[PluginsPanel] renderDetailExtra threw for "${def.id}":`, err);
    }
  }
}

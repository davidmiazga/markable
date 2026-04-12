/**
 * Plugins Panel — toggle FC2 features on/off.
 *
 * List view: plugin name + toggle switch (no descriptions).
 * Detail view: click a plugin row to see full description + back button.
 *
 * The panel no longer owns the plugin definitions list. Definitions are
 * injected via createPluginsPanel(definitions, toggleCallback) so the
 * PluginManager remains the single source of truth (EC-16).
 */

import "./plugins-panel.css";
import type { PluginDef } from "../plugin-types";

// --- State ---

/** The panel overlay element (null until createPluginsPanel is called). */
let panelElement: HTMLElement | null = null;
let bodyElement: HTMLElement | null = null;
let titleElement: HTMLElement | null = null;
let isOpen = false;
let currentView: "list" | "detail" = "list";
let currentStates: Record<string, boolean> = {};
let onToggle: ((pluginId: string, enabled: boolean) => void) | null = null;

/**
 * Plugin definitions injected at createPluginsPanel() time.
 * Stored module-level so showListView() can iterate them without
 * needing to close over the createPluginsPanel call.
 */
let pluginDefinitions: PluginDef[] = [];

// --- Public API ---

/**
 * Inject the plugins panel into the DOM. Call once during initApp().
 * The panel is hidden by default; open it with togglePluginsPanel().
 *
 * EC-9: This function is always called before the panel is needed —
 * pluginManager (module-level const) is initialized by ES module resolution
 * before any importing code runs, so getDefinitions() is always ready.
 *
 * @param definitions     Plugin metadata array from pluginManager.getDefinitions().
 * @param toggleCallback  Called when the user flips a toggle switch.
 */
export function createPluginsPanel(
  definitions: PluginDef[],
  toggleCallback: (pluginId: string, enabled: boolean) => void,
): void {
  pluginDefinitions = definitions;
  onToggle = toggleCallback;

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

  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape" && isOpen) {
      e.preventDefault();
      if (currentView === "detail") {
        showListView();
      } else {
        closePluginsPanel();
      }
    }
  });
}

// --- List View ---

/**
 * Render the list view: one row per plugin with a toggle switch.
 * Iterates pluginDefinitions (injected at createPluginsPanel time).
 */
function showListView(): void {
  if (!bodyElement || !titleElement) return;
  currentView = "list";
  titleElement.textContent = "Plugins";
  bodyElement.innerHTML = "";

  for (const plugin of pluginDefinitions) {
    const enabled = currentStates[plugin.id] ?? false;

    const row = document.createElement("div");
    row.className = "plugin-row";

    const nameEl = document.createElement("div");
    nameEl.className = "plugin-name plugin-name-clickable";
    nameEl.textContent = plugin.name;
    nameEl.addEventListener("click", () => showDetailView(plugin));

    const toggle = document.createElement("label");
    toggle.className = "plugin-toggle";
    toggle.innerHTML = `
      <input type="checkbox" ${enabled ? "checked" : ""}>
      <span class="plugin-toggle-track"></span>
      <span class="plugin-toggle-thumb"></span>
    `;

    const checkbox = toggle.querySelector("input") as HTMLInputElement;
    checkbox.addEventListener("change", () => {
      currentStates[plugin.id] = checkbox.checked;
      onToggle?.(plugin.id, checkbox.checked);
    });

    row.append(nameEl, toggle);
    bodyElement.appendChild(row);
  }
}

// --- Detail View ---

/**
 * Render the detail view for a single plugin: back button, description text,
 * and a toggle switch with enabled/disabled label.
 *
 * @param plugin - The PluginDef whose detail to display.
 */
function showDetailView(plugin: PluginDef): void {
  if (!bodyElement || !titleElement) return;
  currentView = "detail";
  titleElement.textContent = plugin.name;
  bodyElement.innerHTML = "";

  const backBtn = document.createElement("button");
  backBtn.className = "plugin-back-btn";
  backBtn.textContent = "\u2190 Back";
  backBtn.addEventListener("click", showListView);

  const detail = document.createElement("div");
  detail.className = "plugin-detail";
  detail.textContent = plugin.detail;

  const enabled = currentStates[plugin.id] ?? false;
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
    currentStates[plugin.id] = checkbox.checked;
    statusEl.textContent = checkbox.checked ? "Enabled" : "Disabled";
    onToggle?.(plugin.id, checkbox.checked);
  });

  bodyElement.append(backBtn, detail, toggleRow);
}

// --- Open / Close ---

/**
 * Open the plugins panel and seed it with the provided plugin states.
 *
 * @param states - Map of plugin id → enabled boolean from pluginManager.getStates().
 */
export function openPluginsPanel(states: Record<string, boolean>): void {
  if (!panelElement) return;
  currentStates = { ...states };
  showListView();
  panelElement.classList.remove("hidden");
  panelElement.setAttribute("aria-hidden", "false");
  isOpen = true;
  (panelElement.querySelector(".settings-panel") as HTMLElement)?.focus();
}

/** Close the plugins panel. */
export function closePluginsPanel(): void {
  if (!panelElement) return;
  panelElement.classList.add("hidden");
  panelElement.setAttribute("aria-hidden", "true");
  isOpen = false;
  currentView = "list";
}

/**
 * Toggle the plugins panel open/closed.
 *
 * @param states - Current plugin states (only used when opening).
 */
export function togglePluginsPanel(states: Record<string, boolean>): void {
  if (isOpen) closePluginsPanel();
  else openPluginsPanel(states);
}

/**
 * Update internal plugin states from outside (e.g. when a plugin auto-enables
 * the status bar). If the panel is currently showing the list view, re-render
 * it so toggles reflect the new state immediately.
 *
 * EC-10: Guards on panelElement — safe to call before createPluginsPanel has run.
 *
 * @param partial - Partial state update to merge into currentStates.
 */
export function updatePluginStates(partial: Record<string, boolean>): void {
  if (!panelElement) return;
  Object.assign(currentStates, partial);
  if (isOpen && currentView === "list") {
    showListView();
  }
}

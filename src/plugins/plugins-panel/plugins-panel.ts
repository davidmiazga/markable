/**
 * Plugins Panel — two collapsible sections: "Core Plugins" and "User Plugins".
 *
 * After step_04a, the panel renders plugins in two sections determined by
 * UnifiedPluginDef.kind. Core plugins show a version badge and may show an
 * "Overridden" badge when a user file shadows them. The User Plugins section
 * contains a Reload button wired to the reloadPlugins callback.
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
import { getCurrentSettings } from "../../lib/settings";
import { movePanelToSide } from "../../sidebar";

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

/**
 * Guard flag that prevents adding the Escape keydown listener more than once.
 *
 * LOW finding (code review): if createPluginsPanel() were ever called twice
 * (e.g. during hot-reload in development), each call would register a new
 * keydown handler. The handlers cannot be removed because they are anonymous
 * closures. The guard ensures at most one listener is registered per session,
 * regardless of how many times createPluginsPanel() is called.
 */
let keydownListenerRegistered = false;

/**
 * Per-section collapsed state (session-only, not persisted to settings).
 * Both sections start open (collapsed = false) on first load.
 */
const sectionCollapsed: Record<"core" | "user", boolean> = {
  core: false,
  user: false,
};

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

  // Guard against registering the Escape handler more than once if
  // createPluginsPanel() is ever called multiple times in the same session
  // (e.g. during dev hot-reload). Anonymous listeners cannot be removed, so
  // a second registration would double-fire on every keydown event.
  if (!keydownListenerRegistered) {
    keydownListenerRegistered = true;
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
 * Render the two-section list view: "Core Plugins" then "User Plugins".
 * Each section is collapsible (session state in sectionCollapsed).
 */
function showListView(): void {
  if (!bodyElement || !titleElement) return;
  currentView = "list";
  titleElement.textContent = "Plugins";
  bodyElement.innerHTML = "";

  // Split the flat definitions array into core and user buckets.
  const coreDefs = definitions.filter((d) => d.kind === "core");
  const userDefs = definitions.filter((d) => d.kind === "user");

  bodyElement.appendChild(buildSection("core", "Core Plugins", coreDefs));
  bodyElement.appendChild(buildSection("user", "User Plugins", userDefs));
}

// ── Section builder ───────────────────────────────────────────────────────────

/**
 * Build a collapsible section element for the given kind and plugin list.
 *
 * Section layout:
 *   [header: chevron + label  |  (Reload button if user section)]
 *   [body: plugin rows or empty placeholder]
 *
 * The left portion of the header is clickable to toggle collapse.
 * The Reload button (user section only) stops event propagation so clicking
 * it does not also collapse/expand the section.
 *
 * @param kind     "core" | "user" — controls section id and collapse state key.
 * @param label    Human-readable section heading text.
 * @param defs     Plugin definitions for this section.
 */
function buildSection(
  kind: "core" | "user",
  label: string,
  defs: UnifiedPluginDef[],
): HTMLElement {
  const section = document.createElement("div");
  section.className = "plugin-section";

  // Header row: [chevron + label] [reload button (user section only)]
  const header = document.createElement("div");
  header.className = "plugin-section-header";

  const leftGroup = document.createElement("div");
  leftGroup.className = "plugin-section-header-left";

  // Chevron indicator: ▼ when expanded, ▶ when collapsed.
  const chevron = document.createElement("span");
  chevron.className = "plugin-section-chevron";
  chevron.textContent = sectionCollapsed[kind] ? "\u25B6" : "\u25BC";

  const title = document.createElement("span");
  title.className = "plugin-section-title";
  title.textContent = label;

  leftGroup.append(chevron, title);
  header.appendChild(leftGroup);

  // Reload button lives only in the User Plugins section header (right side).
  // It is disabled when no reloadPlugins callback was passed to createPluginsPanel.
  if (kind === "user") {
    const reloadBtn = document.createElement("button");
    reloadBtn.className = "plugin-reload-btn";
    reloadBtn.textContent = "Reload";
    reloadBtn.disabled = onReload === null;
    reloadBtn.title = onReload === null
      ? "Reload not available"
      : "Rescan the user plugins directory";
    reloadBtn.addEventListener("click", async (e) => {
      // Prevent the click from also toggling the section collapse state.
      e.stopPropagation();
      if (!onReload) return;
      // EC-23: disable the button during the async reload to prevent double-click.
      reloadBtn.disabled = true;
      reloadBtn.textContent = "Reloading\u2026";
      try {
        await onReload();
      } finally {
        // showListView() will replace this button on re-render, but restore the
        // text/state defensively in case the re-render does not occur immediately.
        reloadBtn.disabled = false;
        reloadBtn.textContent = "Reload";
      }
    });
    header.appendChild(reloadBtn);
  }

  // Section body wraps all plugin rows. Hidden when the section is collapsed.
  const body = document.createElement("div");
  body.className = "plugin-section-body";
  if (sectionCollapsed[kind]) {
    body.classList.add("plugin-section-body--collapsed");
  }

  // Clicking the left group (chevron + label) toggles section collapse.
  leftGroup.addEventListener("click", () => {
    sectionCollapsed[kind] = !sectionCollapsed[kind];
    chevron.textContent = sectionCollapsed[kind] ? "\u25B6" : "\u25BC";
    body.classList.toggle("plugin-section-body--collapsed", sectionCollapsed[kind]);
  });

  // Populate rows, or show a per-section empty placeholder.
  if (defs.length === 0) {
    const placeholder = document.createElement("p");
    placeholder.className = "plugin-empty-placeholder";
    placeholder.textContent =
      kind === "core" ? "No core plugins loaded." : "No user plugins installed.";
    body.appendChild(placeholder);
  } else {
    for (const def of defs) {
      body.appendChild(buildRow(def, kind));
    }
  }

  section.append(header, body);
  return section;
}

// ── Row dispatcher ─────────────────────────────────────────────────────────────

/**
 * Dispatch to the appropriate row builder based on status.
 *
 * @param def   Plugin definition to render.
 * @param kind  Section kind — passed to buildPluginRow for version badge logic.
 */
function buildRow(def: UnifiedPluginDef, kind: "core" | "user"): HTMLElement {
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
  return buildPluginRow(def, enabled, kind);
}

// ── Row builders ──────────────────────────────────────────────────────────────

/**
 * Build a standard loaded plugin row: name (clickable → detail view),
 * optional version badge (core plugins only), and a toggle switch.
 *
 * The version badge is shown only for core plugins because user plugins may
 * not declare a version and its absence would be confusing in context.
 *
 * @param def      The plugin definition to render.
 * @param enabled  Whether the plugin is currently enabled.
 * @param kind     "core" | "user" — controls whether the version badge is shown.
 */
function buildPluginRow(
  def: UnifiedPluginDef,
  enabled: boolean,
  kind: "core" | "user",
): HTMLElement {
  const row = document.createElement("div");
  row.className = "plugin-row";

  const nameEl = document.createElement("div");
  nameEl.className = "plugin-name plugin-name-clickable";

  const nameText = document.createElement("span");
  nameText.textContent = def.name;
  nameEl.appendChild(nameText);

  // Version badge: shown for core plugins that have a non-empty version string.
  if (kind === "core" && def.version) {
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

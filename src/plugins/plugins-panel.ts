/**
 * Plugins Panel — toggle FC2 features on/off.
 *
 * List view: plugin name + toggle switch (no descriptions).
 * Detail view: click a plugin row to see full description + back button.
 */

import "./plugins-panel.css";

// --- Plugin definitions ---

export interface PluginDef {
  id: string;
  name: string;
  description: string;
  detail: string;
}

const PLUGINS: PluginDef[] = [
  {
    id: "wordCount",
    name: "Word Count",
    description: "Word and character count in the status bar",
    detail: "Displays a live word count and character count in the status bar. Updates as you type. Shows selection count when text is selected.",
  },
  {
    id: "statusBar",
    name: "Status Bar",
    description: "Show a status bar at the bottom of the editor",
    detail: "Adds a status bar at the bottom of the editor window. Other plugins (like Word Count) display their information here. The bar is hidden when no plugins use it.",
  },
  {
    id: "focusMode",
    name: "Focus Mode",
    description: "Dim all content except the current paragraph",
    detail: "Dims all lines except the paragraph containing your cursor, helping you focus on what you're writing. The active paragraph stays at full opacity while everything else fades. Works at the paragraph/block level — code fences and list items are treated as single blocks.",
  },
  {
    id: "typewriterMode",
    name: "Typewriter Mode",
    description: "Keep the cursor line vertically centered",
    detail: "Keeps the line you're typing on vertically centered in the viewport, like a typewriter. Allows blank space above and below at document edges so the cursor is always in the middle of the screen. Can be combined with Focus Mode.",
  },
];

// --- State ---

let panelElement: HTMLElement | null = null;
let bodyElement: HTMLElement | null = null;
let titleElement: HTMLElement | null = null;
let isOpen = false;
let currentView: "list" | "detail" = "list";
let currentStates: Record<string, boolean> = {};
let onToggle: ((pluginId: string, enabled: boolean) => void) | null = null;

// --- Public API ---

export function createPluginsPanel(
  toggleCallback: (pluginId: string, enabled: boolean) => void,
): void {
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

function showListView(): void {
  if (!bodyElement || !titleElement) return;
  currentView = "list";
  titleElement.textContent = "Plugins";
  bodyElement.innerHTML = "";

  for (const plugin of PLUGINS) {
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

export function openPluginsPanel(states: Record<string, boolean>): void {
  if (!panelElement) return;
  currentStates = { ...states };
  showListView();
  panelElement.classList.remove("hidden");
  panelElement.setAttribute("aria-hidden", "false");
  isOpen = true;
  (panelElement.querySelector(".settings-panel") as HTMLElement)?.focus();
}

export function closePluginsPanel(): void {
  if (!panelElement) return;
  panelElement.classList.add("hidden");
  panelElement.setAttribute("aria-hidden", "true");
  isOpen = false;
  currentView = "list";
}

export function togglePluginsPanel(states: Record<string, boolean>): void {
  if (isOpen) closePluginsPanel();
  else openPluginsPanel(states);
}

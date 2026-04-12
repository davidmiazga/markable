# Step 05 — Plugins Panel UI Refactor

**Objective:** Refactor `src/plugins/plugins-panel/plugins-panel.ts` and `plugins-panel.css` to support two collapsible sections ("Built-in Plugins" and "User Plugins"), a Reload button in the User Plugins section header, a folder-path info label, a "No plugins installed" placeholder (EC-19), and a failed-plugin error badge (EC-3).

**Traceability:** Requirements decisions 7 and 8, EC-3, EC-14, EC-17, EC-19, EC-22.

---

## Design Decisions

1. **Collapsible sections** — Each section has a header row with a chevron toggle (`▸` closed / `▾` open). Both sections are open by default; collapse state is not persisted (resets on panel open per Decision 8).

2. **Detail view** — The detail view is shared between built-in and user plugins. It shows the plugin name, full description, enabled/disabled toggle, and — for failed user plugins — a read-only error text instead of a toggle.

3. **Reload button** — Sits in the User Plugins section header, to the right of the "User Plugins" label and chevron. Label: "Reload". While loading, the button is disabled and its label changes to "Loading…".

4. **Folder path label** — A single `<p class="plugin-folder-path">` element rendered at the top of the User Plugins section body (always visible, even when empty). Text: `~/Library/Application Support/com.markable.app/plugins/`. This is the install instruction (Decision 6).

5. **"No plugins installed" placeholder** — Rendered when `userDefs.length === 0` or all entries are `status: "missing"` after filtering (EC-19).

6. **Failed plugin badge** — A row with `status: "failed"` shows a red `(failed)` badge next to the name and a tooltip with `failReason`. Clicking the name shows the detail view with the error text instead of a toggle.

7. **Missing plugin badge** — A row with `status: "missing"` shows a grey `(missing)` badge. No toggle (cannot enable a missing plugin).

---

## Files to Modify

### `src/plugins/plugins-panel/plugins-panel.ts`

The current file is 233 lines. The new file replaces it entirely. Key public API changes:

- `createPluginsPanel(definitions, toggleCallback)` becomes `createPluginsPanel(builtinDefs, userDefs, toggleBuiltin, toggleUser, onReloadPlugins)`.
- `openPluginsPanel(states)` gains an optional second parameter `userStates`.
- `updatePluginStates(partial)` gains an optional second parameter `userPartial`.
- New export: `updateUserPluginDefs(defs, userStates)` — called after reload to re-render the user section without closing the panel.

All existing exports (`createPluginsPanel`, `openPluginsPanel`, `closePluginsPanel`, `togglePluginsPanel`, `updatePluginStates`) must remain exported with backward-compatible behaviour where possible.

Full replacement:

```typescript
/**
 * Plugins Panel — two collapsible sections: Built-in Plugins and User Plugins.
 *
 * Built-in section: existing list/detail view (unchanged behaviour).
 * User Plugins section: loaded + failed + missing entries; Reload button;
 *   folder path label; "No plugins installed" placeholder.
 *
 * createPluginsPanel() signature has changed — see below.
 */

import "./plugins-panel.css";
import type { PluginDef } from "../plugin-types";
import type { UserPluginDef } from "../user-plugin-types";

// ── Module-level state ────────────────────────────────────────────────────────

let panelElement: HTMLElement | null = null;
let bodyElement: HTMLElement | null = null;
let titleElement: HTMLElement | null = null;
let isOpen = false;
let currentView: "list" | "detail" = "list";

// Built-in plugins
let builtinDefinitions: PluginDef[] = [];
let currentBuiltinStates: Record<string, boolean> = {};
let onToggleBuiltin: ((id: string, enabled: boolean) => void) | null = null;

// User plugins
let userDefinitions: UserPluginDef[] = [];
let currentUserStates: Record<string, boolean> = {};
let onToggleUser: ((id: string, enabled: boolean) => void) | null = null;
let onReloadPlugins: (() => Promise<void>) | null = null;

// Section collapse state (not persisted — always open on panel launch)
let builtinSectionOpen = true;
let userSectionOpen = true;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Inject the plugins panel into the DOM. Call once during initApp().
 *
 * @param builtinDefs    Built-in plugin metadata from pluginManager.getDefinitions().
 * @param userDefs       User plugin metadata from pluginManager.getUserDefinitions().
 * @param toggleBuiltin  Called when user toggles a built-in plugin.
 * @param toggleUser     Called when user toggles a user plugin.
 * @param reloadPlugins  Called when user clicks "Reload" in the User Plugins section.
 */
export function createPluginsPanel(
  builtinDefs: PluginDef[],
  userDefs: UserPluginDef[],
  toggleBuiltin: (id: string, enabled: boolean) => void,
  toggleUser: (id: string, enabled: boolean) => void,
  reloadPlugins: () => Promise<void>,
): void {
  builtinDefinitions = builtinDefs;
  userDefinitions = userDefs;
  onToggleBuiltin = toggleBuiltin;
  onToggleUser = toggleUser;
  onReloadPlugins = reloadPlugins;

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

/**
 * Open the panel, seeding it with current plugin states.
 *
 * @param builtinStates  Map of built-in plugin id → enabled boolean.
 * @param userStates     Map of user plugin id → enabled boolean.
 */
export function openPluginsPanel(
  builtinStates: Record<string, boolean>,
  userStates: Record<string, boolean> = {},
): void {
  if (!panelElement) return;
  // Reset section collapse on each open (Decision 8).
  builtinSectionOpen = true;
  userSectionOpen = true;
  currentBuiltinStates = { ...builtinStates };
  currentUserStates = { ...userStates };
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

export function togglePluginsPanel(
  builtinStates: Record<string, boolean>,
  userStates: Record<string, boolean> = {},
): void {
  if (isOpen) closePluginsPanel();
  else openPluginsPanel(builtinStates, userStates);
}

/**
 * Update internal plugin states from outside (e.g. status bar auto-enable).
 * If the panel is open on the list view, re-renders immediately.
 */
export function updatePluginStates(
  builtinPartial: Record<string, boolean>,
  userPartial: Record<string, boolean> = {},
): void {
  if (!panelElement) return;
  Object.assign(currentBuiltinStates, builtinPartial);
  Object.assign(currentUserStates, userPartial);
  if (isOpen && currentView === "list") {
    showListView();
  }
}

/**
 * Update user plugin definitions and states without closing the panel.
 * Called by main.ts after a Reload completes to refresh the User Plugins section.
 *
 * @param defs       New user plugin definitions from pluginManager.getUserDefinitions().
 * @param userStates New user plugin states from pluginManager.getUserStates().
 */
export function updateUserPluginDefs(
  defs: UserPluginDef[],
  userStates: Record<string, boolean>,
): void {
  userDefinitions = defs;
  Object.assign(currentUserStates, userStates);
  if (isOpen && currentView === "list") {
    showListView();
  }
}

// ── List View ─────────────────────────────────────────────────────────────────

function showListView(): void {
  if (!bodyElement || !titleElement) return;
  currentView = "list";
  titleElement.textContent = "Plugins";
  bodyElement.innerHTML = "";

  bodyElement.appendChild(buildBuiltinSection());
  bodyElement.appendChild(buildUserSection());
}

// ── Built-in section ──────────────────────────────────────────────────────────

function buildBuiltinSection(): HTMLElement {
  const section = document.createElement("div");
  section.className = "plugin-section";

  // Section header with chevron
  const header = document.createElement("div");
  header.className = "plugin-section-header";
  header.innerHTML = `
    <span class="plugin-section-chevron">${builtinSectionOpen ? "&#9662;" : "&#9656;"}</span>
    <span class="plugin-section-title">Built-in Plugins</span>
  `;
  header.addEventListener("click", () => {
    builtinSectionOpen = !builtinSectionOpen;
    showListView();
  });
  section.appendChild(header);

  if (!builtinSectionOpen) return section;

  const body = document.createElement("div");
  body.className = "plugin-section-body";

  for (const plugin of builtinDefinitions) {
    const enabled = currentBuiltinStates[plugin.id] ?? false;
    body.appendChild(buildPluginRow(plugin, enabled, "builtin"));
  }

  section.appendChild(body);
  return section;
}

// ── User Plugins section ──────────────────────────────────────────────────────

function buildUserSection(): HTMLElement {
  const section = document.createElement("div");
  section.className = "plugin-section";

  // Section header with chevron and Reload button
  const header = document.createElement("div");
  header.className = "plugin-section-header";

  const chevronAndTitle = document.createElement("div");
  chevronAndTitle.className = "plugin-section-header-left";
  chevronAndTitle.innerHTML = `
    <span class="plugin-section-chevron">${userSectionOpen ? "&#9662;" : "&#9656;"}</span>
    <span class="plugin-section-title">User Plugins</span>
  `;
  chevronAndTitle.addEventListener("click", () => {
    userSectionOpen = !userSectionOpen;
    showListView();
  });

  const reloadBtn = document.createElement("button");
  reloadBtn.className = "plugin-reload-btn";
  reloadBtn.textContent = "Reload";
  reloadBtn.addEventListener("click", async (e) => {
    e.stopPropagation(); // prevent chevron toggle
    reloadBtn.disabled = true;
    reloadBtn.textContent = "Loading\u2026";
    try {
      await onReloadPlugins?.();
    } finally {
      reloadBtn.disabled = false;
      reloadBtn.textContent = "Reload";
    }
  });

  header.appendChild(chevronAndTitle);
  header.appendChild(reloadBtn);
  section.appendChild(header);

  if (!userSectionOpen) return section;

  const body = document.createElement("div");
  body.className = "plugin-section-body";

  // Folder path info label (always shown — Decision 6)
  const folderLabel = document.createElement("p");
  folderLabel.className = "plugin-folder-path";
  folderLabel.textContent =
    "Install: copy .js files to ~/Library/Application Support/com.markable.app/plugins/";
  body.appendChild(folderLabel);

  // Filter out missing plugins for display count purposes
  const visibleDefs = userDefinitions.filter((d) => d.status !== "missing");

  if (visibleDefs.length === 0) {
    // EC-19: placeholder
    const placeholder = document.createElement("p");
    placeholder.className = "plugin-empty-placeholder";
    placeholder.textContent = "No plugins installed.";
    body.appendChild(placeholder);
  } else {
    for (const plugin of userDefinitions) {
      if (plugin.status === "missing") {
        // EC-17: show missing badge but no toggle
        body.appendChild(buildMissingPluginRow(plugin));
      } else if (plugin.status === "failed") {
        body.appendChild(buildFailedPluginRow(plugin));
      } else {
        const enabled = currentUserStates[plugin.id] ?? false;
        body.appendChild(buildPluginRow(plugin, enabled, "user"));
      }
    }
  }

  section.appendChild(body);
  return section;
}

// ── Row builders ──────────────────────────────────────────────────────────────

function buildPluginRow(
  plugin: PluginDef | UserPluginDef,
  enabled: boolean,
  kind: "builtin" | "user",
): HTMLElement {
  const row = document.createElement("div");
  row.className = "plugin-row";

  const nameEl = document.createElement("div");
  nameEl.className = "plugin-name plugin-name-clickable";
  nameEl.textContent = plugin.name;
  nameEl.addEventListener("click", () => showDetailView(plugin, kind));

  const toggle = document.createElement("label");
  toggle.className = "plugin-toggle";
  toggle.innerHTML = `
    <input type="checkbox" ${enabled ? "checked" : ""}>
    <span class="plugin-toggle-track"></span>
    <span class="plugin-toggle-thumb"></span>
  `;

  const checkbox = toggle.querySelector("input") as HTMLInputElement;
  checkbox.addEventListener("change", () => {
    if (kind === "builtin") {
      currentBuiltinStates[plugin.id] = checkbox.checked;
      onToggleBuiltin?.(plugin.id, checkbox.checked);
    } else {
      currentUserStates[plugin.id] = checkbox.checked;
      onToggleUser?.(plugin.id, checkbox.checked);
    }
  });

  row.append(nameEl, toggle);
  return row;
}

function buildFailedPluginRow(plugin: UserPluginDef): HTMLElement {
  const row = document.createElement("div");
  row.className = "plugin-row plugin-row-failed";

  const nameEl = document.createElement("div");
  nameEl.className = "plugin-name plugin-name-clickable";

  const nameText = document.createElement("span");
  nameText.textContent = plugin.name;

  const badge = document.createElement("span");
  badge.className = "plugin-status-badge plugin-status-failed";
  badge.textContent = "failed";
  if (plugin.failReason) {
    badge.title = plugin.failReason;
  }

  nameEl.append(nameText, badge);
  nameEl.addEventListener("click", () => showDetailView(plugin, "user"));

  row.appendChild(nameEl);
  return row;
}

function buildMissingPluginRow(plugin: UserPluginDef): HTMLElement {
  const row = document.createElement("div");
  row.className = "plugin-row plugin-row-missing";

  const nameEl = document.createElement("div");
  nameEl.className = "plugin-name";

  const nameText = document.createElement("span");
  nameText.textContent = plugin.name;

  const badge = document.createElement("span");
  badge.className = "plugin-status-badge plugin-status-missing";
  badge.textContent = "missing";
  badge.title = "Plugin file was deleted. Entry will be removed on next launch.";

  nameEl.append(nameText, badge);
  row.appendChild(nameEl);
  return row;
}

// ── Detail View ───────────────────────────────────────────────────────────────

function showDetailView(plugin: PluginDef | UserPluginDef, kind: "builtin" | "user"): void {
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
  detail.textContent = plugin.detail ?? plugin.description;

  bodyElement.append(backBtn, detail);

  // For failed user plugins: show error text instead of toggle.
  const userPlugin = plugin as UserPluginDef;
  if (kind === "user" && userPlugin.status === "failed") {
    const errorEl = document.createElement("div");
    errorEl.className = "plugin-detail-error";
    errorEl.textContent = userPlugin.failReason ?? "Unknown load error.";
    bodyElement.appendChild(errorEl);
    return;
  }

  // Missing plugins: no toggle either.
  if (kind === "user" && userPlugin.status === "missing") {
    const missingEl = document.createElement("div");
    missingEl.className = "plugin-detail-error";
    missingEl.textContent =
      "Plugin file no longer exists on disk. This entry will be removed on next app launch.";
    bodyElement.appendChild(missingEl);
    return;
  }

  const enabled =
    kind === "builtin"
      ? (currentBuiltinStates[plugin.id] ?? false)
      : (currentUserStates[plugin.id] ?? false);

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
    if (kind === "builtin") {
      currentBuiltinStates[plugin.id] = checkbox.checked;
      onToggleBuiltin?.(plugin.id, checkbox.checked);
    } else {
      currentUserStates[plugin.id] = checkbox.checked;
      onToggleUser?.(plugin.id, checkbox.checked);
    }
  });

  bodyElement.appendChild(toggleRow);
}
```

---

### `src/plugins/plugins-panel/plugins-panel.css`

Append the following new rules to the existing file (after the last rule, which ends at line 109):

```css
/* ── Section headers ── */

.plugin-section {
  margin-bottom: 4px;
}

.plugin-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0 6px;
  cursor: default;
  border-bottom: 1px solid var(--border-color);
  margin-bottom: 4px;
}

.plugin-section-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  flex: 1;
}

.plugin-section-chevron {
  font-size: 10px;
  color: var(--text-secondary);
  width: 12px;
  flex-shrink: 0;
}

.plugin-section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}

/* ── Reload button ── */

.plugin-reload-btn {
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  font-size: 11px;
  font-family: inherit;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  flex-shrink: 0;
}
.plugin-reload-btn:hover:not(:disabled) {
  background: var(--border-color);
  color: var(--text-primary);
}
.plugin-reload-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Folder path label ── */

.plugin-folder-path {
  font-size: 11px;
  color: var(--text-secondary);
  margin: 4px 0 8px;
  word-break: break-all;
  line-height: 1.4;
}

/* ── Empty placeholder ── */

.plugin-empty-placeholder {
  font-size: 13px;
  color: var(--text-secondary);
  padding: 12px 0;
  text-align: center;
}

/* ── Status badges ── */

.plugin-status-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 3px;
  margin-left: 6px;
  vertical-align: middle;
  cursor: help;
}
.plugin-status-failed {
  background: #fde8e8;
  color: #c0392b;
}
.plugin-status-missing {
  background: var(--border-color);
  color: var(--text-secondary);
}

/* ── Failed/missing rows ── */

.plugin-row-failed .plugin-name {
  color: var(--text-secondary);
}
.plugin-row-missing .plugin-name {
  color: var(--text-secondary);
  font-style: italic;
}

/* ── Detail error text ── */

.plugin-detail-error {
  font-size: 12px;
  color: #c0392b;
  background: #fde8e8;
  padding: 8px 10px;
  border-radius: 4px;
  margin-top: 8px;
  line-height: 1.5;
  word-break: break-word;
}
```

---

## Verification Checklist

- [ ] Panel opens with two sections: "Built-in Plugins" (4 rows) and "User Plugins".
- [ ] Both sections are expanded by default; collapsing one does not affect the other.
- [ ] Reopening the panel always shows both sections expanded (collapse not persisted).
- [ ] "User Plugins" section header shows a "Reload" button.
- [ ] Reload button is disabled and shows "Loading…" while `onReloadPlugins` is in flight.
- [ ] Folder path label is always visible in the User Plugins section, even when empty (EC-19).
- [ ] "No plugins installed." placeholder appears when `userDefs` is empty (EC-19).
- [ ] Failed plugin row shows a red `(failed)` badge; clicking the name shows the error in the detail view (EC-3).
- [ ] Missing plugin row shows a grey `(missing)` badge; no toggle is rendered (EC-17).
- [ ] `updatePluginStates({}, {})` before `createPluginsPanel` does not throw (existing EC-10 guard retained).
- [ ] `updateUserPluginDefs(defs, states)` re-renders the user section while the panel stays open.
- [ ] `togglePluginsPanel` signature still works when called with one argument (second `userStates` argument defaults to `{}`).
- [ ] Existing `tests/plugins-panel.test.ts` tests still pass (EC-10 guard is unchanged).

# step_04a — Panel Update: Core/User Sections, Version Badges, Reload Wiring

**Chunk:** 4
**Prerequisite:** Chunk 3 approved (step_03a, step_03b, step_03c all merged and passing).
**Status:** NOT STARTED

---

## Objective

Rewrite `plugins-panel.ts` list view from a flat unsectioned list into two collapsible sections — "Core Plugins" and "User Plugins" — and wire the previously no-op Reload button to a new `reloadUserPlugins()` method on `PluginManager`. Also add:

- A `v{version}` badge on each core plugin row in the list view.
- A version line in the detail view for all loaded plugins.
- The Reload button lives in the "User Plugins" section header.

No new Rust commands are needed. The panel already receives `UnifiedPluginDef[]` with `kind`, `status`, and `version` fields from `pluginManager.getDefinitions()`. This step is purely TypeScript + CSS.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/plugins/plugins-panel/plugins-panel.ts` | Replace `showListView()` with sectioned rendering; wire `reloadPlugins` param; add version in detail view |
| `src/plugins/plugins-panel/plugins-panel.css` | Add `.plugin-version-badge` rule; add `.plugin-section-body` collapsed state |
| `src/plugins/index.ts` | Add `reloadUserPlugins(settings, statusBarZones)` method to `PluginManager` |
| `src/main.ts` | Pass `reloadPlugins` callback to `createPluginsPanel()`; define the callback body |

---

## Design Decisions

### Section split

`getDefinitions()` returns one flat array in load order (core records first, then user records, within each group in lexicographic filename order). The panel splits this array into two groups at render time:

- **Core section**: records where `kind === "core"`.
- **User section**: records where `kind === "user"`.

A core record with `status === "overridden"` appears in the Core section (not the User section) with the "Overridden" badge and toggle disabled. The user version of that file appears normally in the User section.

### Collapsible behaviour

Both sections open by default (`collapsed = false`). A chevron button in the section header toggles the body visibility. The collapsed state is per-session only (not persisted to settings).

### Version badge placement

In the list view, each loaded core plugin row shows `v{version}` as a small grey span after the plugin name. Overridden and failed core rows do not show a version badge (version is unknown for those slots).

In the detail view, all loaded plugins (core and user) show a "Version: {version}" line below the description text.

### Reload button

The Reload button is in the "User Plugins" section header (right side). It is enabled only when a `reloadPlugins` callback was passed to `createPluginsPanel()`. During an in-progress reload it is disabled with `"Reloading..."` text to prevent double-click (EC-23).

`reloadUserPlugins()` on `PluginManager` does a constrained rescan: it calls `listUserPlugins()`, evaluates any `.js` files not already in `_records` by filename, and calls `_enable` for plugins whose id appears in `settings.plugins` with `enabled: true`. It does NOT re-scan the core directory. Already-registered user plugin filenames are skipped (EC-23 idempotency). After completing, the panel calls `updateUserPluginDefs()` to re-render.

---

## Precise Code

### 1. `src/plugins/index.ts` — add `reloadUserPlugins()`

Add this method to the `PluginManager` class, after the existing `loadPlugins()` method. It takes the same `settings` and `statusBarZones` parameters as `loadPlugins()`.

```typescript
/**
 * Rescan the user plugin directory and load any new plugins found since
 * the last loadPlugins() call. Already-registered filenames are skipped
 * (EC-23). Core plugins are not rescanned.
 *
 * Called from the panel's "Reload" button. Safe to call multiple times;
 * the filename registration guard prevents duplicate loading.
 *
 * @param settings         Current application settings.
 * @param statusBarZones   DOM references for the three status bar zones.
 */
async reloadUserPlugins(
  settings: MarkableSettings,
  statusBarZones: { left: HTMLElement; center: HTMLElement; right: HTMLElement },
): Promise<void> {
  let userFilenames: string[];
  try {
    const userResponse = await listUserPlugins();
    userFilenames = userResponse.files;
    if (userResponse.truncated.length > 0) {
      console.warn(
        "[Plugins] 50-plugin limit reached during reload. Ignored:",
        userResponse.truncated.join(", "),
      );
    }
  } catch (err) {
    console.error("PluginManager.reloadUserPlugins: failed to list user plugins:", err);
    return;
  }

  // Build the set of filenames already registered (any kind) to guard against
  // re-evaluating a file that was loaded at startup (EC-23).
  const registeredFilenames = new Set(this._records.map((r) => r.filename));
  const registeredIds = new Set(
    this._records.filter((r) => r.id !== null).map((r) => r.id as string),
  );

  for (const filename of userFilenames) {
    if (registeredFilenames.has(filename)) continue;
    registeredFilenames.add(filename);

    const record = await this._loadPluginFile(
      filename,
      "user",
      registeredIds,
      statusBarZones,
    );
    this._records.push(record);
    if (record.id !== null) registeredIds.add(record.id);

    // Restore enabled state for newly-loaded plugins.
    if (record.status === "loaded" && record.plugin && record.api) {
      const saved = settings.plugins?.[record.plugin.id];
      if (saved?.enabled === true) {
        await this._enable(record);
      }
    }
  }
}
```

### 2. `src/plugins/plugins-panel/plugins-panel.ts` — full replacement

Replace the entire file with the content below. All public exports are preserved (`createPluginsPanel`, `openPluginsPanel`, `closePluginsPanel`, `togglePluginsPanel`, `updatePluginStates`, `updateUserPluginDefs`). The `void reloadPlugins` placeholder is replaced by proper storage and use.

```typescript
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

// ── Module-level state ────────────────────────────────────────────────────────

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

/** Per-section collapsed state (session-only, not persisted). */
const sectionCollapsed: Record<"core" | "user", boolean> = {
  core: false,
  user: false,
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Inject the plugins panel into the DOM. Call once during initApp().
 *
 * @param defs          Unified plugin metadata from pluginManager.getDefinitions().
 * @param states        Current plugin states from pluginManager.getStates().
 * @param toggle        Called when user toggles a plugin (unified callback).
 * @param reloadPlugins Optional: called when user clicks "Reload" in User Plugins section.
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

/**
 * Update internal plugin states from outside (e.g. when a plugin auto-enables
 * another). If the panel is currently showing the list view, re-renders it so
 * toggles reflect the new state immediately.
 *
 * EC-10: Guards on panelElement — safe to call before createPluginsPanel has run.
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
 * Called by main.ts after a Reload completes to refresh the plugin list.
 * Safe to call before createPluginsPanel has been called (guard on panelElement).
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

function showListView(): void {
  if (!bodyElement || !titleElement) return;
  currentView = "list";
  titleElement.textContent = "Plugins";
  bodyElement.innerHTML = "";

  const coreDefs = definitions.filter((d) => d.kind === "core");
  const userDefs = definitions.filter((d) => d.kind === "user");

  bodyElement.appendChild(buildSection("core", "Core Plugins", coreDefs));
  bodyElement.appendChild(buildSection("user", "User Plugins", userDefs));
}

// ── Section builder ───────────────────────────────────────────────────────────

/**
 * Build a collapsible section element for the given kind and plugin list.
 *
 * @param kind     "core" | "user" — controls section id and collapse state key.
 * @param label    Human-readable section heading.
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

  const chevron = document.createElement("span");
  chevron.className = "plugin-section-chevron";
  chevron.textContent = sectionCollapsed[kind] ? "\u25B6" : "\u25BC"; // ▶ or ▼

  const title = document.createElement("span");
  title.className = "plugin-section-title";
  title.textContent = label;

  leftGroup.append(chevron, title);
  header.appendChild(leftGroup);

  // Reload button (user section only, enabled only when callback is wired)
  if (kind === "user") {
    const reloadBtn = document.createElement("button");
    reloadBtn.className = "plugin-reload-btn";
    reloadBtn.textContent = "Reload";
    reloadBtn.disabled = onReload === null;
    reloadBtn.title = onReload === null
      ? "Reload not available"
      : "Rescan the user plugins directory";
    reloadBtn.addEventListener("click", async (e) => {
      e.stopPropagation(); // Do not toggle section collapse.
      if (!onReload) return;
      reloadBtn.disabled = true;
      reloadBtn.textContent = "Reloading\u2026";
      try {
        await onReload();
      } finally {
        // Re-render will replace this button; but in case it doesn't, restore.
        reloadBtn.disabled = false;
        reloadBtn.textContent = "Reload";
      }
    });
    header.appendChild(reloadBtn);
  }

  // Body element wraps all rows; hidden when section is collapsed.
  const body = document.createElement("div");
  body.className = "plugin-section-body";
  if (sectionCollapsed[kind]) {
    body.classList.add("plugin-section-body--collapsed");
  }

  // Toggle collapse on left-group click.
  leftGroup.addEventListener("click", () => {
    sectionCollapsed[kind] = !sectionCollapsed[kind];
    chevron.textContent = sectionCollapsed[kind] ? "\u25B6" : "\u25BC";
    body.classList.toggle("plugin-section-body--collapsed", sectionCollapsed[kind]);
  });

  // Populate rows.
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
 * Standard loaded plugin row: name (clickable) + optional version badge + toggle.
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

  // Version badge for core plugins only.
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
  badge.title = "A user plugin with the same filename overrides this core slot.";

  nameEl.append(nameText, badge);
  row.appendChild(nameEl);
  return row;
}

// ── Detail View ───────────────────────────────────────────────────────────────

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

  // Version line for loaded plugins.
  if (def.status === "loaded" && def.version) {
    const versionLine = document.createElement("div");
    versionLine.className = "plugin-detail-version";
    versionLine.textContent = `Version: ${def.version}`;
    bodyElement.appendChild(versionLine);
  }

  if (def.status === "failed") {
    const errorEl = document.createElement("div");
    errorEl.className = "plugin-detail-error";
    errorEl.textContent = def.failReason ?? "Unknown load error.";
    bodyElement.appendChild(errorEl);
    return;
  }

  if (def.status === "missing") {
    const msgEl = document.createElement("div");
    msgEl.className = "plugin-detail-error";
    msgEl.textContent =
      "Plugin file no longer exists on disk. This entry will be removed on next app launch.";
    bodyElement.appendChild(msgEl);
    return;
  }

  if (def.status === "overridden") {
    const msgEl = document.createElement("div");
    msgEl.className = "plugin-detail-error";
    msgEl.textContent =
      "This core plugin slot is overridden by a user plugin with the same filename.";
    bodyElement.appendChild(msgEl);
    return;
  }

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
}
```

### 3. `src/plugins/plugins-panel/plugins-panel.css` — add new rules

Add these rules at the end of the file (before the closing of the file):

```css
/* ── Section body collapsed state ── */

.plugin-section-body--collapsed {
  display: none;
}

/* ── Version badge (core plugin list rows) ── */

.plugin-version-badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-left: 5px;
  vertical-align: middle;
}

/* ── Overridden row ── */

.plugin-status-overridden {
  background: #fff3cd;
  color: #856404;
}

.plugin-row-overridden .plugin-name {
  color: var(--text-secondary);
}

/* ── Detail version line ── */

.plugin-detail-version {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 16px;
}
```

Note: `.plugin-status-overridden` styling already exists as a selector in the current CSS but without colour rules (it was a structure placeholder). These rules add the amber colour. Verify the file does not already contain a `.plugin-status-overridden` colour rule before adding to avoid duplication.

### 4. `src/main.ts` — pass `reloadPlugins` callback and wire status bar zones

Find the `createPluginsPanel(...)` call (around line 903) and extend it:

```typescript
// Before:
createPluginsPanel(
  pluginManager.getDefinitions(),
  pluginManager.getStates(),
  async (id, enabled) => {
    if (editor) await pluginManager.toggle(id, enabled);
  },
);

// After:
createPluginsPanel(
  pluginManager.getDefinitions(),
  pluginManager.getStates(),
  async (id, enabled) => {
    if (editor) await pluginManager.toggle(id, enabled);
  },
  async () => {
    await pluginManager.reloadUserPlugins(migratedSettings, statusBarZones);
    updateUserPluginDefs(
      pluginManager.getDefinitions(),
      pluginManager.getStates(),
    );
  },
);
```

Also verify that `updateUserPluginDefs` is imported from `plugins-panel`. Add it to the import if missing:

```typescript
import {
  createPluginsPanel,
  openPluginsPanel,
  closePluginsPanel,
  togglePluginsPanel,
  updatePluginStates,
  updateUserPluginDefs,
} from "./plugins/plugins-panel/plugins-panel";
```

---

## Verification Checklist

- [ ] `npm test` passes with zero new failures (no test touches `reloadUserPlugins` yet — see step_04b for test additions).
- [ ] `npm run tauri dev` launches without TypeScript errors.
- [ ] Open Plugins panel: two sections visible ("Core Plugins", "User Plugins"), both open by default.
- [ ] Click Core Plugins section header chevron: section collapses; click again: expands.
- [ ] Each loaded core plugin row shows `v{version}` in small grey text after the name.
- [ ] An overridden core plugin (place a same-named `.js` in `~/Library/.../plugins/user/` then reload app): the Core section row shows "overridden" amber badge; toggle is not present; User section shows the user version normally.
- [ ] Click a loaded core plugin name: detail view shows "Version: {version}" line below description.
- [ ] Click a loaded user plugin name: detail view shows "Version: {version}" line if plugin declares it.
- [ ] Reload button is present in User Plugins section header.
- [ ] Clicking Reload button: button shows "Reloading..." and is disabled during the async call; re-enables and shows "Reload" after.
- [ ] After Reload, any newly added `.js` file in `~/Library/.../plugins/user/` appears in the User Plugins section without reopening the panel.
- [ ] `updateUserPluginDefs([], {})` called before `createPluginsPanel` does not throw (EC-10 guard unchanged).

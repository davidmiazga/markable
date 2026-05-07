---
title: "Step 03 — Layouts Plugin"
last-updated: "2026-05-06"
review-cadence-days: 14
status: active
---

# Step 03 — Layouts Plugin

Delivers FR-22 through FR-27: sidebar panel, picker modal, auto-render on file
open, first-run starter layouts, command bar integration, and click-to-open
data-path wiring.

**Files to create:**
- `src/plugins/layouts/layouts.plugin.ts`

**Files to modify:**
- `src/plugins/index.ts` — add `"layouts"` to `WORKFLOW_PLUGINS`
- `scripts/build-plugins.mjs` — add `layouts` entry

---

## Module structure of `layouts.plugin.ts`

```
// ── Imports ────────────────────────────────────────────────────────────────────
import type { MarkablePluginAPI } from "../markable-plugin-api";
import {
  buildContext,
  render,
  stripScripts,
  wireDataPathListeners,
  type TemplateContext,
  type VaultFileEntry,
} from "./layout-engine";

// ── Constants ──────────────────────────────────────────────────────────────────
const STYLE_ID = "__markable_layouts_css__";
const LAYOUTS_DIR = "VaultSettings/layouts";
const PARTIALS_DIR = "VaultSettings/layouts/partials";
const LAYOUTS_PANEL_ID = "layouts-panel";
const ACTION_ID = "layouts-open-picker";

// ── Module-level state ─────────────────────────────────────────────────────────
let _enabled = false;
let _api: MarkablePluginAPI | null = null;
let _pickerOpen = false;
let _overlayEl: HTMLElement | null = null;
let _currentVaultRoot: string | null = null;

// ── Layout file discovery ──────────────────────────────────────────────────────
// discoverLayouts()
// parseLayoutFrontmatter()

// ── Context building ───────────────────────────────────────────────────────────
// buildRenderContext()

// ── First-run ─────────────────────────────────────────────────────────────────
// STARTER_LAYOUTS (object with wikipedia + bookshelf content)
// writeStarterLayouts()

// ── Sidebar panel ─────────────────────────────────────────────────────────────
// renderSidebarPanel()

// ── Picker modal ──────────────────────────────────────────────────────────────
// showPickerUI()
// closePicker()

// ── Render entry point ────────────────────────────────────────────────────────
// applyLayout()

// ── Auto-render (updateListener via addExtensions) ────────────────────────────
// buildAutoRenderExtension()

// ── CSS ───────────────────────────────────────────────────────────────────────
// injectCSS() / removeCSS()

// ── Plugin export ─────────────────────────────────────────────────────────────
// const plugin = { id, name, version, description, sidebarPanelId, onEnable, onDisable }
// export default plugin;
```

---

## Layout file format

Each `.layout.md` file has YAML frontmatter:

```yaml
---
name: "Wikipedia"
description: "Single-file view with infobox"
applies-to: "single"
---
<!-- HTML template body -->
```

The YAML parser used inside the IIFE must be self-contained — no npm imports.
Use the minimal gray-matter-style approach: split on the first `---` block and
parse only the fields `name`, `description`, and `applies-to` using a small
hand-rolled YAML line parser (key: value format). Full YAML is not required for
these three fields.

```typescript
interface LayoutMeta {
  name: string;        // from frontmatter "name" or filename stem
  description: string; // from frontmatter "description" or ""
  appliesTo: "single" | "collection" | "any"; // from "applies-to" or "any"
  filePath: string;    // absolute path to the .layout.md file
  body: string;        // template body (after frontmatter)
}
```

Fallbacks (EC-04):
- Missing `name` → filename stem (strip `.layout.md` extension)
- Missing `description` → `""`
- Missing or unrecognised `applies-to` → `"any"` (EC-19)

---

## `discoverLayouts(vaultRoot): Promise<LayoutMeta[]>`

1. Call `invoke("list_md_files", { path: vaultRoot + "/" + LAYOUTS_DIR })`.
   - On failure: return `[]`.
2. Filter results to only `.layout.md` files.
3. For each file, call `invoke("read_file", { path: fullPath })`.
4. Parse frontmatter to produce `LayoutMeta`.
5. Return array sorted by `name` field (ascending, case-insensitive).

Note: `list_md_files` returns filenames (not full paths). Prepend
`vaultRoot + "/" + LAYOUTS_DIR + "/"` to produce absolute paths.

---

## `buildRenderContext(layoutMeta, filePath): Promise<TemplateContext>`

```typescript
async function buildRenderContext(
  layoutMeta: LayoutMeta,
  filePath: string | null,
): Promise<TemplateContext>
```

1. Read vault data from `window.__MARKABLE_VAULT_MANAGER__`:
   - `getActiveVaultRoot()` → `_currentVaultRoot`
   - `getVaultIndex()` → `VaultIndex` (entries, directories)
   - `getActiveVault()?.name` → vault name
2. Read meta from `window.__MARKABLE_META__`.
3. Build `FileContext | null`:
   - If `filePath` is non-null: call `invoke("read_file", { path: filePath })`.
     - Get `VaultIndexEntry` for this path from the vault index.
     - Parse frontmatter YAML (reuse the same inline parser).
     - `rendered = renderMd(content)`.
   - If `filePath` is null: `file = null`.
4. Call `buildContext(file, vault, meta)` from `layout-engine.ts`.

---

## `applyLayout(layoutMeta, filePath): Promise<void>`

The main render entry point called by both the sidebar "Apply" button and the
picker modal.

```typescript
async function applyLayout(layoutMeta: LayoutMeta, filePath: string | null): Promise<void> {
  if (!_enabled) return;
  const vaultRoot = _currentVaultRoot;
  if (!vaultRoot) return;

  // Per-render cancellation flag (EC-16).
  let cancelled = false;

  // Capture invoke and renderMd at call time for dependency injection.
  const inv = (window as any).__TAURI_INTERNALS__.invoke.bind((window as any).__TAURI_INTERNALS__);
  const renderMd = (window as any).__MARKABLE_RENDER_MD__ as ((md: string) => string) | undefined;

  // EC-18: __MARKABLE_RENDER_MD__ absent → warn and use identity.
  const safeRenderMd: (md: string) => string = renderMd
    ? renderMd
    : (md) => { console.warn("[layouts] __MARKABLE_RENDER_MD__ not set; falling back to raw text."); return md; };

  const ctx = await buildRenderContext(layoutMeta, filePath);
  if (cancelled || !_enabled) return;

  const rawHtml = await render(layoutMeta.body, ctx, 0, vaultRoot, inv, safeRenderMd);
  if (cancelled || !_enabled) return;

  const safeHtml = stripScripts(rawHtml);

  const tabTitle = layoutMeta.name;
  const openCustomTab = (window as any).__MARKABLE_OPEN_CUSTOM_TAB__ as
    ((t: string, fn: (el: HTMLElement) => void) => void) | undefined;

  if (!openCustomTab) {
    console.warn("[layouts] __MARKABLE_OPEN_CUSTOM_TAB__ not available.");
    return;
  }

  openCustomTab(tabTitle, (el) => {
    el.innerHTML = safeHtml;
    wireDataPathListeners(el);
  });
}
```

---

## Sidebar panel (FR-22)

Registered via `api.registerSidebarPanel({ id: "layouts-panel", ... })`.

```typescript
interface SidebarState {
  layouts: LayoutMeta[];
  selectedIndex: number;
}
```

Panel HTML structure:
```html
<div class="layouts-panel">
  <div class="layouts-list">
    <!-- one button per layout -->
    <button class="layouts-item [selected]">
      <span class="layouts-item-name">Wikipedia</span>
      <span class="layouts-item-desc">Single-file view with infobox</span>
    </button>
  </div>
  <div class="layouts-actions">
    <button class="layouts-apply-btn" [disabled]>Apply to current file</button>
  </div>
</div>
```

Render logic:
- On `render(container)`: call `discoverLayouts()` and populate the list.
- If no vault active (EC-01): show `<p class="layouts-empty">Open a vault to use layouts.</p>`, no apply button.
- If layouts list is empty (EC-03): show empty state message, apply button disabled.
- "Apply to current file" button:
  - Disabled when no layout is selected (always true if list is empty).
  - Disabled when `selectedLayout.appliesTo === "single"` and no active editor
    file is open (EC-05, EC-06). Read active file from
    `window.__MARKABLE_TAB_MANAGER__?.getActiveFilePath()`.
  - On click: calls `applyLayout(selectedLayout, activeFilePath)`.

The sidebar panel does not call `api.addExtensions()` — the auto-render CM6
extension is registered separately in `onEnable`.

---

## Picker modal (FR-24)

Matches the visual style of `templates.plugin.ts` picker. Use the same CSS
class names where possible (`templates-overlay`, `templates-card`,
`templates-item`) to leverage existing styles, plus layouts-specific additions.

Singleton guard: if `_pickerOpen` is true, `showPickerUI()` is a no-op (EC-14).

Keyboard behaviour:
- `ArrowDown` / `ArrowUp` → move selection, clamp at ends.
- `Enter` → apply selected layout.
- `Escape` → close.
- Backdrop click → close.

Show layout `description` as a subtitle beneath the name (FR-24):

```html
<button class="templates-item layouts-picker-item [selected]">
  <span class="layouts-picker-name">Wikipedia</span>
  <span class="layouts-picker-desc">Single-file view with infobox</span>
</button>
```

On "apply": get active file path from `window.__MARKABLE_TAB_MANAGER__`,
call `applyLayout(layout, filePath)`, then `closePicker()`.

---

## Command bar integration (FR-23)

In `onEnable`:

```typescript
// Register action extension.
const ext = (window as any).__MARKABLE_ACTION_EXTENSIONS__ as Map<string, () => void> | undefined;
if (ext instanceof Map) {
  ext.set(ACTION_ID, () => void openPickerFromAction());
}

// Register in COMMANDS for command bar display.
const cmds = (window as any).__MARKABLE_COMMANDS__ as Array<{
  id: string; name: string; action: () => void;
}> | undefined;
cmds?.push({ id: ACTION_ID, name: "Open with Layout…", action: () => void openPickerFromAction() });
```

In `onDisable`:

```typescript
// Remove from action extensions.
const ext = (window as any).__MARKABLE_ACTION_EXTENSIONS__ as Map<string, () => void> | undefined;
if (ext instanceof Map) ext.delete(ACTION_ID);

// Remove from COMMANDS array.
const cmds = (window as any).__MARKABLE_COMMANDS__ as Array<{ id: string }> | undefined;
if (cmds) {
  const idx = cmds.findIndex((c) => c.id === ACTION_ID);
  if (idx !== -1) cmds.splice(idx, 1);
}
```

`openPickerFromAction()` discovers layouts and calls `showPickerUI()`.

---

## Auto-render on file open (FR-25)

Uses `api.addExtensions([updateListener])` in `onEnable`.

Detection strategy: use the `__MARKABLE_TAB_MANAGER__` `onTabActivated` event
if it exists, otherwise fall back to a CM6 `updateListener` that checks for
document replacement (signalled by `update.docChanged` and the full document
being replaced).

The requirement references "TabManager activation event via
`__MARKABLE_TAB_MANAGER__`". Reading `tab-manager.ts`, there is no
`onTabActivated` event emitter. The viable approach is:

1. Register a CM6 `updateListener` extension via `api.addExtensions()`.
2. In the listener, on each update where `update.docChanged`:
   - Read the current frontmatter from `update.state.doc.toString()`.
   - Extract the `layout:` field from the YAML block.
   - If the field is present and names a known layout, call `applyLayout()`.

Since `updateListener` fires on every edit, add a debounce guard:
- Only trigger when the tab's file path changes (compare against cached path).
- Use `window.__MARKABLE_CURRENT_FILE__` as the current file path sentinel.
- Cache the last-seen file path in `_lastAutoRenderPath`.
- On path change: re-parse frontmatter, check for `layout:` field, auto-render.

```typescript
let _lastAutoRenderPath: string | null = null;

function buildAutoRenderExtension(): Extension {
  return EditorView.updateListener.of(async (update) => {
    if (!_enabled) return;
    const currentPath = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
    if (currentPath === _lastAutoRenderPath) return;
    _lastAutoRenderPath = currentPath;
    if (!currentPath) return;

    // Parse frontmatter lazily.
    const doc = update.state.doc.toString();
    const yamlMatch = doc.match(/^---\n([\s\S]*?)\n---/);
    if (!yamlMatch) return;
    const layoutField = yamlMatch[1].match(/^layout:\s*(.+)$/m);
    if (!layoutField) return;
    const layoutName = layoutField[1].trim().replace(/["']/g, "");

    const vaultRoot = _currentVaultRoot;
    if (!vaultRoot) return;
    const allLayouts = await discoverLayouts(vaultRoot);
    const target = allLayouts.find(
      (l) => l.name === layoutName || l.filePath.endsWith(`/${layoutName}.layout.md`)
    );
    if (!target) return; // EC-27: silently skip if not found.
    void applyLayout(target, currentPath);
  });
}
```

Note: `EditorView.updateListener` is a CM6 global exposed on `window` via
`src/lib/cm-globals.ts`. Access it as `(window as any).EditorView.updateListener.of(...)`.

---

## First-run starter layouts (FR-26)

```typescript
const STARTER_LAYOUTS: Record<string, string> = {
  "wikipedia.layout.md": `---
name: "Wikipedia"
description: "Two-column layout with rendered body and YAML infobox"
applies-to: "single"
---
<style>
.wiki-layout { display: flex; gap: 24px; max-width: 900px; margin: 0 auto; }
.wiki-body { flex: 1; min-width: 0; }
.wiki-body h1 { margin-top: 0; color: var(--text-primary); }
.wiki-tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 16px; }
.wiki-tag { background: var(--bg-secondary, #2a2a3a); border-radius: 3px; padding: 2px 8px; font-size: 12px; color: var(--text-secondary); }
.wiki-infobox { width: 240px; flex-shrink: 0; border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; background: var(--bg-secondary); font-size: 13px; }
.wiki-infobox table { width: 100%; border-collapse: collapse; }
.wiki-infobox td { padding: 4px 6px; vertical-align: top; color: var(--text-primary); border-bottom: 1px solid var(--border-color); }
.wiki-infobox td:first-child { color: var(--text-secondary); font-weight: 500; white-space: nowrap; }
</style>
{{#if file}}
<div class="wiki-layout">
  <div class="wiki-body">
    <h1>{{file.title}}</h1>
    <div class="wiki-tags">{{#each file.tags}}<span class="wiki-tag">{{this}}</span>{{/each}}</div>
    {{{file.rendered}}}
  </div>
  <aside class="wiki-infobox">
    <strong>{{file.title}}</strong>
    <table>
      {{#each file.yaml}}<tr><td>{{@key}}</td><td>{{this}}</td></tr>{{/each}}
    </table>
  </aside>
</div>
{{/if}}
{{#if !file}}<p style="color:var(--text-secondary)">No file selected.</p>{{/if}}
`,

  "bookshelf.layout.md": `---
name: "Bookshelf"
description: "Responsive card grid of all vault files"
applies-to: "collection"
---
<style>
.shelf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; padding: 8px 0; }
.shelf-card { background: var(--bg-secondary, #2a2a3a); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; cursor: pointer; transition: background 0.15s; }
.shelf-card:hover { background: var(--bg-hover, #333); }
.shelf-card-title { font-weight: 600; color: var(--text-primary); font-size: 14px; margin-bottom: 6px; }
.shelf-card-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.shelf-tag { background: var(--bg-primary); border-radius: 3px; padding: 2px 6px; font-size: 11px; color: var(--text-secondary); }
</style>
<h2 style="color:var(--text-primary)">{{vault.name}}</h2>
<div class="shelf-grid">
{{#each vault.files}}
<div class="shelf-card" data-path="{{this.path}}">
  <div class="shelf-card-title">{{this.title}}</div>
  <div class="shelf-card-tags">
    {{#each this.tags}}<span class="shelf-tag">{{this}}</span>{{/each}}
  </div>
</div>
{{/each}}
</div>
`,
};
```

`writeStarterLayouts(vaultRoot)`:

```typescript
async function writeStarterLayouts(vaultRoot: string): Promise<void> {
  const inv = (window as any).__TAURI_INTERNALS__.invoke.bind((window as any).__TAURI_INTERNALS__);
  const dir = vaultRoot + "/" + LAYOUTS_DIR;
  try {
    await inv("ensure_directory", { path: dir });
  } catch {
    return; // EC-28: silent failure.
  }
  for (const [filename, content] of Object.entries(STARTER_LAYOUTS)) {
    try {
      await inv("write_file", { path: dir + "/" + filename, content });
    } catch (err) {
      console.warn("[layouts] Failed to write starter layout:", filename, err);
    }
  }
}
```

Called in `onEnable` after vault root is established:

```typescript
// First-run: write starters if directory is empty.
if (vaultRoot) {
  const existing = await discoverLayouts(vaultRoot);
  if (existing.length === 0) {
    void writeStarterLayouts(vaultRoot);
  }
}
```

---

## `onEnable(api)` sequence

```typescript
async onEnable(api: MarkablePluginAPI): Promise<void> {
  _enabled = true;
  _api = api;

  injectCSS();

  // Capture vault root.
  _currentVaultRoot = (window as any).__MARKABLE_VAULT_MANAGER__?.getActiveVaultRoot?.() ?? null;

  // Register sidebar panel.
  api.registerSidebarPanel({
    id: LAYOUTS_PANEL_ID,
    title: "Layouts",
    side: "left",
    render: (container) => renderSidebarPanel(container),
    destroy: () => { /* no teardown needed — panel DOM is owned by sidebar */ },
  });

  // Register command bar action extension.
  const ext = (window as any).__MARKABLE_ACTION_EXTENSIONS__ as Map<string, () => void> | undefined;
  if (ext instanceof Map) ext.set(ACTION_ID, () => void openPickerFromAction());
  const cmds = (window as any).__MARKABLE_COMMANDS__ as Array<{ id: string; name: string; action: () => void }> | undefined;
  cmds?.push({ id: ACTION_ID, name: "Open with Layout…", action: () => void openPickerFromAction() });

  // Register auto-render extension.
  api.addExtensions([buildAutoRenderExtension()]);

  // First-run: write starters if needed.
  if (_currentVaultRoot) {
    const existing = await discoverLayouts(_currentVaultRoot);
    if (existing.length === 0) void writeStarterLayouts(_currentVaultRoot);
  }
}
```

---

## `onDisable(api)` sequence (NFR-07)

```typescript
onDisable(api: MarkablePluginAPI): void {
  _enabled = false;

  // 1. Close picker if open.
  if (_pickerOpen) closePicker();

  // 2. Remove injected CSS.
  removeCSS();

  // 3. Remove sidebar panel.
  api.unregisterSidebarPanel(LAYOUTS_PANEL_ID);

  // 4. Remove CM6 extension.
  api.removeExtensions();

  // 5. Remove action extension.
  const ext = (window as any).__MARKABLE_ACTION_EXTENSIONS__ as Map<string, () => void> | undefined;
  if (ext instanceof Map) ext.delete(ACTION_ID);

  // 6. Remove COMMANDS entry.
  const cmds = (window as any).__MARKABLE_COMMANDS__ as Array<{ id: string }> | undefined;
  if (cmds) {
    const idx = cmds.findIndex((c) => c.id === ACTION_ID);
    if (idx !== -1) cmds.splice(idx, 1);
  }

  // 7. Clear module state.
  _api = null;
  _currentVaultRoot = null;
  _lastAutoRenderPath = null;
}
```

---

## CSS injection

The plugin injects its own stylesheet for the sidebar panel and picker overlay.
All colors use CSS custom properties (NFR-05):

```css
/* Sidebar panel */
.layouts-panel { display: flex; flex-direction: column; height: 100%; }
.layouts-list { flex: 1; overflow-y: auto; }
.layouts-item { display: flex; flex-direction: column; padding: 8px 12px; ... }
.layouts-item.selected { background: var(--selection-bg, #264f78); }
.layouts-item-name { font-size: 13px; color: var(--text-primary); }
.layouts-item-desc { font-size: 11px; color: var(--text-secondary); margin-top: 2px; }
.layouts-apply-btn { ... }
.layouts-empty { padding: 16px; color: var(--text-secondary); text-align: center; font-size: 13px; }

/* Picker — inherits templates-overlay / templates-card styles where possible */
.layouts-picker-item { display: flex; flex-direction: column; ... }
.layouts-picker-name { font-size: 13px; color: var(--text-primary); }
.layouts-picker-desc { font-size: 11px; color: var(--text-secondary); margin-top: 2px; }
```

---

## `src/plugins/index.ts` change

Add `"layouts"` to `WORKFLOW_PLUGINS`:

```typescript
export const WORKFLOW_PLUGINS: readonly string[] = [
  "file-browser",
  "yaml-pane",
  "knowledge-graph",
  "layouts",
];
```

---

## `scripts/build-plugins.mjs` change

Add to the `PLUGINS` array (after `"typing-assist"` or at the end):

```javascript
// Layouts — template rendering, sidebar, picker, auto-render.
["layouts", "src/plugins/layouts/layouts.plugin.ts"],
```

---

## Build verification

After implementation:

```bash
npm run build:plugins && npm run sync:plugins
```

Verify `src-tauri/plugins/core/layouts.js` is created and non-empty.

---

## Edge cases addressed

| EC | Handler |
|---|---|
| EC-01 | Sidebar shows placeholder when `_currentVaultRoot` is null |
| EC-02 | `discoverLayouts` returns `[]` on missing dir; first-run writes starters |
| EC-03 | Empty list shows empty state; apply button disabled |
| EC-04 | Frontmatter fallbacks: name→stem, description→"", applies-to→"any" |
| EC-05 | Apply button disabled when applies-to=single and no active file |
| EC-06 | Active custom tab → getActiveFilePath() returns null → same as EC-05 |
| EC-14 | Singleton guard on `_pickerOpen` prevents duplicate picker |
| EC-16 | `cancelled` flag + `_enabled` check before DOM write |
| EC-18 | `__MARKABLE_RENDER_MD__` absent → warn + identity fallback |
| EC-22 | Plugin disabled while tab is open: render tab stays; click listeners remain on DOM |
| EC-23 | Last `ext.set(ACTION_ID, ...)` wins (Map semantics) |
| EC-25 | Guarded by `openCustomRenderTab` in TabManager |
| EC-27 | Auto-render proceeds regardless of applies-to field |
| EC-28 | `writeStarterLayouts` swallows `ensure_directory` failure silently |

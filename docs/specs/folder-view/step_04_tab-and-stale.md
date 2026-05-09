---
title: "Folder View — Step 04: Tab Opener, Stale Flag, and Fallback"
last-updated: "2026-05-09"
review-cadence-days: 90
status: active
---

# Step 04 — Tab Opener, Stale Flag, and Fallback

**Goal**: Implement `openFolderViewTab`, the stale-flag registry, `notifyFolderViewTabs`, `checkStaleFolderViewTabs`, and the fallback renderer. Wire the live-update hook into `_indexUpdatedCb` and `onTabChanged`.

**Files created**:
- `src/plugins/file-browser/folder-view/tab.ts`
- `src/plugins/file-browser/folder-view/fallback.ts`

**Files modified**:
- `src/plugins/file-browser/file-browser.plugin.ts` (remove stub, add real import, wire callbacks)

---

## Detailed Tasks

### 1. Create `fallback.ts`

```typescript
/**
 * fallback.ts — graceful-degradation renderer for missing/unknown layouts.
 * FR-12, FR-13, EC-04, EC-05.
 */

/**
 * Render the fallback view for missing or unrecognized layout values.
 *
 * Shows a faint notice and optionally renders the _folder.md body as plain
 * markdown below it (FR-11/FR-12).
 *
 * @param body    - Markdown body from _folder.md (may be empty string).
 * @param notice  - The notice string to display (FR-12/FR-13).
 * @param container - The #custom-tab-host element to render into.
 */
export function renderFallback(
  body: string,
  notice: string,
  container: HTMLElement,
): void {
  container.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "folder-view-fallback";

  const noticeEl = document.createElement("p");
  noticeEl.className = "folder-view-fallback-notice";
  noticeEl.textContent = notice;
  wrapper.appendChild(noticeEl);

  if (body.trim()) {
    const bodyEl = document.createElement("div");
    bodyEl.className = "folder-view-description";
    const renderMd = (window as any).__MARKABLE_RENDER_MD__ as
      ((md: string) => string) | undefined;
    if (renderMd) {
      bodyEl.innerHTML = stripScripts(renderMd(body));
    } else {
      const pre = document.createElement("pre");
      pre.textContent = body;
      bodyEl.appendChild(pre);
    }
    wrapper.appendChild(bodyEl);
  }

  container.appendChild(wrapper);
}
```

Add a module-level `stripScripts` helper (same as `layout-manager.ts` pattern — strips `<script>` tags and event handler attributes from HTML strings to prevent XSS):

```typescript
function stripScripts(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/ on\w+="[^"]*"/gi, "")
    .replace(/ on\w+='[^']*'/gi, "");
}
```

**Note**: `renderFallback` must never throw (NFR-06). Wrap in try/catch at call site in `tab.ts`.

### 2. Create `tab.ts`

This is the central orchestrator for Folder View tabs. It exports:
- `openFolderViewTab(folderPath: string): void`
- `notifyFolderViewTabs(savedFilePath: string): void`
- `checkStaleFolderViewTabs(): void`
- Internal registry management

#### 2a. Stale-flag registry

```typescript
interface FolderViewTabEntry {
  /** The synthetic title key used to identify the tab: "__fv__:" + folderPath. */
  syntheticKey: string;
  /** Absolute path of the folder this tab represents. */
  folderPath: string;
  /** Mutable stale flag. Set to true when _folder.md is saved while tab is inactive. */
  staleRef: { stale: boolean };
  /** Re-render function — re-reads disk and re-renders the tab content. */
  rerender: () => void;
}

/** Module-level registry. Entries are garbage-collected in notifyFolderViewTabs. */
const _registry: FolderViewTabEntry[] = [];
```

#### 2b. `openFolderViewTab(folderPath: string): void`

Algorithm:

1. Compute the synthetic key: `const syntheticKey = "__fv__:" + folderPath;`

2. Get the vault index: `const vaultIndex = (window as any).__MARKABLE_VAULT_MANAGER__?.getVaultIndex?.() ?? null;`

3. Read `_folder.md` synchronously is not possible — the read must be async. Use a fire-and-forget async inner function. However, `openCustomRenderTab` expects a synchronous `renderFn`. Design: the `renderFn` passed to `openCustomRenderTab` is synchronous but kicks off an async read internally, then populates the container when the read resolves. Show a loading placeholder while the read is in progress.

   ```typescript
   const staleRef = { stale: false };
   const folderMdPath = folderPath + "/_folder.md";

   const rerender = (): void => {
     // Find the container — only re-render if the tab is currently active.
     const tabMgr = (window as any).__MARKABLE_TAB_MANAGER__;
     const activeTab = tabMgr?.getActiveTab?.();
     if (activeTab?.title !== syntheticKey) return;
     const hostEl = document.getElementById("custom-tab-host");
     if (!hostEl) return;
     hostEl.innerHTML = `<div class="folder-view-loading">Loading…</div>`;
     void renderFolderViewTabAsync(folderPath, folderMdPath, vaultIndex, hostEl);
   };

   const renderFn = (container: HTMLElement): void => {
     staleRef.stale = false;
     container.innerHTML = `<div class="folder-view-loading">Loading…</div>`;
     void renderFolderViewTabAsync(folderPath, folderMdPath, vaultIndex, container);
   };
   ```

4. Call `window.__MARKABLE_OPEN_CUSTOM_TAB__(syntheticKey, renderFn)`.

5. After the call, update the tab's display title in the tab strip. The tab-manager's `openCustomRenderTab` has already run `renderFn` which kicks off the async read. The display title will be updated once the async read completes (inside `renderFolderViewTabAsync`). To set an immediate placeholder title:
   ```typescript
   // Update tab.title to the display title (folder's last path segment).
   // This makes the tab strip show the correct human-readable name.
   const tabMgr = (window as any).__MARKABLE_TAB_MANAGER__;
   const displayTitle = escapeHtml(folderPath.split("/").pop() ?? folderPath);
   const allTabs = tabMgr?.getTabs?.() ?? [];
   const thisTab = allTabs.find((t: any) => t.title === syntheticKey);
   if (thisTab) thisTab.title = displayTitle;
   // Notify the renderer so the tab strip re-paints with the human title.
   tabMgr?._notifyRenderer?.(); // Note: _notifyRenderer is private. See note below.
   ```

   **Note on `_notifyRenderer`**: this is a private method on `TabManager`. Calling it from an IIFE plugin violates the encapsulation principle. Prefer an alternative: pass the displayTitle as a second parameter to `renderFn` and let `renderFn` update `document.getElementById("titlebar-title")?.textContent`. For the tab strip label, fire `window.dispatchEvent(new CustomEvent("markable-tab-changed"))` which causes the tab-strip renderers to call `update()`. The tab strip reads `tab.title`, but we just set it. This may not work because `_notifyRenderer` is not public.

   **Final design decision**: The synthetic key IS the tab's stored title. The actual human-readable title is shown in the titlebar (which `_applyActiveTab` sets from `tab.title`). The tab-strip renderer reads `tab.title` for the strip label. Since we cannot call `_notifyRenderer` from the IIFE, accept that the tab strip shows a truncated/styled version of `__fv__:/path` until the next `activateTab` fires naturally. **Improvement**: register a `markable-tab-changed` listener in `tab.ts` that, when fired, updates `tab.title` for all folder-view tabs. This is already done in step_04's `checkStaleFolderViewTabs` hook.

   Simplest correct approach: compute the displayTitle from the YAML `title` field (once async read completes) and update `tab.title` at that point, then dispatch `markable-tab-changed` to trigger a renderer refresh. This is done inside `renderFolderViewTabAsync`.

6. Register the entry in `_registry`:
   ```typescript
   // Remove any existing entry for this path (re-open replaces stale entry).
   const existingIdx = _registry.findIndex(r => r.syntheticKey === syntheticKey);
   if (existingIdx !== -1) _registry.splice(existingIdx, 1);
   _registry.push({ syntheticKey, folderPath, staleRef, rerender });
   ```

#### 2c. `renderFolderViewTabAsync(folderPath, folderMdPath, vaultIndex, container)`

This private async function does the actual work:

1. Read `_folder.md` from disk:
   ```typescript
   const result = await (window as any).__TAURI_INTERNALS__?.invoke?.("read_file", { path: folderMdPath });
   ```
   If the read fails, call `renderFallback("", "Could not read _folder.md.", container)` and return.

2. Parse: `const config = parseFolderMd(content, folderPath.split("/").pop() ?? "");`

3. Dispatch to layout renderer:
   ```typescript
   const layoutKey = config.layout.toLowerCase();
   if (!layoutKey) {
     renderFallback(config.body, "No layout specified — showing raw content.", container);
   } else if (!LAYOUT_RENDERERS[layoutKey]) {
     renderFallback(config.body, `Unknown layout '${config.layout}' — showing raw content.`, container);
   } else {
     const cards = collectChildren(folderPath, vaultIndex);
     LAYOUT_RENDERERS[layoutKey](config, cards, container, folderPath);
   }
   ```

4. Update the tab's display title. After parsing, update `tab.title` in the registry:
   ```typescript
   const tabMgr = (window as any).__MARKABLE_TAB_MANAGER__;
   const allTabs = tabMgr?.getTabs?.() ?? [];
   const thisTab = allTabs.find((t: any) => t.title === syntheticKey || t.title === config.title);
   if (thisTab && thisTab.title === syntheticKey) {
     thisTab.title = escapeHtml(config.title);
     // Trigger a renderer update by dispatching the tab-changed event.
     window.dispatchEvent(new CustomEvent("markable-tab-changed"));
   }
   ```

#### 2d. `collectChildren(folderPath, vaultIndex): FolderCard[]`

Collects immediate children from `vaultIndex`. Returns combined `FolderCard[]` (directories first, then files). Used by `renderFolderViewTabAsync` and available to the renderer.

Algorithm (FR-19, EC-22):
1. From `vaultIndex.entries`: find entries where `path.startsWith(folderPath + "/") && !path.slice(folderPath.length + 1).includes("/")`. Exclude `_folder.md` entries (FR-23).
2. From `vaultIndex.directories`: find directories where `path.startsWith(folderPath + "/") && !path.slice(folderPath.length + 1).includes("/")`.
3. From `vaultIndex.nonMdFiles ?? []`: find entries where same prefix + no-slash constraint.
4. Build `FolderCard` objects for each. For `.md` files: `name = entry.name` (the stem, without extension). For non-MD files: `name = basename including extension`. `ext` = file extension with leading dot.
5. Return the combined array. Sorting is done by the renderer (step_05), not here.

**Note**: `hasFolderView` on directory cards requires checking if a `_folder.md` entry exists for that subfolder. Build a quick `folderViewSet` from the entries here: `const fvSet = buildFolderViewSet(vaultIndex)`. This is already available from `detection.ts`.

#### 2e. `LAYOUT_RENDERERS` dispatch map (FR-27/FR-28)

```typescript
import type { FolderLayoutRenderer } from "./types";
// renderFolderCards is imported from renderer.ts (step_05).
// For step_04, use a placeholder:
function renderFolderCardsPlaceholder(
  _config: any, _cards: any, container: HTMLElement
): void {
  container.innerHTML = `<div class="folder-view-cards">Renderer coming in step_05.</div>`;
}

const LAYOUT_RENDERERS: Record<string, FolderLayoutRenderer> = {
  "folder-cards": renderFolderCardsPlaceholder, // replaced in step_05
};
```

In step_05, replace `renderFolderCardsPlaceholder` with the real import.

#### 2f. `notifyFolderViewTabs(savedFilePath: string): void`

Called from `_indexUpdatedCb` when a file changes. If the saved file is `_folder.md` inside a folder that has a Folder View tab open, trigger a re-render or set stale.

Algorithm (FR-31/FR-32):
1. Garbage-collect closed tabs: remove entries from `_registry` where `window.__MARKABLE_TAB_MANAGER__.getTabs()` does not contain a tab with `title === entry.syntheticKey`.
2. Determine the folder path of the saved file: if `savedFilePath.endsWith("_folder.md")`, compute `changedFolderPath = savedFilePath.slice(0, savedFilePath.lastIndexOf("/"))`. Otherwise return (no folder-view tab affected).
3. For each entry in `_registry` where `entry.folderPath === changedFolderPath`:
   - Get the active tab: `const activeTab = window.__MARKABLE_TAB_MANAGER__.getActiveTab?.()`.
   - If `activeTab?.title === entry.syntheticKey`: call `entry.rerender()` immediately (FR-31).
   - Otherwise: set `entry.staleRef.stale = true` (FR-32).

#### 2g. `checkStaleFolderViewTabs(): void`

Called from `onTabChanged` in `file-browser.plugin.ts`. Finds stale folder-view tabs that are now the active tab and re-renders them.

Algorithm (FR-32):
1. Get `activeTab = window.__MARKABLE_TAB_MANAGER__.getActiveTab?.()`.
2. For each entry in `_registry` where `entry.syntheticKey === activeTab?.title && entry.staleRef.stale`:
   - Set `entry.staleRef.stale = false`.
   - Call `entry.rerender()`.

#### 2h. `escapeHtml(str: string): string`

A simple HTML escape utility:
```typescript
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```
Used for EC-13 (tab title XSS prevention).

### 3. Modify `file-browser.plugin.ts`

#### 3a. Remove the stub `openFolderViewTab` added in step_03

Delete the placeholder function added in step_03.

#### 3b. Add import

```typescript
import {
  openFolderViewTab,
  notifyFolderViewTabs,
  checkStaleFolderViewTabs,
  clearFolderViewRegistry,
} from "./folder-view/tab";
```

Also add:
```typescript
import { renderFallback } from "./folder-view/fallback";
```

#### 3c. Wire `notifyFolderViewTabs` into `_indexUpdatedCb`

In `setupVaultSubscriptions`, inside `_indexUpdatedCb`, after the existing diff/render logic, add:

```typescript
// FR-31/FR-32: notify folder-view tabs when _folder.md may have changed.
// The event payload may carry the changed path (vault-file-changed).
// If path is available in the event, pass it; otherwise skip (safe to miss — next activation re-renders via stale flag).
if (_event?.path) {
  notifyFolderViewTabs(_event.path as string);
}
```

**Note**: The `VaultFileChangedEvent` type may include a `path` field. Check `vault-types.ts` for the event shape. If `path` is not part of the type, use `(_event as any).path`.

#### 3d. Wire `checkStaleFolderViewTabs` into `onTabChanged`

In `onTabChanged()`, after `updateActiveFileHighlight()`, add:

```typescript
checkStaleFolderViewTabs();
```

#### 3e. Clear registry on `onDisable`

In `onDisable`, add:
```typescript
clearFolderViewRegistry();
```

Export `clearFolderViewRegistry` from `tab.ts`:
```typescript
export function clearFolderViewRegistry(): void {
  _registry.length = 0;
}
```

---

## Acceptance Criteria

### Tests to write: `tests/folder-view/tab.test.ts`

All tests must pass via `npm run test:run -- tests/folder-view/tab.test.ts`.

1. **FR-17 / EC-15**: `openFolderViewTab("/vault/Work/Reports")` and `openFolderViewTab("/vault/Personal/Reports")` → two separate entries in `_registry` with distinct `syntheticKey` values (`__fv__:/vault/Work/Reports` and `__fv__:/vault/Personal/Reports`).

2. **FR-17 dedup**: Calling `openFolderViewTab("/vault/A")` twice → `_registry` has exactly ONE entry for `/vault/A`; the second call replaces the first.

3. **FR-32 stale flag set**: `notifyFolderViewTabs("/vault/A/_folder.md")` when tab `__fv__:/vault/A` is NOT active → `staleRef.stale === true`.

4. **FR-31 immediate re-render**: `notifyFolderViewTabs("/vault/A/_folder.md")` when tab `__fv__:/vault/A` IS active → `rerender` is called (not stale flag set).

5. **FR-32 stale check**: `checkStaleFolderViewTabs()` when tab `__fv__:/vault/A` is active and `staleRef.stale === true` → `rerender` called, `staleRef.stale` reset to false.

6. **EC-18**: Stale tab not re-rendered until activated: `notifyFolderViewTabs` sets stale, then `checkStaleFolderViewTabs` with a different active tab → `rerender` NOT called.

7. **FR-12 fallback**: `renderFolderViewTabAsync` with `config.layout === ""` → `renderFallback` is called with notice `"No layout specified — showing raw content."`.

8. **FR-13 fallback**: `renderFolderViewTabAsync` with `config.layout === "unknown-thing"` → `renderFallback` called with notice `"Unknown layout 'unknown-thing' — showing raw content."`.

9. **EC-13**: Display title uses `escapeHtml`: folder path segment `"<script>"` → tab title is `"&lt;script&gt;"`.

10. **FR-33**: `notifyFolderViewTabs` does NOT affect document layout tabs (kind=editor tabs are not in `_registry`).

### Visual verification (after running `npm run build:plugins && npm run sync:plugins`)

1. Create a directory with `_folder.md` containing `---\nlayout: folder-cards\n---`.
2. Click the folder name label → a tab opens with the folder name as title (or `Loading…` briefly).
3. Click the same folder name label again → no duplicate tab (existing tab activates).
4. Open two directories with the same name in different parent paths → two independent tabs (EC-15).
5. Edit and save `_folder.md` while the Folder View tab is active → tab re-renders (FR-31).
6. Edit and save `_folder.md` while the Folder View tab is NOT active → switch to the tab → it re-renders (FR-32).
7. Create `_folder.md` with no `layout:` field → fallback notice shown (FR-12).
8. Create `_folder.md` with `layout: unknown-thing` → fallback notice with layout name (FR-13).

**EC-19 known limitation**: Vault switch while a Folder View tab is open — the tab persists showing stale content. This is acceptable v1 behavior. Document it in a comment in `tab.ts`.

**Run after this step**:
```
npm run build:plugins && npm run sync:plugins
```

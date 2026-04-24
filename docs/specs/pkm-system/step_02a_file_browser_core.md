---
title: "PKM Step 02a — File Browser Core (Panel, Tree Rendering, Vault Nodes)"
last-updated: "2026-04-24"
review-cadence-days: 14
status: active
---

# Step 02a — File Browser Core

## Goal

Register the File Browser as a sidebar panel, render the active vault's file tree (read-only), implement vault node display with the data-driven icon extension point, keyboard navigation, active file highlighting, and search filtering. No file write operations in this step.

**Prerequisite**: Step 01 complete. `vault-manager.ts` and all vault types are available.

---

## Files to Create

| File | Purpose |
|---|---|
| `src/plugins/file-browser/file-browser.plugin.ts` | IIFE plugin: sidebar panel registration, panel lifecycle, tree rendering orchestration |
| `src/plugins/file-browser/file-tree.ts` | Pure functions: buildTreeFromIndex, sortNodes, filterTree, diffTree |
| `src/plugins/file-browser/file-browser.css` | All File Browser visual styles |

---

## Files to Modify

| File | Change |
|---|---|
| `src/plugins/index.ts` (or equivalent plugin registry) | Register `file-browser` as a core plugin. |
| `src-tauri/src/commands/plugins.rs` (copy_core_plugins) | Add `file-browser.plugin.js` to the expected plugin list (stale cleanup step). |

---

## IIFE Plugin Structure (`file-browser.plugin.ts`)

The plugin follows the established IIFE pattern (same as backlinks, command-bar):

```typescript
// Must export a default UnifiedPlugin object from the IIFE body.
// Must NOT import directly from Tauri — use __TAURI_INTERNALS__.invoke.
// Must NOT import sidebar directly — use api.registerSidebarPanel().
// MAY import vault-manager.ts (bundled inline by Rollup).
// MAY import file-tree.ts (bundled inline by Rollup).
```

**`onEnable(api)`**:
1. Load plugin settings via `api.loadSettings()` (showAllFiles toggle state, etc.).
2. Register sidebar panel via `api.registerSidebarPanel(descriptor)`.
3. Subscribe to `vaultManager.onVaultChanged()` → re-render tree.
4. Subscribe to `vaultManager.onIndexUpdated()` → incremental tree update.
5. Subscribe to tab-change events from `__MARKABLE_TAB_MANAGER__` → update active file highlight.

**`onDisable(api)`**:
1. `api.unregisterSidebarPanel("file-browser")`.
2. Unsubscribe from `vaultManager.onVaultChanged()`.
3. Unsubscribe from `vaultManager.onIndexUpdated()`.
4. Unsubscribe from tab-change events.

**`SidebarPanelDescriptor`**:
```typescript
{
  id: "file-browser",
  title: "Files",
  side: "left",
  defaultWidth: 240,
  render(container) { /* build panel DOM */ },
  destroy(container) { container.innerHTML = ""; },
  headerActions: [
    { icon: "+", title: "New Note", onClick: () => handleNewNote() },
    { icon: "⋯", title: "Panel menu", onClick: () => togglePanelMenu() },
  ],
}
```

---

## `file-tree.ts` — Pure Functions

These functions have no side effects and no DOM dependencies. They operate on `VaultIndexEntry[]` and return plain data structures.

### `TreeNode` type

```typescript
export type TreeNodeType = "vault" | "directory" | "file";

export interface TreeNode {
  type: TreeNodeType;
  path: string;             // Absolute path
  name: string;             // Display name (no extension for .md files)
  children: TreeNode[];     // Empty for files
  expanded: boolean;        // For directories and vault nodes
  depth: number;            // 0 = root level
  iconClass: string;        // CSS class for icon: "vault-icon-default", "folder-icon", "file-icon"
  vaultId?: string;         // Set when type === "vault"
}
```

### Required exports

```typescript
/**
 * Build a tree from VaultIndexEntry[].
 * Root nodes are the vault's rootPaths (or their ancestors in the file tree).
 * Directories are synthesised from file paths (they are not in the index).
 * Respects expandedPaths: paths that should be shown as expanded.
 */
export function buildTreeFromIndex(
  entries: VaultIndexEntry[],
  rootPaths: string[],
  expandedPaths: Set<string>,
  vault: VaultEntry
): TreeNode[];

/**
 * Sort tree nodes in-place: directories before files, then alpha case-insensitive.
 * Applies recursively to children.
 */
export function sortNodes(nodes: TreeNode[]): TreeNode[];

/**
 * Filter tree to files whose names fuzzy-match query.
 * Returns a flat array of matching file nodes (no folder structure) when query is non-empty.
 * Returns the original tree (preserving structure) when query is empty.
 * Case-insensitive. Same scoring algorithm as Command Bar fuzzy ranker.
 */
export function filterTree(
  nodes: TreeNode[],
  query: string
): TreeNode[];

/**
 * Compute the minimal DOM operations needed to update a rendered tree.
 * Returns { toAdd, toRemove, toUpdate } sets of paths.
 * Used by the incremental update path (onIndexUpdated).
 */
export function diffTree(
  oldNodes: TreeNode[],
  newNodes: TreeNode[]
): { toAdd: string[]; toRemove: string[]; toUpdate: string[] };

/**
 * Resolve the CSS icon class for a vault node.
 * Extension point: checks vault.iconId and maps to CSS class.
 * Unknown iconId falls back to "vault-icon-default".
 */
export function getVaultIconClass(vault: VaultEntry): string;
```

---

## Tree Rendering (DOM, inside `file-browser.plugin.ts`)

The tree is rendered into the sidebar panel container as a `<ul class="file-tree">`. Each `TreeNode` maps to a `<li class="tree-node" data-path="..." data-type="...">`.

### Vault nodes

Vault nodes are `<li class="tree-node tree-node-vault" data-path="..." data-vault-id="...">`.

Structure:
```html
<li class="tree-node tree-node-vault" data-path="/path" data-vault-id="uuid">
  <span class="tree-node-indent"></span>
  <span class="tree-node-icon vault-icon-default"></span>
  <span class="tree-node-label">Vault Name</span>
  <span class="tree-node-chevron">▶</span>
</li>
```

Clicking a vault node calls `vaultManager.switchVault(vaultId)` and re-renders the tree.

When multiple vaults are configured, vault nodes appear at the top of the tree as roots. All other vaults are shown collapsed (only the active vault is expanded).

### Directory nodes

```html
<li class="tree-node tree-node-directory" data-path="/path">
  <span class="tree-node-indent" style="padding-left: calc(var(--depth) * 16px)"></span>
  <span class="tree-node-icon folder-icon"></span>
  <span class="tree-node-label">folder-name</span>
  <span class="tree-node-chevron" aria-expanded="true">▶</span>
</li>
```

The depth indent uses a CSS variable `--depth` set inline via `style.setProperty("--depth", node.depth)`.

### File nodes

```html
<li class="tree-node tree-node-file" data-path="/path/note.md" tabindex="0">
  <span class="tree-node-indent" style="..."></span>
  <span class="tree-node-icon file-icon"></span>
  <span class="tree-node-label">note-name</span>
</li>
```

File extension `.md` is NOT shown in the label (matches requirements FR-04.3).

Clicking a file node calls `__MARKABLE_TAB_MANAGER__.openFile(node.path)`.

### Panel header

```html
<div class="file-browser-header">
  <input class="file-browser-search" placeholder="Search files…" type="search" />
</div>
```

The search input is debounced 150ms. Non-empty query switches to flat filtered view; empty restores tree.

### Empty states

- No active vault: `<div class="file-browser-empty">Create your first vault to get started. <button>New Vault</button></div>`
- Active vault, no files: `<div class="file-browser-empty">No notes yet. Click the + button to create your first note.</div>`
- Search with no results: `<div class="file-browser-empty">No notes match '<em>{query}</em>'.</div>`

---

## Keyboard Navigation

When the File Browser panel has focus (any tree node has focus):

| Key | Action |
|---|---|
| `ArrowDown` | Move focus to next visible node |
| `ArrowUp` | Move focus to previous visible node |
| `Enter` | File: open in tab. Directory/Vault: toggle expand/collapse |
| `ArrowRight` | Expand collapsed directory (no-op if already expanded or is a file) |
| `ArrowLeft` | Collapse expanded directory (no-op if already collapsed or is a file) |
| `F2` | Activate inline rename on focused node |
| `Delete` | Trigger delete confirmation on focused node |

Focus management: each `<li>` has `tabindex="0"`. When the panel is shown (`onShow`), focus the first visible node or the active file node. Arrow key navigation uses `document.querySelector` to find the adjacent visible node — do NOT use DOM index arithmetic (fragile with filtered view).

---

## Active File Highlight

When the active tab changes (via `__MARKABLE_TAB_MANAGER__` event or polling), find the tree node whose `data-path` matches `__MARKABLE_CURRENT_FILE__`. Add `.tree-node-active` class to it; remove from all others.

The active node is scrolled into view via `node.scrollIntoView({ block: "nearest" })`.

If the active file is not in the current vault's tree (opened from outside the vault), no node is highlighted.

---

## Expanded State Persistence

Expanded directory paths are stored in the plugin settings (via `api.saveSettings`):
```json
{
  "expandedPaths": {
    "<vaultId>": ["/path/to/folder", "/path/to/other"]
  },
  "showAllFiles": false
}
```

On tree render, `expandedPaths[activeVaultId]` is loaded and passed to `buildTreeFromIndex`. On expand/collapse interaction, the set is updated and `api.saveSettings()` is called (debounced 500ms).

When the panel is re-opened after vault switch (EC-22), the expanded paths for the new vault are loaded. The previous vault's expanded paths are preserved in settings but not applied.

---

## CSS (`file-browser.css`)

All colours and fonts via CSS variables.

Key rules:
- `.file-tree` — `list-style: none; padding: 0; margin: 0; overflow-y: auto;`
- `.tree-node` — `display: flex; align-items: center; height: 28px; cursor: pointer; padding-right: 8px;`
- `.tree-node:hover` — `background: var(--hover-bg)`
- `.tree-node-active` — `background: var(--selection-bg); border-left: 2px solid var(--accent-color);`
- `.tree-node:focus` — `outline: 1px solid var(--accent-color); outline-offset: -1px;`
- `.tree-node-vault` — `font-weight: 600; border-bottom: 1px solid var(--border-color);`
- `.vault-icon-default` — vault icon (SVG or unicode glyph). Must be distinct from `.folder-icon`.
- `.folder-icon` — folder icon.
- `.file-icon` — document icon.
- `.tree-node-chevron` — rotates 90deg when `aria-expanded="true"`.
- `.file-browser-search` — full-width, uses `--input-bg`, `--input-border`, `--ui-font`.
- `.file-browser-empty` — centered, muted text color `var(--muted-text)`.

---

## Test Requirements (`tests/plugins/file-browser/file-browser.test.ts` and `file-tree.test.ts`)

Minimum 40 tests across both files. Pure function tests in `file-tree.test.ts`; DOM/integration tests in `file-browser.test.ts`.

### `file-tree.test.ts` (pure, min 20)

1. `buildTreeFromIndex`: empty entries → single vault root node with no children.
2. `buildTreeFromIndex`: one file at root → vault node + file child.
3. `buildTreeFromIndex`: nested file → intermediate directory node synthesised.
4. `buildTreeFromIndex`: expandedPaths contains a dir → that dir's `expanded: true`.
5. `buildTreeFromIndex`: expandedPaths does not contain a dir → `expanded: false`.
6. `sortNodes`: directories before files.
7. `sortNodes`: case-insensitive alpha within each group.
8. `sortNodes`: empty array → returns empty.
9. `filterTree`: empty query → returns original tree structure unchanged.
10. `filterTree`: query matches file name → returns flat array with that file.
11. `filterTree`: query matches no file → returns empty array.
12. `filterTree`: case-insensitive match.
13. `diffTree`: identical trees → empty toAdd/toRemove/toUpdate.
14. `diffTree`: new file added → path in toAdd.
15. `diffTree`: file removed → path in toRemove.
16. `diffTree`: file modified (different modified timestamp) → path in toUpdate.
17. `getVaultIconClass`: null/undefined iconId → "vault-icon-default".
18. `getVaultIconClass`: unknown iconId → "vault-icon-default".
19. `buildTreeFromIndex`: multiple rootPaths → multiple root-level entries.
20. `filterTree`: fuzzy match (e.g., "mtg" matches "meeting-notes") → returns match.

### `file-browser.test.ts` (DOM/mock, min 20)

1. Panel registers with id "file-browser" and side "left".
2. Panel renders vault node when active vault is set.
3. Panel renders empty state when no active vault.
4. Panel renders empty-notes state when active vault has no files.
5. File node click calls `__MARKABLE_TAB_MANAGER__.openFile`.
6. Vault node click calls `vaultManager.switchVault`.
7. Vault node click on the already-active vault → no-op (no redundant switch).
8. Active file is highlighted (`.tree-node-active` class on matching node).
9. Non-matching file has no `.tree-node-active` class.
10. Active file scrolled into view when panel is shown.
11. Search input debounced 150ms (mock timer).
12. Search with query → flat filtered view (no folder nesting).
13. Search cleared → tree structure restored.
14. Search with no results → empty-search state shown.
15. `onVaultChanged` callback triggers tree re-render.
16. `onIndexUpdated` callback triggers incremental update.
17. ArrowDown key moves focus to next node.
18. ArrowRight key expands collapsed directory.
19. ArrowLeft key collapses expanded directory.
20. Panel destroy clears container and unsubscribes from vault-manager.

---

## Acceptance Criteria

1. `npm run build:plugins` succeeds with no TypeScript errors.
2. `npx vitest run tests/plugins/file-browser/` passes all tests (min 40).
3. The File Browser panel appears in the left sidebar when the plugin is enabled.
4. With an active vault, the tree shows the vault's files and folders.
5. The vault node is visually distinct from folder nodes (different icon class).
6. Clicking a file node opens it in the editor.
7. Clicking a vault node switches the active vault and rebuilds the tree.
8. The active file (current tab) has `.tree-node-active` styling.
9. Typing in the search input filters the tree to matching files (debounced).
10. Clearing the search restores the full tree.
11. No active vault → "Create your first vault" empty state.
12. Active vault, no files → "No notes yet" empty state.
13. Keyboard navigation (arrow keys, Enter) works correctly with focus visible.
14. Expanded state persists across panel open/close cycles.

---

## Edge Cases Covered

- EC-07: vault root path inaccessible → panel shows error state "Vault root path '[path]' is no longer accessible." (tree not rendered).
- EC-08: index capped → header notice "Showing [N] of [total] notes. Increase the index limit in Vault Settings."
- EC-14: vault with 0 files → "No notes yet" empty state.
- EC-22: File Browser closed when vault switch occurs → on next open, new vault's tree is shown.
- EC-23: fuzzy search returns no results → "No notes match" empty state.

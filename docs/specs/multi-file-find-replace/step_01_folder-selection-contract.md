---
title: Step 01 — Folder selection contract (file-browser plugin)
last-updated: "2026-05-03"
review-cadence-days: 90
status: active
---

# Step 01 — Folder selection contract

## Objective

Extend `file-browser.plugin.ts` to expose `window.__MARKABLE_FILE_BROWSER__`
as a global object with a `getSelectedFolderPath(): string | null` accessor.
The find widget will read this accessor in step_02 to determine the folder scope
root path.

After this step `npm run test:run` and
`npm run build:plugins && npm run sync:plugins` must both succeed.

---

## Design decision (from 00_index.md)

The global accessor pattern is chosen over a DOM event for two reasons:

1. The find widget needs to pull the folder path synchronously at search time.
   A stateful accessor maps directly to this pull model; an event would require
   the find widget to maintain its own listener and cached copy.
2. The file-browser already follows the `window.__MARKABLE_OPEN_MANAGE_VAULTS__`
   global pattern (line 2972). A sibling global is architecturally consistent.

---

## Files to edit

- `src/plugins/file-browser/file-browser.plugin.ts`

---

## What to change

### 1. Add a module-level state variable for the selected folder path

After the existing module-level state block (around line 200, near the other
`let _...` declarations), add:

```typescript
/**
 * The absolute path of the folder currently selected/highlighted in the
 * file browser. Updated when the user right-clicks a folder node (context
 * menu target) or single-clicks a folder node. null when no folder is
 * selected or when only files are selected.
 *
 * Exposed via window.__MARKABLE_FILE_BROWSER__.getSelectedFolderPath()
 * so the find widget can read it without a direct import dependency.
 */
let _selectedFolderPath: string | null = null;
```

### 2. Update `_selectedFolderPath` on folder node click

The file-browser renders tree nodes via `renderTreeNode`. Each node has a click
handler. Locate the click handler that calls
`__MARKABLE_TAB_MANAGER__?.openFileInTab` (around line 1451). The node type is
available at click time from the `TreeNode` data bound to the element.

Add a folder-selection update in the click handler. For directory nodes, set
`_selectedFolderPath` to the node's path and dispatch a DOM event so other
components can react if needed:

```typescript
// Inside the tree node click handler, after determining node type:
if (node.type === "directory" || node.type === "vault") {
  _selectedFolderPath = node.path;
  window.dispatchEvent(
    new CustomEvent("markable-folder-selected", { detail: { path: node.path } })
  );
} else {
  // File or other non-directory node: clear the folder selection.
  _selectedFolderPath = null;
  window.dispatchEvent(
    new CustomEvent("markable-folder-selected", { detail: { path: null } })
  );
}
```

Note: The DOM event is dispatched as a secondary side-effect only. The find
widget's primary mechanism is the synchronous accessor. The event is emitted
so future consumers can subscribe without polling.

### 3. Update `_selectedFolderPath` when the context menu is invoked on a folder

Locate `showContextMenu()` (around line 2017). It receives the path of the
right-clicked node. At the top of that function, before the menu is built,
update the selected folder path if the node is a directory:

```typescript
// At the start of showContextMenu(path, type, ...):
if (type === "directory") {
  _selectedFolderPath = path;
} else if (type === "file") {
  _selectedFolderPath = null;
}
// vault-root right-clicks: do NOT clear the selection; treat vault root
// as a valid folder scope (same as "vault" scope in the find widget).
```

### 4. Clear `_selectedFolderPath` when the vault changes

In `setupVaultSubscriptions`, the `onVaultChanged` callback already handles
clearing the tree. Add one line to clear the folder selection too:

```typescript
_selectedFolderPath = null;
```

Place this immediately after the existing `_currentTree = []` reset (or
equivalent clearing statement) inside the `onVaultChanged` callback.

### 5. Register the global in `onEnable`

In `plugin.onEnable()`, after the existing
`(window as any).__MARKABLE_OPEN_MANAGE_VAULTS__ = openManageVaultsModal;`
line (line 2972), add:

```typescript
(window as any).__MARKABLE_FILE_BROWSER__ = {
  getSelectedFolderPath(): string | null {
    return _selectedFolderPath;
  },
};
```

### 6. Null the global in `onDisable`

In `plugin.onDisable()`, after the existing
`(window as any).__MARKABLE_OPEN_MANAGE_VAULTS__ = null;` line (line 3007),
add:

```typescript
(window as any).__MARKABLE_FILE_BROWSER__ = null;
_selectedFolderPath = null;
```

---

## Test file to create

`tests/plugins/file-browser/folder-selection.test.ts`

### Mock setup (same pattern as `file-browser.test.ts`)

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import plugin, { _testing } from "../../../src/plugins/file-browser/file-browser.plugin";
import type { VaultEntry } from "../../../src/lib/vault-types";

// Standard mock helpers from file-browser.test.ts
function makeVault(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    id: "test-vault",
    name: "Test Vault",
    rootPaths: ["/notes"],
    excludePatterns: [],
    maxIndexSize: 500,
    created: "2026-01-01T00:00:00Z",
    lastOpened: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

let mockApi: any;

beforeEach(() => {
  // Reset globals
  (window as any).__MARKABLE_VAULT_MANAGER__ = {
    getActiveVault: vi.fn(() => makeVault()),
    getVaultIndex: vi.fn(() => null),
    onVaultChanged: vi.fn(),
    offVaultChanged: vi.fn(),
    onIndexUpdated: vi.fn(),
    offIndexUpdated: vi.fn(),
  };
  (window as any).__MARKABLE_TAB_MANAGER__ = {
    openFileInTab: vi.fn(),
    openMediaInTab: vi.fn(),
    getTabs: vi.fn(() => []),
  };
  (window as any).__TAURI_INTERNALS__ = { invoke: vi.fn().mockResolvedValue(null) };

  mockApi = {
    registerSidebarPanel: vi.fn(),
    unregisterSidebarPanel: vi.fn(),
  };
});

afterEach(() => {
  plugin.onDisable(mockApi);
  document.body.innerHTML = "";
  delete (window as any).__MARKABLE_FILE_BROWSER__;
  delete (window as any).__MARKABLE_VAULT_MANAGER__;
  delete (window as any).__MARKABLE_TAB_MANAGER__;
  delete (window as any).__TAURI_INTERNALS__;
});
```

### Required test cases

**Test FS-1 — global is registered on enable**
```
plugin.onEnable(mockApi)
assert (window as any).__MARKABLE_FILE_BROWSER__ is not null
assert typeof (window as any).__MARKABLE_FILE_BROWSER__.getSelectedFolderPath === "function"
```

**Test FS-2 — getSelectedFolderPath returns null initially**
```
plugin.onEnable(mockApi)
assert (window as any).__MARKABLE_FILE_BROWSER__.getSelectedFolderPath() === null
```

**Test FS-3 — global is cleared on disable**
```
plugin.onEnable(mockApi)
plugin.onDisable(mockApi)
assert (window as any).__MARKABLE_FILE_BROWSER__ === null or undefined
```

**Test FS-4 — getSelectedFolderPath returns null after disable**
```
plugin.onEnable(mockApi)
const accessor = (window as any).__MARKABLE_FILE_BROWSER__
plugin.onDisable(mockApi)
// accessor is now detached; getSelectedFolderPath should return null
// (the module-level variable was cleared in onDisable)
assert accessor.getSelectedFolderPath() === null
```

Note: Test FS-4 verifies the closure captures the live module-level variable,
not a snapshot. After `onDisable` clears `_selectedFolderPath`, any retained
reference to the accessor object must return null.

**Test FS-5 — vault change clears selected folder path**
```
plugin.onEnable(mockApi)
// Simulate a vault-changed event that passes null (vault deactivated)
const vaultChangedCb = (window as any).__MARKABLE_VAULT_MANAGER__.onVaultChanged.mock.calls[0][0]
vaultChangedCb(null)
assert (window as any).__MARKABLE_FILE_BROWSER__.getSelectedFolderPath() === null
```

---

## Acceptance criteria for this step

- AC-S1-1: `window.__MARKABLE_FILE_BROWSER__` is a non-null object when the
  file-browser plugin is enabled.
- AC-S1-2: `getSelectedFolderPath()` returns `null` before any folder is
  interacted with.
- AC-S1-3: `window.__MARKABLE_FILE_BROWSER__` is null/absent when the plugin
  is disabled.
- AC-S1-4: The selected folder path is cleared when the vault changes.
- AC-S1-5: No existing file-browser tests regress.
- AC-S1-6: `npm run build:plugins && npm run sync:plugins` succeeds.

---

## After this step

```bash
npm run test:run -- tests/plugins/file-browser/folder-selection.test.ts
npm run test:run
npm run build:plugins && npm run sync:plugins
```

All tests must pass. Proceed to step_02.

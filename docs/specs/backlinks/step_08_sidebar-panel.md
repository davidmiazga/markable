---
title: "Step 8: Sidebar Panel"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Step 8: Sidebar Panel

## Goal

Register a sidebar panel via `api.registerSidebarPanel()` that displays a list of files linking to the current document. Each entry is clickable (navigates to the file in a tab).

## Acceptance Criteria

1. Panel registered with `id: "backlinks"`, `title: "Backlinks"`, `side: "right"`, `defaultWidth: 220`.
2. Panel shows a list of filenames (without `.md` extension) that link to the current file.
3. Entries are sorted alphabetically.
4. Clicking an entry opens the file in a tab via `tabManager.openFileInTab()`.
5. Empty state: centered "No backlinks" text.
6. Loading state: centered "Scanning..." text during index rebuild.
7. Panel updates when the index is rebuilt or the active tab changes.
8. CSS follows the auto-toc pattern: injected `<style>` tag, uses existing CSS variables.

## Design

### CSS

```css
const BACKLINKS_CSS = `
.backlinks-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 0;
}

.backlink-item {
  display: block;
  width: 100%;
  background: none;
  border: none;
  border-left: 2px solid transparent;
  text-align: left;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  line-height: 1.4;
  padding: 4px 12px;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-sizing: border-box;
}

.backlink-item:hover {
  background: var(--code-bg);
  color: var(--text-primary);
  border-left-color: var(--link-color);
}

.backlink-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  color: var(--text-secondary);
  pointer-events: none;
  user-select: none;
}
`;
```

Style ID: `__markable_backlinks_css__`

### Module-Level State

```typescript
/** The .backlinks-list div inside the sidebar panel. */
let _backlinksListEl: HTMLElement | null = null;

/** Whether the index is currently being rebuilt (show "Scanning..."). */
let _isScanning = false;

/** Most recent backlinks result. */
let _currentBacklinks: string[] = [];
```

### Panel Registration (in onEnable)

```typescript
api.registerSidebarPanel({
  id: "backlinks",
  title: "Backlinks",
  side: "right",
  defaultWidth: 220,

  render(container: HTMLElement): void {
    const list = document.createElement("div");
    list.className = "backlinks-list";
    container.appendChild(list);
    _backlinksListEl = list;

    // Wire the index builder callbacks
    _onScanningStateChanged = (scanning: boolean) => {
      _isScanning = scanning;
      rebuildBacklinksDOM();
    };
    _onIndexRebuilt = (backlinks: string[]) => {
      _currentBacklinks = backlinks;
      _isScanning = false;
      rebuildBacklinksDOM();
    };

    // Render initial state
    rebuildBacklinksDOM();
  },

  destroy(_container: HTMLElement): void {
    _backlinksListEl = null;
    _onScanningStateChanged = null;
    _onIndexRebuilt = null;
  },
});
```

### `rebuildBacklinksDOM(): void`

```typescript
function rebuildBacklinksDOM(): void {
  if (!_backlinksListEl) return;

  _backlinksListEl.innerHTML = "";

  // Loading state
  if (_isScanning) {
    const el = document.createElement("div");
    el.className = "backlink-empty";
    el.textContent = "Scanning...";
    _backlinksListEl.appendChild(el);
    return;
  }

  // Empty state
  if (_currentBacklinks.length === 0) {
    const el = document.createElement("div");
    el.className = "backlink-empty";
    el.textContent = "No backlinks";
    _backlinksListEl.appendChild(el);
    return;
  }

  // Backlinks list
  for (const filename of _currentBacklinks) {
    const btn = document.createElement("button");
    btn.className = "backlink-item";
    // Display without .md extension
    btn.textContent = filename.endsWith(".md") ? filename.slice(0, -3) : filename;
    btn.title = filename;

    btn.addEventListener("click", () => {
      const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
      const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;

      if (!tabManager || !currentFile) return;

      const dir = currentFile.replace(/\/[^/]*$/, "");
      const filePath = `${dir}/${filename}`;
      void tabManager.openFileInTab(filePath);
    });

    _backlinksListEl.appendChild(btn);
  }
}
```

## TDD Test Plan

```
describe("Backlinks sidebar panel", () => {
  test("renders 'No backlinks' when backlinks array is empty")
  test("renders 'Scanning...' when isScanning is true")
  test("renders backlink items for each filename")
  test("displays filenames without .md extension")
  test("items are sorted alphabetically")
  test("clicking item calls openFileInTab with correct path")
  test("EC-1: untitled document shows 'No backlinks'")
  test("EC-14: tab switch to untitled clears panel to 'No backlinks'")
  test("panel updates when index is rebuilt")
  test("panel updates when scanning state changes")
})

describe("CSS injection", () => {
  test("injectCSS creates style tag with correct id")
  test("removeCSS removes style tag")
  test("injectCSS is idempotent (no duplicate tags)")
})
```

## Edge Cases Addressed

| EC | Handling |
|---|---|
| EC-1 | Untitled document: index builder sets `_currentBacklinks = []`, panel shows "No backlinks" |
| EC-14 | Tab switch to untitled: index builder clears everything, `_onIndexRebuilt([])` triggers "No backlinks" |

## NFR-5: CSS Theme Compatibility

All colors use existing CSS variables:
- `--text-primary`, `--text-secondary`: text colors
- `--code-bg`: hover background
- `--link-color`: active border indicator on hover
- `--selection-bg`: not used (keeping the panel simpler than auto-toc since backlink items do not have an "active" state)

Font sizes are hard-coded in px (12px) and independent of editor zoom, matching the auto-toc panel pattern.

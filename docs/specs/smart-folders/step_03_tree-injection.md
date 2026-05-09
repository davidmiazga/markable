---
title: Step 03 — Tree integration, virtual nodes, expansion state
last-updated: "2026-05-08"
review-cadence-days: 30
status: active
---

# Step 03 — Tree integration, virtual nodes, expansion state

## Goal

Inject Smart Folders into the rendered tree as virtual `TreeNode`
entries — one per def, at the **top** of each vault root's children
(FR-14, FR-16). Their children are the matched files (flat, sorted by
modified desc — FR-18, Locked #12). Expansion state survives rebuilds
via the synthetic key `__smart__/<id>` (Locked #14).

After this step, when test-data is wired in step_07, Smart Folders
appear in the file browser tree, expand, show their files, and the
files open in tabs on click — all via existing tree event handlers.

---

## Files to create

1. `src/plugins/file-browser/smart-folders/tree-injection.ts` — pure
   helpers that consume `EvaluationResult` and produce `TreeNode`s.

## Files to modify

1. `src/plugins/file-browser/file-tree.ts` — extend `TreeNode` interface,
   accept smart-folder injections in `buildTreeFromIndex`, guard
   `sortNodes` recursion.
2. `src/plugins/file-browser/file-browser.plugin.ts` — pass injections
   into `buildTreeFromIndex`. Update `data-smart-folder-id` attribute on
   the rendered `<li>`. Update `tree-node-smart-folder` class.

---

## 1. Extend `TreeNode` (in `file-tree.ts`)

Add two optional fields:

```typescript
export interface TreeNode {
  // … existing fields …

  /** When set, this node is a virtual smart-folder root. Synthetic path uses __smart__/<id>. */
  smartFolderId?: string;

  /** Match count, populated for smart-folder nodes. Rendered as a faint suffix. */
  matchCount?: number;
}
```

Both fields are **optional** so existing call sites and tests remain
valid without modification.

---

## 2. `tree-injection.ts` — pure helpers

### Required exports

```typescript
import type { TreeNode } from "../file-tree";
import type { SmartFolderDef, EvaluationResult } from "./types";
import type { VaultIndexEntry } from "../../../lib/vault-types";

/** Synthetic prefix for smart-folder expansion-state keys. */
export const SMART_FOLDER_PATH_PREFIX = "__smart__/";

/** Compose the synthetic path used for expansion state and DOM data-path. */
export function smartFolderPath(id: string): string;

/** True if a path is a smart-folder synthetic key (used by sortNodes guard). */
export function isSmartFolderPath(path: string): boolean;

/** Build the synthetic TreeNode for one smart folder, including its file children. */
export function buildSmartFolderNode(
  def: SmartFolderDef,
  result: EvaluationResult,
  entriesByPath: Map<string, VaultIndexEntry>,   // for resolving match paths to leaves
  expandedPaths: Set<string>,
  rootDepth: number,                              // depth of vault root + 1
): TreeNode;

/** Inject smart-folder nodes at the top of a vault root's children list (after-sort prepend). */
export function injectSmartFolderNodes(
  rootChildren: TreeNode[],
  smartFolderNodes: TreeNode[],
): TreeNode[];
```

### `smartFolderPath` and `isSmartFolderPath`

```typescript
export function smartFolderPath(id: string): string {
  return `${SMART_FOLDER_PATH_PREFIX}${id}`;
}

export function isSmartFolderPath(path: string): boolean {
  return path.startsWith(SMART_FOLDER_PATH_PREFIX);
}
```

### `buildSmartFolderNode` algorithm

```text
const synthPath = smartFolderPath(def.id)
const expanded  = expandedPaths.has(synthPath)

const children: TreeNode[] = result.matches.map(matchPath => {
  const entry = entriesByPath.get(matchPath)
  // For non-md files, entry is undefined — synthesize a minimal file node.
  return {
    type: "file",
    path: matchPath,
    name: stripMdExtension(basename(matchPath)),
    children: [],
    expanded: false,
    depth: rootDepth + 1,
    iconClass: chooseFileIconClass(matchPath),     // reuse existing logic if present, else "file-icon"
    modified: entry?.modified ?? 0,
  }
})

return {
  type: "directory",                  // FR-15: standard directory node, inherits behavior
  path: synthPath,
  name: def.name,
  children,
  expanded,
  depth: rootDepth,
  iconClass: "folder-smart",          // step_04 wires the SVG to this class
  smartFolderId: def.id,
  matchCount: result.count,
}
```

### `injectSmartFolderNodes` algorithm

Pure prepend — no sort, no merge:

```text
return [...smartFolderNodes, ...rootChildren]
```

The caller (modified `buildTreeFromIndex`) uses this **after**
`sortNodes` runs on `rootChildren`, so smart folders always appear
above the alphabetized real subdirectories — FR-14, EC-14.

---

## 3. Modify `buildTreeFromIndex` and `sortNodes` (in `file-tree.ts`)

### Change 1 — accept injections argument

Add a sixth, optional parameter:

```typescript
export function buildTreeFromIndex(
  entries: VaultIndexEntry[],
  rootPaths: string[],
  expandedPaths: Set<string>,
  vault: VaultEntry,
  directories?: string[],
  smartFolderInjections?: TreeNode[],   // NEW — pre-built smart-folder nodes
): TreeNode[] {
  // existing logic unchanged …

  /* After all rootChildren are populated, prepend smart-folder injections.
     They must appear above real subdirs (FR-14). Since sortNodes runs
     after this function returns, we mark the smart-folder nodes so
     sortNodes leaves them in place — see Change 2. */
  if (smartFolderInjections && smartFolderInjections.length > 0) {
    rootChildren.unshift(...smartFolderInjections);
  }

  // existing vault-node wrap unchanged …
}
```

**Why pass pre-built nodes instead of building inside?** Keeps
`file-tree.ts` free of imports from `smart-folders/`. The plugin is the
composition point.

### Change 2 — guard `sortNodes` recursion

`sortNodes` currently sorts every children array recursively. Smart-folder
children are pre-sorted by the evaluator (modified desc) and **must
not** be re-sorted. Also: smart-folder *roots* must end up at the top of
their siblings — they cannot participate in alphabetical sort.

Modify `sortNodes`:

```typescript
export function sortNodes(nodes: TreeNode[]): TreeNode[] {
  /* Smart-folder nodes are kept in their input order at the front of
     the array — they are pre-prepended by buildTreeFromIndex (or, when
     called recursively, by the parent that owned them). We sort the
     non-smart subset and concatenate.  */
  const smart = nodes.filter(n => n.path.startsWith("__smart__/"));
  const real  = nodes.filter(n => !n.path.startsWith("__smart__/"));

  real.sort((a, b) => {
    const aIsDir = a.type === "directory" || a.type === "vault";
    const bIsDir = b.type === "directory" || b.type === "vault";
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  /* Recurse into REAL nodes only — smart-folder children are evaluator-sorted. */
  for (const node of real) {
    if (node.children.length > 0) sortNodes(node.children);
  }

  /* Mutate the original array so callers' references stay valid. */
  nodes.length = 0;
  nodes.push(...smart, ...real);
  return nodes;
}
```

**Important**: `nodes.length = 0; nodes.push(...)` mutates in place
because the existing API returns the same reference and several call
sites depend on that (e.g. `_currentTree = tree` in
`renderTreeContent`).

### Change 3 — `diffTree` is unaffected

`diffTree` already keys on `path`; synthetic `__smart__/...` paths
participate naturally. When a smart folder is renamed, its `name`
changes but path stays identical → `diffTree.toUpdate` includes it,
which triggers a label re-render. When a smart folder is deleted, its
path disappears → `toRemove`. No code change needed — verify in tests.

---

## 4. Modify `file-browser.plugin.ts`

### Change 1 — import injection helpers

```typescript
import {
  buildSmartFolderNode,
  smartFolderPath,
  isSmartFolderPath,
} from "./smart-folders/tree-injection";

import {
  getAllEvaluationResults,
} from "./smart-folders";
```

### Change 2 — extend `renderTreeContent`

After this block (near line 1517):

```typescript
const tree = buildTreeFromIndex(
  allEntries,
  activeVault.rootPaths,
  _expandedPaths,
  activeVault,
  vaultIndex.directories,
);
```

Replace with:

```typescript
const entriesByPath = new Map(vaultIndex.entries.map(e => [e.path, e]));
const evalResults   = getAllEvaluationResults();
const sfNodes: TreeNode[] = _smartFolders
  .map(def => {
    const r = evalResults.get(def.id);
    if (!r) return null;
    return buildSmartFolderNode(def, r, entriesByPath, _expandedPaths, /* rootDepth */ 1);
  })
  .filter((n): n is TreeNode => n !== null);

const tree = buildTreeFromIndex(
  allEntries,
  activeVault.rootPaths,
  _expandedPaths,
  activeVault,
  vaultIndex.directories,
  sfNodes,
);
```

Then `sortNodes(tree)` runs as today and leaves the smart-folder
prepend intact (Change 2 above).

### Change 3 — `buildNodeEl` recognizes smart-folder nodes

In `buildNodeEl` (around line 1139), after the existing class
assignment, add:

```typescript
if (node.smartFolderId) {
  li.classList.add("tree-node-smart-folder");
  li.setAttribute("data-smart-folder-id", node.smartFolderId);
}
```

These are read by step_06's context-menu dispatcher.

### Change 4 — empty-match hint child row

When a smart folder is **expanded** AND has zero matches, render a
`<li class="smart-folder-empty-hint">No matches</li>` as its only
child (EC-03). Two implementation choices:

**Choice A** — handle it inside `buildSmartFolderNode` by synthesizing
a sentinel `TreeNode` with `type: "file"`, `path: "__smart__/<id>/__empty__"`,
which the renderer styles via the empty-hint class. **Architect
recommends Choice A** because it keeps the renderer (`renderNodes`)
ignorant of smart-folder specifics.

In `buildNodeEl`, recognize the sentinel:

```typescript
if (node.path.endsWith("/__empty__") && isSmartFolderPath(node.path)) {
  li.className = "tree-node smart-folder-empty-hint";
  li.removeAttribute("tabindex");
  // No icon, no click handler.
  const span = document.createElement("span");
  span.className = "tree-node-label";
  span.textContent = "No matches";
  li.appendChild(span);
  return li;
}
```

In `attachNodeListeners` (the dispatch that wires click/contextmenu),
skip listener attachment for empty-hint rows.

---

## 5. CSS additions (FILE_BROWSER_CSS or file-browser.css)

```css
.tree-node-smart-folder { /* visual marker only; structure already directory-like */ }
.smart-folder-empty-hint {
  cursor: default;
  opacity: .55;
  font-style: italic;
  padding-left: 36px;     /* align with file-leaf indent */
  user-select: none;
}
.smart-folder-empty-hint:hover { background: transparent; }
```

The `.folder-smart` icon mapping is added in step_04 once the SVG is
fetched.

---

## Tests to pass after this step

Create `tests/plugins/file-browser/smart-folders.tree-injection.test.ts`:

| Test name | Asserts |
|---|---|
| `smartFolderPath / isSmartFolderPath round-trip` | sanity |
| `buildSmartFolderNode includes match files in modified-desc order` | Locked #12 |
| `buildSmartFolderNode honors expandedPaths` | __smart__/id present → expanded true |
| `buildSmartFolderNode emits empty-hint sentinel when zero matches` | EC-03 |
| `injectSmartFolderNodes prepends in input order` | order preserved |
| `buildTreeFromIndex with injections puts smart folders above real dirs` | FR-14 |
| `sortNodes leaves smart-folder roots at top after sorting reals` | EC-14 |
| `sortNodes does NOT recurse into smart-folder children` | spy on sortNodes is called once for top, never for sf children |
| `sortNodes mutates input reference` | array identity preserved |
| `diffTree handles smart-folder rename: emits toUpdate for synthetic path` | EC-05 |
| `diffTree handles smart-folder delete: emits toRemove` | EC-06 |

Plus a small DOM-style integration test in
`tests/plugins/file-browser/file-browser.test.ts`:

- "smart folder li carries data-smart-folder-id attribute"
- "smart folder li has class tree-node-smart-folder"
- "empty-hint row has no tabindex and no click handler"

---

## Done when

- [ ] Tree-injection unit tests pass.
- [ ] `npm run test:run` is green; no regression in
      `tests/plugins/file-browser/file-tree.test.ts`.
- [ ] `npm run build:plugins && npm run sync:plugins` succeeds.
- [ ] No visible UI yet — until step_07 wires the eager-eval triggers
      and step_04 lands the icon, smart folders won't render anything
      (the cache is empty). Verified by running the app.

---

## Constraints

- **Do NOT** modify `_indexUpdatedCb` / `_vaultChangedCb` here — that
  is step_07. This step is rendering plumbing only.
- **Do NOT** touch `attachKeyboardHandler` — smart folders inherit the
  existing arrow/Enter behavior because they are `type: "directory"`
  (NFR-05).
- File children of a smart folder must reuse the existing
  `buildActivateHandler` for click-to-open — DO NOT add a parallel
  click handler. Reuse satisfies FR-19.
- Each function ≤ 30 lines.

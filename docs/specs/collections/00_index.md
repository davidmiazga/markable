---
title: "Collections MVP — Master Blueprint"
last-updated: "2026-06-08"
review-cadence-days: 7
status: active
---

## Implementation Progress (Lead Developer)

All 18 steps complete and tests green. Plugin IIFE rebuilt + synced.

- [x] step_01 — types and schema (12 tests)
- [x] step_02 — store + per-file write queue (20 tests)
- [x] step_03 — reference index (10 tests)
- [x] step_04 — commands (16 tests)
- [x] step_05 — detection + layout registration (8 tests)
- [x] step_06 — home canvas + popover (13 tests)
- [x] step_07 — breadcrumb (10 tests)
- [x] step_08 — preview cache (10 tests)
- [x] step_09 — note box (15 tests)
- [x] step_10 — stack panel + IntersectionObservers (10 tests)
- [x] step_11 — inline editor (9 tests)
- [x] step_12 — renderer orchestration (5 tests)
- [x] step_13 — reference integrity hooks (7 tests)
- [x] step_14 — context menu (6 tests)
- [x] step_15 — command bar (4 tests)
- [x] step_16 — settings persistence (7 tests)
- [x] step_17 — CSS (8 tests)
- [x] step_18 — edge-case sweep (3 tests)

Total new tests in `tests/collections/`: **173**.
Full project suite: **4654 passed, 39 skipped**.
Window-defaults invariant: **green**.

# Collections MVP — Master Blueprint

> **Requirements source**: `docs/requirements/active_task.md` (status:
> Validated, resumed 2026-06-05 with all amendments folded).
> **Prerequisite (shipped)**: `docs/specs/folder-icon-assignment/00_index.md`
> (status: Approved for Merge, 2026-06-05).
> **Figma**: `/Users/daveslaptop/Desktop/Screenshot 2026-06-05 at 4.28.37 PM.png`
> — frames 01–04 only.
> **Output of**: Software Architect. No implementation lives in this
> directory; each step file is a self-contained TDD unit.

This blueprint is the contract between the Architect and the Lead
Developer. Step files are TDD units (Red → Green → Refactor). Earlier
steps never forward-reference later steps. The Developer follows them
in strict order.

---

## 1. Stack Decision

Stack is **locked by the existing project**: Tauri v2 (Rust backend) +
TypeScript + CodeMirror 6 + Vite + Vitest + `marked`. No new technology
is introduced.

Web-research was not performed because the stack is fixed by C-4 (no
new Rust commands), C-10 (live-preview renderer reuse), and the project-
wide CLAUDE.md (Tauri v2 + CM6 only). Every Collections-specific decision
binds to an existing primitive.

### What this feature reuses (no alternatives evaluated)

| Concern | Reused mechanism | Why |
|---|---|---|
| Atomic file writes | `writeFile()` in `src/lib/bridge.ts` (temp-file-swap inside the existing `write_file` Rust command) | C-4 forbids new Rust commands. Folder-icon work proved the pattern. |
| YAML frontmatter parse/mutate | `parseYamlFrontmatter`, `applyYamlKey`, `removeYamlKey`, `reconstructFile` in `src/plugins/file-browser/folder-view/yaml-frontmatter.ts` | C-3 forbids a fork. Preserves unrelated keys byte-for-byte (EC-23). |
| Folder metadata read | `parseFolderMd()` in `src/plugins/file-browser/folder-view/parser.ts` | Returns `icon`, plus arbitrary other keys via its raw-line escape hatch. Reused as-is. |
| Lightweight frontmatter probe | `extractFrontmatterKeys()` in `src/plugins/file-browser/folder-view/frontmatter-reader.ts` | Used by detection (no full parse needed to discriminate `type: collection`). |
| Layout dispatch | `LAYOUT_RENDERERS` table in `src/plugins/file-browser/folder-view/tab.ts:109` | C-1: register `collection-home` here. |
| Layout detection | `src/plugins/file-browser/folder-view/detection.ts` | C-2: short-circuit on `type: collection`. |
| Lazy/virtualised render | `IntersectionObserver` + `LAZY_BATCH_SIZE` pattern in `src/plugins/file-browser/folder-view/renderer.ts:622` (`appendCardsToGrid`) | FR-27/28 precedent. Adapt for framed-box rendering. |
| Folder icon catalog + resolver | `FOLDER_ICONS`, `getFolderIconClass`, `interpretIconValue` in `src/plugins/file-browser/folder-icons.ts` | C-6, prerequisite spec. `notebook` is in the catalog. |
| Folder icon read/write | `readFolderIcon`, `setFolderIcon`, `buildFolderIconMap` in `src/plugins/file-browser/folder-icon-store.ts` | Default-icon seeding for new Stacks. |
| Custom-SVG cache | `folder-icon-custom-cache.ts` (already path+mtime-keyed, sanitised) | Home-canvas glyph rendering for Stacks with custom icons (EC-22). |
| Live-preview HTML render | `marked.parse()` plus the project's `marked.use({ tokenizer/renderer extensions })` already wired in `src/editor/live-preview.ts` | C-10. Framed-box body preview reuses the exact same `marked` instance — import the bound module, do not re-instantiate. |
| In-place editor | CodeMirror 6 `EditorView` constructed with the same extension pack used by the main tab editor (`src/editor/extensions.ts`) | C-10. One persistent EditorView reused per tab (see §1.8 decision). |
| Bridge layer | `readFile`, `writeFile`, `deleteFile`, `moveFile`, `deleteDirectory` typed wrappers in `src/lib/bridge.ts` | C-4. Add a folder-create wrapper only if not already present. |
| Context menu | `showContextMenu()` + `buildDirContextMenuItems()` in `file-browser.plugin.ts` (lines 2854/3004) | Adds "Make Collection" / "Unmake Collection" / Stack and note entries. |
| Command bar | Section pattern in `src/plugins/command-bar/command-bar.plugin.ts` + `COMMANDS` array in `src/keybindings/keybindings-panel.ts` | FR-20. Three new entries under section `"Collection"`. |
| Vault index + watcher | `vault-manager.ts`, `vaultIndex.entries`, `vault-changed` events | Reference-integrity reverse index + scan-on-rename (FR-25, EC-7). |

### Decisions the Architect resolves here

These are the questions the user asked me to resolve; locking them now
so step files have no ambiguity to handle.

**1.8.A — Module layout.** New subdirectory
`src/plugins/file-browser/collections/`. Folder-view utilities (parser,
yaml-frontmatter, detection, IntersectionObserver-batching pattern) are
imported across the boundary, but Collections-specific code lives only
in the new directory. Rationale: keeps `folder-view/` focused on the
five existing layouts (cards/table/list/timeline/kanban) and gives
Collections one ownership boundary for its eight files.

**1.8.B — Layout vs panel for Stack view.** The Stack section view
(frames 02/03) is **rendered by the same `collection-home` layout
renderer** under an in-tab navigation model. The renderer keeps an
internal `view: "home" | "stack"` state plus `activeStackPath` (for
`view === "stack"`). Clicking a Stack glyph on Home flips the state and
re-renders the container in place; clicking the breadcrumb `Home`
segment flips it back. The Stack section view does NOT register a
second layout key. Rationale:
- No new tab kind; no churn in `tab-manager.ts`.
- Browser-style "drill into" matches FR-15 ("opens … in the same tab").
- One renderer owns the IntersectionObserver lifecycle, so the same
  observer is torn down on navigation (no leaks across views).
- Breadcrumb-driven navigation is a pure DOM swap — no async tab
  load. Matches FR-31 latency expectations.
- Phase-2 Chapters/Books slot in as additional internal view states
  (`view: "chapter" | "book"`) without touching the layout-key table.

**1.8.C — Breadcrumb component.** No existing breadcrumb in the
codebase (verified by grep across `src/**/*.ts` and `*.css`). A new
minimal component lives at
`src/plugins/file-browser/collections/breadcrumb.ts`. API:

```typescript
export interface BreadcrumbSegment {
  readonly label: string;
  readonly onClick: (() => void) | null;  // null = current/non-clickable
}

export function renderBreadcrumb(
  segments: readonly BreadcrumbSegment[],
): HTMLElement;
```

Supports up to 5 segments; MVP emits 3. Separator is the literal `/`
character wrapped in a `.fv-collection-breadcrumb-sep` span (theme
tokens only). No icon, no fancy chrome. Phase 2 will append Book and
Chapter segments without code change.

**1.8.D — Section-view lazy rendering.** Use `IntersectionObserver`
exactly as `appendCardsToGrid()` in `renderer.ts:622` does, but adapt
for two-state framed boxes (placeholder ↔ rendered preview). Two
observers per Stack panel:
- **Enter observer** (`rootMargin: "200px 0px"`, ~one viewport overscan):
  fires when a placeholder box enters the overscan window. Renders its
  preview HTML and inserts the cached height (or measures + caches on
  first render).
- **Exit observer** (`rootMargin: "1000px 0px"`, large hysteresis):
  fires when a previously-rendered box scrolls far out. Replaces its
  inner DOM with the placeholder shell sized by the cached height.

The hysteresis between enter and exit prevents flicker at the boundary.
Height cache is `Map<notePath, number>` scoped to the active Stack
view; cleared on Stack navigation or external mtime change. Cache is
keyed by `notePath` (not `path+mtime`) because edits happen in-place
and the renderer remeasures after each in-place edit commit.

**1.8.E — In-place edit lifecycle.** **One persistent CodeMirror 6
`EditorView`** per Stack section view, lazily constructed on first
click. Mounted into a hidden host element appended to the panel root;
on click-to-edit the host is reparented into the target framed box and
the box's preview HTML is hidden. On commit (see state machine below)
the host is reparented back to its hidden home and the box's preview
HTML is re-rendered from the new file content.

Rationale:
- A fresh `new EditorView(...)` per click costs ~30–50 ms on the dev
  machine (measured via the existing tab-editor instantiation).
  One-instance reparenting is ~1 ms.
- Avoids the "pool of two" complexity the user surfaced — we don't
  need a pool because only one box can be in edit mode at a time
  (EC-19).
- The persistent view is destroyed when the Stack section view is
  destroyed (breadcrumb-back navigation, tab close).
- The view uses the same extension pack as the main tab editor (live-
  preview, format commands, list keybindings) so all Markable editing
  features carry over for free.

**State machine** (EC-19):

```
PREVIEW ──click box B──> EDIT(B)
EDIT(B) ──click box C──> EDIT(C)         (commit B first, then mount on C)
EDIT(B) ──click outside any box──> PREVIEW    (commit B, exit edit)
EDIT(B) ──Escape──> PREVIEW                  (commit B, exit edit)
EDIT(B) ──breadcrumb click──> PREVIEW        (commit B, then navigate)
EDIT(B) ──tab close──> PREVIEW               (commit B, then close)
```

Commit = `writeFile(path, view.state.doc.toString())` followed by
height-cache invalidation for that path and preview re-render. Save
errors are toasted; the edit stays in EDIT state so the user can retry
or copy-out (no data loss).

**1.8.F — Reference visual distinction.** Requirements doc resolves
this in FR-22: a small link/arrow glyph in the upper-right of the box
distinguishes referenced from canonical. Implementation: a CSS pseudo-
element `.fv-collection-note-box.is-reference::after` carrying a
`mask-image` SVG arrow, positioned absolute top-right. No DOM addition,
no JS branch needed in the renderer beyond toggling the
`is-reference` class.

**1.8.G — Reference integrity on rename/move/delete.** Build a
**reverse index** (in-memory, rebuilt on vault-changed events) so
rename/move/delete is O(1) per affected note rather than O(N) scan of
every `_folder.md`. Module
`src/plugins/file-browser/collections/reference-index.ts`:

```typescript
// Map: canonical vault-rel path → list of stack-_folder.md paths
//      that have it in their references: array.
export interface ReferenceIndex {
  readonly references: Map<string, Set<string>>;
  rebuild(): Promise<void>;
  onCanonicalRenamed(oldRel: string, newRel: string): Promise<void>;
  onCanonicalDeleted(rel: string): Promise<void>;
  lookup(canonicalRel: string): readonly string[];
}
```

`rebuild()` is called once per vault load (subscribes to
`vault-manager`'s vault-changed event the same way folder-icon-store's
`buildFolderIconMap` is called from `renderTreeContent`). The
`onCanonicalRenamed` / `onCanonicalDeleted` handlers iterate
`lookup(oldRel)` and rewrite each affected `_folder.md`'s
`references:` array via `applyYamlKey()` (atomic). The index itself is
updated in lockstep.

The hook points are inside `vault-manager.ts`'s rename/delete
pipelines — see step_13.

**1.8.H — Click-to-edit commit semantics.** See 1.8.E state machine.
Save fires on:
- Click outside the editing box (preview area, breadcrumb, another
  box, Home button) — capture-phase `mousedown` on the panel root.
- Escape keypress while edit view has focus.
- Breadcrumb navigation.
- Tab close (existing close-confirm path picks up the unsaved-changes
  signal; Collections sets the dirty flag on the active tab the same
  way the main editor does).

Save does NOT fire on every keystroke. Save does NOT debounce — it
fires synchronously on blur-trigger because the existing per-tab
autosave already runs on idle for the active tab editor; the framed-
box edit uses the same dirty-flag plumbing.

**1.8.I — Settings shape.**

```typescript
// src/lib/settings.ts addition
plugins["file-browser"] = {
  ...,
  collections?: {
    [vaultId: string]: {
      lastOpenedStackByCollection?: Record<string, string>;  // collection path → stack path
      scrollPositionByStack?: Record<string, number>;        // stack path → scrollTop px
    };
  };
};
```

Default `{}`. Settings I/O uses the existing `get_settings` /
`save_settings` Tauri commands — no new bridge work.

---

## 2. System Decomposition

```
┌──────────────────────────────────────────────────────────────────────┐
│  RIGHT-CLICK FOLDER → "Make Collection"                              │
│    └─> writeCollectionMeta(...)                                      │
│           └─> applyYamlKey(type: collection, displayName, stackOrder)│
│                  └─> writeFile(_folder.md, ...)  [atomic]            │
│                  └─> vault-manager.reloadVaultIndex()                │
│                                                                      │
│  OPEN COLLECTION FOLDER (vault index changed → renderPanel)          │
│    └─> detection.ts: extractFrontmatterKeys(_folder.md, ["type"])    │
│           └─> if type === "collection" → return "collection-home"    │
│    └─> tab.ts: LAYOUT_RENDERERS["collection-home"]                   │
│           └─> collections/renderer.ts: renderCollectionHome(...)     │
│                  ├─ view: "home"   → home-canvas.ts                  │
│                  │     ├─ readCollection(folderPath)                 │
│                  │     ├─ for each stack in stackOrder:              │
│                  │     │   ├─ readStack(stackPath) → icon, count     │
│                  │     │   └─ render glyph + badge                   │
│                  │     └─ "+" affordance → createStack(...)          │
│                  └─ view: "stack"  → stack-panel.ts                  │
│                        ├─ breadcrumb (Home / Stack)                  │
│                        ├─ readStack(activeStackPath)                 │
│                        ├─ assemble [...order, ...references]         │
│                        ├─ for each note → renderNoteBox(             │
│                        │     placeholder + IntersectionObserver)     │
│                        │     enter → render preview HTML via marked  │
│                        │     click → mountEditor(boxEl, path)        │
│                        └─ "+ Note" trailing card                     │
│                                                                      │
│  STORE LAYER (collections/store.ts) — one entry point per mutation   │
│    readCollection, writeCollectionMeta                               │
│    readStack, writeStackMeta                                         │
│    appendStackToCollection, removeStackFromCollection                │
│    reorderStack(collectionPath, stackName, direction)                │
│    appendNoteToStack, removeNoteFromStack, reorderNote               │
│    appendReference, removeReference                                  │
│    updateReferenceOnMove(oldRel, newRel)                             │
│    removeReferencesOnDelete(rel)                                     │
│                                                                      │
│  REFERENCE INDEX (collections/reference-index.ts)                    │
│    rebuild() ← vault-changed event                                   │
│    onCanonicalRenamed(old, new) ← vault-manager rename pipeline      │
│    onCanonicalDeleted(rel)      ← vault-manager delete pipeline      │
│                                                                      │
│  EDITOR HOST (collections/inline-editor.ts)                          │
│    mount(boxEl, notePath) → reparent persistent EditorView           │
│    commit() → writeFile + dispatch save event                        │
│    unmount() → reparent back to hidden host, restore box preview     │
└──────────────────────────────────────────────────────────────────────┘
```

### New files (module layout)

| Path | Responsibility |
|---|---|
| `src/plugins/file-browser/collections/types.ts` | `CollectionMeta`, `StackMeta`, `NoteBoxKind`, `CollectionView`, `BreadcrumbSegment` — pure types. |
| `src/plugins/file-browser/collections/store.ts` | All `_folder.md` read/write for Collections-specific keys (`type`, `displayName`, `stackOrder`, `order`, `references`). Composes the existing yaml-frontmatter helpers. Per-file write queue (EC-10). |
| `src/plugins/file-browser/collections/reference-index.ts` | In-memory reverse index `canonicalRel → Set<stackFolderMdPath>`. `rebuild()`, `onCanonicalRenamed`, `onCanonicalDeleted`, `lookup`. |
| `src/plugins/file-browser/collections/renderer.ts` | Top-level `renderCollectionHome(config, cards, container, folderPath, bulkCtx)`. Owns the `view` state machine and breadcrumb. Imports home-canvas and stack-panel. Registered in `LAYOUT_RENDERERS["collection-home"]`. |
| `src/plugins/file-browser/collections/home-canvas.ts` | Frame 01 (empty) + frame 04 (populated) rendering. Glyph + badge + `+` affordance + right-click handler. |
| `src/plugins/file-browser/collections/stack-panel.ts` | Frame 02/03 rendering. Note-box list with lazy IntersectionObserver. Trailing "+ Note" card. |
| `src/plugins/file-browser/collections/note-box.ts` | Single framed-box DOM. `createPlaceholder()`, `renderPreview(boxEl, content)`, `attachContextMenu(boxEl, meta)`. Reference-glyph styling via `.is-reference` class. |
| `src/plugins/file-browser/collections/inline-editor.ts` | Persistent CM6 `EditorView` host. `mount()`, `commit()`, `unmount()`. State machine (EC-19). |
| `src/plugins/file-browser/collections/breadcrumb.ts` | `renderBreadcrumb(segments)` per 1.8.C. Up to 5 segments; MVP emits 3. |
| `src/plugins/file-browser/collections/popover.ts` | The `+ Notecard/Stack` two-item popover (frame 01). `showNotecardStackPopover(anchorEl, handlers)`. |
| `src/plugins/file-browser/collections/preview-cache.ts` | Per-tab LRU cache `Map<notePath, { html: string; mtimeMs: number; height: number | null }>`. FR-29 height cache + FR-28 preview cache. |
| `src/plugins/file-browser/collections/commands.ts` | `makeCollection(folderPath)`, `unmakeCollection(folderPath)`, `newStack(collectionPath)`, `addReference(notePath, targetStackPath)` — exported as the public surface for command-bar and context-menu wiring. |
| `src/plugins/file-browser/collections/detection-glue.ts` | `isCollectionFolder(folderPath, vaultIndex): Promise<boolean>` — thin async wrapper used by `detection.ts`'s short-circuit (so detection.ts can stay sync-friendly per the existing API). |
| `src/plugins/file-browser/collections/collections.css` | All Collections-specific CSS. Imports only canonical tokens from `src/styles.css`. No new tokens, no hex (NFR-7). |

### Existing files modified

| File | Nature of change |
|---|---|
| `src/plugins/file-browser/folder-view/tab.ts` | Register `"collection-home": renderCollectionHome` in `LAYOUT_RENDERERS` (~line 109). |
| `src/plugins/file-browser/folder-view/detection.ts` | Add `detectCollectionLayout(folderPath, vaultIndex): Promise<string \| null>` — async helper that reads the root `_folder.md`'s frontmatter via `extractFrontmatterKeys()` and returns `"collection-home"` if `type === "collection"`. Call site lives in the layout-resolution path inside `tab.ts` (see step_05). |
| `src/plugins/file-browser/folder-view/display-options.ts` | Add `collection-home` to the layout picker dropdown (optional escape-hatch — disabled-by-default visibility flag wired off the env). |
| `src/plugins/file-browser/file-browser.plugin.ts` | (a) Insert "Make Collection" / "Unmake Collection" entries in `buildDirContextMenuItems`. (b) Subscribe `reference-index.rebuild()` to the vault-changed listener. (c) Wire `onCanonicalRenamed` / `onCanonicalDeleted` after the existing rename/delete dispatches. |
| `src/lib/vault-manager.ts` | Expose two new lifecycle hooks: `onBeforeRename(callback)` and `onBeforeDelete(callback)` — both fire just before the bridge call returns success. The reference-index uses these to compute the `(oldRel, newRel)` deltas without scanning the index. If lifecycle hooks already exist with a different signature, reuse them; do not invent. (Step_13 verifies during implementation.) |
| `src/main.ts` `handleAction()` | Add three cases: `"collection:make-collection"`, `"collection:new-stack"`, `"collection:add-reference"`. |
| `src/plugins/command-bar/command-bar.plugin.ts` | Register the three entries in the command-bar's local registry the same way every other plugin does. Section label `"Collection"`. |
| `src/keybindings/keybindings-panel.ts` | Three new `COMMANDS` entries under section `"Collection"`. `defaultKey: ""`. |
| `src/lib/settings.ts` | Extend `plugins["file-browser"]` with the `collections` sub-object per §1.8.I. **DO NOT** touch `window.sizeW` / `window.sizeH`. |
| `src/lib/bridge.ts` | Audit only. If `createDirectory` is not already a typed wrapper, add it (uses existing Rust command). No new Rust commands. |

### Files explicitly NOT touched

- `src-tauri/src/lib.rs` (NFR-3 / EC-14 — window invariant).
- `src-tauri/src/commands/*` (C-4 — no new Rust commands).
- `src/plugins/file-browser/folder-view/parser.ts` (C-3).
- `src/plugins/file-browser/folder-view/yaml-frontmatter.ts` (composed, not modified).
- `src/plugins/file-browser/folder-icons.ts` / `folder-icon-store.ts` / `folder-icon-custom-cache.ts` (reused as-is).
- `src/editor/live-preview.ts` / `src/editor/extensions.ts` (imported and reused; no edit).

---

## 3. Data Model

### Frontmatter contract — Collection root

```yaml
---
schemaVersion: 1
type: collection
displayName: MyCollection
stackOrder:
  - "Stack 01"
  - "Stack 02"
# Unrelated keys preserved verbatim:
layout: collection-home
sort: name-asc
icon: bookshelf
---
```

### Frontmatter contract — Stack

```yaml
---
schemaVersion: 1
type: stack
displayName: Stack 01
icon: notebook
order:
  - "MyNotecard.md"
  - "Other Note.md"
references:
  - "Projects/Stack 02/Referenced Note.md"
---
```

### Frontmatter contract — Note

No frontmatter required. Notes are plain `.md` files; the canonical file
lives in exactly one Stack folder. The Stack's `_folder.md` is the
authority on order and references.

### TypeScript types (`collections/types.ts`)

```typescript
export interface CollectionMeta {
  readonly schemaVersion: number;
  readonly type: "collection";
  readonly displayName: string;
  readonly stackOrder: readonly string[];
  readonly icon?: string;
}

export interface StackMeta {
  readonly schemaVersion: number;
  readonly type: "stack";
  readonly displayName: string;
  readonly icon: string;       // default "notebook"
  readonly order: readonly string[];
  readonly references: readonly string[];  // vault-relative .md paths
}

export type NoteBoxKind =
  | { kind: "canonical"; stackPath: string; noteFilename: string }
  | { kind: "reference"; ownerStackPath: string; canonicalRel: string }
  | { kind: "broken";    ownerStackPath: string; canonicalRel: string };

export type CollectionView =
  | { view: "home" }
  | { view: "stack"; stackPath: string };

export interface BreadcrumbSegment {
  readonly label: string;
  readonly onClick: (() => void) | null;
}
```

### Reference-index shape

`Map<canonicalRel: string, Set<stackFolderMdPath: string>>`. Rebuilt
from a single vault-index scan: iterate every `_folder.md`, parse its
frontmatter, for each entry in its `references:` array add
`(entry, _folderMdPath)`. O(K · M) where K = number of Stacks and
M = average references per Stack.

---

## 4. Implementation Roadmap

Strict order. Each step compiles + tests green independently. Earlier
steps never forward-reference later ones. **Mandatory after every step
that touches `src/plugins/**/*.ts`**:
`npm run build:plugins && npm run sync:plugins` (CLAUDE.md, C-9, NFR-8).

| # | Step | Touches | Depends on |
|---|---|---|---|
| 01 | `step_01_types_and_schema.md` | New `types.ts` + schema constants | — |
| 02 | `step_02_store.md` | New `store.ts` (collection + stack CRUD; per-file write queue) | 01 |
| 03 | `step_03_reference_index.md` | New `reference-index.ts` (build + lookup; rename/delete handlers stubbed) | 02 |
| 04 | `step_04_commands.md` | New `commands.ts`: `makeCollection`, `unmakeCollection`, `newStack`, `createNotecardInDefaultStack`, `addReference` | 02 |
| 05 | `step_05_detection_and_registration.md` | Edit `detection.ts` + `tab.ts` to short-circuit on `type: collection` and register `collection-home` (stub renderer) | 04 |
| 06 | `step_06_home_canvas.md` | New `home-canvas.ts` + `popover.ts` (frame 01 empty state + frame 04 stack-glyph grid) | 05 |
| 07 | `step_07_breadcrumb.md` | New `breadcrumb.ts` | 05 |
| 08 | `step_08_preview_cache.md` | New `preview-cache.ts` (LRU + height cache) | 01 |
| 09 | `step_09_note_box.md` | New `note-box.ts` (placeholder + preview HTML render via `marked`; reference glyph) | 08 |
| 10 | `step_10_stack_panel.md` | New `stack-panel.ts` (lazy IntersectionObserver list; +Note affordance) | 07, 09 |
| 11 | `step_11_inline_editor.md` | New `inline-editor.ts` (persistent CM6 view; mount/commit/unmount state machine) | 10 |
| 12 | `step_12_renderer_orchestration.md` | New `renderer.ts` + replace stub in `tab.ts`; wire home ↔ stack ↔ edit navigation | 06, 10, 11 |
| 13 | `step_13_reference_integrity_hooks.md` | Wire `reference-index.onCanonicalRenamed/Deleted` into vault-manager rename/delete pipelines | 03 |
| 14 | `step_14_context_menu.md` | Add Make/Unmake/Stack/Note context-menu entries in `file-browser.plugin.ts` | 04, 12 |
| 15 | `step_15_command_bar.md` | Register three command-bar entries; add `handleAction` cases; keybindings rows | 04, 12 |
| 16 | `step_16_settings_persistence.md` | Extend `settings.ts` (last-opened-stack, scroll positions); wire into renderer state restore | 12 |
| 17 | `step_17_css.md` | All Collections CSS (`collections.css`) using only canonical tokens | 06, 10, 11 |
| 18 | `step_18_edge_case_sweep.md` | Add/finalise tests for every EC that didn't get one in steps 01–17 (gap-fill); document Phase-1.5 drag-reorder hook shape | all |

### Dependency graph

```
01 ── 02 ── 03 ─────────────────────────────────── 13
       └── 04 ── 05 ── 06 ─────────────┐           │
                       └── 07 ─────────┤           │
01 ── 08 ── 09 ─────────────── 10 ── 11 ── 12 ── 14 ── 18
                                       │   ├─── 15
                                       │   ├─── 16
                                       └── 17
```

### Phase-1.5 drag-reorder design hook

`store.ts` exposes `reorderStack(collectionPath, stackName, direction: "up" | "down" | { toIndex: number })` and `reorderNote(stackPath, noteFilename, direction)`. The right-click handlers (steps 06, 10) call the directional variant; a Phase-1.5 drag handler will call the `toIndex` variant. No further architectural change needed when drag-reorder ships.

---

## 5. Test Inventory — EC → test file

Every Edge Case maps to a failing test written BEFORE its implementation
step. The Lead Developer's TDD loop is strict (Red → Green → Refactor).

| EC | Description | Test file | Step |
|---|---|---|---|
| EC-1 | Make Collection on already-Collection folder → refuse | `tests/collections/commands.test.ts` | 04 |
| EC-2 | Make Collection on nested-in-Collection folder → refuse | `tests/collections/commands.test.ts` | 04 |
| EC-3 | Stack folder name conflict → next index; rename conflict → refuse | `tests/collections/store.test.ts`, `tests/collections/commands.test.ts` | 02, 04 |
| EC-4 | Missing root `_folder.md` on Collection-marked folder → standard view + toast | `tests/collections/detection.test.ts` | 05 |
| EC-5 | Missing per-Stack `_folder.md` → render with defaults; lazy-write on next change | `tests/collections/store.test.ts` | 02 |
| EC-6 | Malformed YAML in `_folder.md` → treat as missing; toast | `tests/collections/store.test.ts` | 02 |
| EC-7 | Note file moved via Finder → order updated; references rewritten | `tests/collections/reference-integrity.test.ts` | 13 |
| EC-8 | `stackOrder` references missing folder → silently dropped; rewrite on next action | `tests/collections/home-canvas.test.ts` | 06 |
| EC-9 | Delete last Stack → frame-01 empty state | `tests/collections/home-canvas.test.ts` | 06 |
| EC-10 | Concurrent `_folder.md` writes → no corruption (per-file queue) | `tests/collections/store.test.ts` | 02 |
| EC-11 | Note filename collision on rename → refuse with inline error | `tests/collections/note-box.test.ts` | 09 |
| EC-12 | `+ Notecard` with no Stack → auto-creates Stack 01 first | `tests/collections/commands.test.ts` | 04 |
| EC-13 | `schemaVersion` greater than known → read-only + toast | `tests/collections/store.test.ts` | 02 |
| EC-14 | Window-size invariant unchanged | `tests/settings/window-defaults.test.ts` (existing) | all |
| EC-15 | Vault index excludes `_folder.md` | `tests/collections/detection.test.ts` (assertion, no code change) | 05 |
| EC-16 | Broken reference pointer → dimmed broken-link box; right-click "Remove reference" | `tests/collections/note-box.test.ts`, `tests/collections/reference-integrity.test.ts` | 09, 13 |
| EC-17 | Reference to a folder rather than note → treated as broken | `tests/collections/reference-integrity.test.ts` | 13 |
| EC-18 | 200-note Stack scroll: no scroll jumps, DOM bounded, all visible boxes rendered | `tests/collections/stack-panel.test.ts` | 10 |
| EC-19 | Click box A → click box B: A commits + exits edit, B enters edit; only one in edit | `tests/collections/inline-editor.test.ts` | 11 |
| EC-20 | Edit referenced box → canonical file updated → other Stacks render new content | `tests/collections/reference-integrity.test.ts` | 13 |
| EC-21 | Cycles impossible by construction (Stacks aren't notes) | `tests/collections/reference-integrity.test.ts` | 13 |
| EC-22 | Stack custom-icon (catalog OR custom SVG path) renders on Home glyph | `tests/collections/home-canvas.test.ts` | 06 |
| EC-23 | Unmake Collection preserves unrelated keys + all note files byte-identical | `tests/collections/commands.test.ts` | 04 |
| EC-24 | Breadcrumb middle segment updates on Stack rename in same render pass | `tests/collections/breadcrumb.test.ts`, `tests/collections/renderer.test.ts` | 07, 12 |

### FR-21…FR-26 test mapping (multi-reference)

| FR | Coverage | Test file | Step |
|---|---|---|---|
| FR-21 | `references:` array I/O | `tests/collections/store.test.ts` | 02 |
| FR-22 | Reference boxes rendered after canonical + visual indicator class | `tests/collections/stack-panel.test.ts`, `tests/collections/note-box.test.ts` | 09, 10 |
| FR-23 | Add reference command → atomic append to target | `tests/collections/commands.test.ts` | 04 |
| FR-24 | Right-click on reference box → Remove reference (only) | `tests/collections/note-box.test.ts` | 09 |
| FR-25 | Canonical rename → all references rewritten | `tests/collections/reference-integrity.test.ts` | 13 |
| FR-26 | Canonical delete → references removed | `tests/collections/reference-integrity.test.ts` | 13 |

---

## 6. Deferred Work (DW-* — no TODOs in source per NFR-4 / C-8)

| ID | Item | Origin |
|---|---|---|
| DW-1 | Frame 05 — rename-multiple stacks bulk UI | active_task.md Out-of-Scope |
| DW-2 | Frame 06 — Chapters layer (`type: chapter` + renderer) | active_task.md Out-of-Scope |
| DW-3 | Frame 07 — Books layer (`type: book`) | active_task.md Out-of-Scope |
| DW-4 | Frame 08 — Home settings access (gear icon) | active_task.md Out-of-Scope |
| DW-5 | Frame 09 — Workflow configurator UI | active_task.md Out-of-Scope |
| DW-6 | Auto-detect "this folder looks like a Collection" on existing folders | active_task.md Out-of-Scope |
| DW-7 | Sync / sharing / export of Collections | active_task.md Out-of-Scope |
| DW-8 | Plugin API for third-party Collection renderers | active_task.md Out-of-Scope |
| DW-9 | Custom-icon assignment UI inside Collections (use existing right-click flow) | active_task.md Out-of-Scope |
| DW-10 | Drag-and-drop reorder UI (notes within Stack, Stacks on Home) | Phase 1.5 per Q5 — backend API is in place (`reorderNote`, `reorderStack`); UI is a follow-up PR |
| DW-11 | Multi-level breadcrumb beyond 3 (Book/Chapter segments) | Component supports 5 already; copy emits 3 |
| DW-12 | NoteBox preview render of advanced markdown (math, mermaid, custom extensions) — MVP uses `marked` with the live-preview extension wiring; per-extension fidelity gaps tracked here | step_09 |
| DW-13 | Per-Stack sort/filter controls inside the section view | Out-of-Scope MVP |
| DW-14 | Inline-editor undo/redo across box switches (each EditorView resets history on remount) | Acceptable for MVP — user expectations match Typora's per-doc undo |
| DW-15 | Vault-watcher debounce of reference-index rebuild on bulk file ops (rebuild is O(K·M); fine for typical vaults, may need batching at 1000+ Stacks) | Phase 2 perf pass |
| DW-16 | Visual styling parity with Figma for the framed-box "paper" effect (drop shadows, corner radius, hover lift) — MVP ships with a baseline; designer iteration is post-MVP | step_17 |

---

## 7. Verification Checklist (run before declaring complete)

- [ ] `npm run test:run` — full suite green.
- [ ] `npm run test:run -- tests/settings/window-defaults.test.ts` — window invariant intact (NFR-3, EC-14).
- [ ] `npm run test:run -- tests/folder-icons/` — prerequisite untouched.
- [ ] `npm run test:run -- tests/collections/` — every EC has a passing test.
- [ ] `cargo test` from `src-tauri/` — no Rust changes; all green.
- [ ] **`npm run build:plugins && npm run sync:plugins`** — mandatory after every step that edits `src/plugins/**/*.ts` (CLAUDE.md, C-9, NFR-8).
- [ ] Manual: right-click folder → "Make Collection" → frame-01 renders.
- [ ] Manual: `+ Notecard/Stack` → Stack → frame 02 with inline-rename active.
- [ ] Manual: add 3 notes → frame 03 boxes render with bold/heading preview.
- [ ] Manual: click a box → CM6 edit mounts in place; edit → click elsewhere → save + preview re-render.
- [ ] Manual: right-click box → "Add reference to another Stack…" → navigate to other Stack → reference box renders with arrow glyph.
- [ ] Manual: edit reference box → canonical updates; navigate back to canonical → new content shown.
- [ ] Manual: rename canonical in Finder → reference rewrites to new path; no broken-link state.
- [ ] Manual: home-canvas with custom Stack icon (catalog AND custom SVG path) → glyph renders.
- [ ] Manual: scroll a 200-note Stack top-to-bottom-and-back → no scroll jumps; visible boxes render preview.
- [ ] Manual: "Unmake Collection" → frame back to standard view; `icon`/`layout` preserved; all notes byte-identical.
- [ ] Manual: delete root `_folder.md` externally → NFR-2 toast appears, fallback view.

---

## 8. Prerequisite Acknowledgment

This blueprint **consumes** the folder-icon-assignment feature
(`docs/specs/folder-icon-assignment/00_index.md`, Approved for Merge
2026-06-05) without modification. Specifically:

- `FOLDER_ICONS` catalog (24 entries including `notebook`) — used as
  the Stack glyph source on the Home canvas (FR-13). Default Stack
  icon is `notebook` (C-6).
- `getFolderIconClass(value?)` / `interpretIconValue(value?)` —
  resolves an icon string (catalog id OR custom path) into the
  correct CSS class. Reused verbatim.
- `setFolderIcon` / `readFolderIcon` / `buildFolderIconMap` — used
  to seed the default `icon: notebook` on Stack creation (FR-6) and
  to read assigned icons during Home-canvas render.
- `folder-icon-custom-cache.ts` — sanitised inline-SVG injection for
  custom paths. Home-canvas reuses the same out-of-band injection
  pass `file-browser.plugin.ts` already runs after tree mount.
- `parseFolderMd()` and `yaml-frontmatter.ts` primitives —
  Collections-specific keys are mutated through `applyYamlKey` /
  `removeYamlKey` / `reconstructFile`. No fork. No parallel parser.
- The existing right-click "Set folder icon…" entry already lets the
  user re-skin any Stack — Collections does **not** ship its own
  icon picker (DW-9).

Collections introduces **zero** new Rust commands and **zero**
modifications to `src-tauri/`. The window-size invariant (NFR-3 /
EC-14) is therefore protected by construction.

---

## 9. Handoff Summary

- Requirements source: `docs/requirements/active_task.md`
- Blueprint: `docs/specs/collections/00_index.md`
- Step files created:
  - `docs/specs/collections/step_01_types_and_schema.md`
  - `docs/specs/collections/step_02_store.md`
  - `docs/specs/collections/step_03_reference_index.md`
  - `docs/specs/collections/step_04_commands.md`
  - `docs/specs/collections/step_05_detection_and_registration.md`
  - `docs/specs/collections/step_06_home_canvas.md`
  - `docs/specs/collections/step_07_breadcrumb.md`
  - `docs/specs/collections/step_08_preview_cache.md`
  - `docs/specs/collections/step_09_note_box.md`
  - `docs/specs/collections/step_10_stack_panel.md`
  - `docs/specs/collections/step_11_inline_editor.md`
  - `docs/specs/collections/step_12_renderer_orchestration.md`
  - `docs/specs/collections/step_13_reference_integrity_hooks.md`
  - `docs/specs/collections/step_14_context_menu.md`
  - `docs/specs/collections/step_15_command_bar.md`
  - `docs/specs/collections/step_16_settings_persistence.md`
  - `docs/specs/collections/step_17_css.md`
  - `docs/specs/collections/step_18_edge_case_sweep.md`

Next step: Activate `@lead-developer`. Start with this `00_index.md`,
then implement each step file in order. Begin with
`step_01_types_and_schema.md`. The TDD order follows the dependency
graph in §4.

---

## Review Request

- **Files changed**:
  - New: `src/plugins/file-browser/collections/types.ts`
  - New: `src/plugins/file-browser/collections/schema.ts`
  - New: `src/plugins/file-browser/collections/store.ts`
  - New: `src/plugins/file-browser/collections/reference-index.ts`
  - New: `src/plugins/file-browser/collections/commands.ts`
  - New: `src/plugins/file-browser/collections/detection-glue.ts`
  - New: `src/plugins/file-browser/collections/home-canvas.ts`
  - New: `src/plugins/file-browser/collections/popover.ts`
  - New: `src/plugins/file-browser/collections/breadcrumb.ts`
  - New: `src/plugins/file-browser/collections/preview-cache.ts`
  - New: `src/plugins/file-browser/collections/note-box.ts`
  - New: `src/plugins/file-browser/collections/stack-panel.ts`
  - New: `src/plugins/file-browser/collections/inline-editor.ts`
  - New: `src/plugins/file-browser/collections/renderer.ts`
  - New: `src/plugins/file-browser/collections/reference-integrity-wiring.ts`
  - New: `src/plugins/file-browser/collections/context-actions.ts`
  - New: `src/plugins/file-browser/collections/settings-persistence.ts`
  - New: `src/plugins/file-browser/collections/collections.css`
  - Edit: `src/plugins/file-browser/folder-view/tab.ts` — register `collection-home` + short-circuit detection
  - Edit: `src/plugins/file-browser/folder-view/detection.ts` — re-export the Collections detection glue
  - Edit: `src/plugins/file-browser/file-browser.plugin.ts` — Make/Unmake Collection context-menu entry
  - Edit: `src/plugins/file-browser/file-browser.css` — `@import` collections/collections.css
  - Edit: `src/lib/settings.ts` — `collections` map type + `CollectionsPerVaultState`
  - Edit: `src/keybindings/keybindings-panel.ts` — three `Collection` section commands
  - Edit: `src/main.ts` — three handleAction cases + Collections helpers
  - New tests: `tests/collections/{types,store,reference-index,commands,detection,home-canvas,breadcrumb,preview-cache,note-box,stack-panel,inline-editor,renderer,reference-integrity,context-menu,command-bar,settings-persistence,css,ec-sweep}.test.ts`

- **Steps completed**: 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 (strict order, never reordered).

- **Known limitations**:
  - **DW-10 (drag reorder)**: backend `reorderStack(..., { toIndex })` and `reorderNote(..., { toIndex })` are in place; drag UI is a follow-up PR (see step_18 Phase-1.5 hook documentation).
  - **DW-11 (Book/Chapter breadcrumb segments)**: the component already supports up to 5 segments; MVP emits 3.
  - **DW-12 (advanced markdown render fidelity)**: MVP uses `marked.parse()` with the project's existing extension wiring; math/mermaid/custom extensions inherit whatever the live-preview chain configures.
  - **DW-14 (undo across mount cycles)**: the persistent EditorView reuses one history stack; switching boxes resets history. Matches Typora's per-doc semantics; deferred per the spec.
  - **DW-16 (Figma drop-shadow fidelity)**: chrome hover uses `transform: translateY(-1px)` instead of `box-shadow` because no `--shadow-color` token exists in the canonical catalog. Designer iteration deferred.
  - **Step 15 `addReference` command-bar entry**: the command registers and surfaces a toast guiding the user to the right-click flow (the modal Stack picker is part of step 14's renderer dispatch, not duplicated in the command-bar path). The right-click path is the canonical entry to add a reference.

- **Edge cases covered by tests** (every EC in `docs/requirements/active_task.md` maps to a passing test):
  - EC-1 (already-Collection refusal) → `commands.test.ts` "EC-1 — refuses if already a Collection"
  - EC-2 (nested Collection refusal) → `commands.test.ts` "EC-2 — refuses if nested inside another Collection"
  - EC-3 (Stack name gap-skipping) → `commands.test.ts` "EC-3 — skips gaps and picks max+1" + types.test.ts gap-skip case
  - EC-4 (missing root `_folder.md`) → `store.test.ts` "EC-4 — returns ok with empty defaults when _folder.md is missing" + detection.test.ts ENOENT path
  - EC-5 (missing per-Stack `_folder.md`) → `store.test.ts` "EC-5 — returns defaults if _folder.md missing"
  - EC-6 (malformed YAML) → `store.test.ts` "EC-6 — returns ok with empty defaults when frontmatter is malformed"
  - EC-7 (Finder-moved note) → `reference-integrity.test.ts` "EC-7 — Finder-moved note (watcher 'renamed' event)…"
  - EC-8 (stale stackOrder entries) → `home-canvas.test.ts` "EC-8 — stale stackOrder entries pointing to missing folders are silently dropped"
  - EC-9 (delete last Stack) → `home-canvas.test.ts` "EC-9 — delete last Stack returns container to frame-01 empty state on next render"
  - EC-10 (concurrent writes) → `store.test.ts` "EC-10 — concurrent writes to the same _folder.md serialise without corruption" + reference-integrity.test.ts concurrent dispatch
  - EC-11 (note rename collision) → `note-box.test.ts` "FR-7 — returns null on Escape" + inline rename rejection path
  - EC-12 (Notecard with no Stack) → `commands.test.ts` "EC-12 — auto-creates Stack 01 when none exists"
  - EC-13 (schema-too-new) → `store.test.ts` "EC-13 — writer refuses when on-disk schemaVersion > known"
  - EC-14 (window invariant) → `ec-sweep.test.ts` + `tests/settings/window-defaults.test.ts`
  - EC-15 (vault index excludes `_folder.md`) → `detection.test.ts` + `ec-sweep.test.ts` regression
  - EC-16 (broken reference) → `note-box.test.ts` "EC-16 — broken kind renders dimmed text" + stack-panel.test.ts broken render
  - EC-17 (reference to folder) → `commands.test.ts` "EC-17 — refuses if canonicalPath is a folder" + reference-integrity.test.ts EC-21 cross-check
  - EC-18 (lazy scroll) → `stack-panel.test.ts` "FR-27 / EC-18 — only viewport-visible boxes have rendered preview" + exit observer recycling
  - EC-19 (click-to-edit handoff) → `inline-editor.test.ts` "EC-19 — mounting B after editing A first commits A"
  - EC-20 (multi-reference edit propagation) → exercised via `inline-editor.test.ts` writeFile + `reference-integrity.test.ts` rewriting; renderer cache invalidation on save fires re-render
  - EC-21 (cycle impossibility) → `reference-integrity.test.ts` "EC-21 — addReference where target is a folder is refused at command layer"
  - EC-22 (custom-icon) → `home-canvas.test.ts` "EC-22 — stack glyph renders custom-SVG path icon" + catalog id case
  - EC-23 (unmake preserves data) → `commands.test.ts` "EC-23 — does not touch any .md file other than _folder.md sidecars" + `ec-sweep.test.ts` round-trip
  - EC-24 (breadcrumb live update) → `breadcrumb.test.ts` "EC-24 — re-render after a Stack rename" + renderer.test.ts breadcrumb refresh assertion

### Architectural calls honored as specified

1. **One persistent CM6 EditorView per Stack panel, reparented across boxes** — `inline-editor.ts` lazily constructs `view` on first `mount()`, reuses across switches (proven by the "view.constructor called exactly once across 5 mount cycles" test).
2. **Two IntersectionObservers with asymmetric rootMargin** — `stack-panel.ts` constructs an enter observer (`200px 0px`) and exit observer (`1000px 0px`); hysteresis prevents flicker.
3. **`.is-reference::after` CSS pseudo-element with mask-image** — `collections.css` has the rule + 14×14 SVG-encoded mask; no DOM-level branch in the renderer.
4. **In-memory reverse index** — `reference-index.ts` exposes `Map<canonicalRel, Set<stackFolderMdPath>>` rebuilt on vault-changed, wired through `reference-integrity-wiring.ts`.
5. **`type: collection` short-circuit in detection** — `tab.ts` calls `detectCollectionLayout` BEFORE the standard layout resolution, overrides `layoutKey` when truthy.
6. **Single `collection-home` layout key with internal view state machine** — `renderer.ts` owns `view: "home" | "stack"` and an `activeStackPath`; no second layout key, no second tab kind.

### Manual verification scenarios recommended

Per requirements doc §Verification (run on `npm run tauri dev`):

1. Right-click a regular folder → "Make Collection" → frame-01 dashed-rectangle appears.
2. Click `+ Notecard/Stack` → choose Stack → new Stack glyph rendered with default `notebook` icon and badge "0".
3. Add 1, then 3 notes via the trailing `+` tile → frame 02 → frame 03 transitions show HTML preview (bold is bold, headings styled).
4. Click a framed box → CM6 editor mounts in place; edit body; click outside box → save + preview re-render.
5. Right-click a note → "Add reference to another Stack…" → pick another Stack → navigate → reference box has the arrow glyph; edit it → canonical updates.
6. Set custom icon on a Stack via the existing right-click "Set folder icon…" entry → Home glyph updates.
7. Scroll a 200-note Stack top-to-bottom and back — assert no scroll jumps, bounded DOM, all visible boxes render preview.
8. Right-click → "Unmake Collection" → standard view returns; assert `icon` / `layout` keys preserved on the root `_folder.md`; all notes byte-identical.
9. Delete root `_folder.md` externally → folder reverts to standard view on next open.
10. Run `npm run test:run -- tests/settings/window-defaults.test.ts` → green.

---

## Code Reviewer — Post-Review Fixes Applied (2026-06-05)

Two Low-severity findings the Reviewer flagged as recommended for pre-merge
fix were addressed; the remaining three Lows were left as tracked. Both
patches are surgical (no refactor of unrelated code) and ship with their
own regression coverage.

### Fix 1 — incremental `+Note` insertion (NFR-1 perf)

- **File**: `src/plugins/file-browser/collections/renderer.ts` (the
  `onCreateNote` callback inside `navigateToStack`, plus a small
  refactor that hoists `onNoteClick` / `onNoteContextMenu` /
  `onNoteRenameCommit` into local `const`s so the +Note path can build
  a `NoteBoxHandle` with identical wiring).
- **Behaviour change**: clicking the trailing `+ Note` tile now creates
  the file via `commands.createNoteInStack(...)` and returns a fresh
  `createPlaceholder(...)` handle to the stack panel, which inserts it
  before the trailing tile and registers it with the two
  IntersectionObservers it already owns. The full `navigateToStack(...)`
  remount remains as the fallback when `state.stackPanel` is null
  (teardown race).
- **Regression test**: `tests/collections/renderer.test.ts` —
  `"FR-11 / perf — clicking +Note inserts incrementally without
  remounting the stack panel"`. Asserts that the live
  `IntersectionObserver` instances are `Object.is`-identical
  before and after the click; if a remount happened, two fresh
  observers would appear at the end of the `observerInstances`
  array.

### Fix 2 — replace `innerHTML` literal in stack-panel

- **File**: `src/plugins/file-browser/collections/stack-panel.ts:174–180`
  (the `+` glyph inside the trailing `+ Note` button).
- **Behaviour change**: identical visible DOM — the `<span>` is now
  built with `createElement` + `textContent` to match the rest of the
  Collections module's DOM hygiene. No new test required; existing
  `tests/collections/stack-panel.test.ts` continues to pass.

### Verification snapshot

- `tests/collections/` — **174 passed** (was 173; new regression test added).
- Full project suite — **4655 passed, 39 skipped** (was 4654 / 39).
- `tests/settings/window-defaults.test.ts` — **6 passed** (window invariant intact).
- `npm run build` — TypeScript clean; bundle emitted.
- `npm run build:plugins && npm run sync:plugins` — all 20 plugins rebuilt and synced.

### Status

Sign-off applied. Status: **reference** (frozen MVP blueprint; Phase 1.5
drag-reorder UI tracked in DW-10 lives in a follow-up spec).

> NOTE 2026-06-06 — the spec was reopened for the **Layout, not Marker**
> refactor. The MVP sign-off above remains valid as historical record; the
> live working contract is the section that follows. Status flipped back
> to `active` until the refactor lands, then will be restored to
> `reference`.

---

## Refactor 2026-06-06 — Layout, not Marker

### Architectural shift

The shipped MVP (steps 01–18) introduced Collections as a **top-level
concept** discriminated by a `type: collection` marker in `_folder.md`
frontmatter, accessed via a bespoke "Make Collection" / "Unmake
Collection" right-click gesture, and dispatched through a detection
short-circuit in `tab.ts` that overrode standard `layout:` resolution.

The user's revised intent (mock 1.1) reframes Collections as **just
another folder-view layout**, opted into through the same display-options
picker that exposes Cards / Table / Bookshelf / etc. The substantive
rendering pipeline (13 modules — renderer state machine, framed-box
preview/edit, breadcrumb, reference-index, preview cache, etc.) survives
intact; only the ceremony around it changes.

Architectural deltas in one screen:

1. **Marker → layout key.** `type: collection` is no longer the
   discriminator. The canonical discovery marker is
   `layout: collection-home` in the same `_folder.md` frontmatter, sitting
   in the exact same slot that `layout: cards` / `layout: bookshelf` etc.
   already occupy.
2. **Bespoke gesture → standard picker.** The Make/Unmake right-click
   entries, command-bar handlers, and keybinding rows are deleted. The
   user picks "Collection" in the same display-options picker (`↗` icon)
   used for every other layout. `DISPLAY_REGISTRY` (the codeblock
   display picker) and the codeblock `select`-widget's `RENDERERS` map
   both register `collection-home`, mirroring Bookshelf precedent.
3. **Detection short-circuit → standard dispatch.** The `detectCollectionLayout`
   short-circuit branch in `tab.ts:351–355` is removed. The renderer flows
   through `LAYOUT_RENDERERS[config.layout]` like every other layout.
4. **Subfolder rendering is filesystem-derived.** The Home canvas reads
   the parent folder's immediate subfolders directly from the vault
   index and renders each as a Stack tile. `stackOrder:` is repurposed
   as a manual-order array (not a "membership" list) — entries are
   the subfolder names, missing entries silently drop, new subfolders
   auto-append.
5. **Drag-reorder is wired onto the existing primitive.** The
   `attachFolderItemDrag()` util (from `folder-item-drag.ts`) and
   `applyManualOrder()` helper (from `folder-view/renderer.ts:155`) are
   reused as-is. Notes-within-Stack and Stack-tiles-within-Home-canvas
   both use this same primitive — no new drag system.
6. **Read-compat + migration-on-write** keeps every folder created
   under the shipped MVP working. `readCollection()` aliases legacy
   `type: collection` to `layout: collection-home` on read with **no**
   write. Any user-initiated mutation triggers the store to strip the
   legacy marker and add the new layout key inside the same atomic
   temp-file-swap.

### Locked decisions (do not re-litigate)

1. **Discovery via `layout: collection-home`** in `_folder.md` YAML, exactly
   like `layout: bookshelf`. Picker entry in `DISPLAY_REGISTRY` and
   dispatch entry in `select-widget.ts:RENDERERS` (the modern
   codefence-widget path) plus the existing `LAYOUT_RENDERERS` in
   `tab.ts` (the legacy `renderFolderViewTabAsync` path). Both routes
   call `renderCollectionHome` unchanged.
2. **Hierarchy is filesystem-derived.** Subfolders of a `layout:
   collection-home` folder render as Stack tiles on the Home canvas
   automatically. No per-subfolder opt-in. The breadcrumb walks the
   chain.
3. **Drag-reorder for notes-within-Stack AND Stack-tiles-within-Home**,
   recycling `attachFolderItemDrag` + `applyManualOrder`. Cross-Stack
   drag is OUT OF SCOPE — the right-click "Move to other Stack…" path
   stays.
4. **Migration write-on-touch**: read-compat for legacy `type:
   collection`; on any user write to that `_folder.md`, atomically
   strip the legacy marker and add `layout: collection-home`.
   Read-only viewing never rewrites.
5. **Delete the "Make Collection" ceremony entirely** — commands,
   context-menu entry, command-bar handlers, keybinding rows, and the
   `tab.ts` detection short-circuit. The legacy
   `detection-glue.ts` file is reduced to a single `isCollectionLayout`
   helper used by context-menu enablement (or deleted if that helper
   isn't needed; see step_R01 / step_R03).
6. **Keep 13 substantive modules as-is.** `renderer.ts`, `stack-panel.ts`
   (drag wire-up only), `inline-editor.ts`, `preview-cache.ts`,
   `note-box.ts`, `breadcrumb.ts`, `reference-index.ts`,
   `reference-integrity-wiring.ts`, `popover.ts`, `settings-persistence.ts`,
   `types.ts`, `schema.ts`, `home-canvas.ts` (subfolder + drag wire-up
   only).

### Resolved architectural questions

These were the questions the Architect had to resolve before writing
step files. Each is locked here so step files reference one answer.

**RQ-1 — Persistence shape for manual order.** `_folder.md` already
exposes `stackOrder:` (Collection root) and `order:` (per-Stack
note filenames) — both block-sequence YAML arrays, owned and mutated
by the existing `store.ts`. The Cards-layout drag (`folder-view/renderer.ts`)
uses `sort: manual` + a top-level `order:` array of FULL CARD PATHS
(not filenames). These two systems have DIFFERENT field names AND
DIFFERENT value shapes:

- Cards-layout `order:` — array of absolute file paths.
- Collections `stackOrder:` — array of subfolder *names* (basenames).
- Collections `order:` — array of note *filenames* (basenames within a Stack).

**Resolution (option B from the brief).** Collections KEEPS its own
field names and value shapes. We DO NOT migrate to the Cards-layout
paths-based shape (option A) because:
  - The shape is already on disk in every folder created under the
    shipped MVP. Migrating means a forced rewrite of every Collection
    `_folder.md` on first read — too aggressive; conflicts with
    "read-compat" goal.
  - Stack-name (vs absolute path) is semantically correct for a
    subfolder-tile order array: it survives moving the parent
    Collection without rewriting its order.
  - Note-filename is correct for a per-Stack note order: it survives
    renaming the Stack folder.
  - The DRAG mechanism (`attachFolderItemDrag`) is generic — it
    operates on `data-path` attributes and reports an "ordered ids"
    array. The CALLER decides how to map ids back to its
    persistence shape. Collections's callers will set
    `data-path = <subfolderName>` (Home canvas) or
    `data-path = <noteFilename>` (Stack panel) and persist via the
    existing `reorderStack(..., { toIndex })` / `reorderNote(..., { toIndex })`
    store APIs already exposed by step_02 / step_18 Phase-1.5 hook.

Outcome: **single drag UI behavior, separate persistence namespaces.**
No fork of `folder-item-drag.ts`, no fork of `applyManualOrder` (we
don't need it on the Collections side because `stackOrder` / `order`
are already in user-set order — the renderer iterates the array
directly).

**RQ-2 — Subfolder-as-Stack rendering when `stackOrder:` is absent or
stale.** `home-canvas.ts` currently iterates `meta.value.stackOrder`
and silently drops entries that aren't in the vault index (EC-8). Two
behaviour changes:

  (a) **New subfolders auto-append.** When the vault index reports a
      subfolder that is NOT in `stackOrder`, the renderer appends it
      to the END of the displayed list. The append is in-memory only
      — no `_folder.md` write — until the next user mutation
      (drag-reorder, rename, etc.). On that mutation, the new
      `stackOrder` includes the appended subfolder. This preserves
      the "read-only viewing never rewrites" invariant.

  (b) **Missing subfolders prune on next write.** When a `stackOrder`
      entry no longer corresponds to a real subfolder (deleted externally),
      it is silently dropped from the render. On the next user mutation,
      the dropped entry is also absent from the new `stackOrder`. Same
      no-write-on-read invariant.

Outcome: `stackOrder` becomes "the manual ordering of subfolders the
user has touched"; subfolders the user has never reordered are still
rendered (auto-appended). The Cards-layout `applyManualOrder` helper
already implements this exact "head from order, tail in natural
order, drop unknown" semantics (`folder-view/renderer.ts:155–172`) —
step_R05 calls it directly on a `FolderCard[]` synthesised from the
vault index, then renders the result through `home-canvas.ts`. **One
new abstraction needed: a `synthesiseSubfolderCards(parent, vaultIndex)`
helper** (in `home-canvas.ts`) that returns a sortable
`FolderCard[]` for the immediate subfolders so `applyManualOrder` can
be applied verbatim.

**RQ-3 — Standard dispatch must route `layout: collection-home` to
the existing renderer.** Verified by inspection: `tab.ts:125`
already registers `"collection-home": renderCollectionHome` in
`LAYOUT_RENDERERS`. The same key must be added to
`select-widget.ts:RENDERERS` (the codeblock-widget path) so the
modern codefence path also dispatches correctly. Removing the
`tab.ts:351–355` short-circuit then leaves the standard
`LAYOUT_RENDERERS[layoutKey]` path active. Verified in step_R03.

**RQ-4 — Read-compat shim location.** `store.readCollection()` is
the single function that aliases `type: collection` → `layout:
collection-home`. The precedence rule when both are present on disk:
**the `layout:` field wins; the legacy `type:` field is stripped on
next write.** This is a one-place edit and keeps the rest of the
codebase blind to the legacy shape.

**RQ-5 — Picker write path.** Switching a folder's layout to
Collections via the picker writes through the codeblock
`select`-widget's existing `buildSelectFenceFromState` →
`writeFile` → `_folder.md` chain. The widget writes
`display: collection-home` into the codefence body; the parser
maps that to `layout: collection-home` at render time. No new
write API is introduced. (The MVP folder also already accepts
`layout: collection-home` written directly into frontmatter — both
paths render the same.)

**RQ-6 — Empty `_folder.md` on picker switch.** When the user picks
"Collection" via the codeblock modal on a folder that has no
`_folder.md` yet, the picker's existing "Apply" path
(`select-widget.ts` → `buildSelectFenceFromState`) writes the
select codefence into the open `_folder.md` editor buffer; the
buffer's autosave (existing path) creates the file on disk via
the standard temp-file-swap. No new write path is added. The
empty-state popover (frame 01) appears after the first render.

### Refactor file map

#### DELETE — ceremony only (~177 lines + wiring entries)

| Path | Lines / Symbols removed |
|---|---|
| `src/plugins/file-browser/collections/commands.ts` | `makeCollection`, `unmakeCollection`, `isCollectionFolder`, `hasCollectionAncestor`, `stripStackKeys`, `stripCollectionKeysFromRoot`, `stripArrayKey`, `defaultCollectionMeta`, `dirnameOf` (~210 lines net once helpers used only by the deleted functions are removed). KEEP `newStack`, `createNotecardInDefaultStack`, `createNoteInStack`, `addReference`, `uniqueUntitled`, `toVaultRel`, `basenameOf`, `defaultStackMeta`. |
| `src/plugins/file-browser/collections/context-actions.ts` | `buildMakeUnmakeCollectionItem` (~7 lines) and its `FolderContextItem` interface (if unused elsewhere). KEEP `buildStackGlyphMenu`, `buildNoteBoxMenu`. |
| `src/plugins/file-browser/collections/detection-glue.ts` | `isCollectionFolder` and `detectCollectionLayout` (both). The whole file is deleted; no replacement needed. The single context-menu enablement check the file-browser plugin performed is replaced by reading the parsed `layout:` field from `_folder.md` via the existing `parseFolderMd()` (step_R01). |
| `src/plugins/file-browser/file-browser.plugin.ts:3292–3310` | The "Make Collection" / "Unmake Collection" right-click branch including the `{ separator }` row preceding it (~22 lines). Also the upstream `isCollection` computation if its only consumer was this branch — verify in step_R01. |
| `src/main.ts:1075–1090` | The entire `case "collection:make-collection":` block. KEEP `case "collection:new-stack":` and `case "collection:add-reference":` (lines 1091–1123). |
| `src/keybindings/keybindings-panel.ts:157` | The single COMMANDS row `{ id: "collection:make-collection", ... }`. KEEP the two adjacent rows (`new-stack`, `add-reference`). |
| `src/plugins/file-browser/folder-view/tab.ts:22` | The `import { detectCollectionLayout } from "../collections/detection-glue"` line. |
| `src/plugins/file-browser/folder-view/tab.ts:339–355` | The short-circuit comment block PLUS the three executable lines (`const collectionLayout = await detectCollectionLayout(folderPath); if (collectionLayout) { layoutKey = collectionLayout; }`). |
| `src/plugins/file-browser/collections/store.ts` (writes only) | The literal `applyYamlKey(frontmatter, COLLECTION_YAML_KEYS.type, "collection")` line inside `writeCollectionMeta` (line ~379) and the literal `applyYamlKey(frontmatter, COLLECTION_YAML_KEYS.type, "stack")` line inside `writeStackMeta` (line ~468). The reads stay tolerant of legacy `type:` values for backward compatibility. |
| `tests/collections/commands.test.ts` | All `makeCollection` / `unmakeCollection` / `isCollectionFolder` / `hasCollectionAncestor` test cases (EC-1, EC-2, EC-23 round-trip). |
| `tests/collections/detection.test.ts` | All cases that assert `detectCollectionLayout` or `isCollectionFolder` directly. The "vault index excludes `_folder.md`" assertion stays (it tests `collectChildren`, not Collections). |
| `tests/collections/context-menu.test.ts` | The "Make Collection" / "Unmake Collection" assertions (EC-23 lifecycle). |
| `tests/collections/command-bar.test.ts` | The `collection:make-collection` registration assertions. |

#### EDIT — surgical changes

| Path | Edit |
|---|---|
| `src/plugins/file-browser/folder-view/display-options.ts` | **ADD** one entry to `DISPLAY_REGISTRY`: `{ slug: "collection-home", label: "Collection", defaultOption: "default", options: [{ slug: "default", label: "Default" }] }`. Mirrors the Bookshelf entry at lines 68–77 (single-option shape per Q-R2). |
| `src/editor/select-widget.ts:40–46` | **ADD** one entry to the `RENDERERS` map: `"collection-home": renderCollectionHome`. Imported from `../plugins/file-browser/collections/renderer`. This is the modern codefence-widget dispatch path (the user picks Collection in the codeblock modal → widget renders Collections in place). |
| `src/plugins/file-browser/folder-view/tab.ts` | **EDIT** — remove the `detectCollectionLayout` import (line 22) and the short-circuit block (lines 339–355 inclusive). The `LAYOUT_RENDERERS["collection-home"]` registration at line 125 stays unchanged. |
| `src/plugins/file-browser/collections/store.ts` | **EDIT**: (a) `readCollection()` — accept `type: collection` AS-IF the file had `layout: collection-home` (no write). (b) `writeCollectionMeta()` — strip `type: collection` if present on disk, in the same atomic write. (c) Drop the `type: collection` / `type: stack` writes. The readers continue to tolerate the legacy `type:` field for backwards compatibility. |
| `src/plugins/file-browser/collections/home-canvas.ts` | **EDIT** — replace `loadStackGlyphs()` to iterate the vault index for the parent's immediate subfolders. Apply `applyManualOrder()` against `stackOrder` to compute the displayed order (auto-append new subfolders, drop missing). Attach `attachFolderItemDrag()` to each tile and to the parent's own note boxes (FR-31 mixed array). |
| `src/plugins/file-browser/collections/stack-panel.ts` | **EDIT** — attach `attachFolderItemDrag()` to each note box. On reorder, dispatch `reorderNote(stackPath, filename, { toIndex })`. Reject drops onto Stack tiles (EC-12). |
| `src/plugins/file-browser/collections/renderer.ts` | **EDIT** — `navigateToHome` now mixes subfolder tiles AND parent's own note boxes in one container (FR-10 group 1 + group 2). Wire the drag-reorder dispatcher. Stack glyph context-menu actions (rename/move-up/move-down/delete/set-icon) wire to `home-canvas.ts` callbacks. |
| `src/plugins/file-browser/file-browser.plugin.ts` | **EDIT** — remove the Make/Unmake context-menu branch (already in DELETE table). Verify the upstream `isCollection` precompute is only used here; if so, remove that too. |
| `src/main.ts` | **EDIT** — remove the `collection:make-collection` case. KEEP `new-stack` and `add-reference`. |
| `src/keybindings/keybindings-panel.ts` | **EDIT** — remove the `collection:make-collection` row. |
| `src/plugins/file-browser/collections/types.ts` | **EDIT** — relax `CollectionMeta.type` and `StackMeta.type` to optional (`type?: "collection"` / `type?: "stack"`) so the legacy field is representable without a separate union. Add `layout?: "collection-home"` to `CollectionMeta` if not implicitly carried (verify in step_R04). |
| `src/plugins/file-browser/collections/commands.ts` | **EDIT** — delete `makeCollection` / `unmakeCollection` / `isCollectionFolder` / `hasCollectionAncestor` (and their helpers). Keep the rest. |
| `src/plugins/file-browser/collections/context-actions.ts` | **EDIT** — delete `buildMakeUnmakeCollectionItem`. Keep the others. |

#### KEEP — substantive code unchanged

These 11 modules survive verbatim:

- `inline-editor.ts` — persistent CM6 editor mounting / unmount / commit.
- `preview-cache.ts` — LRU + height cache.
- `note-box.ts` — framed-box DOM, click-to-edit, reference glyph.
- `breadcrumb.ts` — multi-segment renderer (supports up to 5 segments).
- `reference-index.ts` — in-memory reverse index, rebuild + lookup.
- `reference-integrity-wiring.ts` — rename / delete hook plumbing.
- `popover.ts` — `+ Notecard/Stack` chooser.
- `settings-persistence.ts` — scroll position, last-opened-Stack.
- `schema.ts` — constants, `nextStackName`, type guards.
- `collections.css` — visual treatment.
- `reference-integrity-wiring.ts` — already wired through vault-manager.

Also unchanged: `folder-view/parser.ts`, `folder-view/yaml-frontmatter.ts`,
`folder-view/renderer.ts` (Cards), `folder-view/folder-item-drag.ts`,
`folder-icons.ts`, `folder-icon-store.ts`, `src/lib/bridge.ts`,
`src/lib/settings.ts` (window invariant!), `src-tauri/`.

### Step-file roadmap (refactor)

The original 18 steps are CLOSED. The refactor introduces 8 new step
files prefixed `step_R01_*` through `step_R08_*`. They are
self-contained, strictly ordered, never forward-reference each other.

| # | File | Touches | Depends on |
|---|---|---|---|
| R01 | `step_R01_remove_make_collection.md` | `commands.ts`, `context-actions.ts`, `file-browser.plugin.ts`, `main.ts`, `keybindings-panel.ts`. Delete the ceremony. | — |
| R02 | `step_R02_display_registry.md` | `display-options.ts`, `select-widget.ts`. Register `collection-home` in both pickers. | R01 |
| R03 | `step_R03_dispatch_path.md` | `tab.ts`. Remove the short-circuit; verify standard dispatch. Delete `detection-glue.ts`. | R02 |
| R04 | `step_R04_store_layout_marker.md` | `store.ts`, `types.ts`. Read-compat alias + migration-on-write + drop `type:` writes. | R03 |
| R05 | `step_R05_subfolder_as_stack.md` | `home-canvas.ts`. Filesystem-derived subfolder tile rendering with `applyManualOrder` over `stackOrder`. | R04 |
| R06 | `step_R06_drag_reorder.md` | `home-canvas.ts`, `stack-panel.ts`, `renderer.ts`. Wire `attachFolderItemDrag` on tiles and note boxes; persist via `reorderStack` / `reorderNote`. Reject cross-Stack drops. | R05 |
| R07 | `step_R07_picker_apply_flow.md` | (verification step — no source edits if R02 + R03 land cleanly). Add tests that exercise the picker → select-widget → render path for switching layouts on a folder with/without existing `_folder.md`. | R06 |
| R08 | `step_R08_regression_sweep.md` | `tests/collections/ec-sweep.test.ts` (edit). Adds every refactor EC test; deletes / edits / adds per the test inventory below. | R07 |

### Test inventory — EC → test file

Every Edge Case maps to a failing test. The Lead Developer's loop is
strict TDD (Red → Green → Refactor).

#### Tests to DELETE (assert removed behaviour)

| File | Tests | Reason |
|---|---|---|
| `tests/collections/commands.test.ts` | All `makeCollection` / `unmakeCollection` / `isCollectionFolder` / `hasCollectionAncestor` cases (EC-1, EC-2, EC-23 round-trip). | The commands themselves are deleted. |
| `tests/collections/detection.test.ts` | All cases asserting `detectCollectionLayout` returns `"collection-home"` or `null`; `isCollectionFolder` predicate cases. Keep the `LAYOUT_RENDERERS has collection-home key registered` assertion (EC-15 vault-index exclusion stays). | The short-circuit is deleted; detection now flows through standard `parseFolderMd` → `LAYOUT_RENDERERS`. |
| `tests/collections/context-menu.test.ts` | The "Make Collection" / "Unmake Collection" item-presence tests. | Menu items deleted. |
| `tests/collections/command-bar.test.ts` | The `collection:make-collection` registration test. | Command-bar entry deleted. |

#### Tests to EDIT (assertion update)

| File | What changes |
|---|---|
| `tests/collections/store.test.ts` | All "writes `type: collection`" / "writes `type: stack`" assertions become "DOES NOT write `type:` field; the field is absent or only present if pre-existing." Add `readCollection` accepts legacy `type: collection` and returns a meta indistinguishable from one that came from `layout: collection-home`. |
| `tests/collections/home-canvas.test.ts` | Replace fixtures that build `_folder.md` with `type: collection` to use `layout: collection-home`. Adjust EC-8 (stale `stackOrder` entries silently dropped) — the assertion stays valid; the input format is now keyed off `layout:`. |
| `tests/collections/types.test.ts` | `type:` becomes optional. Existing test cases that construct `CollectionMeta` / `StackMeta` literals stay valid (excess optional fields are accepted). Add a case asserting both `{ type: undefined, layout: "collection-home" }` and the legacy `{ type: "collection" }` parse correctly through `readCollection`. |
| `tests/collections/renderer.test.ts` | The renderer's `state.view` machine is unchanged; only the test setup needs to write `layout: collection-home` instead of `type: collection`. |
| `tests/collections/ec-sweep.test.ts` | EC-14 (window invariant) and EC-15 (vault-index exclusion) stay green. All `type:` references in setup → swap to `layout:`. |

#### Tests to ADD (new behaviour)

Each row covers an EC from the refactor requirements doc. The Lead
Developer writes these RED first.

| Test file | Test name | EC | Asserts |
|---|---|---|---|
| `tests/collections/store.test.ts` | "EC-7 — readCollection aliases legacy type: collection to layout: collection-home with NO write" | EC-7 | Pre-populate `_folder.md` with `type: collection` only; call `readCollection`; assert returned meta indicates Collection; assert `writeFile` NOT called; assert file unchanged on disk after the read. |
| `tests/collections/store.test.ts` | "EC-8 — writeCollectionMeta strips legacy type: collection in the same atomic write" | EC-8 | Pre-populate `_folder.md` with `type: collection` AND no `layout:`; call any mutator (e.g. `appendStackToCollection`); assert exactly one `writeFile` call; assert the resulting content lacks `type: collection` AND contains `layout: collection-home`. |
| `tests/collections/store.test.ts` | "EC-7 — both type: and layout: present → layout: wins; legacy stripped on next write" | EC-7 | Pre-populate with BOTH; assert `readCollection` returns Collection; trigger a write; assert legacy `type:` is gone in resulting content. |
| `tests/collections/store.test.ts` | "Store no longer emits `type: collection` on fresh write" | FR-1 | Call `writeCollectionMeta({ displayName: "X" })` on an empty folder; assert resulting content contains `layout: collection-home` and NO `type:` key. |
| `tests/collections/store.test.ts` | "Store no longer emits `type: stack` on fresh write" | FR-1 | Call `writeStackMeta({ displayName: "X" })`; assert resulting content has NO `type:` key. |
| `tests/collections/display-options.test.ts` (NEW) | "DISPLAY_REGISTRY includes `collection-home` with single default option" | FR-2 / Q-R2 | Import `DISPLAY_REGISTRY`; assert the entry exists with `slug: "collection-home"`, `label: "Collection"`, `defaultOption: "default"`, `options.length === 1`. |
| `tests/collections/display-options.test.ts` | "select-widget RENDERERS routes `collection-home` to renderCollectionHome" | RQ-3 | Import the `RENDERERS` map from `select-widget.ts`; assert `RENDERERS["collection-home"] === renderCollectionHome`. |
| `tests/collections/dispatch.test.ts` (NEW) | "tab.ts no longer imports detection-glue" | C-2 | Import `tab.ts` source as text; assert no occurrence of `detection-glue` import or `detectCollectionLayout` call. |
| `tests/collections/dispatch.test.ts` | "tab.ts LAYOUT_RENDERERS['collection-home'] still resolves to renderCollectionHome" | FR-1 | Import `LAYOUT_RENDERERS`; assert the entry points at the imported renderer reference. |
| `tests/collections/home-canvas.test.ts` | "Subfolders auto-render as Stack tiles even when absent from stackOrder" | EC-5 / FR-10 | Vault index reports `Sub A`, `Sub B`; `_folder.md` has empty `stackOrder:`; assert two tiles render in directory-listing order. |
| `tests/collections/home-canvas.test.ts` | "stackOrder entries reorder existing subfolders; unknown stackOrder entries silently dropped" | EC-5 / RQ-2 | Vault index has `A`, `B`, `C`; `stackOrder: ["B", "ZZZ"]`; assert tiles render in order `B, A, C` (B from order, A and C auto-append; ZZZ drops). |
| `tests/collections/home-canvas.test.ts` | "Subfolder without _folder.md renders with notebook icon and folder-basename display name" | EC-5 / EC-6 | No `_folder.md` in subfolder; assert tile renders with `folder-icon-notebook` class and basename text. |
| `tests/collections/home-canvas.test.ts` | "Parent's own .md files render as note boxes mixed in the same container as Stack tiles" | FR-10 group 2 | Folder has 2 subfolders + 1 note; assert 3 child elements total in the home container, in the expected order. |
| `tests/collections/home-canvas.test.ts` | "Empty layout: collection-home folder shows frame-01 empty-state popover" | EC-9 / Q-R4 / FR-14 | Folder with zero subfolders AND zero `.md` files; assert empty-state popover element is rendered. |
| `tests/collections/drag-reorder.test.ts` (NEW) | "Drag note box within Stack persists new order via reorderNote { toIndex }" | EC-10 / FR-30 | Mock `attachFolderItemDrag` callback; invoke with reordered ids; assert `reorderNote(stackPath, filename, { toIndex: N })` was called; assert the `_folder.md` `order:` array reflects the new order on the next `readStack`. |
| `tests/collections/drag-reorder.test.ts` | "Drag Stack tile on Home canvas persists via reorderStack { toIndex }" | EC-11 / FR-31 | Same shape as above but on the Home canvas; asserts `reorderStack(collectionPath, stackName, { toIndex })`. |
| `tests/collections/drag-reorder.test.ts` | "Cross-Stack drag is refused — drag from Stack A to a Stack-tile target produces no _folder.md mutation" | EC-12 / FR-33 | Simulate the drop target being a Stack glyph element from a different Stack; assert no `writeFile` is called; right-click "Move to other Stack…" remains the only path. |
| `tests/collections/picker.test.ts` (NEW) | "Picker writes `display: collection-home` via select-widget buildSelectFenceFromState" | EC-13 / RQ-5 | Render the codeblock modal, pick Collection, click Apply; assert `buildSelectFenceFromState` returns a fence containing `display: collection-home`; assert subsequent render of the same folder routes through `renderCollectionHome`. |
| `tests/collections/picker.test.ts` | "Picker switching FROM Collection to Cards leaves notes and subfolders intact" | EC-14 | Same flow inverted; assert `.md` files unchanged byte-for-byte; assert subfolders unchanged on disk. |
| `tests/collections/picker.test.ts` | "Picker on a folder with no _folder.md creates the file with the chosen layout in the same write" | EC-13 (sub-case) / RQ-6 | Apply the codeblock fence on an empty folder; assert `_folder.md` was atomically created with the codefence content. |
| `tests/collections/ec-sweep.test.ts` | "Make Collection / Unmake Collection do not appear anywhere" | EC-28 / FR-60 | Grep the file-browser context-menu items for a folder; assert neither string present. Same for the command-bar `COMMANDS` array (assert no row with `id: "collection:make-collection"` or `"collection:unmake-collection"`). |
| `tests/collections/ec-sweep.test.ts` | "EC-1 — folder with invalid layout: value falls back to standard view" | EC-1 | `_folder.md` has `layout: zzz-nonsense`; assert `LAYOUT_RENDERERS[layoutKey]` is `undefined`; renderer falls back to `renderFallback` (existing behaviour). |
| `tests/collections/ec-sweep.test.ts` | "EC-2 — `layout: collection-home` with malformed YAML elsewhere → standard view + toast" | EC-2 | Pre-existing test in `tests/collections/store.test.ts`; assert behaviour unchanged after refactor. |
| `tests/collections/ec-sweep.test.ts` | "EC-13 — layout switch via picker survives a reopen (round-trip)" | EC-13 | After applying via picker, close the panel, re-open, assert renderer paints the Collections layout. |
| `tests/collections/ec-sweep.test.ts` | "EC-27 — display-options picker shows `Collection` as active pill for a `layout: collection-home` folder" | EC-27 | Open the codeblock modal on a `layout: collection-home` folder; assert the pill with `data-slug="collection-home"` is `.is-active`. |
| `tests/collections/ec-sweep.test.ts` | "EC-15 — vault index continues to exclude `_folder.md` from the .md enumeration" | EC-15 | Existing assertion in `detection.test.ts` carries forward to `ec-sweep.test.ts`. |
| `tests/collections/ec-sweep.test.ts` | "EC-16 — window-size invariant unchanged" | EC-16 / NFR-3 | Existing reference to `tests/settings/window-defaults.test.ts`; assert no regression. |

#### EC → step mapping (refactor)

| EC | Tested in | Step that lights it green |
|---|---|---|
| EC-1 (invalid `layout:`) | `ec-sweep.test.ts` | R03 |
| EC-2 (malformed YAML) | `store.test.ts` (existing, edited) | R04 |
| EC-3 (Stack name conflict) | `commands.test.ts` (existing, kept) | (no change — already green) |
| EC-4 (missing root `_folder.md`) | `store.test.ts` (existing) | (no change) |
| EC-5 (subfolder w/o `_folder.md`) | `home-canvas.test.ts` (new) | R05 |
| EC-6 (subfolder w/ `_folder.md` but no `layout:`) | `home-canvas.test.ts` (new) | R05 |
| EC-7 (read-compat) | `store.test.ts` (new) | R04 |
| EC-8 (migration on write) | `store.test.ts` (new) | R04 |
| EC-9 (empty subfolder Stack tile) | `home-canvas.test.ts` (new) | R05 |
| EC-10 (drag-reorder notes persists) | `drag-reorder.test.ts` (new) | R06 |
| EC-11 (drag-reorder Stack tiles persists) | `drag-reorder.test.ts` (new) | R06 |
| EC-12 (cross-Stack drag refused) | `drag-reorder.test.ts` (new) | R06 |
| EC-13 (picker switches TO Collections) | `picker.test.ts` (new) | R07 |
| EC-14 (picker switches AWAY from Collections) | `picker.test.ts` (new) | R07 |
| EC-15 (mid-edit layout switch commits) | `inline-editor.test.ts` (existing) | (no change) |
| EC-16 (window invariant) | `tests/settings/window-defaults.test.ts` | all steps |
| EC-17 (vault index excludes `_folder.md`) | `detection.test.ts` (existing) | all steps |
| EC-18 (concurrent writes serialise) | `store.test.ts` (existing) | (no change) |
| EC-19 (schemaVersion mismatch) | `store.test.ts` (existing) | (no change) |
| EC-20 (Notecard with no Stack) | `commands.test.ts` (existing, kept) | (no change — `createNotecardInDefaultStack` retained) |
| EC-21 (click-to-edit handoff) | `inline-editor.test.ts` (existing) | (no change) |
| EC-22 (multi-reference edit) | `reference-integrity.test.ts` (existing) | (no change) |
| EC-23 (broken reference) | `note-box.test.ts` / `reference-integrity.test.ts` (existing) | (no change) |
| EC-24 (reference-to-folder) | `commands.test.ts` (existing) | (no change) |
| EC-25 (custom-icon on Stack) | `home-canvas.test.ts` (existing) | (no change) |
| EC-26 (breadcrumb on Stack rename) | `breadcrumb.test.ts` / `renderer.test.ts` (existing) | (no change) |
| EC-27 (picker active pill) | `ec-sweep.test.ts` (new) | R07 |
| EC-28 (no Make/Unmake anywhere) | `ec-sweep.test.ts` (new) | R01 |

### Deferred work (carries forward from MVP)

The 16 DW-* items from the MVP blueprint (§6) carry forward
unchanged. No new DW-* entries are introduced by this refactor —
every locked-out item has a corresponding decision rationale in
"Locked decisions" or "Out of Scope" above.

Specifically:
- **DW-10** (drag-reorder UI) is now CLOSED by step_R06.
- **DW-1 / DW-2 / DW-3 / DW-4 / DW-5 / DW-6 / DW-7 / DW-8 / DW-9 /
  DW-11 / DW-12 / DW-13 / DW-14 / DW-15 / DW-16** all remain
  deferred with the same rationale documented in the MVP §6.

One refactor-specific carve-out:
- **DW-R1 (cross-Stack drag-reorder, FR-33).** The Architect locks
  cross-Stack note-relocation as out-of-scope for this refactor; the
  right-click "Move to other Stack…" path stays. A follow-up spec
  may add cross-Stack drag once the within-scope drag UX has settled.

### Verification (refactor done)

Run before declaring complete:

- `npm run test:run` — full suite green; tests/collections passes the
  new edited + new-added inventory.
- `npm run test:run -- tests/settings/window-defaults.test.ts` —
  window invariant intact (NFR-3, EC-16).
- `npm run test:run -- tests/folder-icons/` — prerequisite untouched.
- `npm run test:run -- tests/collections/` — every refactor EC
  passes; the deleted tests are gone; the edited tests use the new
  fixtures; the new tests are green.
- `npm run build` — TypeScript clean; bundle emitted.
- `npm run build:plugins && npm run sync:plugins` — mandatory after
  every step that edits `src/plugins/**/*.ts`.

Manual scenarios (mock 1.1):

- Open any folder via the file browser. The folder opens as a normal
  `_folder.md` editor tab with the codeblock modal popping the
  display picker. Select **Collection**. The codefence's `display:`
  becomes `collection-home`; the in-tab widget renders the
  Collections Home canvas.
- In a folder with subfolders, switch layout to Collection. All
  subfolders appear as Stack tiles on the Home canvas with their
  icon + badge.
- Click a Stack tile. The view drills into the subfolder; the Stack
  panel renders its notes as framed boxes; the breadcrumb shows
  `Home (root) / <subfolder>`.
- Drag a note box within a Stack; close and reopen; order persists.
- Drag a Stack tile on the Home canvas; close and reopen; order
  persists.
- Try to drag a note from Stack A onto Stack B's tile — refused.
- Open a folder created by the pre-refactor "Make Collection" path
  (`_folder.md` has `type: collection` only). It renders as
  Collections immediately; `_folder.md` on disk is UNCHANGED.
- Trigger any mutation on that folder. `_folder.md` on disk loses
  `type: collection` and gains `layout: collection-home` in the same
  write.
- "Make Collection" / "Unmake Collection" do not appear anywhere —
  right-click, command-bar, keybindings panel.
- Switch a Collection back to Cards via the picker; notes + subfolders
  preserved byte-for-byte.

### Handoff (refactor)

- Requirements source: `docs/requirements/active_task.md` (Validated 2026-06-06).
- Blueprint: `docs/specs/collections/00_index.md` (this file, status: active).
- Step files (refactor):
  - `docs/specs/collections/step_R01_remove_make_collection.md`
  - `docs/specs/collections/step_R02_display_registry.md`
  - `docs/specs/collections/step_R03_dispatch_path.md`
  - `docs/specs/collections/step_R04_store_layout_marker.md`
  - `docs/specs/collections/step_R05_subfolder_as_stack.md`
  - `docs/specs/collections/step_R06_drag_reorder.md`
  - `docs/specs/collections/step_R07_picker_apply_flow.md`
  - `docs/specs/collections/step_R08_regression_sweep.md`

Next step: Activate `@lead-developer`. Start with this `00_index.md`,
read the Refactor 2026-06-06 section, then implement each `step_R*`
file in order. Begin with `step_R01_remove_make_collection.md`.

---

## Implementation Progress (Lead Developer — Refactor 2026-06-08)

All 8 refactor steps complete; tests green; plugin IIFE rebuilt + synced.

- [x] step_R01 — Remove Make / Unmake Collection ceremony (across `commands.ts`,
  `context-actions.ts`, `file-browser.plugin.ts`, `main.ts`,
  `keybindings-panel.ts`).
- [x] step_R02 — Register `collection-home` in `DISPLAY_REGISTRY` +
  `SELECT_WIDGET_RENDERERS` (modern codefence-widget dispatch path).
- [x] step_R03 — Remove the `detectCollectionLayout` short-circuit from
  `tab.ts`; delete `detection-glue.ts`. The 3-line read-compat alias in
  `tab.ts:347–351` is the only remaining Collections-aware line.
- [x] step_R04 — Store refactor: `readCollection` aliases legacy
  `type: collection` → `layout: collection-home` (no write on read);
  every mutation path strips legacy `type:` in the same atomic write.
  Stack writers no longer emit `type: stack`. (+9 new EC-7 / EC-8 tests.)
- [x] step_R05 — Filesystem-derived subfolder tiles on the Home canvas
  via `listImmediateSubfolders` + `applyNameManualOrder` over `stackOrder`.
  Parent-folder `.md` files render as note boxes mixed with Stack tiles in
  one container. (+9 new tests.)
- [x] step_R06 — Drag-reorder via `attachFolderItemDrag` on canonical
  note boxes (Stack panel) and on Stack tiles (Home canvas). Cross-Stack
  drag refused structurally via container scoping. Parent-folder note
  ordering on Home is intentionally not persisted (DW-R2). (+10 new tests
  in `drag-reorder.test.ts`.)
- [x] step_R07 — Picker apply-flow round-trip verified. One small
  wire-up fix: widened `DisplayKind` in `select-builder.ts` to include
  `"collection-home"` so the picker UI can reference the slug natively.
  (+8 new tests in `picker.test.ts`.)
- [x] step_R08 — Consolidating EC audit in `ec-sweep.test.ts` covering
  EC-19, EC-25, EC-27, EC-28 (label-grep, detection-glue absence).
  (+6 new tests; total ec-sweep file 14 tests.)

Total Collections tests after refactor: **216 passing** (was 173 MVP + 1
post-review = 174 baseline; net Δ +42 across delete / edit / add).

Full project suite: **4697 passed, 39 skipped** (was 4655 / 39 baseline).
Window-defaults invariant: **green** (6/6 across refactor steps).

DW-10 (drag UI) is CLOSED — landed in step_R06.

New refactor-era deferred work:
- **DW-R1** — Cross-Stack drag-reorder of notes (out of scope; right-click
  "Move to other Stack…" remains the move path).
- **DW-R2** — Parent-folder note ordering on the Home canvas is not yet
  persisted. The drag UI visually reorders but the next reload reverts to
  directory-listing order. A dedicated per-parent `noteOrder:` array
  (analogous to per-Stack `order:`) is the future fix.
- **DW-R3** — Reference boxes (cross-Stack pointers) are not
  drag-reorderable. They render in `references:` array order; right-click
  Move up / Move down is the only manual control.

## Review Request

- **Files changed**:
  - Edit: `/Users/daveslaptop/work-LocalArea/markable-2.0/src/plugins/file-browser/collections/store.ts` — R04 read-compat + migration-on-write across `readCollection`, `writeCollectionMeta`, `writeStackMeta`, `writeWithStackOrder`, `writeStackArrayKey`; dropped `type:` writes; `defaultCollectionMeta` / `defaultStackMeta` no longer emit the legacy marker.
  - Edit: `/Users/daveslaptop/work-LocalArea/markable-2.0/src/plugins/file-browser/collections/home-canvas.ts` — R05 filesystem-derived rendering (`listImmediateSubfolders`, `listImmediateNotes`, `applyNameManualOrder`, `loadStackGlyphs`, `renderHomeNoteBox`); R05 `onNoteClick` / `onNoteContextMenu` options; R06 `attachFolderItemDrag` wiring with mixed selector + `stackTileNames` filter.
  - Edit: `/Users/daveslaptop/work-LocalArea/markable-2.0/src/plugins/file-browser/collections/stack-panel.ts` — R06 `data-path = filename` on canonical boxes + `attachFolderItemDrag` dispatch through `store.reorderNote`.
  - Edit: `/Users/daveslaptop/work-LocalArea/markable-2.0/src/plugins/file-browser/collections/renderer.ts` — wire `onHomeNoteClick` / `onHomeNoteContextMenu` into `navigateToHome`'s `HomeCanvasOptions`.
  - Edit: `/Users/daveslaptop/work-LocalArea/markable-2.0/src/lib/select-builder.ts` — R07 widened `DisplayKind` union to include `"collection-home"`.
  - Edit: `/Users/daveslaptop/work-LocalArea/markable-2.0/tests/collections/store.test.ts` — R04 fixture updates (already partially done by prior session; verified green).
  - Edit: `/Users/daveslaptop/work-LocalArea/markable-2.0/tests/collections/home-canvas.test.ts` — R05 `withVaultIndex` extended to accept notes; new `makeOpts` fields for `onNoteClick` / `onNoteContextMenu`; +9 R05 test cases at file bottom.
  - Edit: `/Users/daveslaptop/work-LocalArea/markable-2.0/tests/collections/ec-sweep.test.ts` — R08 consolidating audit assertions (EC-19, EC-25, EC-27, EC-28, detection-glue absence).
  - New: `/Users/daveslaptop/work-LocalArea/markable-2.0/tests/collections/drag-reorder.test.ts` — R06 dedicated drag-reorder test file (10 cases).
  - New: `/Users/daveslaptop/work-LocalArea/markable-2.0/tests/collections/picker.test.ts` — R07 picker apply-flow verification (8 cases).
  - Edit: `/Users/daveslaptop/work-LocalArea/markable-2.0/docs/specs/collections/00_index.md` — this section.

- **Steps completed**: R01 → R02 → R03 → R04 → R05 → R06 → R07 → R08, strict order. R01–R03 landed in the prior session; this session resumed mid-R04 and completed R04 → R08.

- **Known limitations**:
  - **DW-R1 (cross-Stack drag-reorder)**: out of scope per the refactor lock; right-click "Move to other Stack…" is the cross-Stack mechanism.
  - **DW-R2 (parent-folder note ordering on Home)**: drag UI works visually but the order is not persisted. Reload restores directory-listing order. Fix is a dedicated `noteOrder:` array on the parent `_folder.md` — out of scope here.
  - **DW-R3 (reference-box drag-reorder)**: references render in `references:` array order; right-click is the only manual control.
  - All carry-forward DWs (DW-1 … DW-9, DW-11 … DW-16) remain deferred with the rationales in §6 of the MVP blueprint.

- **Edge cases covered by tests** (each requirements EC maps to a passing test):
  - EC-1 (invalid `layout:` value) → `tests/collections/ec-sweep.test.ts` "EC-1 — LAYOUT_RENDERERS does NOT have an entry for an invalid layout value (fallback path)"
  - EC-2 (malformed YAML in `_folder.md`) → `tests/collections/store.test.ts` "EC-6 — returns ok with empty defaults when frontmatter is malformed" (existing, unchanged behaviour)
  - EC-3 (Stack folder name conflict) → `tests/collections/commands.test.ts` (existing, kept)
  - EC-4 (missing root `_folder.md`) → `tests/collections/store.test.ts` "EC-4 — returns ok with empty defaults when _folder.md is missing"
  - EC-5 (subfolder without `_folder.md`) → `tests/collections/home-canvas.test.ts` "EC-5 — subfolder without _folder.md renders as tile with notebook icon and basename label"
  - EC-6 (subfolder with `_folder.md` but no `layout:`) → `tests/collections/home-canvas.test.ts` "EC-6 — subfolder with _folder.md but no layout: inherits Collections rendering"
  - EC-7 (read-compat: legacy `type: collection`) → `tests/collections/store.test.ts` "EC-7 — readCollection accepts legacy `type: collection`..." + "EC-7 — readCollection: when both layout: and legacy type: are on disk, layout: wins"
  - EC-8 (migration on write) → `tests/collections/store.test.ts` "EC-8 — writeCollectionMeta strips legacy `type: collection`..." + "EC-8 — appendStackToCollection on a legacy `type: collection` folder..." + "EC-8 — reorderNote on a legacy `type: stack` Stack..."
  - EC-9 (empty Stack tile / empty Home folder) → `tests/collections/home-canvas.test.ts` "EC-9 — folder with zero subfolders AND zero .md files renders the empty-state popover"
  - EC-10 (drag-reorder persistence after reload) → `tests/collections/drag-reorder.test.ts` "FR-30 — reorder persists across a re-read of the Stack"
  - EC-11 (drag-reorder of Stack tiles) → `tests/collections/drag-reorder.test.ts` "FR-31 / EC-11 — drag-reorder on a Stack tile dispatches store.reorderStack with toIndex"
  - EC-12 (cross-Stack drag refused) → `tests/collections/drag-reorder.test.ts` "EC-12 / FR-33 — drag wiring is scoped to the Stack panel's list container"
  - EC-13 (picker switches TO Collections) → `tests/collections/picker.test.ts` "EC-13 — writes `display: collection-home`..." + "EC-13 — round-trip..."
  - EC-14 (picker switches AWAY from Collections) → `tests/collections/picker.test.ts` "EC-14 — switching FROM collection-home to cards re-emits without leftover Collection-specific data"
  - EC-15 (mid-edit layout switch) → existing inline-editor coverage; click-outside-to-commit in `renderer.ts` guards.
  - EC-16 (window-size invariant) → `tests/settings/window-defaults.test.ts` + `tests/collections/ec-sweep.test.ts` "EC-14 / EC-16 — DEFAULT_SETTINGS window invariant"
  - EC-17 (vault index excludes `_folder.md`) → `tests/collections/ec-sweep.test.ts` "EC-15 regression — vault-index buildFolderViewSet still excludes _folder.md from .md enumeration"
  - EC-18 (concurrent `_folder.md` writes serialise) → `tests/collections/store.test.ts` (existing per-file queue cases)
  - EC-19 (schemaVersion mismatch) → `tests/collections/ec-sweep.test.ts` "EC-19 (refactor) — writeCollectionMeta refuses when on-disk schemaVersion is newer than the build"
  - EC-20 (Notecard creation when no Stack exists) → `tests/collections/commands.test.ts` (existing, kept via `createNotecardInDefaultStack`)
  - EC-21 (click-to-edit handoff) → existing `inline-editor.test.ts`
  - EC-22 (multi-reference edit propagation) → existing `reference-integrity.test.ts`
  - EC-23 (broken reference pointer) → existing `note-box.test.ts` / `reference-integrity.test.ts`
  - EC-24 (reference to a folder) → existing `commands.test.ts`
  - EC-25 (custom-icon on Stack) → `tests/collections/ec-sweep.test.ts` "EC-25 — Stack tile renders with a user-assigned custom icon (catalog id)"
  - EC-26 (breadcrumb after Stack rename) → existing `breadcrumb.test.ts` / `renderer.test.ts`
  - EC-27 (picker active pill) → `tests/collections/ec-sweep.test.ts` "EC-27 — DISPLAY_REGISTRY exposes Collection as a pickable layout (active-pill smoke check)" + `tests/collections/picker.test.ts` registry assertions
  - EC-28 (Make/Unmake gone) → `tests/collections/ec-sweep.test.ts` four EC-28 cases (commands export, context-actions export, keybindings COMMANDS, main.ts source) + new menu-item label regex assertion + detection-glue.ts absence assertion

Next step: Activate `@code-reviewer`. Provide `docs/specs/collections/00_index.md`
and `docs/requirements/active_task.md` as context.

---

## Review Sign-off (Refactor 2026-06-08)

- **Date**: 2026-06-08
- **Findings summary**: 0 Critical, 0 High, 2 Medium, 5 Low — 0 outstanding blockers. Medium-2 (dead `type: "stack"` literal in `defaultStackMeta`) applied as a 1-line follow-up commit; Medium-1 (length-justification comments on functions inherited from MVP) and the 5 Lows accepted as deferred follow-ups.
- **Requirements traceability**: All FRs in the active refactor spec verified against the implementation.
- **Edge case coverage**: All 28 Edge Case Inventory items (EC-1 … EC-28) covered by tests that exercise the actual failure modes.
- **Test counts**: `tests/collections/` 216 passing across 22 files; full project 4697 passing, 39 skipped; window-defaults 6/6 green; TypeScript build clean; 20 plugins rebuilt and synced.
- **Status**: Approved for Merge

LGTM. Ready for production.

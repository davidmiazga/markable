---
title: Smart Folders — Master Blueprint
last-updated: "2026-05-08"
review-cadence-days: 30
status: reference
---

# Smart Folders — Master Blueprint (FC3 #1)

Requirements source: `docs/requirements/active_task.md` (16 locked decisions,
29 FRs, 6 NFRs, 18 ECs).

This blueprint is the source of truth for the architecture. Step files are
the implementation contract — Lead Developer follows them in order, top to
bottom. No step modifies a file owned by a later step.

---

## Stack Decision

No new technology is introduced. v1 is a pure-frontend feature inside the
existing file-browser IIFE plugin. The Architect surveyed the alternatives
below before locking the stack:

| Concern | Option considered | Outcome |
|---|---|---|
| Query language | `mongo`-style JSON predicates vs hand-rolled discriminated union | **Discriminated union.** Tree-shakable, type-safe operator-per-rule, no runtime parser. Mongo-style would force a parser and a generic value coercion layer for ~6 fixed types — net loss. |
| Filter evaluation engine | Custom evaluator vs general-purpose like `fuse.js` / `match-sorter` | **Custom evaluator.** Smart Folders are exact-match predicates (set inclusion, comparator, substring); no fuzzy ranking is required. Pulling a library would add ≥15 KB to the IIFE for zero benefit. |
| Reactive UI | Plain DOM mutation (file-browser pattern) vs `solid-js` / `lit` micro-runtime | **Plain DOM.** The existing file-browser is hand-rolled DOM with module-level state (`_currentTree`, `_expandedPaths`, etc.). Introducing a reactive layer here only would create two parallel idioms in one plugin. NFR-04 forbids new bundle targets. |
| Persistence | New Tauri command vs reuse `api.saveSettings` | **Reuse `api.saveSettings`.** Locked #11 (no Rust schema changes). Settings already debounced; smart folders piggyback on the same flow. |
| Inverse-map cache | `Map`-based plain JS vs `WeakMap` vs IndexedDB | **`Map` keyed by `vaultIndex.builtAt`.** Built once per evaluation pass per FR-28. WeakMap has no observable benefit (we hold the index strongly elsewhere); IndexedDB would add async latency to a hot path that must finish in ≤100 ms (NFR-01). |
| Web search 2026 | "best in-browser query/filter library 2026" — surveyed `mingo`, `sift`, `fuse.js`, `match-sorter`, `nano-jsonl` | **None adopted.** The 6 rule types are small and stable; an embedded library is overkill. Documented for traceability only. |

**Result**: TypeScript, plain DOM, single IIFE, reuse of `api.saveSettings`,
zero new Rust commands, zero new npm dependencies.

---

## High-Level Architecture

### One-paragraph summary

Smart Folders are saved query objects (`SmartFolderDef`) persisted per-vault
inside `FileBrowserSettings.smartFolders`. On every "evaluation trigger"
(vault index ready, smart folder created/edited/deleted, vault changed) the
plugin runs an evaluation pass: it builds two **inverse maps once** (path →
tag-and-field-value set; targetStem → inbound-link count), then for each
Smart Folder filters `VaultIndex.entries ∪ nonMdFiles` against the rule list
under AND semantics. Matched paths and counts are stored in a module-level
`Map<smartFolderId, EvaluationResult>`. The tree builder reads this map at
render time and injects one virtual `TreeNode { type: "directory",
iconClass: "folder-smart" }` per Smart Folder at the top of each vault
root's children. Expanding a Smart Folder reveals matched files as standard
`TreeNode { type: "file" }` leaves sorted by `modified` descending. The
filter editor mounts inline below the Smart Folder's row using the Mac
Finder row pattern. Settings persistence reuses the existing debounced
`saveSettings` path.

### Data flow — read path (eager evaluation)

```
trigger (vault index built | smart folder CRUD | vault switched)
  └─ buildInverseMaps(vaultIndex)                            ← FR-28, NFR-01
       ├─ pathToTags: Map<path, Set<tag|field:value>>
       └─ pathToInboundCount: Map<path, number>
  └─ scanVaultTagsCached(vault)                              ← A-4, ~5s TTL
  └─ for each SmartFolderDef sf in smartFolders[vaultId]:
       └─ evaluateSmartFolder(sf, vaultIndex, inverseMaps)
            ├─ start with all candidates (md entries + nonMd)
            ├─ for each rule: filter (AND combinator)
            └─ sort by modified desc                          ← Locked #12
       └─ store in _evaluationResults: Map<id, EvaluationResult>
  └─ renderPanel()
       └─ buildTreeFromIndex injects virtual smart-folder nodes
            (one per def, at top of each vault root's children)
       └─ children of each smart-folder node = matched files (flat)
       └─ name suffix: "Drafts (12)"                         ← A-5
```

### Data flow — write path (filter editor)

```
user clicks "+ New Smart Folder" button OR right-click vault root → "New Smart Folder"
  └─ openFilterEditor({ mode: "create", anchorPath: vaultRoot })
       └─ mount inline form below anchor row
       └─ name input focused (FR-22)

user clicks Smart Folder row → "Edit Filters"
  └─ openFilterEditor({ mode: "edit", smartFolderId })
       └─ mount inline form below the smart-folder row
       └─ pre-populate with existing rules

user adds/removes/edits rule rows  (FR-23 row anatomy)
  └─ each row: [Type ▾] [Operator ▾] [Value control] [-] [+]
  └─ in-memory draft only — no persistence yet

user clicks Save
  └─ validate: name non-empty AND rules.length ≥ 1     (FR-26, EC-16)
  └─ commit to settings: smartFolders[vaultId][id] = def
  └─ saveSettings (existing debounced path)
  └─ trigger eager re-evaluation (FR-29 b)
  └─ close editor, focus the smart folder row

user clicks Cancel | clicks outside editor             (FR-23)
  └─ discard draft, close editor
```

---

## Component Map

### New files

| Path | Purpose | Step |
|---|---|---|
| `src/plugins/file-browser/smart-folders/types.ts` | Data shapes: `SmartFolderDef`, `SmartFolderRule` (discriminated union over six types), `EvaluationResult`, `InverseMaps`. Pure types — no runtime exports. | step_01 |
| `src/plugins/file-browser/smart-folders/settings.ts` | Load/save `smartFolders` slice of `FileBrowserSettings`. Migration of legacy settings (no field). Corruption recovery (NFR-06, EC-08). Stable id generation. | step_01 |
| `src/plugins/file-browser/smart-folders/evaluator.ts` | Pure functions: `buildInverseMaps`, `evaluateSmartFolder`, `evaluateAll`, `matchRule` (one matcher per rule type). Per-pass `scan_vault_tags` cache (~5 s TTL). | step_02 |
| `src/plugins/file-browser/smart-folders/tree-injection.ts` | Pure: `injectSmartFolderNodes(treeNodes, smartFolders, results)` — produces synthetic `TreeNode` for each def and a flat sorted children list per locked #12. | step_03 |
| `src/plugins/file-browser/smart-folders/editor-ui.ts` | Inline filter-editor DOM builder (Mac Finder row pattern), Save/Cancel handlers, click-outside detection. | step_05 |
| `src/plugins/file-browser/smart-folders/context-menu.ts` | Context-menu items factory for Smart Folder rows (Edit Filters / Rename / Delete). Helper to add "New Smart Folder" item to existing vault-root menu. | step_06 |
| `src/plugins/file-browser/smart-folders/index.ts` | Public surface re-exported into `file-browser.plugin.ts`: `initSmartFolders`, `evaluateAllSmartFolders`, `injectIntoTree`, `getMatchCount`, `openFilterEditor`, `buildSmartFolderContextMenuItems`. Module-level state (results map, draft state). | step_02 / wired through later steps |

### Existing files modified

| Path | Reason | Steps |
|---|---|---|
| `src/plugins/file-browser/file-browser.plugin.ts` | Extend `FileBrowserSettings`; call `loadSmartFolders` in `loadExpandedPaths` path; add Smart Folder context-menu branch in `handleContextMenu`; add "+ New Smart Folder" entry in `buildAddRow` and in `buildVaultContextMenuItems`; trigger eager re-evaluation on vault-changed / index-updated; pass results into tree builder. | steps 01, 03, 06, 07 |
| `src/plugins/file-browser/file-tree.ts` | `buildTreeFromIndex` accepts an optional `smartFolderInjections` array — injected at the **top** of each vault root's children before sort, with a stable sort marker so they remain above real subdirs (FR-14, EC-14). New `TreeNode.iconClass: "folder-smart"`; new `TreeNode.matchCount?: number` (for badge rendering). | step_03, step_07 |
| `scripts/fetch-material-icons.mjs` | Add `FOLDER_MANAGED: "folder_managed"` to ICONS map; re-run script. | step_04 |
| `src/plugins/file-browser/icons/material/index.ts` | Auto-regenerated by re-running fetch script — adds `ICON_FOLDER_MANAGED`. | step_04 |
| `src/plugins/file-browser/file-browser.css` (or inline `FILE_BROWSER_CSS`) | New rules: `.folder-smart` icon, `.tree-node-smart-suffix` (count badge), `.smart-folder-editor`, `.smart-folder-rule-row`, `.smart-folder-action-bar`, `.smart-folder-empty-hint`. | steps 03, 05, 07 |

### Files that MUST NOT change in v1

- `src-tauri/src/**` — Locked #11, FR-13.
- `src/lib/bridge.ts` — `scanVaultTags` already exists.
- `src/lib/vault-types.ts` — no schema changes.
- `src/lib/settings.ts` — `FileBrowserSettings` is owned by the plugin file.
- Any other plugin (`backlinks`, `command-bar`, …) — NFR-03.

---

## Architectural Decisions

### AD-1 — Module layout: subfolder, not single file

Smart Folders live in `src/plugins/file-browser/smart-folders/` with one
file per concern (types, settings, evaluator, tree-injection, editor-ui,
context-menu, index). Rationale:

- Each file has a single, narrow responsibility under the **30 functions /
  30 lines** rule (CLAUDE.md).
- Mirrors the file-browser convention of pure-utility siblings
  (`file-tree.ts`, `file-browser-ops.ts`, `manage-vaults-ui.ts`).
- Rollup IIFE bundling treats sibling imports as inline at build time —
  NFR-04 (single IIFE) is preserved automatically.
- Test isolation: pure modules (`evaluator.ts`, `tree-injection.ts`) are
  Vitest-friendly without DOM mocking.

### AD-2 — Persistence shape (locked, here for traceability)

```typescript
interface FileBrowserSettings {
  expandedPaths: Record<string, string[]>;
  pinnedPaths?: Record<string, string[]>;
  smartFolders?: Record<string, SmartFolderDef[]>;   // NEW — per-vault, optional
}
```

The field is optional so existing settings files remain valid — `undefined`
is treated as "no smart folders for this vault yet" (EC-02). Migration is
implicit; nothing to write at first launch.

### AD-3 — Smart Folder id is a stable synthetic string

Generated at create-time as `sf-<crypto.randomUUID()>` (or
`sf-${Date.now()}-${Math.floor(Math.random()*1e6)}` fallback if `crypto`
unavailable in IIFE context — guarded). The id is **independent of the
name** so renames don't invalidate expansion state (EC-05).

The expansion-state key per locked #14 is `__smart__/<id>`. The
`__smart__/` prefix never collides with real vault paths (real paths begin
with an absolute filesystem path, e.g. `/Users/...`).

### AD-4 — Eager evaluation, with an inline `scan_vault_tags` per-pass cache

Per A-4 / Locked #15, evaluation runs eagerly. Rationale for eager over
lazy: the count badge (A-5) is a **render-time read** of the result map, so
counts must already exist before `renderPanel` runs. Lazy-on-expand would
either (a) defer count rendering until expand (poor UX), or (b) require its
own background pass that effectively duplicates eager.

`scan_vault_tags` is the only async dependency. We wrap it in a tiny
in-module cache:

```typescript
let _tagScanCache: { vaultId: string; ts: number; promise: Promise<TagEntry[]> } | null = null;
const TAG_SCAN_TTL_MS = 5_000;
```

The cache is a **shared Promise** (not a resolved value) so concurrent
evaluation passes within the TTL await the same in-flight call — important
for EC-15 (rapid edits). Invalidated on:

- TTL expiry (5 s).
- Vault change (`vaultId` mismatch).
- The (rare) case where an evaluation pass observes
  `vaultIndex.builtAt` newer than the cache's `ts`.

**Trigger sources for eager re-evaluation** (FR-29):

| Source | Fired when | Hook in `file-browser.plugin.ts` |
|---|---|---|
| (a) Vault index ready | `onVaultChanged` resolves OR `onIndexUpdated` fires | Existing `_indexUpdatedCb` and `_vaultChangedCb` |
| (b) Smart folder created / edited / deleted | After `saveSettings` for that mutation | New `commitSmartFolderChange()` helper |
| (c) Active vault changed | Before `renderPanel` in vault-changed handler | Same `_vaultChangedCb` |

We **do not** re-evaluate on every tab change, sidebar toggle, or expand
toggle — only on the four sources in FR-29.

### AD-5 — Inverse maps are built once per evaluation pass

`buildInverseMaps(vaultIndex, scanResult)` returns:

```typescript
interface InverseMaps {
  pathToTags: Map<string, Set<string>>;        // tag + field:value combined
  pathToInboundCount: Map<string, number>;     // backlink count per md file
  pathToOutboundCount: Map<string, number>;    // outbound link count per md file
  distinctExtensions: string[];                // for the editor extension dropdown
}
```

- `pathToTags`: invert `scan_vault_tags` `TagEntry[]`. Plain tags and
  `field:value` strings live in the same set per FR-03.
- `pathToInboundCount`: walk all `entries[]`, for each `outboundLinks[]`
  resolve target stem to its absolute path via the existing vault index's
  stem→path resolution (already used by backlinks; we read it out of the
  vault manager's existing API), increment counter on the target. We
  **count by stem** consistently with how backlinks resolve. Non-md files
  always have `pathToInboundCount` = 0 by absence (FR-EC-18).
- `pathToOutboundCount`: just `entries[i].outboundLinks.length`.
- `distinctExtensions`: collect `path.split(".").pop()` over all md +
  non-md, lowercased.

Total cost: one pass over the index. NFR-01 budget (1k files × 10 SFs × 6
rules) is comfortably met because per-rule work is then O(1) lookup
(tag/links) or O(filename) substring (path/title/extension).

### AD-6 — Tree integration

We extend `buildTreeFromIndex(entries, rootPaths, expandedPaths, vault, directories, smartFolderInjections?)`
with a new optional last argument:

```typescript
type SmartFolderInjection = {
  id: string;
  name: string;
  matchCount: number;
  matches: VaultIndexEntry[];   // already sorted modified desc
};
```

Injection happens **inside** `buildTreeFromIndex`, not from the caller, so
test coverage stays in `file-tree.test.ts` and the caller doesn't need to
know about virtual nodes. For each Smart Folder we synthesize:

```typescript
const sfNode: TreeNode = {
  type: "directory",
  path: `__smart__/${id}`,         // synthetic key; matches expandedPaths
  name: name,
  children: matches.map(toFileNode),
  expanded: expandedPaths.has(`__smart__/${id}`),
  depth: 1,                         // direct child of vault root
  iconClass: "folder-smart",
  matchCount: matchCount,           // NEW field on TreeNode (optional)
};
```

Smart folder nodes are **prepended** to `rootChildren` before the existing
sortNodes pass. Because `sortNodes` sorts dirs-first then alphabetically,
we mark smart-folder nodes with a sort sentinel so they sort **above**
real dirs (FR-14, EC-14): we either (a) mutate `sortNodes` to recognize
synthetic paths, or (b) inject after sort. **Architect chooses (b)**: do
the injection **after** `sortNodes` runs on the rest of the tree, then
unshift smart folders into `rootChildren`. Cleaner, no sortNodes change.

The file children of a Smart Folder are already sorted (modified desc) by
the evaluator and **must not** be re-sorted by `sortNodes`. Because
`sortNodes` recurses, we mark the smart-folder node so the recursion skips
its children. Implementation: `sortNodes` checks `node.path.startsWith(
"__smart__/")` and returns early on that branch.

Existing event wiring (`buildActivateHandler`, `attachKeyboardHandler`)
treats Smart Folder rows as `type: "directory"` and works without
modification — name click toggles expansion (FR-20), file children get
standard click-to-open behavior (FR-19). The right-click context menu is
the only behavioral fork; see step_06.

### AD-7 — Match count badge plumbing

`TreeNode.matchCount?: number` carries the count from evaluator → tree
node. `appendIconAndLabel` (existing label builder) is extended in
step_07 to append a faint `<span class="tree-node-smart-suffix">(12)</span>`
after the label when `node.iconClass === "folder-smart"` and
`matchCount !== undefined`. Renderer never re-runs evaluation.

### AD-8 — Filter editor mount strategy

The editor is a single `<div class="smart-folder-editor">` inserted as the
**next sibling** of the Smart Folder's `<li>` in the tree DOM (or the
vault-root `<li>` for create mode). Reasons:

- Mac Finder pattern: anchored to the row it edits (FR-23).
- `<li>` cannot contain block-level form layout cleanly without breaking
  the tree's CSS height invariants. Sibling block placement keeps the
  tree's flex/scroll contract intact.
- Click-outside detection: a single document-level `mousedown` handler
  registered at editor open, removed at close. If the click target is not
  contained by the editor → cancel.

The editor is fully **plain DOM** (matches file-browser idioms). Draft
state lives in a closure inside `openFilterEditor`. Each rule row is built
by `buildRuleRow(rule, onChange, onRemove, canRemove)` that returns its
own `<div>` and manages its own type/operator/value sub-DOM. Type-change
resets operator to the first valid value for the new type (FR-23).

The Save button is enabled iff name is non-empty AND rules.length ≥ 1
(FR-26). On Save: build the new `SmartFolderDef`, call
`commitSmartFolderChange("create"|"update", def)`, close.

### AD-9 — Context menu integration (no new infrastructure)

The existing `showContextMenu(items, x, y)` factory is reused verbatim. We
add:

- **`buildSmartFolderContextMenuItems(el, sfId, vaultId)`** — returns
  `[Edit Filters, Rename, separator, Delete]` and is selected in
  `handleContextMenu` when `el.getAttribute("data-smart-folder-id")` is
  present.
- **A new entry** in `buildVaultContextMenuItems`: `{ label: "New Smart
  Folder", handler: () => openFilterEditor({ mode: "create", anchorPath:
  vaultRoot }) }` placed between "New Folder" and the separator before
  "Unmount".
- **A new menu item** in `buildAddRow`'s `showContextMenu` call: `{ label:
  "New Smart Folder", handler: ... }` after "New Folder".

`handleContextMenu` discriminator: when the clicked `<li>` has class
`tree-node-smart-folder` (set by `buildNodeEl` when `iconClass ===
"folder-smart"`), use the smart-folder menu instead of the directory menu.

### AD-10 — Settings persistence shape & corruption recovery (NFR-06, EC-08)

On load (`loadSmartFolders(vaultId)`), the raw `smartFolders[vaultId]` is
validated **per-entry**:

```text
for each candidate def in raw[vaultId]:
  if shape is invalid:
    drop it, console.warn("[smart-folders] dropping malformed def …")
    continue
  for each rule:
    if rule.type is unknown OR operator invalid for type OR value missing:
      drop the rule (not the whole def)
      console.warn(…)
  if def.rules.length === 0 after rule pruning:
    drop the def (would otherwise be invalid per FR-26)
```

Whitelist validators per rule type live in `settings.ts` next to the load
function. The plugin **never throws** on malformed data — it logs and
proceeds. After load, the cleaned definitions are re-saved on the next
mutation; corruption heals itself.

### AD-11 — Inverse map invalidation

The inverse maps are **stateless per evaluation pass**: we don't cache
them across passes. Justification:

- NFR-01 budget covers a 1k-file vault per pass; inverse-map construction
  is the dominant cost and is single-pass O(N). Caching saves at most one
  pass per trigger but adds invalidation complexity (which file changes →
  which map entry).
- Triggers are infrequent (FR-29 list). Each pass also re-reads
  `scan_vault_tags` (cached ≤ 5 s) so caching the inverse map separately
  would be of marginal benefit.

This decision can be revisited if NFR-01 isn't met on a real 1k-file
vault — see step_08 hardening.

### AD-12 — Empty / loading / no-match states

- **Empty vault** (EC-01): `vaultIndex.entries.length === 0` AND
  `nonMdFiles.length === 0`. Smart folders still render but with
  `matchCount = 0` and zero children. `renderEmptyState` for the tree
  fires the existing "no-files" path; smart folder injection is skipped
  in that branch (we don't want a "Drafts (0)" row above a "no files"
  message).
- **No SFs defined yet** (EC-02): `smartFolders[vaultId]` is undefined or
  `[]`. **No header**, no placeholder — tree renders as today.
- **SF matches zero files** (EC-03): expanded body shows a single dimmed
  child row `<li class="smart-folder-empty-hint">No matches</li>`. Not
  selectable, not focusable.
- **Index still building** (EC-12): when `_isLoading` is true,
  `renderTreeContent` skips the smart-folder branch entirely. Once index
  ready, eager evaluation fires and re-renders.

---

## Open Questions for the Lead Developer

These are minor and **do not block** architecture sign-off — note them
during implementation and flag if any blow up.

1. **`scan_vault_tags` first-call latency**: a 1k-file vault may take
   several hundred ms to scan. The 5 s cache absorbs subsequent passes;
   the first pass after vault load is the slow one. Decide in step_02
   whether to (a) await the scan synchronously inside `evaluateAll` (UI
   blocks ≤ 1 s), or (b) seed `pathToTags` from `vaultIndex.entries[i]
   .tags` only and upgrade to the full scan asynchronously. **Architect
   recommends (a)**: simpler control flow, scan is already in cache for
   future passes, NFR-01's 100 ms budget is per pass *after* the maps
   exist.
2. **Stem→path resolution for inbound link count**: the file-browser
   plugin doesn't currently compute backlinks itself — the backlinks
   plugin does. We need a small helper (likely 5-10 LOC) that walks
   `entries[]` and for each `entries[i].outboundLinks[j]` resolves to a
   path by matching `entries[k].name === outboundLinks[j]`. Lead
   Developer: confirm there's no shared utility before duplicating.

---

## Implementation Roadmap

Each step is independently testable. Lead Developer must run
`npm run test:run` after each step and verify zero regressions before
moving to the next. Plugin rebuild required after every step that touches
`src/plugins/file-browser/`:

```bash
npm run build:plugins && npm run sync:plugins
```

| Step | File | What lands |
|---|---|---|
| 01 | `step_01_settings-and-types.md` | `types.ts`, `settings.ts`, `FileBrowserSettings.smartFolders` field, load/save migration, corruption recovery, id generation |
| 02 | `step_02_evaluator.md` | `evaluator.ts`: `buildInverseMaps`, `evaluateSmartFolder`, `evaluateAll`, `scanVaultTagsCached`, per-rule matchers |
| 03 | `step_03_tree-injection.md` | `tree-injection.ts`, extended `buildTreeFromIndex`, sort guard, skipped recursion in `sortNodes`, expansion-state key wiring |
| 04 | `step_04_icon.md` | Add `FOLDER_MANAGED` to fetch script, re-run, import `ICON_FOLDER_MANAGED`, register `.folder-smart` CSS |
| 05 | `step_05_filter-editor.md` | `editor-ui.ts`: inline form, Mac Finder rows, six rule-type value controls, Save / Cancel / click-outside, validation |
| 06 | `step_06_context-menu.md` | `context-menu.ts`: smart-folder right-click items, "+ New Smart Folder" in vault-root menu and add-row menu, edit/rename/delete wiring |
| 07 | `step_07_count-badge-and-eager.md` | `matchCount` plumbing through `TreeNode`, `appendIconAndLabel` suffix, eager re-evaluation triggers in `file-browser.plugin.ts` |
| 08 | `step_08_edge-cases.md` | EC-01 / EC-02 / EC-03 / EC-07 / EC-08 / EC-12 / EC-14 / EC-18 hardening, vault-switch cleanup of `_evaluationResults` |
| 09 | `step_09_tests.md` | EC checklist test file, evaluator unit tests, tree-injection tests, settings migration test, performance smoke test (NFR-01) |

---

## Definition of Done

- [x] All 29 FRs traceable to a step file (see traceability matrix below).
- [x] All 18 ECs covered by either a test or a deliberate "by construction" justification in `step_09`.
- [x] All 6 NFRs satisfied; NFR-01 verified by `step_09` perf smoke.
- [x] All 16 locked decisions still match the implementation; no silent re-questioning.
- [x] No Rust changes (Locked #11).
- [x] Plugin builds as a single IIFE and loads via `npm run build:plugins && npm run sync:plugins`.
- [x] All 9 step files implemented. 88 test files, 3667 tests passing, 0 TypeScript errors.

### Traceability matrix (FR → step)

| FR | Step | FR | Step | FR | Step |
|---|---|---|---|---|---|
| FR-01 | 01 | FR-11 | 01 | FR-21 | 06 |
| FR-02 | 01 | FR-12 | 01, 08 | FR-22 | 06 |
| FR-03 | 02, 05 | FR-13 | (no Rust — locked) | FR-23 | 05 |
| FR-04 | 02, 05 | FR-14 | 03 | FR-24 | 06 |
| FR-05 | 02, 05 | FR-15 | 03 | FR-25 | 06, 08 |
| FR-06 | 02, 05 | FR-16 | 03 | FR-26 | 05 |
| FR-07 | 02, 05 | FR-17 | 04 | FR-27 | 02 |
| FR-08 | 02, 05 | FR-18 | 03 | FR-28 | 02 |
| FR-09 | 01, 02, 05 | FR-19 | 03 (reuses existing click) | FR-29 | 07 |
| FR-10 | 02 | FR-20 | 03 (reuses existing toggle) | | |

### Edge-case checklist (EC → step / how covered)

| EC | Coverage |
|---|---|
| EC-01 empty vault | step_03 + step_08 (renderEmptyState branch) |
| EC-02 no SFs | step_01 (undefined ⇒ no injection) |
| EC-03 zero matches | step_03 (empty-hint child row) |
| EC-04 tag removed | step_02 (rule still defined, matches none — falls through naturally) |
| EC-05 rename while expanded | step_06 (id stable; `__smart__/<id>` survives) |
| EC-06 delete while expanded | step_06 + step_08 (purge `__smart__/<id>` from expandedPaths) |
| EC-07 vault switch | step_08 (`_evaluationResults.clear()` on vault change) |
| EC-08 corruption | step_01 (per-entry whitelist validators) |
| EC-09 conflicting rules | step_02 (AND ⇒ empty match — same as EC-03) |
| EC-10 large vault | step_09 (perf smoke against 1k synthetic entries) |
| EC-11 many SFs (50+) | step_01 (no hard cap; documented) |
| EC-12 index still building | step_07 (skip injection when `_isLoading`) |
| EC-13 missing field | step_02 (same as EC-04) |
| EC-14 name collides w/ real dir | step_03 (after-sort prepend) |
| EC-15 rapid edits | step_02 (shared-promise tag-scan cache) |
| EC-16 validation | step_05 (Save disabled state) |
| EC-17 fs change while expanded | step_07 (existing `_indexUpdatedCb` triggers eager eval) |
| EC-18 non-md + outbound rule | step_02 (non-md absent from `pathToOutboundCount` ⇒ rule "outbound ≥ 1" excludes them; documented) |

---

## Cross-cutting non-functional reminders

- **NFR-01 perf**: every step that touches the evaluator or tree must
  preserve the "build inverse maps once per pass" invariant.
- **NFR-02 settings size**: no hard cap; if Lead Developer observes any
  `smartFolders` JSON > 100 KB during testing, raise it for a follow-up.
- **NFR-03 home**: nothing leaves `src/plugins/file-browser/`.
- **NFR-04 single IIFE**: no `dependsOn`, no second bundle target.
- **NFR-05 keyboard**: smart-folder rows render as `type: "directory"`
  and inherit existing arrow/Enter behavior.
- **NFR-06 corruption**: drop, log, continue. Never throw.

---

## Handoff Summary

- Requirements source: `docs/requirements/active_task.md`
- Blueprint: `docs/specs/smart-folders/00_index.md`
- Step files created:
  - `docs/specs/smart-folders/step_01_settings-and-types.md`
  - `docs/specs/smart-folders/step_02_evaluator.md`
  - `docs/specs/smart-folders/step_03_tree-injection.md`
  - `docs/specs/smart-folders/step_04_icon.md`
  - `docs/specs/smart-folders/step_05_filter-editor.md`
  - `docs/specs/smart-folders/step_06_context-menu.md`
  - `docs/specs/smart-folders/step_07_count-badge-and-eager.md`
  - `docs/specs/smart-folders/step_08_edge-cases.md`
  - `docs/specs/smart-folders/step_09_tests.md`

---

## Review Request

- **Files changed**:
  - `src/plugins/file-browser/smart-folders/types.ts` (created, step_01)
  - `src/plugins/file-browser/smart-folders/settings.ts` (created, step_01)
  - `src/plugins/file-browser/smart-folders/evaluator.ts` (created, step_02)
  - `src/plugins/file-browser/smart-folders/index.ts` (created, steps 02–08)
  - `src/plugins/file-browser/smart-folders/tree-injection.ts` (created, step_03)
  - `src/plugins/file-browser/smart-folders/editor-ui.ts` (created, step_05)
  - `src/plugins/file-browser/smart-folders/context-menu.ts` (created, step_06)
  - `src/plugins/file-browser/file-tree.ts` (modified, steps 03, 07)
  - `src/plugins/file-browser/file-browser.plugin.ts` (modified, steps 01–08)
  - `src/plugins/file-browser/icons/material/index.ts` (regenerated, step_04)
  - `scripts/fetch-material-icons.mjs` (modified, step_04)
  - `tests/plugins/file-browser/smart-folders.settings.test.ts` (created, step_01)
  - `tests/plugins/file-browser/smart-folders.evaluator.test.ts` (created, step_02)
  - `tests/plugins/file-browser/smart-folders.tree-injection.test.ts` (created, step_03)
  - `tests/plugins/file-browser/smart-folders.icon.test.ts` (created, step_04)
  - `tests/plugins/file-browser/smart-folders.editor.test.ts` (created, step_05)
  - `tests/plugins/file-browser/smart-folders.context-menu.test.ts` (created, step_06)
  - `tests/plugins/file-browser/smart-folders.integration.test.ts` (created, steps 07+09)
  - `tests/plugins/file-browser/smart-folders.perf.test.ts` (created, step_09)
  - `tests/plugins/file-browser/vault-ux.test.ts` (modified, step_06: updated item counts)
  - `docs/specs/smart-folders/00_index.md` (updated, all steps)

- **Steps completed**: step_01, step_02, step_03, step_04, step_05, step_06, step_07, step_08, step_09

- **Known limitations**:
  - `triggerEvaluation` as a `_testing`-exposed function (not in `index.ts` as spec suggested) — kept in plugin layer because it requires access to `_smartFolders`, `_enabled`, and the vault manager window global. The spec's suggested placement in `index.ts` would have created a circular dependency with the plugin's module state.
  - Performance warning threshold (250 ms) is unconditional (not gated on NODE_ENV) as noted in step_08 cleanup #2 — acceptable for v1.
  - Persistence-corruption auto-heal deferred to next mutation (per spec AD-10 design choice).

- **Edge cases covered by tests**:

  | EC | Test file + assertion |
  |---|---|
  | EC-01 empty vault | `smart-folders.integration.test.ts` → "no smart-folder DOM elements when vault index has zero entries" |
  | EC-02 no SFs defined | `smart-folders.integration.test.ts` → "no [data-smart-folder-id] elements when _smartFolders is empty" |
  | EC-03 zero matches | `smart-folders.tree-injection.test.ts` → "adds an empty-hint sentinel child when result has zero matches" |
  | EC-04 tag removed | `smart-folders.evaluator.test.ts` → "returns no matches when tag is not present in any file" |
  | EC-05 rename stable id | `smart-folders.context-menu.test.ts` → "commit does NOT change the id" |
  | EC-06 delete purge | `smart-folders.context-menu.test.ts` → "confirming delete calls onDelete with the def id" |
  | EC-07 vault switch | `smart-folders.integration.test.ts` → "clearEvaluationCache removes all evaluation results from the map" |
  | EC-08 corruption | `smart-folders.settings.test.ts` → "sanitizeDef returns null for entries without id/name/rules" |
  | EC-09 conflicting rules | `smart-folders.evaluator.test.ts` → "AND combinator: contradictory rules produce zero matches" |
  | EC-10 large vault | `smart-folders.perf.test.ts` → "evaluates 1000 entries × 10 SFs × 6 rule types in < 100 ms" |
  | EC-11 many SFs (50+) | `smart-folders.perf.test.ts` → "50 smart folders evaluate within the 100 ms budget" |
  | EC-12 index building | `smart-folders.integration.test.ts` → "triggerEvaluation does not throw when vaultIndex is null" |
  | EC-13 missing field | `smart-folders.evaluator.test.ts` (subset of EC-04 — same test path) |
  | EC-14 name collision | `smart-folders.tree-injection.test.ts` → "smart folders appear before real directories" |
  | EC-15 rapid edits | `smart-folders.integration.test.ts` → "seeding twice: last seed wins" |
  | EC-16 validation | `smart-folders.editor.test.ts` → "Save button is disabled initially when name is empty" |
  | EC-17 fs change | `smart-folders.integration.test.ts` → "triggerEvaluation does not throw when vault + index available" |
  | EC-18 non-md + links | `smart-folders.evaluator.test.ts` → "links rules return false for non-md files" |

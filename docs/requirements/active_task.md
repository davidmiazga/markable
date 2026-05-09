---
title: "Folder View via _folder.md"
last-updated: "2026-05-09"
review-cadence-days: 90
status: active
---

# Active Task — Folder View via `_folder.md`

## Summary

As a vault user, I want to place a `_folder.md` file inside any directory to give that directory a rich "Folder View" tab — a rendered card-grid of its immediate subfolders and files — so that I can navigate and visualize project structures without leaving the editor. Folders without `_folder.md` behave exactly as they do today. The feature is driven entirely by the file-browser plugin and the existing `openCustomRenderTab` mechanism; no Rust changes are required.

---

## Functional Requirements

### Area 1 — File Browser Interaction (split click targets)

- **FR-01** — When a directory node in the file tree does NOT contain a `_folder.md` file, both the expand arrow (chevron) click and the folder name label click behave as they do today: they toggle directory expansion/collapse. This is the unchanged fallback path.

- **FR-02** — When a directory node contains a `_folder.md` file (detected per FR-10), the two click targets diverge:
  - Clicking the **expand arrow (chevron span, `.tree-node-chevron`)** → toggles directory expansion/collapse (existing behavior, unchanged).
  - Clicking the **folder name label (`.tree-node-label`)** → opens the Folder View tab for that directory (new behavior).

- **FR-03** — The chevron and label must be independently hittable. The current `<li>`-level click listener on `buildActivateHandler` must be refactored so that clicks on `.tree-node-chevron` are intercepted and routed to the expand/collapse path, while clicks on `.tree-node-label` (or the icon) are routed to the Folder View path — when `_folder.md` is present.

- **FR-04** — Keyboard behavior for a `_folder.md`-enhanced folder:
  - `Enter` (with the `<li>` focused) → opens the Folder View tab (mirrors label click).
  - `ArrowRight` / `ArrowLeft` → expand/collapse as today (existing keyboard handler unchanged).

- **FR-05** — The file browser must determine at render time whether each directory contains `_folder.md`. Detection must use the existing `VaultIndex.entries` array (scan entries whose `path` begins with `<dirPath>/` and whose `name` equals `_folder`). No new Tauri commands are issued.

- **FR-06** — Detection result (has `_folder.md` or not) must be computed once per `renderPanel` call and stored so that `buildActivateHandler`, `appendIconAndLabel`, and the context menu handler can all read from it without redundant scanning.

- **FR-07** — A directory detected as having `_folder.md` receives an additional CSS class `tree-node-has-folder-view` on its `<li>`. This class is used for styling (optional visual affordance, e.g. a subtle indicator icon or underline on the label) and for reliable querySelectorAll lookups in tests.

### Area 2 — `_folder.md` Visibility and Editability

- **FR-08** — `_folder.md` appears as a normal `.md` file in the file browser tree within its parent directory. It is not hidden, grayed out, or otherwise filtered. The user can click it to open it in the editor and edit the YAML front-matter and markdown body directly.

- **FR-09** — `_folder.md` is subject to all standard file operations available to any `.md` file (rename, delete, move). Renaming or deleting it removes the Folder View behavior from that directory immediately upon the next vault index update.

### Area 3 — `_folder.md` YAML Schema

- **FR-10** — A `_folder.md` file is the trigger for Folder View behavior. The file MUST contain YAML front-matter. The front-matter fields are:

  | Field | Required | Type | Description |
  |---|---|---|---|
  | `layout` | Yes | string | Identifies the folder layout renderer. `folder-cards` is the v1 starter value. |
  | `title` | No | string | Custom tab title. Defaults to the folder's directory name (last path segment). |
  | `sort` | No | string | Sort order for cards. Allowed values: `name-asc` (default), `name-desc`, `modified-asc`, `modified-desc`. |
  | `columns` | No | integer | Number of card columns. Range: 2–6. Default: 3. Values outside range are clamped to [2, 6]. |
  | `show-modified` | No | boolean | Whether to show the modified date on file cards. Default: `true`. |

- **FR-11** — The markdown body of `_folder.md` (the content below the closing `---` of the YAML block) MAY be present. When present, it is rendered as a styled header block above the card grid in the Folder View tab. When absent or empty, no header block is rendered.

- **FR-12** — The `layout:` field is mandatory. If it is absent or empty, the Folder View tab opens with a graceful fallback: renders the `_folder.md` body as plain markdown inside a minimal container, with a faint notice "No layout specified — showing raw content." This fallback does not crash and does not prevent the file from being edited.

- **FR-13** — If `layout:` contains a value that does not match any registered folder layout renderer (e.g., `layout: unknown-thing`), the same graceful fallback as FR-12 applies, with the notice reading "Unknown layout 'unknown-thing' — showing raw content."

- **FR-14** — YAML parsing for `_folder.md` reuses the existing `parseFileYaml` pattern already present in `layout-manager.ts`. No new YAML parser is introduced. Unknown YAML fields are silently ignored.

### Area 4 — Folder Layout Rendering (card-grid starter)

- **FR-15** — Opening a Folder View calls a folder-view-specific tab opener that passes the full folder path as the deduplication key and the display title separately. The tab mechanism is `window.__MARKABLE_OPEN_CUSTOM_TAB__` extended with an optional `key` parameter (the full absolute folder path). The display title is determined by FR-16; the dedup key is always the full path regardless of display title.

- **FR-16** — The tab title for a Folder View tab is:
  1. The value of the `title:` YAML field, if present and non-empty.
  2. Otherwise, the directory's last path segment (folder name).
  Example: `/vault/Projects/2026` → tab title `2026`.

- **FR-17** — Folder View tabs deduplicate by **full folder path**, not by display title. Two folders with the same name in different parent directories (e.g. `/Work/Reports/` and `/Personal/Reports/`) each produce their own independent tab. Re-opening a Folder View for a path that already has a tab activates and re-renders that existing tab. No duplicate tabs accumulate for the same path.

- **FR-18** — The `folder-cards` layout renders a two-section card grid:
  1. **Subfolder section** (if any immediate subdirectories exist): a grid of folder cards. Each card shows: folder icon, folder name.
  2. **File section** (if any immediate `.md` files other than `_folder.md` exist, plus any non-MD files): a grid of file cards. Each card shows: file-type badge (e.g. `.md`, `.pdf`, `.png`), file name (no extension for `.md`), modified date (if `show-modified: true`).

- **FR-19** — "Immediate" means direct children of the folder only. Files and directories in nested subdirectories are NOT included in the card grid for this folder's view.

- **FR-20** — The card grid is sorted according to the `sort` YAML field (FR-10). Within each section (subfolders then files), the sort applies independently. Subfolders always render before files regardless of sort order.

- **FR-21** — Each subfolder card is clickable. Clicking a subfolder card:
  1. Expands the file tree to that subfolder (calls the existing tree expansion API).
  2. If that subfolder has its own `_folder.md`, opens the Folder View tab for it.
  3. If that subfolder does not have `_folder.md`, only the tree expansion occurs.

- **FR-22** — Each file card is clickable. Clicking a file card opens that file using the standard tab-open path (`window.__MARKABLE_TAB_MANAGER__.openFileInTab` for `.md`/`.txt`, `openMediaInTab` for all other types).

- **FR-23** — The `_folder.md` file itself is excluded from the file section of the card grid. It is not shown as a card.

- **FR-24** — If the description body (FR-11) is non-empty, it is rendered as HTML (via `window.__MARKABLE_RENDER_MD__`) above the card grid, inside a `<div class="folder-view-description">`. This div renders the full markdown body of `_folder.md`.

- **FR-25** — The card grid container uses CSS custom properties for theming, consistent with the existing layout CSS conventions (`var(--bg-secondary)`, `var(--border-color)`, `var(--text-primary)`, `var(--text-secondary)`). Hard-coded colors are not used.

- **FR-26** — If a folder is completely empty (no subfolders, no files other than `_folder.md`), the Folder View tab renders with only the description block (if any) and an empty-state message: "This folder is empty."

### Area 5 — Layout Dispatch

- **FR-27** — Layout dispatch in the folder view context is a simple string comparison: the `layout:` field value is compared case-insensitively against registered folder layout names. v1 registers exactly one: `folder-cards`.

- **FR-28** — The dispatch map is defined as a plain module-level `Record<string, FolderLayoutRenderer>` inside the folder-view renderer module. Adding a new layout style in a future task requires only adding one entry to this map.

- **FR-29** — Folder layout renderers are distinct from document layout renderers. The document layout system (`layout-manager.ts`, `.layout.md` files, `discoverLayouts()`) is NOT involved in folder view rendering. Folder layouts are registered directly in the file-browser plugin.

- **FR-30** — If `layout:` is missing, empty, or unrecognized, the fallback renderer is invoked (per FR-12/FR-13). The fallback renderer is always available and cannot itself fail.

### Area 6 — Live Update on Save

- **FR-31** — When the user edits and saves `_folder.md`, the vault file-watcher fires an index update. The folder view tab for the containing folder must re-render automatically if the tab is currently the active (visible) tab. The re-render reads the updated `_folder.md` content from disk.

- **FR-32** — If the Folder View tab is not the currently active tab at the time `_folder.md` is saved, the tab is marked stale. The next time the user activates that tab, the re-render fires. "Stale" state is a boolean flag stored in the tab's renderFn closure or alongside it.

- **FR-33** — The stale-flag mechanism must not interfere with document layout tabs (which use `enterLayoutView`, a separate path). Only `openCustomRenderTab` tabs created by the folder view are subject to FR-31/FR-32.

### Area 7 — Context Menu Integration

- **FR-34** — Right-clicking a directory that has `_folder.md` adds "Open Folder View" as the first item in its context menu, above all other items. Selecting it opens the Folder View tab (same as label click).

- **FR-35** — Right-clicking a directory that does NOT have `_folder.md` shows a new item "Create Folder View..." in the context menu. Its position in the menu is between "New Note" and "New Folder" (i.e., near the top of creation actions). Selecting it:
  1. Creates `_folder.md` in that directory with a starter template (see FR-36).
  2. Opens `_folder.md` in the editor tab so the user can customize immediately.
  3. The vault index update then detects `_folder.md` and enables folder view behavior for that directory.

- **FR-36** — The starter template written by "Create Folder View..." is:
  ```
  ---
  layout: folder-cards
  ---
  ```
  This is the minimum valid `_folder.md`. No extra YAML fields or body text are added to the starter; the user fills them in.

- **FR-37** — After "Create Folder View..." creates `_folder.md` and opens it in the editor, the file browser tree updates on the next vault index refresh to reflect the new `_folder.md` presence (split-click behavior activates).

---

## Non-Functional Requirements

- **NFR-01** — The `_folder.md` detection scan at render time must not add measurable latency to normal tree renders. A vault with 5,000 files must still render the file tree in under 50 ms. Detection must be O(N) over `VaultIndex.entries` once per render, with result cached for the render pass.

- **NFR-02** — Folder view rendering (the card grid) must complete in under 100 ms for a folder with up to 500 direct children.

- **NFR-03** — All folder-view code must live inside `src/plugins/file-browser/`. No new plugin, no change to `src/lib/layout-manager.ts`, no Rust changes.

- **NFR-04** — The plugin must remain a single IIFE built by `npm run build:plugins`. No new bundle target, no new npm dependencies.

- **NFR-05** — The split-click behavior must not regress keyboard navigation. `ArrowRight`/`ArrowLeft` must still expand/collapse. Focus management must remain correct after a Folder View tab is opened.

- **NFR-06** — A malformed, unreadable, or YAML-less `_folder.md` must not crash the plugin or prevent the folder from being opened in the tree. The fallback from FR-12 always applies.

- **NFR-07** — The Folder View tab must be accessible: card elements must have `role="button"` (or be `<button>` elements) with descriptive `aria-label` attributes. The card grid must be keyboard-navigable (Tab to reach cards, Enter to activate).

---

## Edge Case Inventory

This list is the Reviewer's mandatory test checklist. Every EC must have a corresponding test or be explicitly justified as untestable.

- **EC-01** — Directory has `_folder.md` but the vault index has not yet finished building (loading state). Detection returns false (no `_folder.md` detected), so the folder behaves normally until the index is ready. No crash, no split-click activation before detection is possible.

- **EC-02** — `_folder.md` is deleted externally while a Folder View tab for that directory is open. On the next vault index update, the file entry is gone. The existing open tab is NOT forcibly closed (it stays open showing stale data), but re-opening the folder view is no longer possible from the tree. The `<li>` reverts to normal single-click behavior on next render.

- **EC-03** — `_folder.md` is renamed to something other than `_folder.md` (e.g., `_folder-backup.md`). Same behavior as EC-02: detection fails on next index update, folder view disabled.

- **EC-04** — `_folder.md` contains no front-matter at all (empty file or body-only). Falls through to the FR-12 graceful fallback (no layout specified notice). No crash.

- **EC-05** — `_folder.md` has valid front-matter but the YAML is malformed (e.g., unclosed quotes, duplicate keys). The simple line-by-line YAML parser (reused from `layout-manager.ts`) returns a partial or empty record. Result: `layout:` is treated as absent, fallback from FR-12 applies. No crash.

- **EC-06** — `layout: folder-cards` is specified but the folder has zero immediate children (no subfolders, no files other than `_folder.md`). The Folder View tab renders with the description block (if any) and the empty-state message per FR-26.

- **EC-07** — Folder contains only non-MD files (e.g., images), no `.md` files other than `_folder.md`. The subfolder section is empty; the file section shows the non-MD files. The card grid renders correctly.

- **EC-08** — Folder contains only subdirectories, no files other than `_folder.md`. The subfolder section renders; the file section is omitted (or shows an empty state). No crash.

- **EC-09** — A subfolder card is clicked for a subfolder that itself has `_folder.md`. The file tree expands to it AND its Folder View tab opens. The parent Folder View tab is replaced in the tab strip (same title) if the subfolder has the same name as a previously opened folder view.

- **EC-10** — A subfolder card is clicked for a subfolder that does NOT have `_folder.md`. Only tree expansion occurs. No Folder View tab is opened for it.

- **EC-11** — `_folder.md` uses `layout: folder-cards` and sets `columns: 0` (below minimum) or `columns: 100` (above maximum). Both values are clamped to [2, 6] per FR-10. The card grid renders with a valid column count.

- **EC-12** — `_folder.md` sets `sort: invalid-value`. The value is unrecognized; the default sort (`name-asc`) is applied silently. No crash, no error displayed to the user.

- **EC-13** — The folder name contains characters that would be invalid in a tab title (e.g., `<script>` injection attempt). Tab title must be HTML-escaped before insertion into the DOM. No XSS.

- **EC-14** — The `_folder.md` body contains markdown with embedded HTML (e.g., `<script>` tags). The rendered description block must pass through the same `stripScripts` sanitization used by document layouts. No XSS.

- **EC-15** — Two different directories have the same last path segment name (e.g., `/vault/Work/Reports/` and `/vault/Personal/Reports/`). Each has its own `_folder.md`. Opening both folder views must produce two separate tabs (per FR-17, dedup key is the full path). Both tabs may display `Reports` as their title but they are independent and do not interfere with each other.

- **EC-16** — User clicks "Create Folder View..." on a directory that already contains `_folder.md` (race condition: the index update from an external creation has not yet propagated, so the context menu item was shown). The operation should be a no-op: detect `_folder.md` already exists before creating, open the existing file in the editor instead.

- **EC-17** — `_folder.md` is saved (edited) while the Folder View tab is active. The vault index updates, triggering FR-31. The re-render reads the updated file content and redraws the card grid. No flicker beyond what a full re-render normally produces.

- **EC-18** — `_folder.md` is saved while the Folder View tab is inactive (another tab is active). The tab is marked stale (FR-32). When the user later activates the Folder View tab, it re-renders with the updated content.

- **EC-19** — Vault is switched while a Folder View tab is open. The custom tab created via `openCustomRenderTab` persists in the tab strip (this is existing behavior for custom tabs). The tab content is stale relative to the new vault. This is acceptable v1 behavior; no special handling required. Document it as a known limitation.

- **EC-20** — The `_folder.md` file itself is clicked in the file tree (FR-08). It must open in the editor (normal file-open path), not trigger a Folder View. The file-open path is reached via the `type === "file"` branch of `buildActivateHandler`, which is not affected by the split-click change.

- **EC-21** — A folder named `_folder.md` exists (a directory, not a file). Detection logic must check that the found entry is of type `file` (has a `.md` extension and is a `VaultIndexEntry`), not a directory. No incorrect detection.

- **EC-22** — Large folder with 500 immediate children (subfolders + files). Card grid render must meet NFR-02 (under 100 ms). DOM nodes must be built efficiently; no O(N²) operations.

- **EC-23** — Vault has no directories at all (flat vault, all `.md` files at root). Detection scan finds no directory entries; no folder view triggers. Tree renders normally.

- **EC-24** — User right-clicks a Smart Folder (virtual node from the Smart Folders feature). Smart Folder nodes must not show "Create Folder View..." or "Open Folder View" because they are not real filesystem directories and cannot contain `_folder.md`. The context menu discriminator for smart folders (`isSmartFolderPath`) must be checked before injecting folder-view menu items.

---

## Resolved Ambiguities

All six open questions from the brief have been resolved. They are recorded here for traceability.

- **A (YAML schema)** — Minimum required field is `layout: folder-cards`. Optional fields: `title`, `sort` (name-asc default), `columns` (3 default, clamped to [2,6]), `show-modified` (true default). Absent/unrecognized `layout:` value triggers the graceful fallback (FR-12/FR-13), not an error.

- **B (Live update)** — Re-render fires automatically when the active tab is the Folder View tab for the saved file. When the tab is inactive, a stale flag is set; re-render fires on next tab activation. Mirrors the precedent of `refreshLayoutView` in the existing layouts system (FR-31/FR-32).

- **C (Nested folder views)** — Clicking a subfolder card expands the file tree to that subfolder. If the subfolder has `_folder.md`, its Folder View tab also opens. This delegates navigation authority to the file tree and avoids deep tab nesting (FR-21).

- **D (Context menu)** — Right-clicking a `_folder.md`-enabled folder adds "Open Folder View" as the first context menu item. Right-clicking any folder without `_folder.md` adds "Create Folder View..." near the top of the creation actions (FR-34/FR-35).

- **E (Creating `_folder.md`)** — "Create Folder View..." right-click option creates `_folder.md` with a minimal two-line starter template and opens it in the editor. No wizard or multi-step UI (FR-35/FR-36).

- **F (Tab title)** — The folder's last path segment is the default. If YAML contains `title:`, that value is used instead. Tab title is HTML-escaped (EC-13). Deduplication is by full folder path (not display title), so same-name folders in different parent directories are always independent tabs (FR-16/FR-17/EC-15).

---

## Decisions Locked (do NOT re-question)

These decisions are fixed and travel through Architecture, Implementation, and Review without change.

1. **`_folder.md` is the trigger.** Presence of a file named `_folder.md` in a directory enables Folder View for that directory. Absence means no change to existing behavior.
2. **Split click targets.** Chevron click → expand/collapse always. Name-label click → Folder View tab if `_folder.md` exists, otherwise expand/collapse.
3. **`_folder.md` is fully visible in the tree.** No hiding, no special styling beyond the parent folder gaining `tree-node-has-folder-view`.
4. **YAML front-matter controls layout.** The `layout:` field dispatches to a renderer. The markdown body is optional description content.
5. **Folder layouts are separate from document layouts.** `layout-manager.ts` is not involved. Folder layout renderers live in the file-browser plugin.
6. **v1 delivers one layout style: `folder-cards`.** Multiple styles are a follow-on task.
7. **Tab mechanism: `window.__MARKABLE_OPEN_CUSTOM_TAB__`.** Same as document layouts. Same deduplication-by-title behavior applies.
8. **No Rust changes.** Detection uses `VaultIndex.entries`; creation uses the existing file-write bridge calls already available to the file-browser plugin.
9. **All folder-view code lives in `src/plugins/file-browser/`.** Single IIFE, no new bundle target, no new npm dependencies.
10. **Graceful fallback for absent/unrecognized `layout:`.** Renders the body as plain markdown with a notice. Never crashes.
11. **Live update: auto-re-render when tab is active; stale-flag when inactive.**
12. **Subfolder card click: expand tree + open that folder's view if it has `_folder.md`.**
13. **"Create Folder View..." context menu item creates `_folder.md` with a minimal starter and opens it in the editor.**
14. **Tab title: YAML `title:` field if present, otherwise folder's last path segment. HTML-escaped.**
15. **Tab deduplication is by full folder path.** Two folders with the same name in different parent directories produce independent tabs. The display title and the dedup key are separate values.

---

## Handoff Summary

- Artifact: `docs/requirements/active_task.md`
- Status: Requirements Validated
- Edge cases to verify in tests: 24 items in Edge Case Inventory (EC-01 through EC-24)

Next step: Activate @software-architect and provide `docs/requirements/active_task.md` as context.

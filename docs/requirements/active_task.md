---
title: "Smart Folders (File Browser plugin)"
last-updated: "2026-05-08"
review-cadence-days: 14
status: active
---

# Active Task — Smart Folders (FC3 #1)

## Summary

As a vault user, I want to define saved queries that appear in the file browser tree as virtual "Smart Folders," so that I can browse files matching dynamic criteria (tags, YAML field:value pairs, path, file type, modified date, link counts, filename text) without moving or duplicating any files. Smart Folders are pure views — expanding one shows a flat list of matching files, and clicking a file opens it in a tab the normal way.

## Functional Requirements

### Definition & data model

- **FR-01** — A Smart Folder is a saved query. The persisted shape (`SmartFolderDef`) must contain at minimum: a stable id, a user-supplied name, an ordered list of rules, and the AND combinator (implicit in v1).
- **FR-02** — Each rule has a `type` discriminator covering the six v1 filter types (see FR-03 through FR-08), an `operator` field whose allowed values depend on the rule type (FR-09), and a type-specific value payload.
- **FR-03** — Rule type "tag" matches files whose tag set (sourced from `scan_vault_tags()`) contains the selected tag. The picker presents the list returned by `scan_vault_tags()`, including both plain tag values and `field:value` strings (e.g. `status:draft`). No free-form input — user must pick from the discovered list.
- **FR-04** — Rule type "path" matches files whose vault-relative path either contains the entered substring or begins with the entered prefix. The rule must record which mode (substring vs prefix) was chosen.
- **FR-05** — Rule type "extension" matches by file extension (e.g. `.md`, `.pdf`, `.png`). Evaluation uses `VaultIndex.entries` for `.md` files and the `nonMdFiles` collection for everything else.
- **FR-06** — Rule type "modified" supports two presets: "in last N days" (N is a positive integer) and "before/after a specific date" (a calendar date and a direction). Both compare against `VaultIndexEntry.modified` (epoch ms).
- **FR-07** — Rule type "links" supports two sub-rules: "outbound link count" and "inbound link count" (i.e. backlinks), each with a numeric comparator (`= 0`, `≥ 1`, `≥ N`). Inbound counts are computed by inverting `outboundLinks` across all entries — same approach the backlinks plugin uses.
- **FR-08** — Rule type "title" matches when `VaultIndexEntry.title` OR `VaultIndexEntry.name` contains the entered substring (case-insensitive). It must check both because the title may be the H1 while the name is the filename stem.
- **FR-09** — Negation is encoded in each rule's `operator` field, NOT as a separate boolean. Allowed operators per type:
  - **tag**: `is` | `is not`
  - **path**: `contains` | `does not contain` | `starts with` | `does not start with`
  - **extension**: `is` | `is not`
  - **modified**: `in last N days` | `not in last N days` | `before` | `after` (no negation needed for `before`/`after` — pick the opposite direction)
  - **links**: `outbound = 0` | `outbound ≥ 1` | `outbound ≥ N` | `inbound = 0` | `inbound ≥ 1` | `inbound ≥ N`
  - **title**: `contains` | `does not contain`
- **FR-10** — All rules in a Smart Folder are combined with logical AND. v1 must NOT support OR or nested groups.

### Persistence & scope

- **FR-11** — Smart Folders are persisted in `FileBrowserSettings.smartFolders?: Record<vaultId, SmartFolderDef[]>`, mirroring the per-vault `pinnedPaths` pattern. Persistence flows through the existing settings save path; no new Tauri commands are introduced.
- **FR-12** — Smart Folders are scoped per-vault. Switching vaults must show only that vault's Smart Folders. Deleting a vault must orphan (but not necessarily purge) its key in `smartFolders` — purging is a follow-up concern.
- **FR-13** — Rust side gets NO schema changes for v1. Filter evaluation runs entirely in the frontend over the existing `VaultIndex.entries`, `nonMdFiles`, and `scan_vault_tags()` results.

### Tree placement & rendering

- **FR-14** — Smart Folders render as virtual child nodes injected at the TOP of each vault root's `children` array, ABOVE real subdirectories. Implementation lives in `buildTreeFromIndex()` / `buildSubtree()` (`src/plugins/file-browser/file-tree.ts`).
- **FR-15** — Each Smart Folder is rendered as `TreeNode { type: "directory", iconClass: "folder-smart", ... }`. Reusing the directory node type avoids touching `<li>` rendering — Smart Folders inherit standard expand/collapse, hover, and keyboard behavior automatically.
- **FR-16** — Smart Folders MUST NOT use the pinned section's separate `<div>` pattern (`buildPinnedSection` at `file-browser.plugin.ts:826`). They are inline tree nodes.
- **FR-17** — The Smart Folder icon is the Material Symbols `folder_managed` glyph. `scripts/fetch-material-icons.mjs` must be updated to fetch this icon, the script re-run, and the resulting SVG committed under `src/plugins/file-browser/icons/material/`.
- **FR-18** — Expanding a Smart Folder reveals a flat list of matching files. The original directory hierarchy is NOT preserved inside the expanded view. Files render as standard file tree leaves (same icon/click/keyboard contract).
- **FR-19** — Clicking a file inside a Smart Folder opens it in a tab using the normal file-open path. No drag-to-move, copy-to, or folder-relocation interactions involve Smart Folders as a destination.
- **FR-20** — Clicking a Smart Folder's name expands or collapses it. There is no other primary-click action on the Smart Folder header.

### Filter editor & lifecycle

- **FR-21** — Right-clicking a Smart Folder in the tree exposes at minimum: "Edit Filters," "Rename," and "Delete."
- **FR-22** — A "+ New Smart Folder" entry point appears in **two** places: (i) a context-menu item "New Smart Folder" on right-click of the vault root in the tree, and (ii) a small button at the top of the file browser panel. Both open the same filter editor in empty state with the name field focused.
- **FR-23 (Filter Editor — Mac Finder pattern)** — The filter editor opens **inline as an expandable form** anchored to the Smart Folder's row in the tree (or to the vault root when creating new). It must contain:
  - A name input at the top (focused on open).
  - A vertical stack of **rule rows**, each row laid out as: `[Type ▾] [Operator ▾] [Value control] [-] [+]` where:
    - **Type** dropdown selects one of the six rule types (FR-03–FR-08).
    - **Operator** dropdown shows only the operators valid for the chosen Type (FR-09). Switching Type resets Operator to that type's first valid value.
    - **Value control** is type-specific:
      - **tag** → searchable picker populated from `scan_vault_tags()` results (plain tags + `field:value` pairs).
      - **path** / **title** → text input.
      - **extension** → dropdown of distinct extensions present in the current vault index.
      - **modified** → for "in last N days" / "not in last N days": numeric input + fixed "days" label; for "before" / "after": date picker.
      - **links** → comparator+number is encoded in the operator itself; no separate value control needed.
    - `[-]` removes that row. Hidden when there is exactly one row (cannot remove the last rule, since FR-26 requires at least one).
    - `[+]` adds a new empty row directly below.
  - Bottom-right action bar with **`Save`** and **`Cancel`** buttons. Save validates (FR-26) and commits; Cancel discards all unsaved changes and closes the editor.
  - Clicking outside the editor without using Save or Cancel is treated as Cancel.
- **FR-24** — Renaming a Smart Folder updates its `name` in place and preserves all rules and the synthesized id.
- **FR-25** — Deleting a Smart Folder removes its entry from `smartFolders[vaultId]`. If the deleted folder was expanded, its expansion state must also be cleaned up.
- **FR-26** — Save is disabled (or rejected with a visible message) when the Smart Folder has an empty name OR zero rules.

### Evaluation behavior

- **FR-27** — Filter evaluation produces, for each Smart Folder, the list of matching `VaultIndexEntry` (and non-MD file paths if the rules permit). The list is then sorted (sort key per Open Ambiguity A-1) and rendered as the Smart Folder's children.
- **FR-28** — Inverse maps used during evaluation (filePath → tag-and-field-value set; targetPath → inboundLinks count) must be built once per evaluation pass, not per-rule and not per-file.
- **FR-29** — Evaluation cadence is governed by Open Ambiguity A-4 but at minimum must re-run when: (a) the vault index finishes (re)building, (b) the user saves an edited Smart Folder, (c) the user creates or deletes a Smart Folder, and (d) the active vault changes.

## Non-Functional Requirements

- **NFR-01** — Filter evaluation across a 1,000-file vault with all six rule types active across 10 Smart Folders must complete in under 100 ms on the developer reference machine. Build inverse maps once per pass (FR-28). If this budget cannot be met without caching, choose lazy-on-expand evaluation (Open Ambiguity A-4) and document the tradeoff.
- **NFR-02** — Persisted `FileBrowserSettings.smartFolders` size must not balloon the settings JSON beyond what the existing settings save path comfortably handles. A soft limit of "tens of Smart Folders per vault, each with up to ~20 rules" is the v1 design target. No hard cap is enforced in v1, but the architect should call out if a cap is warranted.
- **NFR-03** — All Smart Folder code must live inside `src/plugins/file-browser/` and ship as part of the file-browser plugin. No separate plugin, no `dependsOn` mechanism.
- **NFR-04** — The plugin remains a single IIFE built by `npm run build:plugins`; Smart Folders must not require a new build target or external bundle.
- **NFR-05** — Smart Folder UI must respect the existing file browser's keyboard navigation (arrow keys, expand/collapse) without regressing real-folder behavior.
- **NFR-06** — Malformed `smartFolders` payloads in settings (wrong shape, unknown rule types, missing fields) MUST NOT crash the plugin. Recovery is "drop the malformed entry, log a warning, continue."

## Edge Case Inventory

This list is the Reviewer's mandatory test checklist. Every EC must have a corresponding test or be explicitly justified as untestable.

- **EC-01** — Empty vault: vault index has zero entries. Smart Folders must render as empty (no children) without errors and the tree must still build.
- **EC-02** — No Smart Folders defined yet for the active vault (`smartFolders[vaultId]` is undefined or `[]`). Tree must render exactly as it does today, with no virtual section, no header, no empty placeholder.
- **EC-03** — A Smart Folder whose rules match zero files. Expanding it must show an empty body (or a subtle "No matches" hint — architect decides) and must not error.
- **EC-04** — A tag or `field:value` referenced by a rule has been removed from every file in the vault. The rule remains defined but the Smart Folder simply matches nothing. No crash, no orphan-cleanup prompt in v1.
- **EC-05** — Renaming a Smart Folder while it is expanded. Expansion state must survive the rename (since the synthesized id is stable, not the name).
- **EC-06** — Deleting a Smart Folder while it is expanded. Children must collapse, expansion state must be purged for that id, and the tree must re-render without flicker or stale DOM.
- **EC-07** — Vault switch while a Smart Folder is expanded. Expansion state belongs to the previous vault and must not bleed into the new vault's tree.
- **EC-08** — Persistence corruption: `smartFolders` in settings is malformed (e.g. an object where an array is expected, an unknown `rule.type`, a missing `name`). The plugin must recover per NFR-06.
- **EC-09** — Conflicting filter rules (e.g. `tag:research AND NOT tag:research`). Result is an empty match set — this is allowed and surfaces as EC-03 behavior. No special-case handling.
- **EC-10** — Very large vault (1,000+ files) with many Smart Folders. Must meet NFR-01. If it doesn't, fall back to lazy-on-expand evaluation per A-4.
- **EC-11** — User creates many Smart Folders (e.g. 50+). Settings size must remain serializable per NFR-02.
- **EC-12** — Initial vault index is still building when the plugin first renders. Smart Folders should render as empty (zero children) until the index is ready, then re-evaluate per FR-29(a). No errors, no stuck spinners.
- **EC-13** — A rule references a YAML field that no longer exists in any file (e.g. `status:draft` when nothing in the vault has `status` at all). Same as EC-04 — empty match, no error.
- **EC-14** — A Smart Folder whose name collides with a real subdirectory at the vault root (e.g. user names it "research" and the vault has a `research/` folder). Both must coexist; the tree shows the Smart Folder above the real directory because Smart Folders sort first per FR-14.
- **EC-15** — Rapid edits: user saves the filter editor, then immediately edits again. Re-evaluation must not race; the latest saved definition is the one rendered.
- **EC-16** — Validation: user tries to save a Smart Folder with empty name or zero rules — save is blocked per FR-26 with a visible message.
- **EC-17** — File system change while a Smart Folder is expanded (file added, deleted, or renamed externally). Vault index update triggers FR-29(a); the expanded list refreshes.
- **EC-18** — Non-MD file rules: a rule with `extension = .pdf` must include `.pdf` files from `nonMdFiles` and exclude `.md` entries. `outboundLinks` rules cannot match non-MD files (they have none) — confirm this is the documented behavior, not a bug.

## Resolved Ambiguities

All five A-N items have been resolved by the user; they are now locked alongside the eleven items below.

- **A-1 (resolved) — Default sort: modified descending.** Files inside an expanded Smart Folder are sorted by `VaultIndexEntry.modified` descending (most recent first). Per-folder sort overrides are out of scope for v1.
- **A-2 (resolved) — "+ New Smart Folder" placement: BOTH.** Right-click vault root menu item AND a small button at the top of the file browser panel. See FR-22.
- **A-3 (resolved) — Expansion state key: `__smart__/<smartFolderId>`.** Stored in the existing `expandedPaths` Record using this synthetic key. The `__smart__/` prefix is reserved and cannot collide with real vault paths (real paths begin with a vault root absolute path).
- **A-4 (resolved) — Eager evaluation.** Re-evaluate every Smart Folder when (a) the vault index finishes (re)building, (b) a Smart Folder is created/edited/deleted, (c) the active vault changes. The `scan_vault_tags()` result is cached for ~5 seconds within an evaluation pass to avoid redundant scans.
- **A-5 (resolved) — Match count badge: YES.** Render the match count next to the Smart Folder name as a faint suffix (e.g. `Drafts (12)`). Compatible with eager evaluation (A-4).

## Decisions Locked (do NOT re-question)

These decisions are fixed and travel with the feature through Architecture, Implementation, and Review.

1. **Filter types (v1)**: tags + YAML `field:value` pairs (combined, sourced from `scan_vault_tags`); file path (substring or prefix); file type (extension via `VaultIndex.entries` for `.md` and `nonMdFiles` for everything else); modified date ("last N days" / "before|after date" against `VaultIndexEntry.modified`); has-links / has-backlinks (inverse map of `outboundLinks`); title/filename text contains.
2. **Negation encoded in operators** (NOT a separate boolean). Per-type operator lists in FR-09. Mac Finder pattern.
3. **Combinator**: AND across all rules. No OR, no nested groups in v1.
4. **Plugin home**: lives inside the existing file-browser plugin (`src/plugins/file-browser/`). Not a separate plugin. No `dependsOn` system.
5. **Persistence**: `FileBrowserSettings.smartFolders?: Record<vaultId, SmartFolderDef[]>`, same per-vault Record pattern as `pinnedPaths`.
6. **Tree placement**: synthesized as virtual child nodes at the TOP of each vault root's children, above real subdirectories. Each Smart Folder is a regular `TreeNode` with `type: "directory"`.
7. **Icon**: Material Symbols `folder_managed`. Add to `scripts/fetch-material-icons.mjs` and re-run.
8. **Click behavior**: name click expands/collapses; file-inside click opens in a tab. No move/copy interactions involve Smart Folders.
9. **Subfolder structure**: NONE. Smart Folder contents are a flat list. Original directory structure is not preserved.
10. **Filter editor: inline expandable form, Mac Finder row pattern, explicit Save/Cancel.** See FR-23 for full row anatomy. Click-outside = Cancel.
11. **No Rust schema changes for v1**: evaluation uses existing data — `VaultIndex.entries`, `nonMdFiles`, and `scan_vault_tags()`. Build inverse maps in the frontend.
12. **Sort inside expanded Smart Folder**: modified descending (A-1).
13. **"+ New Smart Folder" entry points**: right-click vault root menu item AND top-of-panel button (A-2).
14. **Expansion state key**: `__smart__/<smartFolderId>` in `expandedPaths` (A-3).
15. **Evaluation cadence**: eager, with ~5s `scan_vault_tags()` cache (A-4).
16. **Match count badge**: render next to name, e.g. `Drafts (12)` (A-5).

## Handoff Summary

- Artifact: docs/requirements/active_task.md
- Status: **Validated** — all open ambiguities resolved.
- Edge cases to verify in tests: 18 items in Edge Case Inventory (EC-01 through EC-18).
- Next step: software-architect produces `docs/specs/smart-folders/00_index.md` + step files.

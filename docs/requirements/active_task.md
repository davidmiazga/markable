---
title: "PKM System — Vaults, File Browser, and Knowledge Graph"
last-updated: "2026-04-24"
review-cadence-days: 7
status: active
---

# PKM System — Vaults, File Browser, and Knowledge Graph

## Validation Status

**VALIDATED — approved by user 2026-04-24.**

---

## Summary

As a user, I want a structured, performance-first personal knowledge management system that gives me a scoped view of my notes (Vaults), a native file tree to browse and manage them (File Browser), a future folder-based workflow model (IN / Working / OUT as auto-generated folder structures called "Workflows"), and a visual map of how notes connect (Knowledge Graph) — all without the startup slowness or monolithic-index problems that make Obsidian painful at scale.

---

## 1. Background and Motivation

### 1.1 The Problem with Monolithic Vaults (Obsidian Comparison)

Obsidian's defining architectural choice — one directory = one vault = one index — creates a compounding performance problem as the vault grows. Scanning tens of thousands of files on every startup, maintaining a full graph in memory, and re-indexing on every file change produces noticeable lag even on modern hardware. Users compensate with a patchwork of community plugins (Dataview, Quick Switcher++, Recent Files) that further inflate memory use.

Markable's approach inverts this: scope is the primary organizing primitive. A vault is a deliberately small, named collection. Indexing is bounded to the active vault. The graph only renders what is in scope. Users who want a "big vault" can have one, but the system does not reward that choice by degrading performance for everyone.

### 1.2 The IN / Working / OUT Workflow Model (Future Add-On)

The user's core organizing principle is a three-phase lifecycle for notes: IN (inbox/capture), Working (active development), and OUT (completed/archived). In Markable this model is implemented as a **Workflow** — an automatically generated folder structure, not a YAML front matter field.

When a user creates a Workflow, Markable auto-creates three folders at a user-specified location: `IN/`, `Working/`, and `OUT/`. A note's state is implied by which folder it lives in. There is no `state:` YAML field; folder location is the sole state indicator.

A vault can contain one or more Workflows, or none at all. Workflows are an add-on layer on top of the vault system. The detailed design of the Workflow feature (icons, creation UI, folder naming, migration UI) will be specced in a separate future document. **This spec does not attempt to design Workflows in detail.** It only notes that the vault system must leave a clean extension point for the Workflow layer to be added later.

The Workflow concept also has a forward-looking AI context dimension: when AI context features arrive, the active vault scope (and optionally a specific Workflow's `Working/` folder) will define the default AI context boundary. The vault scoping mechanism must be designed so a future AI context manager can efficiently query "give me all files in vault X" or "give me all files in the Working/ folder of Workflow Y."

### 1.3 Why These Three Features Are Tied Together

The three sub-features form a dependency chain:

1. **Vault System** defines what is in scope — which files are indexed and monitored.
2. **File Browser** consumes the vault scope to render a bounded file tree. Without a vault, the browser has no defined root or scope.
3. **Knowledge Graph** consumes the vault scope to render a meaningful, fast graph. Without the vault system, the graph has no principled boundary.

All three must be designed together even though they ship in separate phases.

---

## 2. The IN / Working / OUT Workflow Model

### 2.1 What a Workflow Is

A **Workflow** is an optional folder structure that a user can create within a vault to impose an IN / Working / OUT lifecycle on a set of notes. When a user creates a Workflow, Markable automatically creates three subdirectories at a user-chosen location:

```
<chosen location>/
  IN/
  Working/
  OUT/
```

A note's lifecycle state is determined entirely by which folder it lives in — **not** by any YAML front matter field. There is no `state:` front matter property in the Markable data model. The `state` field described in earlier drafts of this document has been removed.

### 2.2 Relationship to Vaults

Workflows are add-ons layered on top of the vault system:

- A vault can contain zero, one, or many Workflows.
- A Workflow must reside within at least one of the vault's root paths to be indexed.
- The vault system does not need to know about Workflows explicitly — Workflows are just folders from the vault's perspective.
- Future features (AI context budgeting, graph filtering by lifecycle state) will be able to target a specific Workflow's sub-folders using path-prefix queries against the vault index.

### 2.3 Scope of This Spec

The Workflow feature is **out of scope for the architecture phase that follows this document.** The detailed design — creation UI, icon taxonomy, migration assistant, Workflow-aware graph coloring — will be supplied by the user in a dedicated future spec session. The Software Architect should note the Workflow concept, leave the vault index path-query mechanism general enough to support folder-prefix filtering, and otherwise not design the Workflow system at this time.

---

## 3. Vault System

### 3.1 What a Vault Is

A vault is a named, user-defined collection of file system paths that Markable treats as a coherent, indexed scope. A vault is NOT:

- An auto-scan of a directory tree.
- A monolithic root directory.
- A sync unit or cloud backup target.

A vault IS:

- A named entry in Markable's settings with one or more root paths.
- The boundary for all indexing operations (backlinks, wiki-link autocomplete, file browser, graph).
- A unit of context (only the active vault is indexed at any given time).
- Small and focused by design — users are encouraged to have multiple focused vaults rather than one giant one.

### 3.2 Vault Data Model (Settings Schema)

Vaults are stored in the application settings file (`~/Library/Application Support/com.markable.app/settings.json`) under a top-level `vaults` key.

```json
{
  "vaults": [
    {
      "id": "uuid-v4-string",
      "name": "Personal Notes",
      "rootPaths": ["/Users/david/Notes/Personal"],
      "created": "2026-04-23T10:00:00Z",
      "lastOpened": "2026-04-23T14:30:00Z",
      "excludePatterns": ["node_modules", ".git", "*.log"],
      "maxIndexSize": 500
    }
  ],
  "activeVaultId": "uuid-v4-string"
}
```

Field definitions:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (UUID v4) | yes | Stable identifier; never changes even if name or paths change |
| `name` | string | yes | Human-readable label, shown in vault switcher UI |
| `rootPaths` | string[] | yes | One or more absolute paths; all are indexed together as one vault |
| `created` | ISO 8601 datetime | yes | Vault creation timestamp |
| `lastOpened` | ISO 8601 datetime | yes | Updated each time the vault is activated |
| `excludePatterns` | string[] | no | Glob patterns for files/directories to exclude from index |
| `maxIndexSize` | integer | no | Soft cap on indexed file count (default: 500; user-configurable above 500 with a performance warning) |

### 3.3 Vault Operations

**Create vault**: User provides a name and selects one or more root paths via native folder picker. A UUID is generated. The vault is added to settings and immediately activated.

**Switch vault**: User selects a different vault from the vault switcher (Command Bar or sidebar). The current vault's index is discarded from memory. The new vault is activated: its root paths are scanned (lazily, not recursively on the main thread) and a new index is built incrementally.

**Edit vault**: User can rename a vault or add/remove root paths. Any change triggers a full re-index of the modified vault (if it is the active vault).

**Delete vault**: User removes a vault. This deletes the vault entry from settings. No files on disk are modified.

**Vault switcher UI**: Vaults are shown directly inside the File Browser panel tree alongside folders, distinguished by a vault icon. Users switch between vaults by interacting with vault nodes in the file browser — there is no separate top-of-window switcher element. The vault switcher is also accessible via Command Bar command "Switch Vault." See Section 4 for the icon extension point.

### 3.4 Scoped Indexing

When a vault is activated, Markable builds an index of that vault's contents. The index is:

- **Lazy**: built incrementally as files are needed (e.g., when the file browser panel is opened, when backlink lookup is triggered, when the graph panel is opened).
- **Bounded**: capped at `maxIndexSize` files (default 500). This is a soft cap — users can raise it in vault settings, but doing so triggers a warning: "Vaults over 500 files may affect performance." If a vault root path contains more files than the configured cap, the index includes the most recently modified files up to the cap and the user is notified in the File Browser panel.
- **Incremental**: uses file-system change events (via Tauri's watch API or equivalent) to update the index when files are created, renamed, moved, or deleted within the vault roots — without a full re-scan.
- **Persistent between sessions**: the index is cached to disk (`~/Library/Application Support/com.markable.app/vault-index/{vaultId}.json`) and loaded on next activation. Staleness is detected by comparing file modification timestamps.

### 3.5 Index Contents

The vault index stores, per file:

| Field | Source | Description |
|---|---|---|
| `path` | file system | Absolute path |
| `name` | file system | Filename without extension |
| `modified` | file system | Last modification timestamp (for staleness detection) |
| `size` | file system | File size in bytes |
| `title` | front matter or H1 | First H1 heading or filename if absent |
| `tags` | front matter parse | `tags:` field, if present |
| `outboundLinks` | light parse | Wiki-links `[[...]]` found in the file (filenames only, not resolved) |

The index is built by reading file metadata (fast, no content read) plus a single-pass light parser for front matter and wiki-links. Full content is never loaded into the index.

---

## 4. File Browser

### 4.1 Overview

The File Browser is a sidebar panel (left slot by default) showing the active vault's file tree alongside vault entries. It replaces the need to use Finder or the system file chooser for routine note management tasks.

The browser is scoped strictly to the active vault's root paths. It does not show the full file system. It does not auto-expand on startup — it opens to the last-known expanded state, or to the vault root collapsed.

**Vault nodes in the tree**: Vaults appear in the File Browser tree alongside regular folders, distinguished by a dedicated vault icon (distinct from a plain folder icon). Clicking a vault node in the tree switches the active vault and re-renders the tree for that vault. This is the primary vault-switching mechanism.

**Icon extension point**: Different vault types (e.g., "Collections", "Smart Bins") will eventually have distinct icons. The icon assigned to each vault node must be configurable via the vault's metadata (a future `vaultType` or `iconId` field on the vault entry). The architect must design the vault tree node renderer to accept an icon identifier from the vault data model rather than hardcoding a single icon. The exact icon taxonomy is TBD and will be provided by the user in a separate session.

### 4.2 File Browser Panel Registration

The File Browser registers as a `SidebarPanelDescriptor` with `id: "file-browser"`, `side: "left"`. It is a core plugin, not a user plugin. It is enabled by default but can be disabled from the Plugins panel.

### 4.3 File Tree Rendering

- Shows all `.md` files and folders within the active vault's root paths.
- Non-`.md` files are hidden by default (configurable: "Show all files" toggle in the browser panel header).
- Folders are expandable/collapsible. Expanded state is persisted per-vault in the vault index cache.
- Each file node shows: filename (without `.md` extension) and modification date on hover.
- Files currently open in a tab are visually highlighted (accent underline or bold).
- The active file (current tab) is auto-scrolled into view when the panel is first opened or when the active tab changes.

### 4.4 File Operations

All file operations that modify the file system go through Tauri commands using the temp-file-swap pattern (creates and renames for writes; plain deletion for deletes with a Tauri confirm dialog).

| Operation | Trigger | Behavior |
|---|---|---|
| Create file | "New Note" button in panel header, or right-click folder | Prompts for filename inline (editable label). Creates `.md` file in the selected folder (or vault root if no folder selected). Opens in a new tab. |
| Create folder | Right-click in panel, "New Folder" | Prompts for folder name inline. Creates the directory. |
| Rename file/folder | Double-click label, or right-click → Rename | Inline rename input. Pressing Enter commits; Escape cancels. Updates all open tabs that reference the renamed file (tab titles). |
| Delete file | Right-click → Delete, or Delete key when file is focused | Shows a native Tauri confirmation dialog: "Delete [filename]? This cannot be undone." Removes the file from disk. Closes any open tab for that file. |
| Delete folder | Right-click → Delete | Confirmation dialog. Recursively deletes the folder and all contents. All affected tabs are closed. |
| Move file/folder | Drag-and-drop within the tree, or right-click → Move To | Moves the file/folder to the new location. Updates open tabs. Does NOT automatically update wiki-links that reference the old path — a post-move notification offers "Update links?" (see EC-18 and FR-02.11). |

### 4.5 Search Within Vault

A search input at the top of the File Browser panel filters the visible tree to files whose names match the query (fuzzy, case-insensitive). The query is applied to filenames only in this version (not full-text search — that is a separate feature). Results update as the user types (debounced 150ms). Clearing the input restores the full tree.

### 4.6 Vault Switching via File Browser Tree

Vault switching is performed by clicking a vault node in the File Browser tree (see Section 4.1 for vault node description). Clicking a vault node in the tree activates that vault and re-renders the tree to show that vault's contents. A "New Vault…" option is available via right-click on the vault list area or via a "+ New Vault" button at the top of the vault section in the tree. "Manage Vaults…" is accessible from the File Browser panel header menu (kebab or gear icon) and from the Command Bar.

---

## 5. Knowledge Graph

### 5.1 Overview

The Knowledge Graph is a sidebar panel (right slot by default, resizable) that renders a force-directed node-link diagram of the notes and connections in the active vault. Nodes represent notes; edges represent wiki-links (`[[filename]]`) and backlinks between notes.

The graph is scoped to the active vault. It does not render the full file system. All indexed notes in the active vault are shown by default. The graph always opens showing the full vault graph (all nodes visible). The user can filter and zoom into subgraphs interactively.

### 5.2 Graph Rendering Approach

**Library choice**: The graph must be rendered using a library that is bundleable with Rollup (same constraint as Mermaid.js), works headlessly in tests (or can be mocked cleanly), does not require canvas-only rendering (SVG preferred for accessibility), and performs acceptably on graphs of 50–500 nodes. Candidate: D3.js (`d3-force` + `d3-selection`, SVG output). Alternative: Cytoscape.js (Canvas + SVG hybrid, richer interaction model).

This is an open architectural decision (AD-05) that the Software Architect must resolve before implementation begins, including a web search for current best options given the Rollup + Vitest + Tauri constraints.

**Rendering model**: The graph is rendered inside a `<div>` in the sidebar panel. SVG (preferred) or Canvas element inside that div. The force simulation runs in the renderer process (not a Web Worker in Phase 1 — Web Worker is a Phase 2 optimization if needed). The simulation is paused when the panel is not visible.

**Performance budget**: Must render 500 nodes and 1000 edges and reach a stable layout within 3 seconds on a 2019 MacBook Pro. Must stay above 30 fps during interactive dragging.

### 5.3 Graph Nodes

- One node per indexed note in the active vault.
- Node size: proportional to the number of connections (inbound + outbound links). Minimum size enforced so isolated nodes remain clickable.
- Node color: uniform accent color (`--accent-color`) by default. Future Workflow integration may color nodes by folder/lifecycle state when Workflows are specced; for now all nodes share the same color palette. Exact color design is at the architect's discretion using CSS variables.
- Node label: the note's title (from front matter `title:` or first H1 or filename).
- Labels are shown at zoom levels above a threshold; hidden when too many nodes are in view (configurable zoom threshold).

### 5.4 Graph Edges

- One directed edge per wiki-link. Edge direction: from the note containing the link to the linked note.
- Bidirectional links (A links B, B links A) are shown as a single undirected edge with a double-arrow visual.
- Edge weight (thickness): proportional to the number of links between the same pair of notes (multiple links from the same note counted once to avoid visual clutter — configurable).
- Edges to notes not in the active vault are shown as stub edges to a ghost node (dimmed, not interactive).

### 5.5 Graph Interaction

| Interaction | Behavior |
|---|---|
| Click node | Opens the note in the editor (new tab or switch to existing tab). The node gets a "selected" highlight ring. |
| Hover node | Shows a tooltip with: note title, connection count, and first line of note content (truncated at 100 chars). Tooltip is positioned to avoid viewport edge clipping. |
| Drag node | Pins the node at the dragged position; other nodes re-simulate around it. Click again on the pinned node to unpin. |
| Scroll/pinch | Zoom in/out. |
| Drag background | Pan the graph. |
| Double-click background | Reset zoom/pan to fit all nodes in view. |
| Filter: Search | Text input in panel header. Highlights matching nodes, dims non-matching ones. Does not remove nodes from view. |

### 5.6 Graph Panel Controls

The graph panel header contains:

- Search input: fuzzy match against node labels.
- Zoom controls: "+" / "-" / "Fit" buttons.
- Settings button: opens graph-specific settings (node size range, label zoom threshold, edge weight display).

### 5.7 Graph Refresh Strategy

The graph does not auto-refresh on every file change (too expensive). Instead:

- On vault activation or vault switch: full graph rebuild from the vault index.
- On file save within the active vault: the index for that file is updated (via the incremental indexer); the graph is notified of the change and updates only the affected node and its edges (no full rebuild).
- On wiki-link add/remove (detected via the incremental indexer): the corresponding edge is added or removed from the live graph.
- Manual refresh: "Refresh" button in panel header.
- The simulation is paused when the panel is hidden and resumed (with a brief re-settle) when re-shown.

---

## 6. Phased Implementation Plan

The three sub-features have hard dependencies that determine their implementation order. This section documents the analyst's recommended phase order and the rationale.

### Phase 1 — Vault System (Data Model + Settings, No UI)

**Deliverable**: The vault data model is fully implemented. Users can create, switch, edit, and delete vaults via a minimal UI (Manage Vaults settings panel). The vault index is built lazily on activation and cached to disk. No File Browser, no graph.

**Why first**: All other features depend on "what is the active vault?" being answered. The vault system is pure infrastructure; shipping it first means Phase 2 (File Browser) and Phase 3 (Graph) can be built on a stable, tested foundation.

**Risk**: The vault index builder (lazy, incremental, bounded) is the most novel Rust code in this system. It must be well-tested before UI is built on top of it.

**Does not break**: Nothing in the existing app depends on vault scope. Existing features (backlinks, wiki-link autocomplete) continue to use the current working directory as their scope during Phase 1.

**Integration gate for Phase 2**: Backlinks and wiki-link autocomplete should be migrated to use the vault index (instead of the current shallow directory scan) as part of Phase 2 — not Phase 1. Phase 1 delivers the vault mechanism without touching existing features.

### Phase 2 — File Browser

**Deliverable**: The File Browser sidebar panel is functional. Users can browse, create, rename, delete, and move notes within the active vault. Vault switching updates the tree. Search within vault works.

**Why second**: The File Browser is the primary UI for the vault concept — it makes the vault "real" to the user. It is also simpler to build than the graph (tree rendering vs. force-directed simulation).

**Dependencies**: Vault system (Phase 1). Specifically: `list_vault_files`, `watch_vault`, and `move_file` Tauri commands from Phase 1.

**Does not break**: The existing tab system, backlinks, and wiki-link autocomplete continue to function independently. The File Browser is additive.

**Integration gate for Phase 3**: The vault index built in Phase 1 and maintained in Phase 2 (via file watch events) is the data source for the graph. Phase 3 can begin once the index is reliably updated.

### Phase 3 — Knowledge Graph

**Deliverable**: The Knowledge Graph sidebar panel is functional. Nodes are rendered with connection-proportional sizing. Edges represent wiki-links. Interaction (click-to-open, hover tooltip, drag, zoom, search filter) is complete. Full overview layout persists per vault.

**Why third**: The graph is the most visually complex feature and has the hardest performance constraints. Building it after the vault + file browser ensures it has access to a mature, well-tested vault index.

**Dependencies**: Vault system (Phase 1), File Browser with watch-based incremental index (Phase 2).

**Risk**: Graph rendering library choice (AD-05) is the biggest unknown. The Software Architect must evaluate options before Phase 3 begins. A wrong choice here is expensive to reverse.

**Future phase — Workflows**: The IN / Working / OUT folder-based Workflow feature will be specced and implemented in a later phase after the above three phases are complete. It is an add-on to the vault system and does not block any of the above phases.

---

## 7. Functional Requirements

### FR-01: Vault System

**FR-01.1** The application maintains a list of named vaults in `settings.json` under the `vaults` key (schema defined in Section 3.2).

**FR-01.2** At any point in time, exactly zero or one vault is "active." The `activeVaultId` field in settings identifies the active vault. Zero active vaults is the valid state when no vaults have been created.

**FR-01.3** A new vault is created by providing: a name (required, 1–100 characters), at least one root path (selected via native folder picker), and optional exclude patterns. A UUID v4 is generated as the vault's `id`. The vault is immediately activated on creation.

**FR-01.4** Vault creation must validate that: (a) the name is non-empty, (b) at least one root path is provided, (c) the root path(s) exist on disk at creation time. Validation failures show inline errors in the Manage Vaults UI; no vault is created.

**FR-01.5** Switching the active vault: (a) persists the current `activeVaultId` change to `settings.json`, (b) discards the in-memory index of the previous vault, (c) loads or builds the index for the new vault, (d) updates the File Browser tree, (e) updates the Knowledge Graph if visible.

**FR-01.6** Editing a vault (rename, add/remove root paths, change exclude patterns): updates the vault entry in `settings.json`. If the vault being edited is the active vault, the index is invalidated and rebuilt.

**FR-01.7** Deleting a vault: removes the entry from `settings.json` and deletes the associated index cache file (`vault-index/{vaultId}.json`). If the deleted vault was active, `activeVaultId` is set to null (no active vault). No files on disk are deleted.

**FR-01.8** The vault index is a JSON file cached at `~/Library/Application Support/com.markable.app/vault-index/{vaultId}.json`. It stores the fields listed in Section 3.5 per file. The index is written via the temp-file-swap pattern.

**FR-01.9** On vault activation, the index is loaded from cache if present. Staleness check: compare the stored `modified` timestamp for each file against the current file system `modified` timestamp. Stale entries are re-parsed. Missing entries (new files) are added. Extra entries (deleted files) are removed.

**FR-01.10** The index is bounded by `maxIndexSize` (default 500; user-configurable, no hard maximum). If a vault root path contains more `.md` files than the configured cap, the index includes the most recently modified files up to the cap. The user is notified in the File Browser panel header: "Showing [N] of [total] notes. Increase the index limit in Vault Settings." When the user increases `maxIndexSize` above 500 in vault settings, the settings panel shows a persistent warning: "Vaults over 500 files may affect performance."

**FR-01.11** File-system change watching is implemented via a Tauri watcher (using the `notify` crate or equivalent). The watcher is scoped to the active vault's root paths. On file create, modify, rename, or delete within the watched paths, the index is updated incrementally (not rebuilt from scratch).

**FR-01.12** A "Manage Vaults" screen is accessible from: Settings panel (dedicated "Vaults" tab), vault switcher dropdown "Manage Vaults…" option, Command Bar command "Manage Vaults". It shows a list of all defined vaults with their name, root paths, file count, and last-opened date.

**FR-01.13** The Command Bar registers the following vault-related commands: "Switch Vault", "New Vault", "Manage Vaults", "Reload Vault Index". All are discoverable via Cmd-Shift-P.

**FR-01.14** Vault switching is done through the File Browser tree (vault nodes, see Section 4.1) or via Command Bar ("Switch Vault"). There is no separate persistent top-of-window switcher. If the File Browser panel is closed, the Command Bar is the fallback.

**FR-01.15** No vault switching or indexing operation blocks the main thread. All Tauri calls are async. Index loading and writing happens in a Tauri command (Rust side) off the renderer process.

**FR-01.16** When no active vault exists (fresh install, or after all vaults deleted), the app continues to function. Existing features (backlinks, wiki-link autocomplete) fall back to the current working directory as scope. The File Browser shows an empty state with a "Create your first vault" prompt. The Knowledge Graph shows an empty state.

---

### FR-02: File Browser

**FR-02.1** The File Browser panel (`id: "file-browser"`) registers via `SidebarPanelDescriptor` with `side: "left"` as its default slot. The panel is a core plugin enabled by default.

**FR-02.2** The panel renders a file tree of all `.md` files and folders within the active vault's root paths, sourced from the vault index. Non-`.md` files are hidden unless the "Show all files" toggle in the panel header is enabled.

**FR-02.3** The tree is sorted: folders before files, then alphabetically case-insensitive within each group.

**FR-02.4** The panel header contains: (a) "New Note" button, (b) "Show all files" toggle, (c) search input (see FR-02.9), (d) a panel menu (kebab or gear icon) with "New Vault…" and "Manage Vaults…" items.

**FR-02.5** Creating a new note: user clicks "New Note" or presses a keyboard shortcut. An inline editable label appears at the vault root (or inside the currently focused folder). User types the filename (without extension). Pressing Enter creates the file (with `.md` extension appended). Pressing Escape cancels. The new file is opened in a new tab.

**FR-02.6** Renaming: double-clicking a file or folder label activates an inline editable input pre-filled with the current name. Pressing Enter commits the rename. Pressing Escape cancels. On commit: (a) the Rust `rename_file` command is invoked, (b) any open tab for the renamed file has its title updated, (c) a "Check links?" notification is shown if the vault index contains other notes linking to the renamed file (see FR-02.11).

**FR-02.7** Right-click context menu on a file node: New Note (in same folder), Rename, Delete, Move to…, Open in Finder, Copy Path.

**FR-02.8** Right-click context menu on a folder node: New Note (in this folder), New Folder (inside this folder), Rename, Delete, Open in Finder.

**FR-02.9** File search: text input in the panel header. Filters the tree to files whose names fuzzy-match the query (case-insensitive, same algorithm as Command Bar fuzzy ranker). Results show matching files flattened (no folder nesting) when a query is active; folder structure is restored when the query is cleared.

**FR-02.10** Drag-and-drop: files and folders can be dragged to a new location within the tree. The drop target folder is highlighted on hover. On drop: the Rust `move_file` command is invoked. The tree is updated immediately (optimistic update; reverted on error).

**FR-02.11** Post-move / post-rename link update: after a file rename or move, the system checks the vault index for outbound links TO the affected file. If any are found, a dismissible notification appears in the File Browser panel: "[N] notes link to '[old name]'. Update links?" with "Update" and "Dismiss" buttons. Clicking "Update" triggers a bulk find-and-replace via a new Rust command that updates `[[old-name]]` to `[[new-name]]` in all linking files (temp-file-swap per file). This is a best-effort operation; wiki-links using the full path or display-text overrides may not be matched.

**FR-02.12** Delete confirmation: a native Tauri dialog box ("Delete [name]? This cannot be undone.") must be confirmed before any file or folder is deleted. The deletion is executed via the Rust `delete_file` command. Any open tabs for the deleted file are closed.

**FR-02.13** Vault icon: each vault node in the file tree displays a vault icon distinct from the plain folder icon. The icon is resolved from the vault's `iconId` field (or a default vault icon if unset). The rendering must be extensible — the icon identifier is data-driven, not hardcoded. See Section 4.1 for extension point details.

**FR-02.14** Active file highlight: the file node for the currently active tab is highlighted with a distinct style (e.g., bold text and accent left-border). When the active tab changes, the highlight updates. The panel auto-scrolls to bring the active file node into view.

**FR-02.15** Keyboard navigation: when the File Browser panel has focus, Up/Down arrows navigate between nodes; Enter opens a file or expands/collapses a folder; Right arrow expands a collapsed folder; Left arrow collapses an expanded folder; F2 activates inline rename on the focused node; Delete key triggers delete confirmation on the focused node.

**FR-02.16** Empty vault state: when the active vault has no `.md` files, the panel shows a centered empty state: "No notes yet. Click the + button to create your first note."

---

### FR-03: Knowledge Graph

**FR-03.1** The Knowledge Graph panel (`id: "knowledge-graph"`) registers via `SidebarPanelDescriptor` with `side: "right"` as its default slot.

**FR-03.2** On panel open, the graph is built from the vault index: one node per indexed note, one edge per wiki-link entry in `outboundLinks`. The graph is rendered using the library selected in AD-05.

**FR-03.3** The force simulation runs until stable (force magnitude below threshold) or 5 seconds (whichever comes first). The layout at the time-cap is used if the simulation has not fully converged.

**FR-03.4** Node appearance is defined in Section 5.3. Edge appearance in Section 5.4. Both use CSS variables for colors.

**FR-03.5** Click on a node: opens the corresponding note in the editor (`__MARKABLE_TAB_MANAGER__.openFile(path)`). The selected node receives a distinct visual ring.

**FR-03.6** Hover on a node: shows a tooltip (Section 5.5). The tooltip is rendered as a DOM element positioned absolutely, not as a native macOS tooltip.

**FR-03.7** Graph controls (Section 5.6) are implemented as DOM elements in the panel header.

**FR-03.8** Incremental graph update (Section 5.7): when the vault index emits an "index-updated" event for a specific file, the graph updates the corresponding node's edges. No full rebuild.

**FR-03.9** When the active vault has fewer than 2 notes, the graph shows an empty state: "No connections yet. Add wiki-links ([[note name]]) to your notes to see the graph."

**FR-03.10** Graph layout is persisted per vault. The canonical persisted layout is the **full vault graph** (all nodes visible). Node positions (x, y) are stored after the simulation stabilizes. On next open of the same vault, the persisted layout is used as the initial state (simulation runs briefly to re-settle from saved positions rather than from random initial placement). When the user zooms or filters into a subgraph view (e.g., clicking a node to focus on its neighbors), that filtered view is transient — positions in the filtered view are NOT persisted separately. Only the full overview layout is the canonical saved state.

**FR-03.11** The graph panel performance must meet: 500 nodes / 1000 edges reaches stable layout in under 3 seconds; interactive dragging stays above 30 fps; initial render (before simulation completes) shows nodes within 500ms.

---

### FR-04: New Rust Commands

The following Tauri commands must be implemented in `src-tauri/src/commands/`. All follow the existing command file pattern and are registered in `tauri::generate_handler!`.

| Command | Signature | Phase | Purpose |
|---|---|---|---|
| `create_vault` | `(name: String, root_paths: Vec<String>, exclude_patterns: Vec<String>) -> Result<VaultEntry, String>` | 1 | Creates vault entry in settings; generates UUID. |
| `update_vault` | `(id: String, name: String, root_paths: Vec<String>, exclude_patterns: Vec<String>, max_index_size: Option<u32>) -> Result<(), String>` | 1 | Updates vault fields in settings. |
| `delete_vault` | `(id: String) -> Result<(), String>` | 1 | Removes vault entry and deletes index cache file. |
| `switch_vault` | `(id: String) -> Result<(), String>` | 1 | Sets `activeVaultId` in settings. |
| `build_vault_index` | `(vault_id: String) -> Result<VaultIndex, String>` | 1 | Lazy full-index build from vault root paths. Returns the index; does not start watching. |
| `get_vault_index` | `(vault_id: String) -> Result<Option<VaultIndex>, String>` | 1 | Returns the cached index from disk (if present and fresh) or null. |
| `save_vault_index` | `(vault_id: String, index: VaultIndex) -> Result<(), String>` | 1 | Persists the index to disk using temp-file-swap. |
| `watch_vault` | `(vault_id: String, root_paths: Vec<String>) -> Result<(), String>` | 2 | Starts fs watch on the vault's root paths. Emits `vault-file-changed` Tauri events. |
| `unwatch_vault` | `(vault_id: String) -> Result<(), String>` | 2 | Stops fs watch for the vault. |
| `create_file` | `(path: String, content: String) -> Result<(), String>` | 2 | Creates file (and parent dirs) using temp-file-swap. |
| `rename_file` | `(old_path: String, new_path: String) -> Result<(), String>` | 2 | Renames/moves a file. Errors if `new_path` already exists (no silent overwrite). |
| `delete_file` | `(path: String) -> Result<(), String>` | 2 | Deletes a file. Returns error if path does not exist. |
| `move_file` | `(source: String, destination_dir: String) -> Result<String, String>` | 2 | Moves a file to a new directory. Returns the new absolute path. |
| `delete_directory` | `(path: String) -> Result<(), String>` | 2 | Recursively deletes a directory. Used for folder delete in File Browser. |
| `update_wiki_links` | `(files_to_update: Vec<String>, old_link: String, new_link: String) -> Result<Vec<String>, String>` | 2 | Batch find-and-replace of `[[old_link]]` with `[[new_link]]` across a list of files. Temp-file-swap per file. Returns list of updated file paths. |
| `list_vault_files` | `(root_paths: Vec<String>, exclude_patterns: Vec<String>, max_count: u32) -> Result<Vec<FileEntry>, String>` | 1 | Shallow+recursive scan returning file metadata (no content). Used for initial index build. |

Note: `create_daily_note` and `check_paths_exist` already exist (implemented during the Daily Note feature). `list_md_files` already exists. These do not need to be re-implemented.

---

## 8. Non-Functional Requirements

**NFR-01: No recursive scan on startup** — Activating a vault must NOT synchronously scan its root paths on the main thread before the editor window is usable. Index loading from cache (if fresh) is synchronous and fast; only staleness re-parsing is async. Full index rebuilds happen in background Tauri tasks.

**NFR-02: Vault activation latency** — Switching vaults must result in the File Browser tree being visible (possibly partially populated) within 500ms. Full index build for a vault with 500 files must complete in under 5 seconds on a mechanical HDD (SSD target: 1 second).

**NFR-03: File Browser responsiveness** — All file tree interactions (expand, collapse, inline rename input appearance) must respond within 100ms. File operations (create, rename, delete, move) must complete and update the UI within 500ms for single files.

**NFR-04: Knowledge Graph render** — Initial graph render (nodes visible, edges visible, pre-simulation) within 500ms of panel open. Force simulation stabilizes within 3 seconds for 500-node graphs. See FR-03.11.

**NFR-05: Index size soft cap** — The vault index enforces `maxIndexSize` (default 500; user-adjustable with no hard maximum). Behavior at or above the cap is defined in FR-01.10. When a user raises `maxIndexSize` above 500, the vault settings panel shows a persistent performance warning. The system must not silently bypass the configured cap without notifying the user.

**NFR-06: File watch CPU usage** — The fs watcher must consume negligible CPU when no changes are occurring. The watcher must batch rapid changes (e.g., a git checkout touching hundreds of files) with a 500ms debounce before triggering index updates.

**NFR-07: No blocking on large file content** — Index entries never store file content. The light parser (front matter + wiki-link extraction) reads only the first 4 KB of each file for front matter; wiki-link scanning reads the full file but is done asynchronously during index builds, never on the main thread.

**NFR-08: CSS variable theming** — All UI components (File Browser, vault switcher, Knowledge Graph panel) use CSS variables exclusively. No hardcoded hex values or font stacks.

**NFR-09: Test coverage** — Each phase ships with a Vitest test file:
- Phase 1: `tests/vault/vault-index.test.ts` — minimum 40 tests covering index build, staleness, capping, UUID generation, settings schema.
- Phase 2: `tests/plugins/file-browser/file-browser.test.ts` — minimum 40 tests covering tree render, vault node rendering, search, rename notification logic, link update detection.
- Phase 3: `tests/plugins/knowledge-graph/knowledge-graph.test.ts` — minimum 40 tests covering node/edge construction from index, full-vs-filtered layout persistence, incremental update, empty state.
- Rust: `cargo test` must pass for all new commands in `src-tauri/src/commands/`.

**NFR-10: No TODO comments in source** — Deferred work must be logged in `docs/specs/[feature]/00_index.md`, not as inline `// TODO` comments.

---

## 9. Integration Points

| Global / API | Role | Phase |
|---|---|---|
| `__MARKABLE_TAB_MANAGER__` | `openFile(path)`, `getAllTabs()`, tab-change event | 2, 4 |
| `__MARKABLE_CURRENT_FILE__` | Derive fallback scope when no vault is active | 1 |
| `__MARKABLE_COMMANDS__` | Register vault/state commands | 1, 3 |
| `__MARKABLE_HANDLE_ACTION__` | Dispatch vault/state/graph commands | 1, 3, 4 |
| `__MARKABLE_COMMAND_BAR_OPEN__` | Open Command Bar for vault-switch command | 1 |
| `api.loadSettings()` / `api.saveSettings()` | Persist plugin settings for File Browser and Graph | 2, 3 |
| `SidebarPanelDescriptor` | Register File Browser and Knowledge Graph panels | 2, 3 |
| Backlinks index | Currently uses `list_md_files` (shallow scan of current dir). Phase 2 migration: switch to vault index as the source of truth for wiki-link resolution and autocomplete candidates. | 2 |
| YAML Pane plugin | No new coupling required in this spec. The `state:` front matter field has been removed from the data model; YAML Pane does not need a dedicated state control. | — |
| Daily Note plugin | `dailyNoteFolder` setting is explicitly configured by the user in the Daily Note plugin — it does not auto-inherit from the active vault root and has no vault coupling. No changes required in this spec. | — |
| Command Bar "Files" mode | The file list in Cmd-P "Files" mode should be sourced from the vault index (Phase 2) rather than a fresh directory scan. Pre-Phase 2, behavior is unchanged. | 2 |
| `__MARKABLE_PLUGIN_MANAGER__` | File Browser and Knowledge Graph are core plugins; registered and loaded by PluginManager. | 2, 3 |

---

## 10. Out of Scope

The following are explicitly deferred and must NOT be implemented as part of this spec:

1. **Cloud sync / backup** — Vault data lives locally only. No Dropbox, iCloud Drive sync integration in this spec.
2. **Collaboration / shared vaults** — No multi-user editing, shared indexes, or presence indicators.
3. **Mobile / cross-platform** — Markable is macOS-only; no iOS or Android vault sync.
4. **Full-text search** — File Browser search is filename-only in this spec. Full-text search (searching inside note content) is a separate feature.
5. **Dataview / query tables** — Querying notes by front matter field, tag, or state as a table or list. Separate FC3 feature.
6. **Periodic notes (weekly/monthly)** — Separate feature already deferred in the Daily Note spec.
7. **Smart folders / saved searches** — Dynamic vault sub-groupings based on queries.
8. **Vault import from Obsidian** — Migration assistant for importing an Obsidian vault (with its `.obsidian/` config). Future feature.
9. **Graph 3D view** — Force-directed graph in 3D space. 2D only in this spec.
10. **Graph clustering / communities** — Automatic grouping of nodes into clusters by link density. Future enhancement.
11. **Graph export** — Saving the graph as a PNG, SVG, or PDF file.
12. **Nested vaults (enforcement)** — Overlapping vault paths are allowed (see Section 3.3 and EC-04). What is out of scope is any automatic de-duplication or merging of overlapping vault indexes. Duplicate coverage is the user's responsibility.
13. **Vault-level encryption** — No at-rest encryption of vault contents.
14. **IN / Working / OUT Workflows** — The folder-based Workflow feature (auto-created IN/Working/OUT folder structures) is explicitly deferred to a future spec. No Workflow UI or folder creation logic is in scope here.
15. **Weekly note / periodic note integration with Daily Note** — Already deferred in the Daily Note spec.

---

## 11. Resolved Architectural Decisions

**AD-01 — Workflow state is folder-based, not front matter**: The IN / Working / OUT lifecycle model is implemented as automatically generated folder structures ("Workflows"), not as a `state:` YAML front matter field. A note's lifecycle state is implied by which folder it resides in. There is no `state` field in the Markable data model. This is a deliberate inversion of the Obsidian front matter convention: folder location is explicit, portable to any editor, and requires no parser.

**AD-02 — Multiple focused vaults over one monolithic vault**: The vault system explicitly encourages small, focused vaults. The `maxIndexSize` default (500) is a soft performance recommendation — users can raise it, but they are warned. This diverges from Obsidian's single-vault model. The cost is more manual vault management; the benefit is predictable performance regardless of total note count.

**AD-03 — UUID-based vault identity**: Vaults are identified by a UUID v4, not by their root path or name. This means a vault can be renamed or have its root path changed without losing its identity (cached index, persisted layout, etc.). Root paths are metadata of a vault, not its identity.

**AD-04 — Index is a JSON file, not a SQLite database**: Phase 1 and Phase 2 use a JSON cache file. SQLite would offer richer query capabilities (needed for Dataview / full-text search) but adds build complexity (SQLite native bindings in Tauri/Rust are straightforward, but the frontend query interface is non-trivial). The JSON index design is intentionally compatible with a future migration to SQLite: each entry in the JSON array maps to a row in a future `notes` table. The migration will be a Phase 3+ concern.

**AD-05 — Graph rendering library (OPEN — Architect must decide)**: The best rendering library for a force-directed graph in a Rollup-bundled, Vitest-tested Tauri app as of 2026 is not predetermined in this spec. The Software Architect must evaluate current options (D3.js `d3-force`, Cytoscape.js, Sigma.js, Cola.js, or others) against the constraints: Rollup compatibility, SVG preferred, 500-node performance, viable in Vitest test environment, bundle size < 500 KB. A web search for current community recommendations is required before Phase 3 architecture begins.

**AD-06 — Incremental index updates via fs watch, not polling**: File system watching (using the `notify` Rust crate, already a transitive dependency of Tauri) is used for incremental index updates. Polling would impose unnecessary I/O overhead and latency. The watcher is started when a vault is activated and stopped when a vault is deactivated or the app closes.

**AD-07 — No automatic Workflow folder assignment on note creation**: New notes are created at the vault root or in the user-selected folder. The system does not automatically place new notes in a Workflow's `IN/` folder. Users who want a capture-to-IN flow will configure their own default folder (e.g., via templates or file browser). This keeps the default experience clean and avoids enforcing a workflow the user may not have set up.

**AD-08 — Backlinks migration to vault index happens in Phase 2, not Phase 1**: The existing backlinks feature uses `list_md_files` (shallow scan) as its source. Migrating it to use the vault index (richer, bounded, cached) is a Phase 2 task. Phase 1 delivers the vault infrastructure without modifying existing features.

**AD-09 — Post-rename link update is opt-in, best-effort**: When a note is renamed, the system detects affected notes (those with `[[old-name]]` in their `outboundLinks` index entry) and offers a "Update links?" prompt. The user explicitly confirms before any bulk find-and-replace is executed. This is not automatic to avoid silent data modification. The operation is "best-effort" because it matches only the `[[filename-stem]]` form of wiki-link; links using full relative paths or display-text overrides with the exact old stem in a non-standard way may not match.

---

## 12. Open Questions — All Resolved

All seven open questions have been answered by the user (2026-04-24). Resolutions are incorporated into the spec above. The answers are summarized here for traceability.

**OQ-01: Daily Note folder path — RESOLVED**
The `dailyNoteFolder` setting requires explicit user configuration in the Daily Note plugin settings. It does NOT auto-inherit from the active vault root. No vault coupling; no code changes needed. This is the resolved and final behavior.

**OQ-02: Overlapping vault paths — RESOLVED (policy reversed)**
Overlapping vaults ARE allowed and are a feature, not an error. Example: Vault A = `/Notes/` for full context; Vault B = `/Notes/Work/` for focused work. This is the primary mechanism for scope control and performance limiting. When a vault is a sub-path of another vault and both are open/indexed, the system detects the nesting and warns the user about potential performance impact in the vault settings panel. Overlapping paths are NOT rejected at creation time.

**OQ-03: Vault switcher placement — RESOLVED**
Vaults appear inside the File Browser panel tree alongside folders, with a distinct vault icon. Users switch vaults directly in the file browser by clicking the vault node. There is no separate top-of-window switcher. Different vault types will eventually have different icons (Collections, Smart Bins, etc.) — taxonomy TBD in a future session. The architect must leave a data-driven extension point for the icon system.

**OQ-04: IN/Working/OUT model — RESOLVED (major change from draft)**
The IN/Working/OUT model is NOT a YAML front matter system. It is a folder-based "Workflow" feature: Markable auto-creates `IN/`, `Working/`, `OUT/` folders at a user-specified location. State is implied by folder location. The `state` front matter field has been removed from the spec entirely. Workflow feature will be specced separately in a future session.

**OQ-05: `maxIndexSize` default — RESOLVED**
500 files is the correct default. Users can exceed 500 but receive a warning in vault settings: "Vaults over 500 files may affect performance." The cap is a soft warning, not a hard block.

**OQ-06: Graph layout persistence granularity — RESOLVED**
The graph always opens showing the full vault graph. Node positions are persisted for the full-graph layout only. Filtered/zoomed subgraph views are transient — their positions are NOT persisted separately. The full overview layout is the canonical persisted state.

**OQ-07: Multiple disconnected vault root paths — RESOLVED**
Acceptable as-is. Multiple disconnected roots show as separate tree roots in the File Browser. No special visual treatment required at this time.

---

## 13. Edge Case Inventory

The following edge cases are the mandatory test checklist for the Code Reviewer. Every item must have a corresponding test or a documented rationale for exclusion. Items are grouped by sub-feature.

### Vault System

**EC-01: Creating a vault with a root path that does not exist on disk** — Expected: `create_vault` returns an error. The Manage Vaults UI shows an inline error. No vault entry is written to settings.

**EC-02: Creating a vault whose root path is a file, not a directory** — Expected: same as EC-01. The validator checks `is_dir()` on the Rust side.

**EC-03: Creating two vaults with the same name** — Expected: allowed (names are not unique identifiers; IDs are). The vault switcher shows both names; if ambiguous, the last-opened date differentiates them.

**EC-04: Creating a vault with a root path that is a subdirectory of another vault's root path (overlapping vaults)** — Expected: allowed. The system detects the nesting relationship at creation time and shows a warning in the vault settings panel: "This vault's path overlaps with vault '[name]'. Both vaults will index shared files independently. This may affect performance." The vault is created. No rejection.

**EC-05: Switching vaults while a file write is in flight** — A save is pending in the current vault. Expected: the in-flight write completes (the tab is not closed mid-save). Vault switch completes after the write resolves. The written file remains in the old vault's index (it was written before the switch).

**EC-06: Vault index cache is corrupted (malformed JSON)** — On vault activation, the cache file fails to parse. Expected: the error is logged, the cache is discarded, and a full index rebuild is triggered. The user is not shown an error (the rebuild is transparent).

**EC-07: Vault root path is moved or deleted externally while the vault is active** — The fs watcher emits events for the deleted path. Expected: the File Browser shows an error state: "Vault root path '[path]' is no longer accessible." The watcher is stopped. The vault remains in settings (user can re-point it to a new path).

**EC-08: `maxIndexSize` cap is reached during initial index build** — Expected: indexing stops at the configured cap. The File Browser shows: "Showing [N] of [total] notes. Increase the index limit in Vault Settings." The user can raise the cap in vault settings; raising it above 500 shows a performance warning.

**EC-09: Vault index `save_vault_index` fails (disk full, permissions)** — Expected: the Rust command returns an error. The frontend logs the error. The in-memory index continues to function. On next app launch, the index rebuilds from scratch (no crash, no data loss for notes themselves).

**EC-10: Deleting the active vault** — Expected: `activeVaultId` is set to null. The File Browser shows empty state. The Knowledge Graph shows empty state. No crash. The user is not redirected or prompted — they remain in the editor with their currently open tabs intact.

**EC-11: App launch with a saved `activeVaultId` that no longer exists in the `vaults` array** — E.g., the settings file was manually edited. Expected: `activeVaultId` is reset to null. The app initializes with no active vault and shows the "Create your first vault" empty state in the File Browser.

**EC-12: `build_vault_index` encounters a file it cannot read (permissions denied)** — Expected: the file is skipped and omitted from the index. A count of "N files skipped (permission denied)" is stored in the index metadata and surfaced in the File Browser panel header.

**EC-13: Rapid vault switching (user clicks 3 vaults in quick succession)** — Expected: only the final vault's index is loaded. Intermediate index loads are cancelled via a generation counter or task cancellation. No stale index data from intermediate vaults appears in the UI.

**EC-14: Vault with 0 files** — Expected: `build_vault_index` returns an empty index. File Browser shows "No notes yet." Knowledge Graph shows empty state. No crash.

### File Browser

**EC-15: Creating a note with a name that already exists in the same folder** — Expected: the inline create input shows an inline error "A note with this name already exists." The file is not created. The user can change the name or cancel.

**EC-16: Creating a note with a filename containing macOS-illegal characters (`:`, `/` in the middle of a name, etc.)** — Expected: inline validation error in the rename/create input. The illegal characters are highlighted. The file is not created.

**EC-17: Renaming a file to a name that already exists in the same folder** — Expected: same as EC-15 but for rename. The rename is cancelled with an inline error.

**EC-18: Renaming a file when other notes link to it via `[[old-name]]`** — Expected: after a successful rename, a notification "N notes link to 'old-name'. Update links?" is shown in the File Browser panel. The user can click "Update" or "Dismiss." If "Update" is clicked, `update_wiki_links` is invoked. If the command returns an error for any file, the user is notified of partial failure.

**EC-19: Moving a file to a folder within the same vault (drag-and-drop) when the destination already contains a file with the same name** — Expected: the move is rejected. A notice: "A note named '[name]' already exists in '[destination]'." No file is overwritten.

**EC-20: Deleting a folder that contains a currently open tab** — Expected: the tab is closed (with unsaved changes discarded — or a "Save before closing?" prompt if the tab has unsaved changes). The folder and its contents are deleted. The File Browser tree is updated.

**EC-21: Deleting a folder that contains another vault's root path (overlapping vault case)** — Expected: the delete proceeds normally (Markable deletes the folder and its contents on disk). The other vault whose root path was inside that folder will now have an inaccessible root path. On next activation of that vault, EC-07 handling applies ("Vault root path is no longer accessible").

**EC-22: File Browser panel is closed when vault switch occurs** — Expected: the panel's internal state (tree, scroll position) is reset. On next open, the new vault's tree is shown.

**EC-23: Fuzzy search returns no results** — Expected: the tree shows a "No notes match '[query]'" empty state. The search input shows no error; clearing it restores the tree.

**EC-24: Inline rename input is active when the user clicks elsewhere** — Expected: the rename is cancelled (same as pressing Escape). The node label reverts to its original name.

**EC-25: File watch event arrives for a file outside the vault's root paths** — The watcher should never emit such events (it is scoped to root paths). If it does (e.g., a symlink resolves outside the vault), the event is ignored. The vault index is not modified.

**EC-26: `update_wiki_links` encounters a file that has been deleted since the index was last updated** — Expected: the command skips deleted files, returns them in the error list. The user is notified: "Could not update links in N files (files may have been moved or deleted)."

**EC-27: File Browser is open and the user rapidly creates 10 notes in quick succession** — Expected: the tree updates incrementally (one node per creation event, not a full re-render). No duplicate nodes, no missing nodes. The inline create input re-opens for the next note without losing focus.

### Note State

*Note: EC-28 through EC-32 from the original draft referenced `state:` YAML front matter field behavior. These cases are no longer applicable — the `state` front matter field has been removed from the spec entirely. Lifecycle state is now folder-based via the Workflow feature, which will be specced separately. These EC numbers are retired.*

### Knowledge Graph

**EC-33: A wiki-link in a note references a file that does not exist in the vault index (broken link)** — Expected: the graph renders a ghost node (dimmed, not interactive, no tooltip with note content) for the broken link target. The edge to the ghost node is shown as a dashed line.

**EC-34: Two notes have the same filename (in different folders within the same vault)** — E.g., `/Research/meeting.md` and `/Work/meeting.md`. A wiki-link `[[meeting]]` in a third note is ambiguous. Expected: the graph renders both `meeting.md` nodes distinctly (full path as differentiator). The ambiguous edge is shown in a warning color (e.g., orange) with a tooltip: "Ambiguous link — matches multiple notes."

**EC-35: [Retired]** — This case referenced `state: out` front matter filtering in the graph. The `state` front matter field has been removed from the spec. The Knowledge Graph in this spec does not have a state-based filter. This EC number is retired; no replacement case required at this time.

**EC-36: The Knowledge Graph panel is open when the user switches vaults** — Expected: the graph is rebuilt for the new vault. A brief loading indicator is shown during the rebuild. The previous vault's graph is not visible during the transition.

**EC-37: The force simulation has not converged when the user closes the panel** — Expected: the simulation is paused immediately on panel close. The partial layout is saved. On next open, the layout resumes from the saved state.

**EC-38: A note links to itself (self-referential wiki-link)** — Expected: a self-loop edge is shown on the node (or the self-link is omitted — design choice; must be documented). No crash or infinite loop in the force simulation.

**EC-39: The graph has 0 edges (all notes are isolated, no wiki-links)** — Expected: all nodes are rendered at approximately equal spacing (force simulation still runs; nodes repel each other). The graph is functional; the empty-connections message is not shown (that message is for < 2 nodes, per FR-03.9). A panel-header notice: "No connections found. Add [[wiki-links]] to connect notes."

**EC-40: `build_vault_index` encounters a note with malformed front matter (YAML parse error)** — Expected: the file is indexed with `tags: []` and `outboundLinks` extracted via a fallback regex (not the YAML parser). The YAML parse error is logged but does not prevent indexing. The note appears in the graph as a normal node.

**EC-41: The Knowledge Graph panel is scrolled/zoomed and then the user clicks a node to open it** — Expected: the editor opens the correct note. The graph panel does not reset its zoom/pan position on node click. Only the node's "selected" ring is updated.

**EC-42: A vault with `maxIndexSize: 500` has 500 indexed files and 200 more files that were excluded due to the cap** — The excluded files are not in the graph. Expected: no edges point to the excluded files (they are not known to the index). Wiki-links from indexed notes to excluded notes render as ghost nodes (broken links, per EC-33).

**EC-43: The `update_wiki_links` Rust command fails partway through (disk error on file 3 of 10)** — Expected: the command returns the list of files it successfully updated and the list of failures. The frontend shows: "Updated links in 2 notes. Could not update 8 notes: [list]." No partial writes — each file is either fully updated (using temp-file-swap) or not touched at all.

---

## Handoff Summary

This document is **VALIDATED** (approved by user 2026-04-24). All seven open questions have been resolved and incorporated. The Software Architect may be activated with this document as context.

**Key changes from the original draft that the Architect must note:**

1. **No `state` front matter field** — The `state:` YAML field has been removed entirely. Lifecycle state (IN/Working/OUT) is implemented as a folder-based "Workflow" feature that is explicitly out of scope for this architecture phase. The Architect must not design or implement any state tagging system.
2. **Overlapping vaults are allowed** — Do not implement rejection logic for overlapping root paths. Implement detection + warning instead.
3. **Vault switcher is in the File Browser tree** — Vault nodes appear alongside folders in the tree. No separate top-of-window switcher. The vault node renderer must support a data-driven icon identifier (extension point for future vault types).
4. **`maxIndexSize` is a soft cap** — No hard maximum. Raising above 500 shows a performance warning in vault settings.
5. **Graph layout persistence** — Only the full overview layout (all nodes visible) persists. Filtered subgraph views are transient.
6. **Phase plan is now 3 phases** (Vault → File Browser → Knowledge Graph). The former Phase 3 (state tagging) is removed. Workflows are a future phase.

Once the Architect produces `docs/specs/pkm-system/00_index.md` + step files, activate the Lead Developer.

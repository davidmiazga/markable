# Active Task: Unified Plugin System

**Status: VALIDATED**
**Date: 2026-04-12**
**Supersedes:** User Plugin System (now fully implemented and merged, see `docs/specs/user-plugins/00_index.md`)
**Covers:** Collapsing the current two-tier plugin architecture (compiled TypeScript built-ins + dynamically-loaded user JS) into a single, unified loading system where every plugin — base and user — is a `.js` file on disk loaded by the same code path.

---

## Summary

As a Markable developer and power user, I want all plugins — whether they ship with the app or are written by users — to be loaded from disk using the same dynamic loading mechanism, so that base plugins can be iterated on independently of the app bundle and so that the plugin API surface is identical regardless of who wrote the plugin.

---

## Background and Constraints from Existing Architecture

The following facts are locked by existing code and are hard constraints for this feature.

### What exists today

**Current built-in plugins (compiled TypeScript, statically bundled):**

| Plugin | Directory | CM6 involvement |
|--------|-----------|-----------------|
| Word Count | `src/plugins/word-count/` | None — DOM only |
| Status Bar | `src/plugins/status-bar/` | None — DOM only |
| Focus Mode | `src/plugins/focus-mode/` | `focusModeExtension` (StateField + StateEffect) |
| Typewriter Mode | `src/plugins/typewriter-mode/` | `typewriterModeExtension` (StateField + StateEffect) |

These are imported statically in `src/plugins/index.ts` and hardcoded in `PluginManager`'s constructor. They currently call `getExtensions()` at editor-init time (before the `EditorView` exists), and their CM6 extensions are baked into the initial `EditorState` configuration.

**Current user plugins (dynamic JS, loaded post-init):**

- Loaded from `~/Library/Application Support/com.markable.app/plugins/` (currently a flat `plugins/` directory, no `user/` subdirectory yet — see PC-EXISTING-1 below)
- Evaluated via `new Function('api', source)()` with a restricted `UserPluginAPI` object
- Restricted to DOM-only access; `getExtensions()` and `EditorView` are intentionally absent from `UserPlugin` / `UserPluginAPI`
- Implemented in: `src/plugins/user-plugin-loader.ts`, `src/plugins/user-plugin-types.ts`, `src/plugins/index.ts` (`loadUserPlugins` / `toggleUserPlugin` / etc.), `src-tauri/src/commands/plugins.rs`

**Current `PluginManager` (`src/plugins/index.ts`):**

- Two separate plugin arrays: `this.plugins: MarkablePlugin[]` (built-ins, static) and `this.userPluginRecords: UserPluginRecord[]` (user, dynamic)
- Two separate toggle methods: `toggle()` (built-ins) and `toggleUserPlugin()` (user)
- Two separate panel data sources: `getDefinitions()` and `getUserDefinitions()`
- Two separate state snapshots: `getStates()` and `getUserStates()`

**Current interface split:**

| Interface | File | CM6 access | `getExtensions()` |
|-----------|------|-----------|-------------------|
| `MarkablePlugin` | `plugin-types.ts` | Full (`EditorView` in `PluginContext`) | Yes (optional) |
| `UserPlugin` | `user-plugin-types.ts` | None | No |
| `PluginContext` | `plugin-types.ts` | `editor: EditorView` | — |
| `UserPluginAPI` | `user-plugin-types.ts` | None | — |

**Current Rust command surface (all in `src-tauri/src/commands/plugins.rs`):**

- `list_user_plugins()` — scans `plugins/` top-level, returns `{ files, truncated }` (max 50, lexicographic)
- `read_plugin_file(filename)` — reads a `.js` file, max 500 KB, path-confined
- `read_plugin_settings(id, json)` — reads `plugins/<id>/settings.json`
- `write_plugin_settings(id, json)` — writes `plugins/<id>/settings.json`

**CM6 Compartment — does not exist yet.** The editor's extension set is built once in `buildExtensions()` and passed to `EditorState.create()`. There is no post-init reconfiguration mechanism.

**`src-tauri/resources/`** — does not exist yet. Currently only `help/*` is listed under `bundle.resources` in `tauri.conf.json`.

**PC-EXISTING-1 — Current user plugin directory is flat `plugins/`, not `plugins/user/`.** The implemented system uses `plugins/` directly. The new system introduces `plugins/core/` and `plugins/user/` subdirectories. A migration path is required for existing users who already have plugins in `plugins/`.

---

## Knowns

- All plugins (base and user) will be `.js` files on disk, evaluated via the same `new Function`-based loader.
- Base plugins ship as `.js` files inside the Tauri app bundle (under `resources/plugins/core/`).
- On first launch (or when the app version bumps), Rust copies `resources/plugins/core/` files to `~/Library/.../plugins/core/`. User files in `plugins/user/` are never touched by the copy step.
- User plugins are placed in `~/Library/.../plugins/user/` (subdirectory, not the previous flat `plugins/`).
- A user can override a base plugin by placing a same-named `.js` file in `plugins/user/`. The user version wins.
- Base plugins show in a "Core Plugins" collapsible section; user plugins show in "User Plugins" collapsible section.
- An overridden core plugin shows an "Overridden" badge in the Core Plugins section; the user version renders normally in the User Plugins section.
- All plugins receive the same unified `MarkablePluginAPI` object. Base plugins get the same API as user plugins — the `PluginContext` / `UserPluginAPI` split is eliminated.
- `getExtensions()` is restored to the unified API surface and is available to all plugins (base and user). CM6 extensions are injected post-init via a `Compartment`-based reconfiguration, not at editor-init time.
- Plugin versioning: each plugin object declares a `version: string` field (semver string, e.g. `"1.0.0"`). There is no sidecar `.json` manifest file.
- Base plugin auto-update: on app version bump, Rust overwrites `plugins/core/` files with the bundled versions. User files in `plugins/user/` are never overwritten.
- Plugin enable/disable state continues to be persisted in `settings.json` under appropriate keys (details in FR-7).
- The existing `loadSettings()` / `saveSettings()` per-plugin settings storage mechanism (`plugins/<id>/settings.json`) is retained.
- The maximum plugin count (50 per directory, lexicographic) is retained for user plugins. Core plugins have no cap (they are under developer control).
- The existing path-traversal guards and file-size limits (500 KB) are retained for the user plugin directory.

---

## Resolved Decisions

All six key technical decisions listed in the brief are resolved as follows.

**Decision 1 — CM6 API surface for plugins (formerly PC-6, now reversed)**

All plugins receive a `MarkablePluginAPI` object that includes:
- `statusBar` zones (left/center/right `HTMLElement`)
- `ensureStatusBar()` / `hideStatusBarIfUnused()`
- `loadSettings()` / `saveSettings(data)` — per-plugin settings JSON
- `addExtensions(exts: Extension[])` — injects CM6 extensions via the editor `Compartment` post-init
- `removeExtensions()` — removes all extensions previously added by the calling plugin from the `Compartment` (all-or-nothing per plugin id)

The raw `EditorView` instance is **not** exposed on `MarkablePluginAPI`. All CM6 interaction goes through the `addExtensions` / `removeExtensions` façade. This limits blast radius (plugins cannot call `editor.dispatch` with arbitrary transactions, access `editor.dom`, or read editor state directly) while enabling the full set of use cases (custom syntax highlighting, decorations, keymaps, state fields).

Rationale: exposing `addExtensions`/`removeExtensions` only is substantially narrower than passing the raw `EditorView`. A plugin that needs to read document state can do so by registering a `StateField` via `addExtensions`; it does not need direct access to the view.

**Decision 2 — Base plugin build pipeline**

Each of the four existing TypeScript plugins is built as a standalone IIFE `.js` file using Vite in library mode. Each plugin file is self-contained: it bundles its own CM6 dependencies (tree-shaken from `@codemirror/*`). The built `.js` files are placed in `src-tauri/resources/plugins/core/`. Tauri picks them up via the `resources` bundle config. A new npm script (`build:plugins`) runs the per-plugin Vite builds and is invoked as part of the main `tauri build` pipeline.

The IIFE wrapper convention for base plugins is identical to user plugin convention: the outermost expression must be `(function(api){ ... return pluginObject; })(api)` where `api` is the injected `MarkablePluginAPI`.

**Decision 3 — Override detection**

When loading core plugins, the loader checks whether a same-named `.js` file exists in `plugins/user/`. If it does, the user version is loaded and the core slot shows an "Overridden" badge. The core `.js` file in `plugins/core/` is not evaluated when overridden.

Override matching is by **filename**, not by plugin `id`. A file named `focus-mode.js` in `plugins/user/` overrides `focus-mode.js` in `plugins/core/`. The overriding file may declare a different `id` — the override is purely filesystem-level.

**Decision 4 — Plugin versioning**

Each plugin object must declare `version: string` as a required field. Validation rejects any plugin that does not include a non-empty `version` string. The `version` field is displayed in the Plugins panel detail view. Semver is recommended but not enforced.

**Decision 5 — First-launch vs app-update copy mechanism**

The app stores its own version in a `pluginsCopiedForVersion` key in `settings.json` (a frontend-only key, preserved by the raw-JSON pass-through). On startup:

1. Load settings. Read `pluginsCopiedForVersion` (may be absent on first launch).
2. Read the current app version via the Tauri `app` plugin (`@tauri-apps/api/app` → `getVersion()`).
3. If `pluginsCopiedForVersion !== currentAppVersion`, invoke a new Rust command `copy_core_plugins()` which copies all files from `resources/plugins/core/` into `~/Library/.../plugins/core/`, overwriting any existing files with the same name. Files in `plugins/user/` are not touched.
4. After a successful copy, persist `{ pluginsCopiedForVersion: currentAppVersion }` to settings.

This is a simple version-stamp check. It does not perform per-file version comparison — all core files are overwritten on every app update, which is safe because core files are never user-edited.

**Decision 6 — Migration of existing `plugins/` flat directory**

Existing user plugins sitting in the flat `plugins/` root (the current layout) must be migrated to `plugins/user/` on the first launch after this refactor ships. The `copy_core_plugins` Rust command also performs this one-time migration: before copying core files, it checks whether any `.js` files exist directly in `plugins/` (not in a subdirectory) and moves them to `plugins/user/`. This runs once because after migration the root contains only `core/` and `user/` subdirectories.

**Decision 7 — Vite IIFE build output for core plugins: fully self-contained (U-1 resolved)**

Each core plugin `.js` file bundles its own copy of all `@codemirror/*` dependencies. There is no shared runtime file. Each IIFE is fully self-contained. `@codemirror/*` packages are not listed as externals in the Vite library build config.

Rationale: eliminates load-order complexity entirely. On a native desktop app the size overhead (~50 KB per plugin for `@codemirror/state` etc.) is negligible against the simplicity gain.

**Decision 8 — `removeExtensions` granularity: all-or-nothing per plugin (U-2 resolved)**

`removeExtensions()` takes no arguments and removes all CM6 extensions that the calling plugin registered via `addExtensions`. There is no partial removal. `PluginManager` stores a `Map<string, Extension[]>` (plugin id → array) to reconstruct the compartment after removal.

Rationale: all four current base plugins each contribute a single logical extension set. Partial removal is not needed and reference-equality tracking across plugin calls adds unnecessary complexity.

## Functional Requirements

### FR-1: Unified `MarkablePluginAPI` Interface

Replace `PluginContext` (internal built-in interface) and `UserPluginAPI` (restricted user interface) with a single `MarkablePluginAPI` that all plugins receive at runtime.

Required fields on `MarkablePluginAPI`:

```typescript
export interface MarkablePluginAPI {
  statusBar: {
    left: HTMLElement;
    center: HTMLElement;
    right: HTMLElement;
  };
  ensureStatusBar(): void;
  hideStatusBarIfUnused(): void;
  loadSettings(): Promise<Record<string, unknown> | null>;
  saveSettings(data: Record<string, unknown>): Promise<void>;
  addExtensions(extensions: Extension[]): void;
  removeExtensions(): void;
}
```

`addExtensions` registers extensions for the calling plugin and reconfigures the shared `Compartment`. `removeExtensions` removes **all** extensions previously registered by the calling plugin (all-or-nothing per plugin id) and reconfigures the `Compartment`. Both are no-ops if the editor has not yet been created (will not be called before the editor exists under the new startup sequence).

### FR-2: Unified `MarkablePlugin` Interface

Replace the `MarkablePlugin` (TypeScript built-in contract) and `UserPlugin` (JS runtime contract) with a single interface used for both:

```typescript
export interface MarkablePlugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly detail?: string;
  readonly version: string;
  onEnable(api: MarkablePluginAPI): void | Promise<void>;
  onDisable(api: MarkablePluginAPI): void | Promise<void>;
}
```

Removed from the interface relative to the old `MarkablePlugin`:
- `getExtensions()` — replaced by `addExtensions`/`removeExtensions` calls inside `onEnable`/`onDisable`
- `restoreFromSettings(settings, ctx)` — replaced by a unified restore mechanism in `PluginManager` (FR-5)
- `isEnabled()` — enabled state is now tracked entirely by `PluginManager`, not by each plugin module
- `handlesOwnPersistence` — no longer needed; `PluginManager` handles all persistence uniformly

The `detail` field becomes optional (matching the existing `UserPlugin` convention). The `version` field is new and required.

### FR-3: CM6 Compartment

A single `Compartment` is added to the editor's extension set during `buildExtensions()`. All plugin-contributed CM6 extensions live inside this compartment. On `addExtensions(exts)`, the `PluginManager` stores `exts` keyed by the calling plugin's `id` and dispatches a `Compartment.reconfigure([...allRegisteredExtensions])` effect on the live `EditorView`. On `removeExtensions()` (no argument), the `PluginManager` removes all extensions stored under the calling plugin's `id` and dispatches `Compartment.reconfigure([...remainingExtensions])`.

`PluginManager` maintains a `Map<string, Extension[]>` (plugin id → extension array) so it can reconstruct the full compartment contents on each add or remove call. All-or-nothing removal per plugin id is the only supported granularity — a plugin cannot partially remove individual extensions from its own registered set.

### FR-4: Base Plugin Build Pipeline

A new npm script `build:plugins` builds each of the four existing TypeScript plugins as standalone IIFE files:

- `src/plugins/focus-mode/` → `src-tauri/resources/plugins/core/focus-mode.js`
- `src/plugins/typewriter-mode/` → `src-tauri/resources/plugins/core/typewriter-mode.js`
- `src/plugins/word-count/` → `src-tauri/resources/plugins/core/word-count.js`
- `src/plugins/status-bar/` → `src-tauri/resources/plugins/core/status-bar.js`

Each build uses Vite in library mode with `build.lib.entry` pointed at the plugin's `index.ts` and `build.lib.formats: ['iife']`. The IIFE global name is unused (the loader uses `new Function`, not a global). All `@codemirror/*` dependencies are bundled into the IIFE (not externalized), so the `.js` file is fully self-contained.

The `package.json` `tauri build` script must be updated to run `build:plugins` before `vite build`.

`src-tauri/tauri.conf.json` `bundle.resources` must include `"plugins/core/*"`.

### FR-5: Unified `PluginManager`

`PluginManager` is refactored into a single-tier system:

- One record type (`PluginRecord`) covers both core and user plugins.
- One `load()` method loads plugins from a directory path.
- One `toggle(id, enabled)` method handles both core and user plugins.
- One `getDefinitions()` / `getStates()` covers all plugins.
- Core and user plugins are stored in separate arrays for panel-section rendering, but use the same record type.

`PluginRecord`:

```typescript
interface PluginRecord {
  plugin: MarkablePlugin | null;
  api: MarkablePluginAPI | null;
  filename: string;
  origin: "core" | "user";
  status: "loaded" | "failed" | "missing" | "overridden";
  failReason?: string;
  _enabled: boolean;
}
```

The `"overridden"` status is new: it marks a core plugin slot whose filename has a same-named file in the user directory.

`PluginManager.restoreAll(settings)` — iterates over all loaded (non-failed, non-overridden) records and calls `onEnable(api)` for any plugin whose persisted enabled state is `true`. This is a unified path; there is no separate `restoreUserPlugins` step.

### FR-6: Rust Command — `copy_core_plugins`

New Rust command `copy_core_plugins(app: AppHandle) -> Result<(), String>`:

1. Resolves `resources/plugins/core/` using `app.path().resource_dir()`.
2. Ensures `~/Library/.../plugins/core/` and `~/Library/.../plugins/user/` exist (create if absent).
3. Performs the one-time migration: scans `plugins/` root for any `.js` files at the top level (not in subdirectories). If found, moves each to `plugins/user/`. Logs each moved file.
4. Copies every `.js` file from the resolved resource path into `~/Library/.../plugins/core/`, overwriting existing files (base plugin update).
5. Returns `Ok(())` on success; returns `Err(reason)` if any copy fails (caller treats this as a non-fatal warning — the app continues with whatever partial state resulted).

### FR-7: Settings Persistence for Unified System

Plugin enable/disable state is unified under a single `plugins` key in `settings.json`:

```json
{
  "plugins": {
    "focus-mode": { "enabled": true },
    "typewriter-mode": { "enabled": false },
    "word-count": { "enabled": true },
    "status-bar": { "enabled": true },
    "my-user-plugin": { "enabled": false }
  }
}
```

This replaces both the flat boolean keys used by current built-in plugins (`focusMode: true`, `typewriterMode: false`, etc.) and the `userPlugins` key used by the current user plugin system.

A one-time migration must run at startup: if the old flat boolean keys (`focusMode`, `typewriterMode`, `wordCount`, `statusBar`) or the old `userPlugins` key are present in settings, they are migrated into the new `plugins` structure and the old keys are removed. The migration is performed on the frontend before `restoreAll()` is called.

`MarkableSettings` TypeScript type gains:
```typescript
plugins?: Record<string, { enabled: boolean }>;
```

The old fields (`focusMode?`, `typewriterMode?`, `wordCount?`, `statusBar?: { visible: boolean }`, `userPlugins?`) are kept in the type as deprecated optionals until the migration step removes them at runtime, then they can be removed from the type definition.

### FR-8: Rust Command — `list_core_plugins` and Updated `list_user_plugins`

Two separate Rust commands for directory scanning:

- `list_core_plugins()` — scans `plugins/core/`, returns all `.js` filenames (no cap). Returns `[]` if the directory does not exist (handled by first-launch copy step which runs before this).
- `list_user_plugins()` — updated to scan `plugins/user/` instead of `plugins/` root. Retains the 50-file cap and `{ files, truncated }` response shape. Returns `[]` if `plugins/user/` does not exist.

`read_plugin_file(origin: "core" | "user", filename: string)` — updated signature to accept an `origin` parameter so the path-confinement logic routes to either `plugins/core/` or `plugins/user/` accordingly. The 500 KB size limit and path-traversal guard apply to both origins.

### FR-9: Plugins Panel Updates

The Plugins panel is updated to reflect the unified system:

- "Core Plugins" collapsible section (replaces "Built-in Plugins") — shows base plugins loaded from `plugins/core/`. Overridden entries show an "Overridden" badge and a tooltip or note indicating which user file is overriding it. Overridden core plugin entries are non-toggleable (the user version in the User Plugins section is the active one).
- "User Plugins" collapsible section — unchanged in behavior; shows plugins from `plugins/user/`.
- Plugin detail view shows the `version` field.
- A plugin's panel entry shows version as a secondary label (e.g. `v1.2.0` next to the name).

### FR-10: Authoring Guide Update

`docs/specs/user-plugins/authoring-guide.md` must be updated to document:

- The new unified interface (`MarkablePlugin`, `MarkablePluginAPI`)
- `version` field requirement
- `addExtensions` / `removeExtensions` usage and the rule that extensions added in `onEnable` must be removed in `onDisable`
- The `plugins/user/` directory location (updated from the old flat `plugins/` path)
- Override mechanism: how to override a core plugin by filename
- The retained convention-only sandbox limitation (EC-16 in this document)

---

## Accepted Constraints

- **PC-1**: The unified `MarkablePlugin` interface is required for all plugins. Files that evaluate to a non-conforming object are rejected. `version` is a required field; its absence is a validation error.
- **PC-2**: Plugin `id` values must be unique across all loaded plugins (core + user). A user plugin whose `id` collides with an already-loaded core plugin `id` is rejected. Override is by filename, not by id — a user file overriding a core file by the same filename may have the same or a different `id`; id collision is checked after override resolution.
- **PC-3**: All plugins receive `MarkablePluginAPI`. The raw `EditorView`, `invoke`, `window.__TAURI_INTERNALS__`, and direct CM6 constructs beyond `addExtensions`/`removeExtensions` are not exposed. The convention-only nature of this boundary (same-process WebView) is documented and accepted.
- **PC-4**: File I/O for user plugins (`plugins/user/`) retains all existing guards: path-confinement, 500 KB size limit, UTF-8 validation, path-traversal rejection. Core plugin files (`plugins/core/`) are written only by the Rust copy command, so user-supplied filenames are never used to read core files.
- **PC-5**: Plugin enable/disable state is persisted under the `plugins` key in `settings.json` with a migration from old keys on first run post-upgrade.
- **PC-6**: The `Compartment` shared by all plugins is a single instance managed by `PluginManager`. Plugins do not receive the `Compartment` object directly — they receive only the `addExtensions`/`removeExtensions` façade. `removeExtensions()` takes no arguments and removes all extensions the calling plugin registered. A plugin that calls `addExtensions` in `onEnable` must call `removeExtensions()` in `onDisable`. Failure to do so leaks extensions but does not crash the editor. `PluginManager` tracks extensions per plugin id via a `Map<string, Extension[]>`; individual extension references are never passed back to `removeExtensions`.
- **PC-7**: Maximum 50 user plugins in `plugins/user/` (lexicographic, same as before). Core plugins have no cap.
- **PC-8**: Base plugin `.js` files are built with Vite library mode (IIFE), fully self-contained (all `@codemirror` deps bundled). They must not reference `window.__markable` or any app global — they receive only the `api` parameter.
- **PC-9**: Per-plugin settings (`plugins/<id>/settings.json`) are retained unchanged. The `read_plugin_settings` / `write_plugin_settings` Rust commands continue to operate on a path relative to the `plugins/` root, not `plugins/user/` specifically. Plugin `id` is the key, not the filename.
- **PC-10**: "Reload Plugins" rescans `plugins/user/` only (not `plugins/core/`). Core plugins are loaded once at startup. Already-registered filenames are not re-evaluated on reload (same as before).
- **PC-11**: The `build:plugins` npm script must be a declared prerequisite of `tauri build` so that the bundled core `.js` files are always fresh before packaging.
- **PC-12**: The `copy_core_plugins` Rust command is non-fatal. If it fails (e.g. disk full, permissions error), the app continues with whatever state exists in `plugins/core/`. The error is logged to the console and a non-blocking notification may optionally be shown.

---

## Edge Case Inventory

All items below are mandatory verification items for the Code Reviewer.

| # | Edge Case | Failure Description |
|---|-----------|---------------------|
| EC-1 | `plugins/core/` and `plugins/user/` do not exist on first launch | `copy_core_plugins` creates both directories before copying; `list_user_plugins` autocreates `plugins/user/` if absent (same as before). |
| EC-2 | `copy_core_plugins` Rust resource path cannot be resolved (corrupted app bundle) | Command returns `Err(reason)`; frontend logs a console warning; app continues; core plugins directory may be empty or stale. |
| EC-3 | `copy_core_plugins` fails to copy one file (permission error) | Returns `Err` after the first failure; already-copied files remain; frontend logs warning and continues; partial core plugin set is loaded. |
| EC-4 | User has a `.js` file in the old flat `plugins/` root at migration time | File is moved to `plugins/user/` by the migration step inside `copy_core_plugins`. If the move fails (e.g. name collision in `plugins/user/`), the file is left in place and a warning is logged. |
| EC-5 | `pluginsCopiedForVersion` matches current app version on startup | `copy_core_plugins` is skipped; no files are copied; existing `plugins/core/` contents are used as-is. |
| EC-6 | A core plugin file has been manually deleted from `plugins/core/` and `pluginsCopiedForVersion` matches (so no re-copy occurs) | The missing file is silently skipped during `list_core_plugins`. The Core Plugins panel section shows fewer entries. The plugin's entry in `plugins` settings remains; it is cleaned up only after the next app update that triggers a re-copy. |
| EC-7 | A user `.js` file has the same filename as a core `.js` file | The core plugin slot is marked `"overridden"` and not evaluated. The user file is loaded normally in the User Plugins section. Both are shown in the panel. |
| EC-8 | A user plugin overrides a core plugin but the user file fails validation | The core plugin slot shows `"overridden"` (it is still not loaded). The user plugin shows `"failed"` in the User Plugins section. Neither version of the plugin is active. |
| EC-9 | A plugin file is empty or contains only whitespace | Rejected at evaluation; status set to `"failed"`; warning logged; other plugins load normally. |
| EC-10 | A plugin file contains a syntax error | Caught per-plugin at `new Function` construction time; `"failed"` status; other plugins unaffected. |
| EC-11 | Plugin evaluates without error but does not return a conforming object (missing `version`, `onEnable`, etc.) | Rejected at validation; missing field names included in warning; `"failed"` status. |
| EC-12 | Two plugins (in the same or different directories) declare the same `id` | After override resolution, if two loaded plugins still share an `id`, the second one encountered (lexicographic order within each directory; core before user) is rejected with a collision error. |
| EC-13 | `onEnable` throws synchronously | Exception caught; plugin `_enabled` stays `false`; error logged per-plugin; other plugins unaffected. |
| EC-14 | `onEnable` returns a rejected Promise | Unhandled rejection caught via `try/await`; same outcome as EC-13. |
| EC-15 | `onDisable` throws | Exception caught; `_enabled` forced to `false` via `finally`; error logged; other plugins continue. |
| EC-16 | Plugin calls `addExtensions` in `onEnable` but does not call `removeExtensions()` in `onDisable` | The extensions remain active in the `Compartment` for the session. This is a plugin author bug. The runtime does not detect it. It is documented in the authoring guide as a mandatory contract. |
| EC-17 | Plugin calls `removeExtensions()` when it has not previously called `addExtensions` (nothing registered) | `PluginManager` finds no entry in its `Map` for that plugin id; the `Compartment` is not reconfigured. No-op, no error. |
| EC-18 | `addExtensions` is called from `onEnable` before the editor `Compartment` has been initialized | `addExtensions` must guard: if the `EditorView` does not yet exist, queue the extensions and apply them once the view is available. Under the new startup sequence (`buildExtensions` → `createEditor` → `restoreAll`) this should not occur, but the guard prevents crashes if the call order is ever violated. |
| EC-19 | Path-traversal attempt in user plugin filename (e.g. `../evil.js`) | Rust `read_plugin_file` rejects the filename; plugin not loaded; other plugins unaffected. |
| EC-20 | User plugin file exceeds 500 KB | Rejected before evaluation; warning logged; not registered. |
| EC-21 | User plugin file contains invalid UTF-8 | Rust `read_to_string` error; `"failed"` status; other plugins load normally. |
| EC-22 | Plugin `id` is an empty string or contains invalid characters (`/`, `\`, `.`, NUL) | Rejected at validation; warning logged. |
| EC-23 | "Reload Plugins" is triggered and an already-registered user file is encountered again | Skipped (same as existing EC-21 behavior). |
| EC-24 | "Reload Plugins" is triggered and a previously-failing user file has been corrected on disk | Not re-evaluated (same limitation as existing EC-22). Requires app relaunch. Documented. |
| EC-25 | A user file overrides a core file, then the user file is deleted while the app is running | Core plugin slot remains `"overridden"` for the current session. On next app launch, no override is detected and the core version loads normally. |
| EC-26 | Settings migration: old flat boolean keys (`focusMode`, `wordCount`, etc.) are absent (fresh install or already migrated) | Migration is a no-op; `plugins` key is initialized to `{}` if absent. |
| EC-27 | Settings migration: `userPlugins` key exists from the previous user-plugin system | Entries are merged into `plugins` with the same `enabled` values; `userPlugins` key is removed from settings. |
| EC-28 | Settings migration: both old flat key and `userPlugins` entry exist for the same logical plugin (inconsistent state from partial previous migration) | The `userPlugins` entry takes precedence; the flat key is discarded. |
| EC-29 | `plugins/user/` contains more than 50 `.js` files | Files beyond the cap (lexicographic sort; first 50 loaded) are ignored with `console.warn` listing dropped names. |
| EC-30 | `build:plugins` Vite build fails for one of the four core plugin TypeScript sources | Build is aborted; `tauri build` does not proceed; developer must fix the TypeScript error before packaging. |
| EC-31 | A core plugin `.js` built by `build:plugins` references a CM6 symbol that is not bundled (e.g. `EditorView` used but left as an external) | The plugin will throw a ReferenceError at evaluation time. Caught per-plugin; `"failed"` status. Prevented by ensuring no externals in the Vite library build config. |
| EC-32 | Two different core plugin IIFE builds accidentally share a bundled module instance via a global variable | IIFEs are self-contained and use local closures; no shared global pollution. Verified by the requirement that no IIFE uses a non-`api` global. |
| EC-33 | `per-plugin settings` call (`loadSettings`/`saveSettings`) from a core plugin — `plugins/<id>/settings.json` path uses plugin `id`, not filename | Core plugins should use a stable `id` that does not change. If a core plugin's `id` changes between versions, its settings file becomes orphaned. This is a plugin authoring concern, not a runtime error. Documented in authoring guide. |
| EC-34 | App update copies new core plugin files but `pluginsCopiedForVersion` update fails to persist (crash after copy, before settings write) | On next launch, `pluginsCopiedForVersion` still shows the old version; `copy_core_plugins` runs again and overwrites core files again. Idempotent — no data loss. |

---

## Impact Analysis

### Frontend

| File | Change | Reason |
|------|--------|--------|
| `src/plugins/plugin-types.ts` | Replace `MarkablePlugin` + `PluginContext`; add `MarkablePluginAPI`; remove `UserPlugin`, `UserPluginAPI` | Unified interface |
| `src/plugins/user-plugin-types.ts` | Delete | Superseded by unified `plugin-types.ts` |
| `src/plugins/user-plugin-loader.ts` | Refactor to handle unified `MarkablePlugin` validation (add `version` field check) | Unified validation |
| `src/plugins/index.ts` | Rewrite `PluginManager` as unified single-tier system | Core requirement |
| `src/plugins/focus-mode/index.ts` | Rewrite as IIFE-compatible plugin using `api.addExtensions` / `api.removeExtensions` | Base plugin migration |
| `src/plugins/typewriter-mode/index.ts` | Same as above | Base plugin migration |
| `src/plugins/word-count/index.ts` | Same as above | Base plugin migration |
| `src/plugins/status-bar/index.ts` | Same as above | Base plugin migration |
| `src/plugins/plugins-panel/plugins-panel.ts` | Rename "Built-in" to "Core"; add "Overridden" badge; show `version` in detail view | Panel updates |
| `src/lib/settings.ts` | Add `plugins?: Record<string, { enabled: boolean }>` field; keep deprecated fields as optional for migration | Settings schema |
| `src/main.ts` | Update startup sequence; add `copy_core_plugins` call; add migration step; remove split restore calls | Startup wiring |
| `src/editor/extensions.ts` | Add plugin `Compartment` to extension set | CM6 compartment |
| `src/lib/bridge.ts` | Add `copyCorePlugins()`, `listCorePlugins()` wrappers; update `listUserPlugins()` (path change); update `readPluginFile()` (origin parameter) | New Rust commands |
| `package.json` | Add `build:plugins` script; update `tauri build` to depend on it | Build pipeline |

### Rust

| File | Change | Reason |
|------|--------|--------|
| `src-tauri/src/commands/plugins.rs` | Add `copy_core_plugins`, `list_core_plugins` commands; update `list_user_plugins` path to `plugins/user/`; update `read_plugin_file` with `origin` parameter | New commands + path changes |
| `src-tauri/src/commands/mod.rs` | Re-export new commands | |
| `src-tauri/src/lib.rs` | Register new commands in `generate_handler![]` | |
| `src-tauri/tauri.conf.json` | Add `"plugins/core/*"` to `bundle.resources` | Bundle core plugin files |

### New files

| File | Purpose |
|------|---------|
| `src-tauri/resources/plugins/core/focus-mode.js` | Built output — core plugin |
| `src-tauri/resources/plugins/core/typewriter-mode.js` | Built output — core plugin |
| `src-tauri/resources/plugins/core/word-count.js` | Built output — core plugin |
| `src-tauri/resources/plugins/core/status-bar.js` | Built output — core plugin |
| `vite.plugins.config.ts` (or equivalent) | Vite config for `build:plugins` pipeline |

### Files that do NOT change

- `src/editor/focus-mode.ts`, `typewriter-mode.ts` — the TypeScript source files remain; only the plugin `index.ts` wrapper changes to use `addExtensions`/`removeExtensions`.
- `src-tauri/capabilities/default.json` — no new permissions needed.
- `src-tauri/src/commands/settings.rs`, `themes.rs`, `dialogs.rs`, `io.rs` — no changes.

---

## Resolved Unknowns

All unknowns from the analysis phase have been answered by the user.

**U-1 — Vite build output for core plugins — RESOLVED: fully self-contained IIFEs**

Each plugin `.js` file bundles its own copy of `@codemirror/*`. No shared runtime. See Decision 7.

**U-2 — `removeExtensions` granularity — RESOLVED: all-or-nothing per plugin**

`removeExtensions()` takes no arguments and removes all extensions for the calling plugin. See Decision 8.

---

## Definition of Done

Requirements phase:
- [x] All resolved decisions documented above.
- [x] Edge Case Inventory (EC-1 through EC-34) complete.
- [x] Two Unknowns (U-1, U-2) identified for user input.
- [x] User answers U-1 and U-2.
- [x] User explicitly states: "Requirements approved. Activate Architect."
- [x] This document updated; status set to "Validated."

Implementation phase (for Lead Developer):
- [ ] `build:plugins` script builds all four core plugins as IIFE `.js` files into `src-tauri/resources/plugins/core/`.
- [ ] `tauri.conf.json` includes `"plugins/core/*"` in `bundle.resources`.
- [ ] `copy_core_plugins` Rust command copies core files on version bump; migrates flat `plugins/*.js` to `plugins/user/`.
- [ ] `list_core_plugins` scans `plugins/core/`; `list_user_plugins` scans `plugins/user/`.
- [ ] `read_plugin_file` accepts `origin` parameter and routes to the correct directory.
- [ ] Unified `MarkablePlugin` interface with required `version` field enforced at validation.
- [ ] Unified `MarkablePluginAPI` with `addExtensions`/`removeExtensions` backed by a `Compartment`.
- [ ] Single `PluginManager` with one record type, one toggle method, one restore pass.
- [ ] Override detection: core plugin filename match against user directory; `"overridden"` status.
- [ ] Settings migration from old flat keys + `userPlugins` to `plugins` runs once at startup.
- [ ] All 34 edge cases in the Edge Case Inventory verified by Code Reviewer.
- [ ] Authoring guide updated (FR-10).
- [ ] All existing tests continue to pass; new tests cover EC items.

---

## Decisions Deferred to Architecture Phase

- Exact Vite library mode configuration for the `build:plugins` pipeline (entry points, output directory, no externals — all `@codemirror/*` deps bundled per Decision 7).
- `Compartment` initialization timing relative to `buildExtensions()` call in `extensions.ts` — does the compartment start empty and get populated during `restoreAll`, or does it start populated with the enabled plugins' extensions?
- Whether `buildPluginContext()` / `buildPluginAPI()` in `main.ts` constructs one `MarkablePluginAPI` object shared by all plugins, or a per-plugin instance (relevant for `loadSettings`/`saveSettings` which need the plugin's `id` to construct the correct path).
- Whether the `PluginManager` `Compartment` reference is passed in at construction time (after editor creation) or set via a `setEditor(view)` method called after `createEditor()`.
- Exact startup sequence ordering: `copy_core_plugins` → `list_core_plugins` → `list_user_plugins` → evaluate all → `restoreAll` — the Architect must validate this against the existing `initApp()` flow.
- Whether the four existing TypeScript plugin `index.ts` files are rewritten in-place (source of truth is TypeScript, IIFE is the build output) or replaced by hand-authored JS files (simpler for the build pipeline but loses TypeScript safety).

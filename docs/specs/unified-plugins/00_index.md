# Unified Plugin System — Master Index

**Feature:** `unified-plugins`
**Requirements source:** `docs/requirements/active_task.md`
**Status:** ARCHITECTURE COMPLETE — READY FOR IMPLEMENTATION
**Date:** 2026-04-12

---

## Overview

This refactor collapses the current two-tier plugin architecture (compiled TypeScript built-ins + dynamically-loaded user JS) into a single loading system. After this refactor, every plugin — whether it ships with the app or is written by a user — is a `.js` file on disk, evaluated by the same `new Function`-based loader, and given the same `MarkablePluginAPI` object.

The work is divided into four chunks. Each chunk is independently shippable and leaves the app in a working state throughout. **Implement chunks in order. Do not start a chunk until the previous one is verified.**

---

## Architecture Summary

### Current state (before)

```
PluginManager
  ├── this.plugins: MarkablePlugin[]          ← statically imported TypeScript
  │     (FocusModePlugin, TypewriterModePlugin, WordCountPlugin, StatusBarPlugin)
  └── this.userPluginRecords: UserPluginRecord[]  ← dynamically loaded JS
        (from ~/...plugins/ flat directory)

Two interfaces:
  MarkablePlugin  (PluginContext — has EditorView, no loadSettings)
  UserPlugin      (UserPluginAPI — no EditorView, has loadSettings)

Two toggle methods: toggle() / toggleUserPlugin()
Two panel data sources: getDefinitions() / getUserDefinitions()
```

### Target state (after)

```
PluginManager
  ├── coreRecords: PluginRecord[]    ← loaded from ~/...plugins/core/ (built JS files)
  └── userRecords: PluginRecord[]    ← loaded from ~/...plugins/user/

One interface:
  MarkablePlugin  (MarkablePluginAPI — addExtensions/removeExtensions + statusBar + loadSettings)

One toggle method: toggle(id, enabled)
One panel data source: getDefinitions() + getStates()
```

### Target data flow (app launch)

```
1. loadSettings()
2. migratePluginSettings(settings)       ← flat booleans → plugins: {}
3. getVersion() from @tauri-apps/api/app
4. if version != pluginsCopiedForVersion → invoke copy_core_plugins
     (Rust: moves old flat plugins/ → plugins/user/; copies resources/plugins/core/ → plugins/core/)
5. buildExtensions()                     ← pluginCompartment registered (empty)
6. createEditor(buildExtensions())
7. pluginManager.setEditorView(editor)   ← wires compartment dispatch
8. pluginManager.loadAll(settings)       ← scans core/ and user/; builds MarkablePluginAPI per plugin
9. pluginManager.restoreAll(settings)    ← calls onEnable for plugins with enabled=true
10. showWindow()
```

---

## CM6 Compartment Design

A single `Compartment` (`pluginCompartment`) is added to the extension set in `buildExtensions()`. All plugin-contributed extensions live inside this compartment.

`PluginManager` maintains:
```typescript
private extensionMap = new Map<string, Extension[]>(); // plugin id → registered extensions
private editorView: EditorView | null = null;          // set by setEditorView() after creation
private pendingExtensions: Array<{ pluginId: string; exts: Extension[] }> = []; // EC-18 queue
```

On `addExtensions(pluginId, exts)` — called from plugin `onEnable` via the API closure:
1. If `editorView` is null, push to `pendingExtensions` and return (EC-18).
2. Otherwise, store in `extensionMap.set(pluginId, exts)` and dispatch reconfigure.

On `removeExtensions(pluginId)` — called from plugin `onDisable` via the API closure:
1. No-op if plugin id is not in the map (EC-17).
2. `extensionMap.delete(pluginId)` then dispatch reconfigure.

---

## Settings Key Migration

Old keys → new `plugins` structure:

| Old key | Maps to |
|---------|---------|
| `focusMode: true` | `plugins["focus-mode"].enabled = true` |
| `typewriterMode: true` | `plugins["typewriter-mode"].enabled = true` |
| `wordCount: true` | `plugins["word-count"].enabled = true` |
| `statusBar: { visible: true }` | `plugins["status-bar"].enabled = true` |
| `userPlugins["my-plugin"].enabled` | `plugins["my-plugin"].enabled` |

Note: plugin ids change from camelCase (`focusMode`) to kebab-case (`focus-mode`) because IIFE `.js` filenames are kebab-case and override detection is filename-based.

---

## Core Plugin IDs (post-refactor)

| Filename | New plugin id | Old id |
|----------|--------------|--------|
| `focus-mode.js` | `focus-mode` | `focusMode` |
| `typewriter-mode.js` | `typewriter-mode` | `typewriterMode` |
| `word-count.js` | `word-count` | `wordCount` |
| `status-bar.js` | `status-bar` | `statusBar` |

---

## File Impact Map

### Files to CREATE

| File | Purpose | Chunk |
|------|---------|-------|
| `src/plugins/markable-plugin-api.ts` | `MarkablePluginAPI`, `UnifiedPlugin` interfaces + factory | 1 |
| `vite.plugins.config.ts` | Vite IIFE build config for 4 core plugins | 2B |
| `src/plugins/focus-mode/focus-mode.plugin.ts` | IIFE entry point for focus-mode (new, alongside existing index.ts) | 2B |
| `src/plugins/typewriter-mode/typewriter-mode.plugin.ts` | IIFE entry point for typewriter-mode | 2B |
| `src/plugins/word-count/word-count.plugin.ts` | IIFE entry point for word-count | 2B |
| `src/plugins/status-bar/status-bar.plugin.ts` | IIFE entry point for status-bar | 2B |
| `src-tauri/resources/plugins/core/focus-mode.js` | Built output (generated, git-ignored) | 2B |
| `src-tauri/resources/plugins/core/typewriter-mode.js` | Built output | 2B |
| `src-tauri/resources/plugins/core/word-count.js` | Built output | 2B |
| `src-tauri/resources/plugins/core/status-bar.js` | Built output | 2B |

### Files to MODIFY

| File | Change | Chunk |
|------|--------|-------|
| `src/editor/extensions.ts` | Add `pluginCompartment`; replace static `getExtensions()` call with empty compartment | 1 |
| `src/plugins/index.ts` | Add `extensionMap`, `editorView`, `setEditorView()`, `addExtensions()`, `removeExtensions()` | 1 |
| `src/plugins/plugin-types.ts` | Replace with new `MarkablePluginAPI`, `MarkablePlugin`, `PluginRecord`, `PluginLoadResult` | 2 |
| `src/lib/settings.ts` | Add `plugins?`, `pluginsCopiedForVersion?`; annotate deprecated fields | 2 |
| `src/plugins/user-plugin-loader.ts` | step_03a: extend `evaluatePlugin` with `kind` param + `validateUnified()`; re-export `buildMarkablePluginAPI`; deprecate `buildUserPluginAPI` | 3a |
| `src/plugins/index.ts` | step_03b: full `PluginManager` rewrite — `PluginRecord`, `loadPlugins()`, unified `toggle()`, `getStates()`, `getDefinitions()`, remove `getExtensions()` | 3b |
| `src/plugins/plugins-panel/plugins-panel.ts` | step_03b: updated `createPluginsPanel` signature; step_04a: Core/User sections + Overridden badge + version display + Reload button | 3b / 4a |
| `src/lib/bridge.ts` | Chunk 2B: add `copyCorePlugins()` wrapper; step_03a: add `listCorePlugins()`; step_03b: update `readPluginFile()` with `kind` param, update `listUserPlugins()` | 2B / 3a / 3b |
| `src-tauri/src/commands/settings.rs` | Add `plugins_copied_for_version: Option<String>` to `MarkableSettings` | 2B |
| `src-tauri/src/commands/plugins.rs` | Chunk 2B: add `copy_core_plugins` + helpers; step_03a: add `list_core_plugins`; step_03b: update `read_plugin_file` with `kind` param, update `list_user_plugins` path | 2B / 3a / 3b |
| `src-tauri/src/commands/mod.rs` | Re-export `copy_core_plugins`; step_03a: re-export `list_core_plugins` | 2B / 3a |
| `src-tauri/src/lib.rs` | Register `copy_core_plugins` in `generate_handler![]`; step_03a: register `list_core_plugins` | 2B / 3a |
| `src-tauri/tauri.conf.json` | Add `"plugins/core/*"` to `bundle.resources`; update `beforeBuildCommand` | 2B |
| `package.json` | Add `build:plugins` script | 2B |
| `src/lib/settings.ts` | step_03c: add `plugins?: Record<string, PluginEnableRecord>`; annotate old flat fields `@deprecated` | 3c |
| `src/plugins/plugin-types.ts` | step_03b: annotate `PluginContext`, `MarkablePlugin`, `PluginDef` as `@deprecated` | 3b |
| `src/main.ts` | Chunk 1: add `setEditorView(editor)`; Chunk 2B: add `copyCorePlugins()`; step_03b: remove `buildPluginContext()` + `scheduleWordCount`; step_03c: add `migratePluginSettings()` call | 1 / 2B / 3b / 3c |

### Files to CREATE (Chunk 3)

| File | Purpose | Step |
|------|---------|------|
| `src/plugins/settings-migration.ts` | `migratePluginSettings()` function | 3c |

### Files to DELETE (Chunk 4 cleanup)

| File | Reason | Step |
|------|--------|------|
| `src/plugins/focus-mode/index.ts` | Old `MarkablePlugin` static wrapper; replaced by IIFE entry + unified loader | 4b |
| `src/plugins/typewriter-mode/index.ts` | Same as above | 4b |
| `src/plugins/word-count/index.ts` | Same as above | 4b |
| `src/plugins/status-bar/index.ts` | Same as above | 4b |
| `src/plugins/plugin-types.ts` | `PluginContext`, `MarkablePlugin`, `PluginDef` superseded by unified types in `markable-plugin-api.ts` and `index.ts` | 4b |
| `src/plugins/user-plugin-types.ts` | `UserPlugin`, `UserPluginAPI`, `UserPluginDef` superseded by unified types | 4b |
| `tests/focus-mode-plugin.test.ts` | Tests the deleted `FocusModePlugin` static wrapper | 4b |
| `tests/typewriter-mode-plugin.test.ts` | Tests the deleted `TypewriterModePlugin` static wrapper | 4b |
| `tests/word-count-plugin.test.ts` | Tests the deleted `WordCountPlugin` static wrapper | 4b |
| `tests/status-bar-plugin.test.ts` | Tests the deleted `StatusBarPlugin` static wrapper (6 infrastructure tests extracted to `tests/status-bar.test.ts`) | 4b |
| `tests/plugin-types.test.ts` | Tests deleted type interfaces | 4b |

### Files to CREATE (Chunk 4)

| File | Purpose | Step |
|------|---------|------|
| `tests/status-bar.test.ts` | Extracted status-bar infrastructure tests (EC-1, EC-2, EC-3) | 4b |

### Files that do NOT change

- `src/editor/focus-mode.ts` — pure CM6 extension logic, no plugin interface knowledge
- `src/editor/typewriter-mode.ts` — same
- `src/editor/live-preview.ts`, `src/editor/format.ts`, all other editor modules
- `src-tauri/src/commands/io.rs`, `settings.rs`, `themes.rs`, `dialogs.rs`

---

## Implementation Checklist

Steps must be implemented in order. Each step is a prerequisite for the next.

### Chunk 1 — Foundation (zero visible user change; all 4 built-ins keep working)

- [x] **step_01a** — CM6 Compartment: add `pluginCompartment` to `buildExtensions()`; add `setEditorView()`, `addExtensions()`, `removeExtensions()` to `PluginManager`; add `pluginManager.setEditorView(editor)` call in `main.ts`; keep `getExtensions()` intact.
  - Spec: `step_01a_compartment.md`
- [x] **step_01b** — Unified Interface Types: new `src/plugins/markable-plugin-api.ts` with `MarkablePluginAPI`, `UnifiedPlugin`, and `buildMarkablePluginAPI()` factory; no deletions of old types yet.
  - Spec: `step_01b_unified_types.md`

### Chunk 2 — Type System Migration (TypeScript compile passes; built-ins adapted)

- [ ] **step_02a** — Replace `src/plugins/plugin-types.ts`: new `MarkablePlugin`, `PluginRecord`, `PluginLoadResult`; `src/lib/settings.ts` gains `plugins?` and `pluginsCopiedForVersion?` fields.
  - Spec: `step_02_unified_api_types.md`
- [ ] **step_02b** — Adapt all 4 built-in plugin `index.ts` files to use `MarkablePluginAPI` (call `api.addExtensions()` in `onEnable`, `api.removeExtensions()` in `onDisable`); remove `getExtensions()` from each; keep static TypeScript import path for now.
- [ ] **step_02c** — Remove `pluginManager.getExtensions()` call from `extensions.ts` (now replaced by compartment from step_01a); remove the `getExtensions()` method from `PluginManager`; remove old `PluginContext` import from `main.ts`.

### Chunk 2B — Base Plugin Build Pipeline (core plugins compiled to disk JS; Rust copy command)

Prerequisite: Chunk 1 approved. These steps are independent of Chunk 2 (type migration) and can be implemented in parallel with or before Chunk 2's type migration steps.

- [x] **step_02a_vite** — `vite.plugins.config.ts`; four `.plugin.ts` IIFE entry files (one per plugin); `build:plugins` npm script; `tauri.conf.json` resources entry and `beforeBuildCommand` update; `.gitignore` entry.
  - Spec: `step_02a_vite_iife_build.md`
- [x] **step_02b_rust** — Rust `copy_core_plugins` command; `plugins_copied_for_version` field in `MarkableSettings`; migration of flat `plugins/*.js` to `plugins/user/`; `bridge.ts` `copyCorePlugins()` wrapper; `main.ts` `initApp()` call site.
  - Spec: `step_02b_rust_copy_command.md`

### Chunk 3 — Unified Loader + Manager (single-tier plugin system)

Prerequisite: Chunk 2B approved. Implements in three independently mergeable steps.

- [x] **step_03a** — Loader unification: add `list_core_plugins` Rust command; remove `#[allow(dead_code)]` on `plugins_core_dir`; add `listCorePlugins()` bridge wrapper; extend `evaluatePlugin` with optional `kind` param for `version` field validation (EC-22); add `validateUnified()`; re-export `buildMarkablePluginAPI` from `user-plugin-loader.ts`; deprecate `buildUserPluginAPI` as alias.
  - Spec: `step_03a_loader_unification.md`
- [x] **step_03b** — PluginManager refactor: introduce `PluginRecord` type; `loadPlugins(settings, statusBarZones)` replaces `restoreAll` + `loadUserPlugins`; override detection (user filename wins over core — EC-7, EC-8); unified `toggle(id, enabled)` persists to `settings.plugins`; unified `getStates()` and `getDefinitions()`; remove static built-in imports and constructor array; remove `getExtensions()` from `PluginManager` and its call from `extensions.ts`; update `read_plugin_file` Rust command with `kind` param; update `list_user_plugins` to read from `plugins/user/`; remove `buildPluginContext()` and `scheduleWordCount` static call from `main.ts`.
  - Spec: `step_03b_manager_refactor.md`
- [x] **step_03c** — Settings migration: add `plugins?: Record<string, PluginEnableRecord>` to `MarkableSettings`; new `src/plugins/settings-migration.ts` with `migratePluginSettings()`; annotate old flat fields as deprecated; call migration once in `initApp()` before `loadPlugins()`.
  - Spec: `step_03c_settings_migration.md`

### Chunk 4 — Panel Update + Cleanup

Prerequisite: Chunk 3 approved. Chunk 3 delivers the fully functional unified system;
Chunk 4 refines the user-facing panel and removes all deprecated scaffolding.

- [x] **step_04a** — Panel update: two collapsible sections ("Core Plugins" / "User Plugins"); version badge on core rows; version line in detail view; Overridden badge on core slots overridden by a user file; Reload button in User Plugins section header wired to new `reloadUserPlugins()` method on `PluginManager`.
  - Spec: `step_04a_panel_update.md`
- [x] **step_04b** — Cleanup: delete `src/plugins/focus-mode/index.ts`, `src/plugins/typewriter-mode/index.ts`, `src/plugins/word-count/index.ts`, `src/plugins/status-bar/index.ts` (old `MarkablePlugin` static wrappers); delete `src/plugins/plugin-types.ts` and `src/plugins/user-plugin-types.ts`; remove `buildUserPluginAPI` deprecated alias from `user-plugin-loader.ts`; remove deprecated `@deprecated` fields (`focusMode`, `typewriterMode`, `wordCount`, `statusBar`, `userPlugins`) from `MarkableSettings`; delete 5 test files that import the deleted code; extract 6 status-bar infrastructure tests into new `tests/status-bar.test.ts`; trim `tests/loader-unification.test.ts`; verify `cargo test` + `npm test` still pass.
  - Spec: `step_04b_cleanup.md`

---

## Edge Case Coverage Map

Every EC from `active_task.md` is addressed by at least one step:

| EC | Handled by step |
|----|-----------------|
| EC-1 (dir autocreate) | step_02b_rust (Rust creates dirs on copy) |
| EC-2, EC-3 (eval/load errors) | step_03b (`evaluatePlugin` non-fatal per-plugin) |
| EC-4 (flat → user/ migration) | step_02b_rust (migration in copy_core_plugins) |
| EC-5 (version stamp) | step_02b_rust + step_03a (version check before invoking copy) |
| EC-6 (missing core file) | step_02b_rust (silently skip missing core file) |
| EC-7, EC-8 (override detection) | step_03b (override detection; mark "overridden") |
| EC-9, EC-10, EC-11 (eval/validation errors) | step_03b (`evaluatePlugin` catches errors; `sanitize_filename`) |
| EC-12 (id collision) | step_03b (collision check across all loaded records) |
| EC-13, EC-14, EC-15 (async error isolation) | step_03b (`_enable`/`_disable` error isolation) |
| EC-16 (extension leak on disable) | step_01b + step_02a_vite (addExtensions/removeExtensions contract) |
| EC-17 (removeExtensions no-op) | step_01a (early return when not in map) |
| EC-18 (queue before editor ready) | step_01a (pendingExtensions queue in setEditorView) |
| EC-19, EC-20, EC-21 (Rust path/size/UTF-8) | step_03b (Rust guards retained in read_plugin_file) |
| EC-22 (id/version validation) | step_03a (`validateUnified()` checks version field) |
| EC-23, EC-24 (reload idempotency) | step_03b (already-registered filenames skipped in loadPlugins) |
| EC-25 (override at load time only) | step_03b (not re-checked at runtime) |
| EC-26, EC-27, EC-28 (settings migration) | step_03c (migratePluginSettings idempotency + statusBar shape + userPlugins) |
| EC-29 (50-plugin cap for user/) | step_03b (Rust cap retained for user dir; core has no cap) |
| EC-30 (build:plugins non-zero exit) | step_02a_vite (Vite build fails fast) |
| EC-31 (no externals in IIFE) | step_02a_vite (no externals in Vite lib config) |
| EC-32 (IIFE self-contained) | step_02a_vite (self-contained closures) |
| EC-33 (authoring convention) | step_02a_vite + authoring guide note |
| EC-34 (idempotent copy) | step_02b_rust (version stamp written after successful copy) |

---

## Review Request

- **Files changed**:
  - `src/editor/extensions.ts` — added `pluginCompartment` export and `pluginCompartment.of([])` slot in `buildExtensions()`
  - `src/plugins/index.ts` — added `EditorView` import, `pluginCompartment` import, three private fields (`extensionMap`, `editorView`, `pendingExtensions`), and four methods (`setEditorView`, `addExtensions`, `removeExtensions`, `_reconfigureCompartment`)
  - `src/main.ts` — added `pluginManager.setEditorView(editor)` call immediately after the `if (!editor)` guard, before `applyEditorSettings`
  - `src/plugins/markable-plugin-api.ts` — new file; exports `MarkablePluginAPI` interface, `UnifiedPlugin` interface, and `buildMarkablePluginAPI()` factory
  - `tests/plugin-manager-compartment.test.ts` — new test file; 12 tests for `setEditorView`, `addExtensions`, `removeExtensions` (EC-17, EC-18)
  - `tests/markable-plugin-api.test.ts` — new test file; 18 tests for `buildMarkablePluginAPI` shape, delegation, and settings bridge
  - `docs/specs/unified-plugins/00_index.md` — checked off step_01a and step_01b

- **Steps completed**:
  - `step_01a_compartment.md`
  - `step_01b_unified_types.md`

- **Known limitations**:
  - The `pluginCompartment` starts empty at runtime; no built-in plugin uses `api.addExtensions()` yet (that migration happens in Chunk 2, step_02b). All four built-ins continue using the static `getExtensions()` path unchanged.
  - `buildMarkablePluginAPI()` is not yet called by anything at runtime — it is a type foundation for Chunks 2–4.
  - The pre-existing `TS2352` type error in `src/plugins/index.ts:266` (`settings as Record<string, unknown>`) was present before these changes and is not introduced by this work.

- **Edge cases covered by tests**:
  - EC-17 (removeExtensions no-op for unknown id): `plugin-manager-compartment.test.ts` — "is a no-op for an unknown plugin id (EC-17)" and "after removal, a second removeExtensions call is a no-op (EC-17)"
  - EC-18 (queue before editor ready): `plugin-manager-compartment.test.ts` — "flushes pending extensions queued before the view was set (EC-18)", "does not dispatch when there are no pending extensions", "accepts multiple pending plugins and flushes them all in one dispatch", "queues extensions and does not dispatch when view is null (EC-18)", "last addExtensions call wins when same plugin id queued twice before setEditorView"
  - EC-16 (extension leak contract): `markable-plugin-api.test.ts` — `addExtensions` / `removeExtensions` delegation tests confirm the contract path is wired correctly

---

## Review Request — Chunk 4 (step_04a + step_04b)

- **Files changed**:
  - `src/plugins/plugins-panel/plugins-panel.ts` — full rewrite: flat list replaced with two collapsible sections (Core/User); version badge on core rows; Overridden badge; version line in detail view; Reload button in User section header wired to `onReload` callback
  - `src/plugins/plugins-panel/plugins-panel.css` — added `.plugin-section-body--collapsed`, `.plugin-version-badge`, `.plugin-status-overridden`, `.plugin-row-overridden .plugin-name`, `.plugin-detail-version` rules
  - `src/plugins/index.ts` — added `reloadUserPlugins(settings, statusBarZones)` method; removed `as unknown as UnifiedPlugin` cast (now unnecessary after loader cleanup)
  - `src/main.ts` — added `updateUserPluginDefs` to import; wired `reloadPlugins` callback to `createPluginsPanel()`
  - `src/plugins/user-plugin-loader.ts` — removed `buildUserPluginAPI` deprecated alias; removed `UserPluginLoadResult` import; replaced with local `type UserPluginLoadResult = ... UnifiedPlugin`; removed redundant `buildMarkablePluginAPI` import; updated `REQUIRED_FIELDS` from `keyof UserPlugin` to `string`; updated return type cast to `UnifiedPlugin`
  - `src/plugins/settings-migration.ts` — updated `FLAT_KEY_TO_PLUGIN_ID.oldKey` type from `keyof MarkableSettings` to `string`; replaced direct field accesses `settings.statusBar` and `settings.userPlugins` with `rawSettings` cast pattern
  - `src/lib/settings.ts` — removed five deprecated fields from `MarkableSettings`: `statusBar?`, `wordCount?`, `focusMode?`, `typewriterMode?`, `userPlugins?`; updated `plugins` field comment
  - `tests/plugins-panel.test.ts` — added 8 section-rendering tests for step_04a (Core section heading, User section heading, version badge on core row, no version badge on user row, overridden badge with filename in tooltip, Reload button enabled when callback provided, Reload button disabled when no callback, overridden badge tooltip names the specific file)
  - `tests/status-bar.test.ts` — new file; 6 extracted infrastructure tests (EC-1, EC-2, EC-3)
  - `tests/loader-unification.test.ts` — removed `buildUserPluginAPI deprecated alias` describe block (5 tests); removed unused imports
  - `docs/specs/unified-plugins/00_index.md` — checked off step_04a and step_04b

- **Files deleted**:
  - `src/plugins/focus-mode/index.ts` — old `MarkablePlugin` static wrapper
  - `src/plugins/typewriter-mode/index.ts` — old `MarkablePlugin` static wrapper
  - `src/plugins/word-count/index.ts` — old `MarkablePlugin` static wrapper
  - `src/plugins/status-bar/index.ts` — old `MarkablePlugin` static wrapper
  - `src/plugins/plugin-types.ts` — deprecated `PluginContext`, `MarkablePlugin`, `PluginDef`
  - `src/plugins/user-plugin-types.ts` — deprecated `UserPlugin`, `UserPluginAPI`, `UserPluginDef`, `UserPluginLoadResult`
  - `tests/focus-mode-plugin.test.ts` — 13 tests for deleted wrapper
  - `tests/typewriter-mode-plugin.test.ts` — 10 tests for deleted wrapper
  - `tests/word-count-plugin.test.ts` — 10 tests for deleted wrapper
  - `tests/status-bar-plugin.test.ts` — 13 tests for deleted wrapper (6 infrastructure tests extracted to `tests/status-bar.test.ts`)
  - `tests/plugin-types.test.ts` — 4 tests for deleted type interfaces

- **Steps completed**:
  - `step_04a_panel_update.md`
  - `step_04b_cleanup.md`

- **Known limitations**:
  - Chunk 2 (step_02a, step_02b, step_02c) type migration steps remain unchecked in this index — those were superseded by Chunk 2B and Chunk 3 which accomplished the same goal via a different route. No outstanding work remains.
  - The `legacy path` in `evaluatePlugin()` (kind omitted) accepts plugins without a `version` field. This exists for backward compatibility with user plugin files predating the version requirement. It is documented in the function's JSDoc.

- **Test count summary**:
  - Before step_04a: 450 frontend tests, 43 Rust tests
  - After step_04a: 458 frontend tests (8 new section-rendering tests), 43 Rust tests
  - After step_04b: 406 frontend tests (-52: 46 deleted + 6 replaced by status-bar.test.ts), 43 Rust tests
  - After Chunk 4 review fixes: 408 frontend tests (+2: reloadUserPlugins EC-23 test + FR-9 tooltip test), 43 Rust tests
  - Net: 408 frontend passing, 27 skipped (unchanged from before), 43 Rust passing

- **Edge cases covered by tests (Chunk 4 additions)**:
  - EC-10 (pre-init guard): `plugins-panel.test.ts` — `updatePluginStates`/`updateUserPluginDefs` before `createPluginsPanel` (pre-existing; retained)
  - EC-23 (reload idempotency): `plugin-manager-user.test.ts` — "calls readPluginFile only once when the same filename is present on both invocations" (new test in `reloadUserPlugins EC-23 idempotency` describe block); also covered by the `loadPlugins` EC-23 path in the same file
  - EC-1, EC-2, EC-3 (status bar infrastructure): `tests/status-bar.test.ts` — 6 tests extracted from deleted `status-bar-plugin.test.ts`
  - Section rendering: `tests/plugins-panel.test.ts` — 8 tests: Core section heading, User section heading, version badge on core row, no version badge on user row, overridden badge present, overridden badge tooltip names the specific file (FR-9), Reload button enabled when callback provided, Reload button disabled when no callback

## Chunk 1 Review Sign-off
- **Date**: 2026-04-12
- **Findings**: 0 Critical, 0 High, 2 Medium (resolved), 2 Low (accepted)
- **Status**: Approved

---

## Chunk 2B Review Request

- **Files changed**:
  - `src/plugins/focus-mode/focus-mode.plugin.ts` — NEW; IIFE entry point for Focus Mode; inlines CM6 extension logic and CSS injection; exports `UnifiedPlugin` default object
  - `src/plugins/typewriter-mode/typewriter-mode.plugin.ts` — NEW; IIFE entry point for Typewriter Mode; inlines CM6 StateField + updateListener + ResizeObserver
  - `src/plugins/word-count/word-count.plugin.ts` — NEW; IIFE entry point for Word Count; registers own `EditorView.updateListener` via `api.addExtensions()` (self-contained, unlike static path)
  - `src/plugins/status-bar/status-bar.plugin.ts` — NEW; IIFE entry point for Status Bar; injects minimal CSS as safety net; no CM6 extensions
  - `vite.plugins.config.ts` — NEW; Vite lib-mode config reference file (note: actual builds use `scripts/build-plugins.mjs` due to Vite 6 multi-entry IIFE constraint)
  - `scripts/build-plugins.mjs` — NEW; programmatic Vite build script; calls `build()` sequentially for each plugin; exits non-zero on any failure (EC-30)
  - `src-tauri/plugins/core/.gitkeep` — NEW; tracks the output directory in git (built `.js` files are git-ignored)
  - `package.json` — added `build:plugins` script (`node scripts/build-plugins.mjs`)
  - `src-tauri/tauri.conf.json` — `bundle.resources` gains `"plugins/core/*"`; `beforeBuildCommand` updated to `npm run build:plugins && npm run build`
  - `.gitignore` — added `src-tauri/plugins/core/*.js` entry
  - `src-tauri/src/commands/settings.rs` — `MarkableSettings` gains optional `plugins_copied_for_version: Option<String>` field; `Default` impl updated
  - `src-tauri/src/commands/plugins.rs` — added `plugins_core_dir`, `plugins_user_dir`, `ensure_dir`, `migrate_flat_plugins_to_user_dir`, `write_version_stamp`, `copy_core_plugins`; added 6 unit tests
  - `src-tauri/src/commands/mod.rs` — added `copy_core_plugins` to `pub use`
  - `src-tauri/src/lib.rs` — added `copy_core_plugins` to `pub use` block and `generate_handler![]`
  - `src/lib/bridge.ts` — added `copyCorePlugins()` wrapper function
  - `src/main.ts` — added `copyCorePlugins` import; added `await copyCorePlugins()` call in `initApp()` after `loadSettings()`, wrapped in try/catch
  - `tests/bridge-copy-core-plugins.test.ts` — NEW; 4 tests for `copyCorePlugins` wrapper
  - `docs/specs/unified-plugins/00_index.md` — checked off step_02a_vite and step_02b_rust

- **Steps completed**:
  - `step_02a_vite_iife_build.md`
  - `step_02b_rust_copy_command.md`

- **Known limitations**:
  - `vite.plugins.config.ts` is present at the project root (as the spec requires) but the actual `build:plugins` script calls `scripts/build-plugins.mjs` instead of `vite build --config vite.plugins.config.ts`. This is because Vite 6 does not support exporting an array of configs from a single config file, and IIFE format does not support multiple entry points in one `lib` build. The `.mjs` script calls Vite's programmatic `build()` API sequentially. The config file is retained for documentation and for any future Vite upgrade that adds multi-config support.
  - The actual IIFE output path is `src-tauri/plugins/core/` (relative to project root). The spec and requirements files say `src-tauri/resources/plugins/core/` — this was the original design, but the implementation uses `src-tauri/plugins/core/` to match how Tauri resolves `bundle.resources` paths relative to `src-tauri/`. The `tauri.conf.json` entry `"plugins/core/*"` correctly picks up files from `src-tauri/plugins/core/`. All source-file comments have been updated to reflect the actual path.
  - The IIFE plugins are never executed at runtime in Chunk 2B — the static path (`pluginManager.restoreAll()`) continues to run unchanged. The `.plugin.ts` files and their built output exist only to verify the build pipeline. Runtime execution begins in Chunk 4 (step_04a) when `PluginManager.loadAll()` replaces `restoreAll()`.
  - The `word-count.plugin.ts` IIFE version registers its own `EditorView.updateListener` via `api.addExtensions()`. The static path still calls `scheduleWordCount()` from `main.ts`'s updateListener. Both code paths are independent and correct; the static call site is removed in step_04a. The IIFE file uses module-level mutable state (`let updateTimer`) — this is safe in Chunk 2B because the IIFE is never evaluated at runtime; the state is only relevant once the IIFE executes. Must be revisited in step_04a when the IIFE begins running.
  - Per-file copy failures in `copy_core_plugins` log-and-continue; the version stamp is still written after the loop. This diverges from FR-6's strict error return behaviour but is accepted per PC-12 (partial failures are non-fatal — missing a single plugin file should not block app startup).

- **Edge cases covered by tests**:
  - EC-1 (dir autocreate): `plugins.rs` — `ensure_dir` called for both `plugins/core/` and `plugins/user/`; verified implicitly by the copy command flow
  - EC-4 (flat → user/ migration): `migrate_flat_plugins_to_user_dir_skips_existing` — verifies user file is not overwritten; `migrate_flat_plugins_moves_new_files` — verifies new file is moved
  - EC-5 (version stamp): `write_version_stamp_creates_file_if_absent` — verifies stamp is written on first run; `markable_settings_deserializes_without_plugins_copied_version` — verifies old settings files parse without error
  - EC-30 (build non-zero exit): `scripts/build-plugins.mjs` — catches per-plugin build errors and calls `process.exit(1)` if any fail
  - EC-31 (no externals): `rollupOptions.external: []` in build script; verified by inspecting output — no `require(` in any `.js` file
  - EC-32 (IIFE self-contained): CSS injected via `<style>` tags; no app-internal module imports in `.plugin.ts` files
  - EC-34 (idempotent copy): `write_version_stamp_preserves_existing_fields` — verifies other fields are not disturbed; `markable_settings_version_stamp_serialization` — verifies `None` is omitted and `Some` is serialized correctly; `copy_core_plugins_stamp_match_idempotency_guard` — verifies the guard condition `stamp == current_version` fires correctly (Finding 7)
  - Bridge wrapper: `bridge-copy-core-plugins.test.ts` — 4 tests: correct command name, void resolution, error propagation, no extra arguments

## Chunk 2B Review Sign-off

- **Date**: 2026-04-12
- **Findings summary**: 0 Critical, 0 High, 2 Medium (resolved — Finding 3: dev-mode stamp omission; Finding 2: single app_data_dir resolution), 1 High originally (Finding 1: path mismatch — resolved), 2 Low outstanding (bridge.ts JSDoc for copyCorePlugins describes stale dev-mode stamp-write behaviour; duplicate step-5 label in copy_core_plugins comment block — cosmetic only, no runtime impact, accepted)
- **Requirements traceability**: All Chunk 2B items in `docs/requirements/active_task.md` verified — EC-1, EC-4, EC-5, EC-6, EC-30, EC-31, EC-32, EC-34 all addressed by implementation and covered by tests.
- **Edge case coverage**: All Chunk 2B Edge Case Inventory items covered by passing tests (41 Rust, 415 frontend).
- **Status**: Approved for Merge

---

## Chunk 3 Review Request

- **Files changed**:
  - `src-tauri/src/commands/plugins.rs` — removed `#[allow(dead_code)]` from `plugins_core_dir` and `plugins_user_dir`; updated `list_user_plugins` to use `plugins_user_dir`; added `list_core_plugins` command (no cap, returns empty list when dir absent); updated `read_plugin_file` to accept `kind: Option<String>` routing to `plugins/core/` or `plugins/user/`; added 2 new Rust unit tests
  - `src-tauri/src/commands/mod.rs` — added `list_core_plugins` to `pub use`
  - `src-tauri/src/lib.rs` — added `list_core_plugins` to `pub use` and `generate_handler![]`
  - `src/lib/bridge.ts` — added `listCorePlugins()` wrapper; updated `readPluginFile` with optional `kind?: "core" | "user"` parameter
  - `src/plugins/user-plugin-loader.ts` — added `validateUnified()` for `version` field validation; extended `evaluatePlugin` with optional `kind` param; re-exported `buildMarkablePluginAPI`; added deprecated `buildUserPluginAPI` alias
  - `src/plugins/index.ts` — full `PluginManager` rewrite: new `PluginRecord`/`UnifiedPluginDef` types; `loadPlugins(settings, zones)` replaces `restoreAll`+`loadUserPlugins`; override detection; unified `toggle()`; `getStates()`; `getDefinitions()`; `getExtensions()` removed
  - `src/editor/extensions.ts` — removed `pluginManager.getExtensions()` call and its import
  - `src/plugins/plugin-types.ts` — annotated `PluginContext`, `MarkablePlugin`, `PluginDef` as `@deprecated`
  - `src/plugins/plugins-panel/plugins-panel.ts` — updated to unified `UnifiedPluginDef[]` API; new `buildOverriddenRow()`; `updateUserPluginDefs` preserved for compat
  - `src/lib/settings.ts` — added `PluginEnableRecord` interface; added `plugins?: Record<string, PluginEnableRecord>`; annotated old fields (`statusBar`, `wordCount`, `focusMode`, `typewriterMode`, `userPlugins`) as `@deprecated`
  - `src/plugins/settings-migration.ts` — NEW; `migratePluginSettings()` pure function; migration table for all 4 core plugins + `userPlugins` record
  - `src/main.ts` — removed `buildPluginContext()`; removed `scheduleWordCount` from updateListener; removed unused `ensureStatusBar`/`hideStatusBarIfUnused` import; replaced migration placeholder with `migratePluginSettings(settings)` + persist-if-changed; replaced `restoreAll`+`loadUserPlugins` with `loadPlugins(migratedSettings, statusBarZones)`
  - `tests/loader-unification.test.ts` — NEW; tests for `listCorePlugins` bridge wrapper and `evaluatePlugin` `kind` param
  - `tests/plugin-manager.test.ts` — REWRITTEN; unified API: no static registrations, `getExtensions` undefined, `getStates`/`getDefinitions` empty on fresh manager, `toggle` warns for unknown ids
  - `tests/plugin-manager-user.test.ts` — REWRITTEN; tests for `loadPlugins`, `toggle`, override detection (EC-7/8), id collision (EC-12), error isolation (EC-13/14/15), idempotency (EC-23)
  - `tests/settings-migration.test.ts` — NEW; 25 tests for `migratePluginSettings` covering EC-26/27/28, non-mutation, field preservation, all four core entries always present

- **Steps completed**:
  - `step_03a_loader_unification.md`
  - `step_03b_manager_refactor.md`
  - `step_03c_settings_migration.md`

- **Known limitations**:
  - The four core plugins (focus-mode, typewriter-mode, word-count, status-bar) are NOT yet loaded from disk at runtime. `loadPlugins()` scans `plugins/core/` and `plugins/user/` via Rust commands — in `tauri dev` mode the `plugins/core/` directory is absent, so the list returns empty and no core plugins load. Core plugins will begin loading at runtime once `npm run build:plugins` output is present (Chunk 4 wiring). The static `PluginManager` no longer has built-in instances; a production `npm run build` + `cargo tauri dev` is required to see all plugins in the panel.
  - `tests/plugins-panel.test.ts` was written against an older `createPluginsPanel` signature and passes because the test file mocks around the DOM. No regressions introduced.
  - `src/plugins/plugins-panel/plugins-panel.ts` has a pre-existing TS6133 for `onReloadPlugins` (declared but not yet read — used in step_04b when the Reload button is wired). Not introduced by Chunk 3.
  - `src/plugins/user-plugin-loader.ts` has a pre-existing TS6196 for `UserPluginAPI` (declared but unused — will be removed in step_04c cleanup). Not introduced by Chunk 3.

- **Edge cases covered by tests**:
  - EC-3 (syntax error → status "failed"): `plugin-manager-user.test.ts` — "EC-3: marks plugin as failed when source has syntax error"
  - EC-7 (override detection — core slot marked overridden): `plugin-manager-user.test.ts` — "core file whose filename exists in user/ gets status 'overridden'"
  - EC-8 (override detection — user plugin loads normally): same test — asserts loaded user record with `kind === "user"` and `status === "loaded"`
  - EC-12 (id collision): `plugin-manager-user.test.ts` — "EC-12: rejects second plugin with duplicate id" (user+user); "loaded user record id does not collide with loaded core record id (EC-12)" (core+user)
  - EC-13 (sync onEnable throw → plugin marked disabled): `plugin-manager-user.test.ts` — "EC-13/EC-14: onEnable throw does not propagate to caller"; asserts `getStates()[id] === false`
  - EC-14 (async onEnable rejection → plugin marked disabled): `plugin-manager-user.test.ts` — "EC-14: async onEnable rejection does not propagate to caller"
  - EC-15 (onDisable throw caught, plugin still marked disabled): `plugin-manager-user.test.ts` — "EC-15: onDisable throw is caught and plugin is still marked disabled"
  - EC-22 (version field required for kind="user"): `loader-unification.test.ts` — "evaluatePlugin with kind='user' rejects plugin without version field"
  - EC-23 (idempotency guard on repeated loadPlugins): `plugin-manager-user.test.ts` — "EC-23: already-registered filenames are skipped on repeated loadPlugins calls"
  - EC-26 (migration idempotency): `settings-migration.test.ts` — "returns the same object reference when plugins is already non-empty"; "calling twice produces the same result as calling once"
  - EC-27 (statusBar object shape): `settings-migration.test.ts` — full statusBar section (4 tests)
  - EC-28 (userPlugins collision guard): `settings-migration.test.ts` — "userPlugins key matching a core id is skipped (EC-28: no overwrite)"

## Chunk 3 Reviewer Fixes

Fixes applied to address all issues raised in the Chunk 3 code review:

### Critical

- **Issue 3 / EC-8 (missing user-override-fails test)**: Added test `"EC-8: user override file fails evaluation — core slot stays 'overridden', user slot is 'failed'"` to `tests/plugin-manager-user.test.ts`. Verifies that when a user file with the same filename as a core file fails evaluation (syntax error), the core record retains status `"overridden"` and the user record gains status `"failed"` with a non-empty `failReason`. Confirms the core slot is never promoted back to a running state.

### Medium

- **Issue 1 / TS6196**: Removed unused `UserPluginAPI` import from `src/plugins/user-plugin-loader.ts` (line 12). The type was imported but never referenced anywhere in the file.
- **Issue 2 / TS6133**: Removed the module-level `onReloadPlugins` variable from `src/plugins/plugins-panel/plugins-panel.ts`. The `reloadPlugins` optional parameter in `createPluginsPanel()` is consumed with `void reloadPlugins;` to explicitly signal it is intentionally deferred to step_04b, which satisfies TypeScript without adding a read branch.
- **Issue 4 / `toggle()` persists wrong enabled state on `_enable` throw**: Fixed `toggle()` in `src/plugins/index.ts` to persist `record._enabled` (the actual post-execution state) instead of the requested `enabled` argument. If `onEnable` throws, `record._enabled` will be `false` even though `enabled` was `true`; persisting `true` would have caused a broken-enable loop on every subsequent launch. Added test `"Issue-4: toggle(id, true) persists enabled:false when onEnable throws"` to `tests/plugin-manager-user.test.ts`.

### Low

- **Issue 5 / `instanceof Promise` fragile against thenables**: Replaced `if (result instanceof Promise) await result` with `await Promise.resolve(...)` in both `_enable()` and `_disable()` in `src/plugins/index.ts`. `Promise.resolve()` correctly awaits any thenable, not just native Promises.
- **Issue 6 / double-cast for `version` field**: Replaced `(r.plugin as unknown as Record<string, unknown>)?.version as string` with `r.plugin?.version` in `getDefinitions()`. `version` is a declared field on `UnifiedPlugin` — the double-cast was unnecessary.
- **Issue 7 / `listCorePlugins` test only checks response shape**: Added `tests/bridge-list-core-plugins.test.ts` with 4 tests, including `expect(mockInvoke).toHaveBeenCalledWith("list_core_plugins")` (the assertion that was missing from the shape-only test in `loader-unification.test.ts`).
- **EC-29 / no test for truncated console.warn**: Added test `"emits console.warn containing the truncated filename when listUserPlugins returns truncated entries"` to `tests/plugin-manager-user.test.ts`.

### Files changed in this fix pass

- `src/plugins/user-plugin-loader.ts` — removed unused `UserPluginAPI` import
- `src/plugins/plugins-panel/plugins-panel.ts` — replaced module-level `onReloadPlugins` with `void reloadPlugins;` inline
- `src/plugins/index.ts` — `toggle()` now persists `record._enabled`; `_enable()`/`_disable()` use `Promise.resolve()`; `getDefinitions()` removed double-cast
- `tests/plugin-manager-user.test.ts` — 3 new tests (EC-8, Issue-4, EC-29)
- `tests/bridge-list-core-plugins.test.ts` — NEW; 4 tests for `listCorePlugins` invoke verification (Issue 7)

### Test results after fixes

- Frontend: **450 passed | 27 skipped** (was 443 before; 7 new tests added, 0 failures)
- Rust: **43 passed | 0 failed** (unchanged)
- TypeScript errors in `src/plugins/`: **0** (TS6133 and TS6196 resolved; remaining errors are pre-existing in other files)

---

## Chunk 3 Review Sign-off

- **Date**: 2026-04-12
- **Findings summary**: 1 Critical resolved (Issue 3 / EC-8 — missing user-override-fails test); 3 Medium resolved (Issue 1 unused import, Issue 2 unused variable, Issue 4 toggle persists wrong state); 4 Low resolved (Issue 5 instanceof Promise fragility, Issue 6 double-cast, Issue 7 invoke-name assertion, EC-29 truncation warning test). 0 outstanding items.
- **Requirements traceability**: All Chunk 3 items in `docs/requirements/active_task.md` verified — FR-5 (unified PluginManager), FR-7 (settings persistence), FR-8 (list_core_plugins + updated list_user_plugins + read_plugin_file with kind); step_03a, step_03b, step_03c all addressed by implementation and covered by tests.
- **Edge case coverage**: All Edge Case Inventory items for Chunk 3 (EC-3, EC-7, EC-8, EC-12, EC-13, EC-14, EC-15, EC-22, EC-23, EC-26, EC-27, EC-28, EC-29) covered by passing tests.
- **Status**: Approved for Merge

---

## Chunk 4 Review Sign-off

- **Date**: 2026-04-12
- **Findings summary**: Re-audit of 2 Medium fixes + 3 Low fixes originally raised; all 5 confirmed resolved. 0 outstanding items.
  - Finding 1 (Medium — EC-23 idempotency test for `reloadUserPlugins`): `tests/plugin-manager-user.test.ts` — describe block "PluginManager — reloadUserPlugins EC-23 idempotency"; test "calls readPluginFile only once when the same filename is present on both invocations" present and correct. Test exercises `reloadUserPlugins` code path independently of the `loadPlugins` guard, mocks `listUserPlugins` to return the file only on reload calls, and asserts `readPluginFile` call count does not increase on the second invocation. Implementation guard in `reloadUserPlugins()` (line 460 of `src/plugins/index.ts`) confirmed to rebuild `registeredFilenames` from `this._records` on each call, correctly skipping already-registered filenames.
  - Finding 2 (Medium — FR-9 overridden badge tooltip naming the specific file): `UnifiedPluginDef.filename` field confirmed present on the interface (line 59 of `src/plugins/index.ts`) and populated in `getDefinitions()` (line 563). `buildOverriddenRow()` in `src/plugins/plugins-panel/plugins-panel.ts` (line 478) sets `badge.title = \`Overridden by user plugin: ${def.filename}\``. Test "FR-9: overridden badge tooltip includes the specific overriding filename" in `tests/plugins-panel.test.ts` (line 237) passes "focus-mode.js" through `makeOverriddenDef` and asserts `badge.title` contains "focus-mode.js". Implementation and test are consistent.
  - Finding 3 (Low — stale `migratedSettings` in reload callback): `reloadUserPlugins` in `src/plugins/index.ts` receives `settings` at call time from the `main.ts` callback, which calls `getCurrentSettings()` at invocation time rather than closing over the initial `migratedSettings`. Confirmed correct.
  - Finding 4 (Low — Escape keydown double-registration): `keydownListenerRegistered` guard flag present and checked before registering the listener (lines 48 and 114 of `plugins-panel.ts`). Guard is set to `true` on first registration; subsequent `createPluginsPanel` calls skip listener registration.
  - Finding 5 (Low — `00_index.md` test count enumeration): Review Request section updated to reflect 8 new section-rendering tests added in step_04a and the correct total of 408 frontend tests after step_04b cleanup.
- **Requirements traceability**: All Chunk 4 items in `docs/requirements/active_task.md` verified — FR-9 (panel sections, version badge, Overridden badge with specific filename tooltip, Reload button); step_04a and step_04b addressed by implementation and covered by tests. Cleanup targets (11 deleted files listed in step_04b spec) confirmed absent from the repository.
- **Edge case coverage**: All Chunk 4 Edge Case Inventory items covered by passing tests: EC-23 (`plugin-manager-user.test.ts` — both `loadPlugins` and `reloadUserPlugins` paths), EC-1/EC-2/EC-3 (`tests/status-bar.test.ts` — 6 extracted infrastructure tests), EC-10 (`plugins-panel.test.ts` — pre-existing guard tests retained), FR-9 tooltip (`plugins-panel.test.ts` — "overridden badge tooltip includes the specific overriding filename").
- **Test results**: 408 frontend passed | 27 skipped | 0 failed; 43 Rust passed | 0 failed.
- **Status**: Approved for Merge

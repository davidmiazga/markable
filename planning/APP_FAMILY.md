# App family readiness

**Decision (2026-09-22):** the future system is a shared core that produces **separate installable applications**, each preconfigured around a focused UX and plugin set. This baseline does not create that layout.

## Values that must become per-app

| Concern | Today’s single value |
|---|---|
| Product name | `Markable` (`tauri.conf.json`, menus, help) |
| Identifier / app data | `com.markable.app` → `~/Library/Application Support/com.markable.app/` |
| Versions | `0.1.0` in npm, Cargo, Tauri |
| Window + menus | One overlay window; one native menu tree in `menu.rs` / `lib.rs` |
| Icons | `src-tauri/icons/` (workspace also has unused `jobWorking/app-icon/`) |
| Default settings | `DEFAULT_SETTINGS` in `src/lib/settings.ts` + Rust defaults |
| Default-enabled plugins | `DEFAULT_ENABLED_PLUGINS` in `src/plugins/index.ts` (`media-preview`, `backlinks`, `markdown-toolbar`, `command-bar`) |
| Bundled resources | `help/*`, `plugins/core/*`, `themes/*` |
| Signing | Not configured |

## Reusable vs Markable-specific (first cut)

**Likely core (keep once, share):**

- Atomic file I/O, dialogs, settings merge, vault index/watch/search
- CodeMirror host, live preview, format, lists, find
- Tab manager, sidebar manager, plugin loader/API, theme CSS load
- Typed command bridge (after it is actually exclusive)

**Likely app composition (per installable):**

- Product name, ID, icons, help, menus, default window
- Plugin manifest (which IIFEs ship and which start enabled)
- Default vault/inbox/quick-capture paths
- Feature flags for PKM surfaces (file browser, collections, graph)

**Likely optional plugins (toggle per app):**

- Most of the current 20 IIFE plugins, especially file-browser, knowledge-graph, daily-note, diagrams, math

## Blockers

There is no plugin manifest file today. Enabled state is a runtime map in settings. Core plugins are a hard-coded array in `build-plugins.mjs`. Until those become data, “preconfigured apps” means forking source.

`dm-software-machine` stays **uninitialized** until this layout exists so `app_folder` is not pointed at a path that will move. See [EXECUTION.md](EXECUTION.md).

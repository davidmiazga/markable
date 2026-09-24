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
| Default-enabled plugins | Packs in [`flavors/packs.json`](../flavors/packs.json); Markable uses `base`; Re-markable intends `base`+`pkm` with a kitchen-sink first-run override |
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

Host vs packs is locked in [`flavors/packs.json`](../flavors/packs.json) and explained in [SeparateApp-CXrequirements-v1.0.md](SeparateApp-CXrequirements-v1.0.md). Existing `com.markable.app` directories are stamped `productLine: "legacy-kitchen-sink"` and keep the Re-markable first-run override plus file-browser-first vault chrome until a migration exists. A missing `settings.json` is stamped `markable` and enables the `base` pack. Existing `settings.plugins` entries still win. The IIFE build list in `scripts/build-plugins.mjs` is still hard-coded. Other flavor JSON files (Project, KnowledgeBank, QuickNote, Diary) are not created yet.

See [EXECUTION.md](EXECUTION.md) for the software-machine contract.

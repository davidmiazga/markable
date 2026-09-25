# App family readiness

**Decision (2026-09-22):** the future system is a shared core that produces **separate installable applications**, each preconfigured around a focused UX and plugin set. This baseline does not create that layout.

## Values that must become per-app

| Concern | Today’s single value |
|---|---|
| Product name | `Markable` (`tauri.conf.json`, menus, help) |
| Identifier / app data | Re-markable / `npm run tauri dev`: `com.markable.app`. Markable via `scripts/tauri-flavor.mjs`: `com.markable.editor`. KnowledgeBank: `com.markable.knowledgebank`. |
| Versions | `0.1.0` in npm, Cargo, Tauri |
| Window + menus | One overlay window; one native menu tree in `menu.rs` / `lib.rs` |
| Icons | `src-tauri/icons/` (workspace also has unused `jobWorking/app-icon/`) |
| Default settings | `DEFAULT_SETTINGS` in `src/lib/settings.ts` + Rust defaults |
| Default-enabled plugins | Packs in [`flavors/packs.json`](../flavors/packs.json); Markable uses `base`; Re-markable and KnowledgeBank use `base`+`pkm` |
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

Host vs packs is locked in [`flavors/packs.json`](../flavors/packs.json). First-run is the active flavor’s `enabledPacks`. Saved `settings.plugins` entries still win. File-browser-first chrome applies when the flavor includes the `pkm` pack. The IIFE build list in `scripts/build-plugins.mjs` is still hard-coded. Bundle ids live on each flavor file; [`scripts/tauri-flavor.mjs`](../scripts/tauri-flavor.mjs) applies them. Named scripts: `npm run dev:markable`, `dev:remarkable`, `dev:knowledgebank` (also `just markable` / `remarkable` / `knowledgebank`). `npm run tauri dev` still uses `com.markable.app` without `VITE_FLAVOR`. Project, QuickNote, and Diary flavor files wait until those packs have shipped features.

See [EXECUTION.md](EXECUTION.md) for the software-machine contract.

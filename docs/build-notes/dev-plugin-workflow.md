---
title: Dev Plugin Workflow Notes
last-updated: "2026-04-24"
review-cadence-days: 90
status: reference
---

# Dev Plugin Workflow

## Building and installing core plugins (dev only)

```bash
npm run build:plugins   # rebuild all plugin bundles into src-tauri/plugins/core/
npm run sync:plugins    # clean-sync to Application Support (removes stale files)
```

`sync:plugins` mirrors what `copy_core_plugins` (Rust) does in production:
it removes any `.js` file from the destination that is no longer in the source,
then copies all source files. **Never use bare `cp *.js ...` for this** — that
copies new files but leaves stale files in the destination.

## Stale plugin cleanup (important after consolidations)

In production, `copy_core_plugins` (Rust) automatically removes `.js` files in
the installed `plugins/core/` dir that are no longer in the app bundle. It does
this by comparing filenames against the bundled resource dir (step 7a in plugins.rs).

**In dev mode this cleanup never runs automatically** — use `npm run sync:plugins`
after any consolidation or rename.

### When to run sync:plugins

Any time a plugin is:
- **Consolidated** into another (e.g. `table-toolbar` + `image-toolbar` → `markdown-toolbar`)
- **Renamed** (old name stays on disk as a stale loader)
- **Removed** entirely

### History of consolidations

| Removed files | Replaced by | Date |
|---|---|---|
| `table-toolbar.js`, `image-toolbar.js` | `markdown-toolbar.js` | 2026-04-24 |

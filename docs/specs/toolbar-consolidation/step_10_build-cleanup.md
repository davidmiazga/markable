---
title: "Step 10 — Build System Cleanup and Source Deletion"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Step 10 — Build System Cleanup and Source Deletion

## What to Build

This is the final cleanup step. It:

1. Removes the two retired entries from `scripts/build-plugins.mjs`.
2. Updates the success log message.
3. Deletes the two retired source directories.
4. Verifies the build produces exactly 6 output files.

No source logic changes. This step purely removes dead code and updates the build system.

---

## Files to Modify

`scripts/build-plugins.mjs`

---

## Files to Delete

| Path | Reason |
|---|---|
| `src/plugins/table-toolbar/table-toolbar.plugin.ts` | Replaced by unified plugin |
| `src/plugins/table-toolbar/` (entire directory) | Nothing remains |
| `src/plugins/image-toolbar/image-toolbar.plugin.ts` | Replaced by unified plugin |
| `src/plugins/image-toolbar/` (entire directory) | Nothing remains |

---

## Precise Specification

### `scripts/build-plugins.mjs` — PLUGINS array

Remove these two entries:

```javascript
// DELETE these two lines:
["table-toolbar",     "src/plugins/table-toolbar/table-toolbar.plugin.ts"],
["image-toolbar",     "src/plugins/image-toolbar/image-toolbar.plugin.ts"],
```

After deletion, the `PLUGINS` array contains exactly 6 entries:

```javascript
const PLUGINS = [
  ["focus-mode",        "src/plugins/focus-mode/focus-mode.plugin.ts"],
  ["typewriter-mode",   "src/plugins/typewriter-mode/typewriter-mode.plugin.ts"],
  ["word-count",        "src/plugins/word-count/word-count.plugin.ts"],
  ["status-bar",        "src/plugins/status-bar/status-bar.plugin.ts"],
  ["auto-toc",          "src/plugins/auto-toc/auto-toc.plugin.ts"],
  ["markdown-toolbar",  "src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts"],
];
```

### `scripts/build-plugins.mjs` — success message

Change the final `console.log` from:

```javascript
console.log("\n[build-plugins] All 8 core plugins built successfully.");
```

to:

```javascript
console.log("\n[build-plugins] All 6 core plugins built successfully.");
```

### Source deletion

```bash
rm -rf src/plugins/table-toolbar/
rm -rf src/plugins/image-toolbar/
```

Both directories must be empty except for the `.plugin.ts` files (no sub-directories,
no CSS files, no helper modules in the originals). Verify before deletion:

```bash
ls src/plugins/table-toolbar/   # expect: table-toolbar.plugin.ts only
ls src/plugins/image-toolbar/   # expect: image-toolbar.plugin.ts only
```

---

## Acceptance Criteria

### AC-10.1 — Build produces exactly 6 files (FR-8)
```bash
npm run build:plugins
ls src-tauri/plugins/core/
```
Output must contain exactly: `focus-mode.js`, `typewriter-mode.js`, `word-count.js`,
`status-bar.js`, `auto-toc.js`, `markdown-toolbar.js`.

No `table-toolbar.js` or `image-toolbar.js` in the output directory.

### AC-10.2 — Build success message updated (FR-8)
```bash
npm run build:plugins 2>&1 | grep "successfully"
```
Output: `[build-plugins] All 6 core plugins built successfully.`

### AC-10.3 — Source directories deleted
```bash
ls src/plugins/table-toolbar/   # must return "No such file or directory"
ls src/plugins/image-toolbar/   # must return "No such file or directory"
```

### AC-10.4 — PLUGINS array has exactly 6 entries (EC-35)
```bash
grep -c '"markdown-toolbar"\|"table-toolbar"\|"image-toolbar"\|"focus-mode"\|"typewriter-mode"\|"word-count"\|"status-bar"\|"auto-toc"' scripts/build-plugins.mjs
```
Returns `6`.

### AC-10.5 — PluginManager handles missing files without crash (EC-19, EC-20)
When `settings.plugins` from a previous session contains:
```json
{ "table-toolbar": true, "image-toolbar": true, "markdown-toolbar": true }
```
The PluginManager marks `table-toolbar` and `image-toolbar` as `status: "missing"` (existing
behaviour, no new code needed). The `markdown-toolbar` plugin enables normally. No console
errors from the PluginManager.

This is a runtime verification, not a compile-time check. Document as a manual QA step.

### AC-10.6 — No TypeScript references to deleted files
```bash
npx tsc --noEmit
```
No errors referencing `table-toolbar/` or `image-toolbar/` paths. (These were already
absent from the main app's imports; this confirms no accidental imports exist.)

---

## Risks and Dependencies

- **Risk**: The `build-plugins.mjs` `clearOutputDir()` function deletes and recreates
  `src-tauri/plugins/core/` before building. Any leftover `table-toolbar.js` or
  `image-toolbar.js` from a previous build will be cleared automatically. No manual
  deletion of the build output is needed.
- **Risk**: Any test file that still imports from `table-toolbar/` or `image-toolbar/`
  source paths will fail after deletion. All such imports must be migrated in step_09
  before this step is executed. Step_10 must follow step_09.
- **Dependency**: Step_09 must be complete and all tests must pass before this step runs.
  Deleting the source files with failing tests is not permitted.
- **Dependency**: The Tauri bundle resources glob `"plugins/core/*"` in `tauri.conf.json`
  picks up all `.js` files in `src-tauri/plugins/core/`. Since the output directory is
  cleared and rebuilt on each `npm run build:plugins` run, the retired `.js` files will
  not appear in the final app bundle after this step.

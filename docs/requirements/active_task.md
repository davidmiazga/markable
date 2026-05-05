---
title: Auto Title Plugin
last-updated: "2026-05-04"
review-cadence-days: 90
status: reference
---

# Auto Title Plugin

## Feature Summary

A core plugin that eliminates the double-typing problem: when the plugin is enabled, new untitled files open with `# ` pre-inserted and the cursor placed after it. On the first Cmd-S, the file is silently saved to the vault root using the H1 text as the filename — no Save As dialog. If no vault is active or the H1 is absent, the system falls back to the Save As dialog with the H1-derived name pre-populated.

---

## Delivered Behaviour

### UX Flow (plugin enabled, vault active)
1. Cmd-N → new tab opens, editor shows `# `, cursor placed after the space
2. User types "My Meeting Notes" → line 1 = `# My Meeting Notes`
3. User writes body, presses Cmd-S
4. File saves as `{vault_root}/My Meeting Notes.md` — no dialog
5. Tab title updates to "My Meeting Notes", file appears in vault tree

### Fallback cases
- No vault active → Save As dialog opens, H1-derived name pre-populated
- H1 absent or blank → Save As dialog opens, empty suggestion
- Plugin disabled → Cmd-N gives empty doc, Cmd-S shows system dialog

---

## Files Delivered

| File | Role |
|------|------|
| `src/plugins/auto-title/auto-title-helpers.ts` | Pure functions: `extractH1`, `h1ToFilename(h1, style?)`, `resolveConflictPath` |
| `src/plugins/auto-title/auto-title.plugin.ts` | IIFE plugin: sets `window.__MARKABLE_AUTO_TITLE__`; `renderDetailExtra` with style selector |
| `tests/plugins/auto-title/auto-title.test.ts` | 35 unit tests covering all helpers and all 3 filename styles |

## Files Modified

| File | Change |
|------|--------|
| `src/tabs/tab-manager.ts` | `_createUntitledTab`: `doc: "# "` when plugin active; `_applyActiveTab`: cursor at `doc.length`, dirty reset, focus; `saveActiveTab`: resolver intercept + dialog fallback with style-aware suggestion |
| `src/lib/dialogs.ts` | `saveFileDialog(suggestedFilename?)` passes through to Rust |
| `src-tauri/src/commands/dialogs.rs` | `save_file_dialog(suggested_filename: Option<String>)` uses it for `.set_file_name()` |
| `src/lib/bridge.ts` | `renameFile(oldPath, newPath)` wrapper added |
| `scripts/build-plugins.mjs` | `auto-title` entry added to PLUGINS array |

---

## Filename Style Options

Configured in **Plugins → Auto Title** (plugin detail view, `renderDetailExtra`). Stored in `plugins/auto-title/settings.json` (plugin-own settings, not `MarkableSettings`).

| Style | Example output |
|-------|---------------|
| Normal Spaces (default) | `My Meeting Notes.md` |
| CamelCase | `MyMeetingNotes.md` |
| kebab-case | `my-meeting-notes.md` |

---

## Window Global Contract

```ts
window.__MARKABLE_AUTO_TITLE__ = {
  resolveTargetPath(doc: string): Promise<string | null>,
  getFilenameStyle(): "spaces" | "camel" | "kebab",
}
```

Set on `onEnable`, deleted on `onDisable`. `resolveTargetPath` applies the style internally. `getFilenameStyle` is read by `tab-manager.ts` only for the Save As dialog suggestion in the fallback path.

---

## Status

Completed and merged to `main` — 2026-05-04. 76 test files, 3378 passing.

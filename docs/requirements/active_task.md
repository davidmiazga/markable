---
title: Pre-PKM Polish Pass
last-updated: "2026-05-05"
review-cadence-days: 30
status: active
---

# Pre-PKM Polish Pass

## Context

Before shifting into the deeper PKM layer (templates, graph intelligence, linking workflows), a small set of editor-level polish items were identified that are absent from the current experience and would become more noticeable once PKM features draw more attention to the tool.

---

## Items

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Reading time in Word Count | ✅ Done 2026-05-05 | Toggle in plugin detail view, default off |
| 2 | Smart typography (curly quotes, dashes) | ⬜ Next | New `smart-typography` plugin |
| 3 | Tab drag-to-reorder | ⬜ Pending | Core `tab-manager.ts` + renderers |
| 4 | Clipboard image paste | ⬜ Pending | Into `markdown-toolbar` plugin + new Rust `write_binary_file` |

---

## Completed: Reading Time

**What was added to `src/plugins/word-count/word-count.plugin.ts`:**
- `_showReadingTime` flag (default `false`), loaded from `plugins/word-count/settings.json` on enable
- `readingTimeLabel(words)` — `"< 1 min read"` or `"~N min read"` at 200 WPM
- `updateDisplay` appends the label when flag is on and there is no active selection
- `renderDetailExtra` — toggle row in plugin detail view, saves setting, refreshes display immediately
- `onEnable` made `async` to await `loadSettings`

---

## Up Next: Smart Typography

New core plugin `smart-typography`. As-you-type CM6 `InputRule` substitutions:
- `"` / `'` → curly open/close quotes (context-aware)
- `--` → `–` (en-dash), `---` → `—` (em-dash)
- `...` → `…` (ellipsis)

**Constraint:** Must be a no-op inside fenced code blocks, inline code, and YAML front matter — check `syntaxTree` node type before substituting.

Toggle in plugin settings (default off). Delivered as a new `src/plugins/smart-typography/smart-typography.plugin.ts`.

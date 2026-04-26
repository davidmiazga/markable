# Markable 2.0 -- Phase 2C: Live Preview -- Master Blueprint

**Date:** 2026-04-08
**Status:** Architecture Complete -- Ready for Lead Developer
**Based on:** `docs/requirements/phase2c_live_preview.md`
**Depends on:** Phase 2B Menu System (complete)

---

## Executive Summary

Phase 2C adds Typora-style live preview to the CodeMirror editor. Markdown syntax markers are visually hidden on inactive lines and revealed when the cursor is on that line. This is the MVP (Phase 2C-1) covering headings, bold, italic, and inline code.

The implementation is a single CodeMirror `ViewPlugin` that walks the lezer markdown syntax tree for visible lines, checks if each node is on the active line, and produces `Decoration.replace()` (to hide markers) and `Decoration.mark()` (to style content) accordingly.

No Rust changes. No new npm dependencies.

---

## Stack Decision

| Technology | Usage |
|---|---|
| `ViewPlugin.fromClass()` | Creates the decoration plugin that recomputes on doc/selection changes |
| `Decoration.replace({})` | Hides syntax markers (e.g., `# `, `**`, `` ` ``) |
| `Decoration.mark({ class })` | Applies CSS classes to content (heading size, bold, italic, code bg) |
| `Decoration.line({ class })` | Applies CSS classes to entire lines (heading line styling) |
| `syntaxTree(state)` | Gets the lezer parse tree without re-parsing |
| `tree.iterate({ enter, from, to })` | Walks nodes in the visible range |

---

## High-Level Architecture

### Decoration Strategy Per Element

| Element | Marker Hidden (replace) | Content Styled (mark/line) |
|---|---|---|
| `# Heading` | `#` + space replaced | Line gets heading class (font-size, weight) |
| `**bold**` | Opening `**` + closing `**` replaced | Inner text gets `cm-live-bold` class |
| `*italic*` | Opening `*` + closing `*` replaced | Inner text gets `cm-live-italic` class |
| `` `code` `` | Opening `` ` `` + closing `` ` `` replaced | Inner text gets `cm-live-code` class |

### Key Design Decisions

1. **One ViewPlugin, one DecorationSet.** All live preview decorations are managed by a single plugin. This avoids ordering conflicts between multiple decoration sources.

2. **Active line = skip.** The plugin checks `state.selection.ranges` to determine which lines are "active". Any node on an active line gets no decorations (raw markdown shown).

3. **Viewport-scoped iteration.** `tree.iterate()` is called with `from: view.viewport.from, to: view.viewport.to` so we only process visible lines.

4. **Decorations are sorted.** CM6 requires decorations in document order. We build them in order by iterating the tree in document order.

### Data Flow

```
EditorView update (doc change, selection change, viewport scroll)
  |
  v
LivePreviewPlugin.update(update) called
  |
  v
Determine active lines from update.state.selection.ranges
  |
  v
Get syntaxTree(update.state)
  |
  v
tree.iterate({ from: viewport.from, to: viewport.to, enter: ... })
  |
  v
For each node (ATXHeading1-6, StrongEmphasis, Emphasis, InlineCode):
  - Is node on an active line? -> skip
  - Otherwise -> add Decoration.replace for markers, Decoration.mark for content
  |
  v
Return DecorationSet via Decoration.set(decorations, true)
  |
  v
CM6 renders: markers hidden, content styled
```

---

## Component Map

```
src/editor/
  live-preview.ts         [NEW]  ViewPlugin + buildDecorations() + CSS class constants
  extensions.ts           [MODIFY] Import and add livePreviewExtension
src/
  styles.css              [MODIFY] Add .cm-live-* CSS classes
```

---

## API Contracts

### Lezer Node Types Used (from @lezer/markdown)

| Node Name | What It Represents |
|---|---|
| `ATXHeading1` - `ATXHeading6` | Heading block (contains HeaderMark + content) |
| `HeaderMark` | The `#` characters (child of ATXHeading) |
| `StrongEmphasis` | `**bold**` block (contains EmphasisMark + content) |
| `Emphasis` | `*italic*` block (contains EmphasisMark + content) |
| `EmphasisMark` | The `*` or `**` markers (child of Emphasis/StrongEmphasis) |
| `InlineCode` | `` `code` `` block (contains CodeMark + CodeText) |
| `CodeMark` | The backtick markers (child of InlineCode) |

### CSS Classes

| Class | Applied To | Styling |
|---|---|---|
| `cm-live-h1` through `cm-live-h6` | Heading line | font-size + font-weight per level |
| `cm-live-bold` | Bold content (between `**`) | font-weight: bold |
| `cm-live-italic` | Italic content (between `*`) | font-style: italic |
| `cm-live-code` | Code content (between `` ` ``) | monospace font, background color |

---

## Edge Case Coverage Matrix

| EC # | Edge Case | Step | Coverage Strategy |
|---|---|---|---|
| EC-1 | Cursor at end of heading line | Step 01 | Active line check includes all cursor positions |
| EC-2 | Empty heading `# ` | Step 01 | HeaderMark still replaced; empty content is fine |
| EC-3 | Nested `**bold *and italic***` | Step 02 | Tree iteration handles nested nodes naturally |
| EC-4 | Unclosed `**bold` | Step 02 | Lezer won't create StrongEmphasis node; no decoration |
| EC-5 | Long line with formatting | Step 02 | Decorations work on any line length |
| EC-6 | Rapid typing | Step 01 | ViewPlugin.update() is efficient; viewport-scoped |
| EC-8 | Selection spanning lines | Step 01 | All selection ranges checked for active lines |
| EC-9 | No markdown formatting | Step 01 | No matching nodes; no decorations; zero overhead |
| EC-10 | Pasting markdown | Step 02 | docChanged triggers update; decorations recompute |

---

## Implementation Checklist

### Step 01: ViewPlugin Scaffold + Heading Decorations
- [ ] Create `src/editor/live-preview.ts` with ViewPlugin class
- [ ] Implement active line detection from `state.selection.ranges`
- [ ] Implement `buildDecorations()` with `syntaxTree` + `tree.iterate`
- [ ] Handle ATXHeading1-6: replace HeaderMark, apply line decoration for font size
- [ ] Add CSS classes `.cm-live-h1` through `.cm-live-h6` to styles.css
- [ ] Wire into `buildExtensions()` in extensions.ts
- [ ] Verify: headings render at correct sizes on inactive lines
- [ ] Verify: clicking a heading reveals raw `# ` markers
- [ ] Verify: no performance issues during typing

### Step 02: Bold, Italic, Inline Code Decorations
- [ ] Add StrongEmphasis handling: replace EmphasisMark, mark content as bold
- [ ] Add Emphasis handling: replace EmphasisMark, mark content as italic
- [ ] Add InlineCode handling: replace CodeMark, mark content with code style
- [ ] Add CSS classes `.cm-live-bold`, `.cm-live-italic`, `.cm-live-code`
- [ ] Handle nested formatting (bold inside italic, etc.)
- [ ] Verify: `**bold**` hides asterisks on inactive lines
- [ ] Verify: `*italic*` hides asterisks on inactive lines
- [ ] Verify: `` `code` `` hides backticks on inactive lines
- [ ] Verify: clicking reveals raw syntax
- [ ] Verify: undo/redo works correctly

### Code Quality
- [ ] No TODO comments in source files
- [ ] `tsc --noEmit` passes
- [ ] No console errors during normal editing
- [ ] Decorations compose correctly with existing basicSetup + markdown()

---

## Handoff Summary

**Requirements source:** `docs/requirements/phase2c_live_preview.md`

**Architecture blueprint:** This file

**Step files:**
- `step_01_viewplugin_headings.md` -- ViewPlugin scaffold, active line detection, heading decorations
- `step_02_inline_formatting.md` -- Bold, italic, inline code decorations

**Next Step:** Implement `step_01` first. Once headings work, `step_02` adds the remaining inline elements.

---

**Architecture Complete -- Ready for Implementation**

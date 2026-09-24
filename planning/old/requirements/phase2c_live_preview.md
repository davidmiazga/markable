# Phase 2C: Live Preview (Typora-Style Inline Editing)

**Status:** Requirements Validated
**Date:** 2026-04-08
**Depends on:** Phase 2B Menu System (complete)
**Feature Checkpoint:** 1 -- Base Features (item 1: Editing Experience)

---

## Executive Summary

Phase 2C is the crown jewel of Markable. It transforms the plain-text CodeMirror editor into a Typora-style live preview editor where markdown syntax is rendered inline. When the cursor is NOT on a line, syntax markers (like `#`, `**`, `` ` ``) are hidden and their visual effects are shown (headings are large, bold text is bold, etc.). When the cursor IS on a line, the raw markdown is revealed for editing.

This is implemented entirely with CodeMirror 6's decoration system (`ViewPlugin`, `Decoration.replace`, `Decoration.mark`) and the lezer markdown syntax tree. No Rust changes are needed.

---

## Core Concept: Active Line Reveal

The fundamental behavior is:

- **Inactive lines** (cursor is elsewhere): Markdown syntax markers are hidden. Visual formatting is applied. The text looks like a rendered document.
- **Active line** (cursor is on this line): Raw markdown is shown. The user sees `## Heading` instead of a large styled heading. This allows direct editing of the markdown source.

"Active line" means any line that contains the cursor or is part of the current selection.

---

## Functional Requirements

### R1: Heading Rendering

**What must be built:**

On inactive lines, ATX headings (`# ` through `###### `) should:
- Hide the `#` markers and the space after them
- Display the heading text at an appropriate font size and weight

| Heading | Font Size | Weight |
|---|---|---|
| H1 | 1.8em | 700 |
| H2 | 1.5em | 700 |
| H3 | 1.25em | 600 |
| H4 | 1.1em | 600 |
| H5 | 1.0em | 600 |
| H6 | 0.9em | 600 |

On active lines, the full `# Heading Text` is shown for editing.

**Acceptance Criteria:**
- `# Hello` on an inactive line renders as large bold "Hello" with no `#` visible.
- Clicking on the heading line reveals `# Hello` for editing.
- Moving the cursor away re-hides the `#`.

---

### R2: Bold/Strong Rendering

**What must be built:**

On inactive lines, `**text**` or `__text__`:
- Hide the `**` / `__` markers
- Display the inner text in bold (`font-weight: bold`)

On active lines, the full `**text**` is shown.

**Acceptance Criteria:**
- `**bold**` on an inactive line shows "bold" in bold with no asterisks.
- Clicking reveals `**bold**` for editing.

---

### R3: Italic/Emphasis Rendering

**What must be built:**

On inactive lines, `*text*` or `_text_`:
- Hide the `*` / `_` markers
- Display the inner text in italic (`font-style: italic`)

**Acceptance Criteria:**
- `*italic*` on an inactive line shows "italic" in italic with no asterisks.

---

### R4: Inline Code Rendering

**What must be built:**

On inactive lines, `` `code` ``:
- Hide the backtick markers
- Display the inner text with a code-style background (monospace font, subtle background color)

**Acceptance Criteria:**
- `` `code` `` on an inactive line shows "code" with a code background and no backticks.

---

### R5: Link Rendering

**What must be built:**

On inactive lines, `[text](url)`:
- Hide the `[`, `](url)` portions
- Display the link text in a link style (blue, underlined)

This is a more complex replacement because the URL portion is hidden entirely while only the display text is shown.

**Acceptance Criteria:**
- `[click here](https://example.com)` shows "click here" styled as a link.
- Clicking the line reveals the full markdown.

---

### R6: Horizontal Rule Rendering

**What must be built:**

On inactive lines, `---`, `***`, or `___` (3+ characters):
- Replace with a styled horizontal line (CSS `<hr>`-like decoration)

**Acceptance Criteria:**
- `---` on an inactive line shows as a thin horizontal rule spanning the editor width.

---

### R7: Blockquote Rendering

**What must be built:**

On inactive lines, `> text`:
- Hide the `> ` marker
- Display the text with a left border and subtle background (blockquote styling)

**Acceptance Criteria:**
- `> quoted text` on an inactive line shows as styled blockquote without the `>` marker.

---

### R8: Code Fence Rendering

**What must be built:**

Code fences (` ``` `) are multi-line and need special treatment:
- On inactive lines, hide the opening ` ```lang ` and closing ` ``` ` fence markers
- Display the code block content with a distinct background (code block styling)
- Syntax highlighting within code blocks is a future enhancement (out of scope)

On active lines within the fence, show the raw content.

**Note:** When the cursor is inside a code fence (on any line between ``` markers), the entire fence block should reveal its markers, not just the active line.

**Acceptance Criteria:**
- A fenced code block on inactive lines shows the code content in a styled container with no ``` markers.
- Clicking inside the block reveals the ``` markers.

---

### R9: List Rendering

**What must be built:**

On inactive lines:
- Bullet lists (`- `, `* `, `+ `): Replace the marker with a styled bullet character
- Ordered lists (`1. `, `2. `): Keep the number but style it
- Task lists (`- [ ] `, `- [x] `): Replace with a checkbox widget (unchecked/checked)

**Acceptance Criteria:**
- `- item` shows a clean bullet point.
- `- [x] done` shows a checked checkbox.
- `- [ ] todo` shows an unchecked checkbox.

---

### R10: Strikethrough Rendering

**What must be built:**

On inactive lines, `~~text~~`:
- Hide the `~~` markers
- Display the inner text with strikethrough styling

**Acceptance Criteria:**
- `~~deleted~~` on an inactive line shows "deleted" with a line through it.

---

## Phased Implementation Strategy

Not all of R1-R10 need to ship at once. The implementation should be phased:

**Phase 2C-1 (MVP):** R1 (Headings), R2 (Bold), R3 (Italic), R4 (Inline Code)
These are the most common markdown elements and prove the decoration system works.

**Phase 2C-2:** R5 (Links), R6 (Horizontal Rules), R7 (Blockquotes)
Slightly more complex decorations.

**Phase 2C-3:** R8 (Code Fences), R9 (Lists), R10 (Strikethrough)
Multi-line handling and widget decorations.

---

## Non-Functional Requirements

### NF1: Performance
- Decorations must be computed in O(visible lines), not O(document length).
- Use `ViewPlugin` with `update()` that only recomputes when the document or viewport changes.
- The syntax tree is already maintained by CodeMirror's language support -- reuse it, don't re-parse.
- No perceptible lag when typing, even in large documents (1000+ lines).

### NF2: Cursor Behavior
- When clicking on a decorated (hidden-syntax) line, the cursor should land at a reasonable position.
- There should be no "jumping" or unexpected cursor repositioning when syntax reveals/hides.

### NF3: Undo/Redo Compatibility
- Decorations are read-only visual overlays. They must not interfere with CodeMirror's undo/redo history.
- Undo/redo should work identically whether decorations are present or not.

### NF4: Selection Handling
- When text is selected across multiple lines, any line that is part of the selection should show raw markdown (active line behavior).

---

## Edge Case Inventory

| # | Edge Case | Expected Behavior |
|---|---|---|
| EC-1 | Cursor at end of heading line | Full raw markdown visible on that line |
| EC-2 | Empty heading (`# ` with nothing after) | Show `# ` on active, show nothing on inactive |
| EC-3 | Nested formatting (`**bold *and italic***`) | On inactive line: bold and italic applied. On active: raw shown. |
| EC-4 | Unclosed formatting (`**bold without close`) | No decoration applied; raw text shown as-is |
| EC-5 | Very long line with formatting | Decorations apply correctly; no overflow or clipping |
| EC-6 | Rapid typing in formatted text | Decorations update smoothly; no flicker |
| EC-7 | Multiple cursors (future) | Each cursor's line is treated as active |
| EC-8 | Selection spanning formatted and plain text | All lines in selection show raw markdown |
| EC-9 | Document with no markdown formatting | No decorations applied; editor behaves as plain text |
| EC-10 | Pasting formatted markdown | Decorations apply after paste completes |
| EC-11 | Code fence with language identifier | Language identifier hidden on inactive lines |
| EC-12 | Heading immediately followed by text | Only the heading line gets heading treatment |

---

## Technical Approach

### Architecture

```
syntaxTree(state)          ViewPlugin
     |                        |
     v                        v
Lezer Markdown AST    decorations computed per update()
     |                        |
     v                        v
Walk visible nodes     Build DecorationSet:
matching formatting      - Decoration.replace() for hiding markers
types                    - Decoration.mark() for styling
     |                        |
     v                        v
Check: is this node    Return RangeSet<Decoration>
on the active line?    to CodeMirror for rendering
     |
  Yes -> skip (show raw)
  No  -> add decoration
```

### Key CM6 APIs Used

| API | Purpose |
|---|---|
| `ViewPlugin.fromClass()` | Creates the decoration plugin |
| `Decoration.replace({})` | Hides syntax markers (e.g., `#`, `**`) |
| `Decoration.mark({ class })` | Applies CSS classes for styling (bold, italic, etc.) |
| `Decoration.widget({ widget })` | Inserts widget (e.g., checkbox, horizontal rule) |
| `syntaxTree(state)` | Gets the lezer parse tree |
| `tree.iterate({ enter })` | Walks tree nodes in the visible range |
| `view.state.selection` | Determines which lines are "active" |

### File Structure

```
src/editor/
  extensions.ts           [MODIFY] Add live preview extension to buildExtensions()
  live-preview.ts         [NEW]    ViewPlugin + decoration logic
  live-preview-styles.ts  [NEW]    CSS classes for rendered elements (or inline in styles.css)
```

---

## Technical Constraints

### TC-1: Decorations Are Read-Only
- `Decoration.replace()` hides content visually but does not modify the document.
- The underlying markdown text is always preserved.
- Undo/redo operates on the actual document, not the visual appearance.

### TC-2: No Rust Changes
- This phase is entirely frontend TypeScript + CSS.

### TC-3: Must Work With Existing Extensions
- The live preview extension must compose with `basicSetup` and `markdown()` language support.
- It should not conflict with existing syntax highlighting.

### TC-4: Active Line Detection Must Be Fast
- Use `state.selection.main.head` to get cursor line.
- Cache the active line number and only recompute decorations when it changes or the document changes.

---

## Out of Scope

- Syntax highlighting inside code fences (language-specific)
- Image rendering (`![alt](url)` -- Phase 2 extended)
- Table rendering (Plugin feature)
- Math/LaTeX rendering (Plugin feature)
- YAML front matter rendering
- Clickable links (clicking a rendered link to open the URL)
- Toggle between source mode and preview mode (always live preview)

---

## Visual Verification Checklist (for user sign-off)

### Phase 2C-1 (MVP)
- [ ] `# Heading` on inactive line shows large bold text, no `#`
- [ ] `## Heading 2` through `###### Heading 6` all render at appropriate sizes
- [ ] Clicking a heading reveals the raw `# ` markers
- [ ] `**bold**` on inactive line shows bold text, no asterisks
- [ ] `*italic*` on inactive line shows italic text, no asterisks
- [ ] `` `code` `` on inactive line shows styled code, no backticks
- [ ] Moving cursor between lines smoothly reveals/hides syntax
- [ ] No flicker or lag during normal typing
- [ ] Undo/redo works correctly
- [ ] Selection across multiple lines reveals raw markdown on all selected lines

---

## Feature Checkpoint 1 Progress After This Phase

| # | Feature | Status |
|---|---|---|
| 1 | Typora-style live preview editing | **DONE** (MVP: headings, bold, italic, code) |
| 2 | Performance (no flash, instant open) | DONE |
| 3 | Settings & persistence | Not started |
| 4 | Theming (hot-swappable CSS) | Not started |
| 5 | Menu system + keyboard shortcuts | DONE |

---

**Next step:** Activate software-architect to produce step files, starting with Phase 2C-1 (MVP).

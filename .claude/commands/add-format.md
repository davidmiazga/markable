Add a new markdown formatting feature to Markable. This skill covers both inline formats (bold, italic, underline, strikethrough, highlight, etc.) and line-level formats (headings, quotes, lists, etc.).

## When to use
- Adding a new inline marker toggle (e.g., superscript `^text^`, subscript `~text~`)
- Adding a new line-level prefix toggle (e.g., callout `> [!note]`)
- Adding a new block insertion (e.g., table, footnote)
- Extending live preview to render a new markdown syntax

## Touch points (4-5 files per feature)

### 1. Toggle command — `src/editor/format.ts`
- **Inline markers**: Use `toggleInlineWrap(view, marker)` for symmetric pairs (`**`, `*`, `__`, `~~`, `==`)
- **Line prefixes**: Use `toggleLinePrefix(view, prefix)` for line-start toggles (`> `, `- `)
- **Specialized**: See `toggleHeading`, `toggleOrderedList`, `toggleTaskList` for complex logic
- Add a `KeyBinding` entry in `formatKeymap[]` — use `Meta-` (Cmd), `Alt-` (Option), or `Meta-Shift-` prefix

### 2. Live preview decoration — `src/editor/live-preview.ts`
- In `buildDecorations()` → `tree.iterate()` → `enter()` callback
- Find the Lezer node name for the syntax (inspect tree or check @lezer/markdown source)
- Call `handleInlineMarkers(node, decorations, "cm-live-CLASSNAME")` to hide markers + apply class
- **Gotcha**: Lezer reuses node names — `StrongEmphasis` covers both `**` and `__`. Check marker text via `node.node.firstChild` to differentiate

### 3. CSS styling — `src/styles.css`
- Add `.cm-live-CLASSNAME` rule near the other live preview classes (~line 285+)
- Use HSL/HSLA for all color values
- For CM6 chrome overrides, use `EditorView.theme()` in extensions.ts — never `!important` for base rules

### 4. Menu item — `src-tauri/src/menu.rs`
- Add `MenuItem::with_id(handle, "format-xxx", "Label", true, Some("Accelerator"))?`
- The catch-all `_ if id.starts_with("format-")` in `lib.rs` auto-routes to frontend — no change needed there

### 5. Menu event handler — `src/main.ts`
- Add case in the `menu-event` listener: `case "format-xxx": if (editor) yourFunction(editor); break;`

## Key conventions
- Keyboard shortcuts: `Meta` = Cmd (macOS), `Alt` = Option, always set both `key` and `mac` in KeyBinding
- Colors: always HSL/HSLA
- CM6 theming: use `EditorView.theme()` to match CM6's internal specificity layer
- Verify with `npx tsc --noEmit` after changes

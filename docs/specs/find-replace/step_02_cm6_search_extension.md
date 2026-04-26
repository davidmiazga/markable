# Step 02 — Register @codemirror/search Extension

**Goal:** Add the CM6 search extension, its keymap, and a search theme module to `extensions.ts`. Ensure the correct v6.x version of `@codemirror/search` is resolved.

**Requirements covered:** FR-2.1, FR-2.2, FR-2.3, FR-2.4, FR-5 (all), FR-6 (all), FR-7 (all), FR-8, TC-2, TC-3, TC-6, EC-2, EC-4, EC-5, EC-6, EC-7, EC-11, EC-12, EC-13

**Files to change:**
- `package.json` (add direct dependency)
- `src/editor/extensions.ts` (add imports + 3 entries in `buildExtensions()`)
- `src/editor/search-theme.ts` (new file)

---

## 1. Fix the @codemirror/search Version Conflict

### The Problem

`node_modules/@codemirror/search` currently resolves to **v0.20.1** — a pre-v6 package with an incompatible `StateField`/`StateEffect` API. The correct v6.6.0 is nested at `node_modules/codemirror/node_modules/@codemirror/search/` and is only consumed by the `codemirror` meta-package.

If `extensions.ts` imports from `@codemirror/search` without fixing this, the import will resolve to v0.20.1 and the `searchState` `StateField` will be from a different CM6 version, causing runtime crashes.

### The Fix

Add `@codemirror/search` as a direct dependency in `package.json`. npm will hoist v6 to the top-level `node_modules/@codemirror/search`, shadowing the stale v0.20.1 entry.

**In `package.json`, inside the `"dependencies"` object, add:**

```json
"@codemirror/search": "^6.5.0",
```

Place it alphabetically with the other `@codemirror/*` packages (after `@codemirror/basic-setup`).

**After editing `package.json`, run:**

```bash
npm install
```

**Verify the resolution:**

```bash
cat node_modules/@codemirror/search/package.json | grep '"version"'
# Must print: "version": "6.x.x"  (not 0.20.x)
```

If the version is still 0.20.x, run `npm dedupe` or delete `node_modules/@codemirror/search` and re-run `npm install`.

---

## 2. Create `src/editor/search-theme.ts`

Create this file from scratch. It exports a single `EditorView.theme()` block that maps CM6 search panel DOM classes to CSS custom properties.

```typescript
/**
 * Search panel theme for Markable.
 *
 * Maps CM6's injected search panel DOM classes to CSS custom properties
 * defined in styles.css, so the panel respects the active theme automatically.
 *
 * Selector reference:
 *   .cm-search          — the panel container div
 *   .cm-textfield       — search and replace input fields
 *   .cm-button          — next / prev / replace / replace all / close buttons
 *   .cm-searchMatch     — all non-active match highlights in the document
 *   .cm-searchMatch-selected — the currently active match highlight
 *   .cm-panels          — the CM6 panel host element (bottom strip)
 */
import { EditorView } from "@codemirror/view";

export const searchTheme = EditorView.theme({
  ".cm-panels": {
    backgroundColor: "var(--search-panel-bg)",
    borderTop: "1px solid var(--search-panel-border)",
    color: "var(--text-primary)",
  },
  ".cm-search": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "6px",
    padding: "8px 12px",
    fontSize: "13px",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  ".cm-search label": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    color: "var(--text-secondary)",
    fontSize: "12px",
    userSelect: "none",
  },
  ".cm-textfield": {
    backgroundColor: "var(--bg-primary)",
    color: "var(--text-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: "4px",
    padding: "3px 7px",
    fontSize: "13px",
    fontFamily: "inherit",
    outline: "none",
    minWidth: "160px",
  },
  ".cm-textfield:focus": {
    borderColor: "var(--link-color)",
    boxShadow: "0 0 0 2px color-mix(in srgb, var(--link-color) 20%, transparent)",
  },
  // EC-3: zero matches — CM6 adds this class to the search input
  ".cm-textfield.cm-not-found": {
    borderColor: "hsl(0, 72%, 51%)",
    backgroundColor: "color-mix(in srgb, hsl(0, 72%, 51%) 12%, var(--bg-primary))",
  },
  ".cm-button": {
    backgroundColor: "var(--bg-primary)",
    color: "var(--text-primary)",
    border: "1px solid var(--border-color)",
    borderRadius: "4px",
    padding: "3px 10px",
    fontSize: "12px",
    fontFamily: "inherit",
    cursor: "pointer",
    lineHeight: "1.4",
    transition: "background-color 0.1s ease",
  },
  ".cm-button:hover": {
    backgroundColor: "color-mix(in srgb, var(--text-primary) 8%, var(--bg-primary))",
  },
  ".cm-button:active": {
    backgroundColor: "color-mix(in srgb, var(--text-primary) 16%, var(--bg-primary))",
  },
  // FR-6.1: all matches
  ".cm-searchMatch": {
    backgroundColor: "var(--search-match-bg)",
    outline: "none",
    borderRadius: "2px",
  },
  // FR-6.2: active match
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--search-match-selected-bg)",
    outline: "1px solid color-mix(in srgb, var(--search-match-selected-bg) 80%, transparent)",
  },
});
```

**Notes on the class names:**
- `.cm-not-found` is the class CM6 adds to the search input when no match is found (EC-3). Verify the exact class name by inspecting the CM6 v6.6.0 source: search for `"cm-not-found"` in `node_modules/codemirror/node_modules/@codemirror/search/dist/index.js`. If the class name differs, update this selector.
- `color-mix()` is supported in all WebKit versions that ship with macOS Ventura+. Since Markable targets macOS Sequoia+, this is safe.
- The `br` element CM6 inserts between the find row and replace row (`elt("br")` in `SearchPanel`) naturally wraps the layout in flex-wrap mode, placing the replace row on a new line.

---

## 3. Modify `src/editor/extensions.ts`

### 3a. Add imports

At the top of `extensions.ts`, after the existing imports, add:

```typescript
import { search, searchKeymap } from "@codemirror/search";
import { searchTheme } from "./search-theme";
```

The full import block at the top of the file should become:

```typescript
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { HighlightExtension } from "./highlight-ext";
import { Compartment, type Extension, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { search, searchKeymap } from "@codemirror/search";
import { livePreviewExtension } from "./live-preview";
import { formatKeymap } from "./format";
import { searchTheme } from "./search-theme";
```

### 3b. Modify `buildExtensions()`

The current `buildExtensions()` return sequence is:

```typescript
extensions.push(EditorView.lineWrapping);
extensions.push(Prec.high(keymap.of(formatKeymap)));
extensions.push(baseTheme);
extensions.push(syntaxHighlighting(themeHighlight));
extensions.push(previewCompartment.of(previewExtensions));
```

Change it to:

```typescript
extensions.push(EditorView.lineWrapping);
extensions.push(Prec.high(keymap.of(formatKeymap)));
// TC-3: searchKeymap at Prec.high so it is not shadowed by basicSetup's default keymaps.
// Verified: Mod-f, Mod-g, Mod-Shift-g, F3, Escape do not conflict with formatKeymap.
extensions.push(Prec.high(keymap.of(searchKeymap)));
// FR-2.2: top: false is CM6's default (panel at bottom). Explicit for clarity.
// EC-13: In non-literal mode, CM6 converts pasted newlines to "\\n" in defaultQuery.
//        In literal mode, a newline searches for the actual newline character (line break).
//        This behavior is CM6's default and requires no additional handling.
extensions.push(search({ top: false }));
extensions.push(baseTheme);
// FR-4.4: searchTheme is registered after basicSetup (added in editor.ts) and after baseTheme
//         so it wins specificity on .cm-panels, .cm-textfield, .cm-button, and match highlights.
extensions.push(searchTheme);
extensions.push(syntaxHighlighting(themeHighlight));
extensions.push(previewCompartment.of(previewExtensions));
```

### Complete `buildExtensions()` after the change

```typescript
export function buildExtensions(): Extension[] {
  const extensions: Extension[] = [];

  try {
    extensions.push(markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [HighlightExtension] }));
  } catch (error) {
    console.warn("Failed to load Markdown extension:", error);
  }

  extensions.push(EditorView.lineWrapping);
  extensions.push(Prec.high(keymap.of(formatKeymap)));
  // TC-3: searchKeymap at Prec.high so it is not shadowed by basicSetup's default keymaps.
  // Verified: Mod-f, Mod-g, Mod-Shift-g, F3, Escape do not conflict with formatKeymap.
  extensions.push(Prec.high(keymap.of(searchKeymap)));
  // FR-2.2: top: false is CM6's default (panel at bottom). Explicit for clarity.
  // EC-13: In non-literal mode, CM6 converts pasted newlines to "\\n" in defaultQuery.
  //        In literal mode, a newline matches actual line break characters.
  //        This is CM6 default behavior; no additional handling required.
  extensions.push(search({ top: false }));
  extensions.push(baseTheme);
  // FR-4.4: searchTheme registered after basicSetup and baseTheme to win specificity.
  extensions.push(searchTheme);
  extensions.push(syntaxHighlighting(themeHighlight));
  extensions.push(previewCompartment.of(previewExtensions));

  return extensions;
}
```

---

## 4. Verify Live Preview Compatibility (FR-8)

No changes to `live-preview.ts` are required. Document the following verified behaviors:

- **FR-8.1 (EC-11):** `openSearchPanel` dispatches a `StateEffect` that appends `searchExtensions` to the state configuration. It does not touch `previewCompartment`. Calling `togglePreview` while the search panel is open will reconfigure only `previewCompartment`, leaving search state intact.
- **FR-8.2:** CM6 searches `view.state.doc` (the raw text), not the rendered DOM. Hidden Markdown syntax (e.g., `**` around bold text) exists in the raw document and will be matched. The live preview decorations do not affect the document model.
- **FR-8.3:** CM6's `findNext` sets the selection to the matched range. The live preview extension re-evaluates line decorations on every `ViewUpdate` (it reads `update.view.state.selection`). After navigation, the cursor is on the matched line, and the live preview decoration evaluates correctly.
- **FR-8.4 (EC-21):** The search panel is inside `#editor`, which has `overflow: hidden`. The panel uses `flex-wrap: wrap` in `searchTheme`. At 400px window width, controls will wrap to additional lines rather than overflow. The `min-width: 160px` on `.cm-textfield` may cause horizontal scrolling within the panel on extremely narrow windows, but will not clip the close button.

---

## Acceptance Criteria for Step 02

- [ ] `npm install` completes with no errors.
- [ ] `cat node_modules/@codemirror/search/package.json | grep '"version"'` prints `6.x.x`.
- [ ] `tsc --noEmit` passes with no errors.
- [ ] `npm run dev` starts without console errors.
- [ ] Pressing Cmd-F in the running app opens the search panel at the bottom of the editor.
- [ ] Pressing Cmd-G (with a search term entered) advances to the next match.
- [ ] Pressing Escape closes the panel.
- [ ] Toggling live preview (Cmd-E) while the search panel is open does not close the panel.
- [ ] Opening a new file closes the search panel (EC-12: when `newFile()` replaces document content, CM6 resets the view, which closes the panel).
- [ ] No TODO comments in `extensions.ts` or `search-theme.ts`.

# Step 01 — Paste Link (Cmd-K)

**Requirements:** `docs/requirements/active_task.md` §2 Feature 1, §3 EC-L1–L6, §4 AC-L1–L7
**Files modified:**
- `src/editor/format.ts`
- `src-tauri/src/menu.rs`
- `src-tauri/src/lib.rs`
- `src/main.ts`

---

## 1. Overview

`insertLink` is an async function that reads the clipboard once, decides which of
four Markdown link templates to insert, dispatches a single CM6 transaction, and
returns. The keymap binding calls it with the `void asyncFn(view); return true`
pattern so the CM6 `run` callback remains synchronous. The menu item fires the
same shared function via a `"format-link"` menu-event case.

---

## 2. `src/editor/format.ts`

### 2a. New function — `insertLink`

Add immediately before the `formatKeymap` array declaration.

```typescript
/**
 * Insert a Markdown link at the cursor or wrap the current selection.
 *
 * Reads the clipboard asynchronously. Covers four cases:
 *   - selection + valid URL  → [selection](url)
 *   - selection + no URL     → [selection]()   cursor inside ()
 *   - no selection + valid URL  → [](url)      cursor inside []
 *   - no selection + no URL     → []()         cursor inside []
 *
 * URL validity: /^https?:\/\/\S+/ tested on the trimmed clipboard string.
 * On clipboard read failure: falls back to the "no URL" path silently.
 */
export async function insertLink(view: EditorView): Promise<void> {
  const URL_RE = /^https?:\/\/\S+/;

  let url = "";
  try {
    const raw = await navigator.clipboard.readText();
    const trimmed = raw.trim();
    if (URL_RE.test(trimmed)) {
      url = trimmed;
    }
  } catch (err) {
    console.warn("insertLink: clipboard read failed, using empty URL", err);
  }

  const state = view.state;
  const { from, to } = state.selection.main;
  const hasSelection = from !== to;

  if (hasSelection) {
    const label = state.doc.sliceString(from, to);
    if (url) {
      // [label](url)
      view.dispatch({
        changes: { from, to, insert: `[${label}](${url})` },
        selection: { anchor: from + label.length + url.length + 4 },
      });
    } else {
      // [label]()  — cursor between the parens
      const insert = `[${label}]()`;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length - 1 },
      });
    }
  } else {
    if (url) {
      // [](url)  — cursor between the square brackets
      const insert = `[](${url})`;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + 1 },
      });
    } else {
      // []()  — cursor between the square brackets
      view.dispatch({
        changes: { from, to, insert: `[]()` },
        selection: { anchor: from + 1 },
      });
    }
  }

  view.focus();
}
```

### 2b. New `formatKeymap` entry

Append to the `formatKeymap` array. The `void` prefix satisfies CM6's
synchronous `run` contract while still executing the async clipboard read.

```typescript
{ key: "Meta-k", mac: "Meta-k", run: (v) => { void insertLink(v); return true; } },
```

---

## 3. `src-tauri/src/menu.rs`

### 3a. Format menu — Insert Link item

The Format menu currently has `format-highlight` at line 102 followed immediately
by a separator and then `format-code-fence`. Add a new separator and
`format-link` between `format-highlight` and that existing separator.

Replace this block in `format_menu`:

```rust
            &MenuItem::with_id(handle, "format-highlight", "Highlight", true, Some("CmdOrCtrl+Shift+H"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "format-code-fence", "Code Fence", true, Some("CmdOrCtrl+Shift+C"))?,
```

With:

```rust
            &MenuItem::with_id(handle, "format-highlight", "Highlight", true, Some("CmdOrCtrl+Shift+H"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "format-link", "Insert Link...", true, Some("CmdOrCtrl+K"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "format-code-fence", "Code Fence", true, Some("CmdOrCtrl+Shift+C"))?,
```

Result: the Format menu reads `... Highlight | Insert Link... | Code Fence ...`
with separators bracketing the new item.

---

## 4. `src-tauri/src/lib.rs`

`format-link` is automatically forwarded by the existing catch-all arm:

```rust
_ if id.starts_with("format-") || id.starts_with("recent-file-") => true,
```

No change to `lib.rs` is required for this feature.

---

## 5. `src/main.ts`

### 5a. Import

Add `insertLink` to the existing destructured import from `"./editor/format"`:

```typescript
import {
  toggleHeading,
  toggleInlineWrap,
  toggleLinePrefix,
  toggleOrderedList,
  toggleTaskList,
  insertCodeFence,
  insertHorizontalRule,
  indentLines,
  outdentLines,
  clearFormatting,
  insertLink,           // <-- add this line
} from "./editor/format";
```

### 5b. `menu-event` switch case

Add the new case immediately after `case "format-highlight"` and before
`case "format-code-fence"`. The `void` prefix matches the pattern used for
`file-export` in the same switch:

```typescript
      case "format-link":
        if (!editor) break;
        void insertLink(editor);
        break;
```

---

## 6. Behavior Matrix (verification)

| Condition | Transaction produced |
|-----------|---------------------|
| Selection="hello", URL="https://x.com" | `[hello](https://x.com)` replaces selection; cursor after `)` |
| Selection="hello", URL="" | `[hello]()` replaces selection; cursor between `()` |
| No selection, URL="https://x.com" | `[](https://x.com)` inserted; cursor between `[]` |
| No selection, URL="" | `[]()` inserted; cursor between `[]` |
| Clipboard throws | Same as URL="" path; `console.warn` fired |
| Clipboard has `"  https://x.com\n"` | trimmed to `"https://x.com"`, treated as valid URL |
| Clipboard has `"ftp://example.com"` | regex fails; treated as no valid URL |

---

## 7. Acceptance Criteria Traceability

| AC | Satisfied by |
|----|-------------|
| AC-L1 | `hasSelection && url` branch |
| AC-L2 | `hasSelection && !url` branch |
| AC-L3 | `!hasSelection && url` branch |
| AC-L4 | `!hasSelection && !url` branch |
| AC-L5 | `format-link` MenuItem with `CmdOrCtrl+K` accelerator |
| AC-L6 | Shared `insertLink` function called from both keymap and menu-event |
| AC-L7 | `catch` block with `console.warn`; no alert |

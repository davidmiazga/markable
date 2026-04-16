---
title: "Step 6: Auto-Complete Source"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Step 6: Auto-Complete Source

## Goal

Implement a CM6 `CompletionSource` that activates when the user types `[[`, shows `.md` filenames from the current directory, and inserts the selected filename with closing `]]`.

## Acceptance Criteria

1. Typing `[[` triggers the autocomplete popup.
2. The popup lists `.md` files from the current file's directory (from cached file list).
3. Filenames are displayed without the `.md` extension.
4. Selecting a completion inserts the filename (without `.md`) and appends `]]`.
5. If `]]` already exists immediately after the cursor, the completion does not insert duplicate brackets.
6. The current file is excluded from the completion list (FR-4.5).
7. If no files match the typed prefix, the popup does not appear (standard CM6 behavior).
8. If `window.__CM_AUTOCOMPLETE__` is not available, autocomplete is not registered (EC-29).
9. If `__MARKABLE_CURRENT_FILE__` is null (untitled doc), the file list is empty.

## Design

### CM6 Autocomplete Global Access

```typescript
function getCmAutocomplete() {
  return (window as any).__CM_AUTOCOMPLETE__ as
    typeof import("@codemirror/autocomplete") | undefined;
}
```

If undefined, `buildAutocompleteExtension()` returns an empty array (no extension registered).

### Cached File List

The file list is a module-level variable managed by the index builder (step 7):

```typescript
/** Cached list of sibling .md filenames. Updated by the index builder. */
let _cachedFileList: string[] = [];

/** Update the cached file list. Called by the index builder after listMdFiles(). */
export function setCachedFileList(files: string[]): void {
  _cachedFileList = files;
}
```

### Completion Source

```typescript
function wikiLinkCompletionSource(context: CompletionContext): CompletionResult | null {
  // Match text: [[ followed by optional non-]] characters
  const before = context.matchBefore(/\[\[([^\]\n]*)/);
  if (!before) return null;

  // The typed text after [[ is the filter prefix
  const prefix = before.text.slice(2); // skip the [[

  // Check if we're inside an already-closed wiki-link (]] exists before next [[)
  // If ]] appears before cursor in the same match, we're editing an existing link
  // For simplicity: if the text between [[ and cursor contains ]], don't activate
  if (prefix.includes("]]")) return null;

  // Get current filename to exclude self (FR-4.5)
  const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
  const currentFilename = currentFile ? filenameFromPath(currentFile) : null;

  // Build completion options from cached file list
  const options = _cachedFileList
    .filter((f) => {
      // Exclude current file
      if (currentFilename && f.localeCompare(currentFilename, undefined, { sensitivity: "base" }) === 0) {
        return false;
      }
      return true;
    })
    .map((filename) => {
      // Display without .md extension
      const label = filename.endsWith(".md") ? filename.slice(0, -3) : filename;
      return {
        label,
        // apply: what gets inserted when the user selects this option
        apply: (view: EditorView, completion: Completion, from: number, to: number) => {
          // Check if ]] already follows the cursor
          const after = view.state.doc.sliceString(to, Math.min(to + 2, view.state.doc.length));
          const closingBrackets = after === "]]" ? "" : "]]";
          view.dispatch({
            changes: { from, to, insert: label + closingBrackets },
            selection: { anchor: from + label.length + closingBrackets.length },
          });
        },
      };
    });

  if (options.length === 0) return null;

  return {
    from: before.from + 2, // start after [[
    options,
    filter: true, // let CM6 filter by typed prefix
  };
}
```

### Extension Builder

```typescript
function buildAutocompleteExtension(): Extension[] {
  const cmAuto = getCmAutocomplete();
  if (!cmAuto) {
    console.warn("[backlinks] __CM_AUTOCOMPLETE__ not available; auto-complete disabled.");
    return [];
  }

  return [
    cmAuto.autocompletion({
      override: [wikiLinkCompletionSource],
      // Don't interfere with the editor's default completions
      // (there aren't any for Markdown, but future-proof)
    }),
  ];
}
```

**Important**: Using `override` replaces all completion sources. If other plugins add their own completions in the future, this would conflict. A safer approach is to use `completionSource` facet directly:

```typescript
function buildAutocompleteExtension(): Extension[] {
  const cmAuto = getCmAutocomplete();
  if (!cmAuto) {
    console.warn("[backlinks] __CM_AUTOCOMPLETE__ not available; auto-complete disabled.");
    return [];
  }

  // Use the autocompletion extension with our source added
  // This creates a standalone autocompletion instance for wiki-links
  return [
    cmAuto.autocompletion({
      override: [wikiLinkCompletionSource],
    }),
  ];
}
```

**Note**: Since Markable does not currently have any other autocomplete sources, `override` is acceptable. If future plugins need their own completions, the architecture should be revisited to use a shared `autocompletion()` with multiple sources.

## TDD Test Plan

```
describe("wikiLinkCompletionSource", () => {
  test("returns completions when cursor is after [[")
  test("returns null when cursor is not after [[")
  test("filters completions by typed prefix")
  test("excludes current file from completions (FR-4.5)")
  test("displays filenames without .md extension")
  test("returns null when no files match (EC-22)")
  test("returns null for untitled document (EC-1, __MARKABLE_CURRENT_FILE__ is null)")
  test("handles empty wiki-link [[ with cursor right after (EC-9)")
  test("does not activate when ]] already closed before cursor")
})

describe("completion apply", () => {
  test("inserts filename + ]] when no closing brackets exist")
  test("inserts filename only when ]] already follows cursor (EC-23)")
})

describe("buildAutocompleteExtension", () => {
  test("returns empty array when __CM_AUTOCOMPLETE__ is undefined (EC-29)")
  test("returns autocompletion extension when global is available")
})
```

## Edge Cases Addressed

| EC | Handling |
|---|---|
| EC-1 | When `__MARKABLE_CURRENT_FILE__` is null, `_cachedFileList` is empty (set by index builder which skips untitled docs), so no completions appear |
| EC-9 | `matchBefore(/\[\[([^\]\n]*)/)` matches `[[` with empty string after -- completions show all files |
| EC-22 | When no files match the prefix, `options.length === 0` returns null -- popup does not appear |
| EC-23 | The `apply` function checks the 2 characters after the cursor for `]]` and skips inserting duplicate brackets |
| EC-29 | `getCmAutocomplete()` returns undefined; `buildAutocompleteExtension()` returns empty array and logs warning |

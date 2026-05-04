---
title: Step 03 — Replace pipeline
last-updated: "2026-05-03"
review-cadence-days: 90
status: active
---

# Step 03 — Replace pipeline

## Objective

Implement the per-match and per-file replace operations for vault scope:

1. `replaceInFile()` — the core helper that reads, modifies, and writes a single
   file, with tab collision detection (FR-8, FR-9, NFR-3).
2. `_replaceVaultMatch()` — replaces the single focused match in the results
   panel (FR-6 "Replace" button).
3. `_replaceAllInFile()` — replaces all matches in the focused file group
   (FR-6 "In File" button).
4. Wire the replace buttons in `_attachEvents()`.

The "Replace All in Vault" confirmation flow (FR-7) is deferred to step_04.
The existing single-file replace behaviour (`replaceAll(this.view)`) is unchanged.

After this step `npm run test:run` must pass.

---

## Files to edit

- `src/editor/vault-search-utils.ts` — no changes needed (already complete from step_02)
- `src/editor/find-widget.ts` — new methods + wiring

---

## New imports in `find-widget.ts`

Add to existing import block at the top of the file:

```typescript
import { readFile, writeFile } from "../lib/bridge";
import { applyStringReplace } from "../editor/vault-search-utils";
import type { PostFilterOptions } from "../editor/vault-search-utils";
```

Also import `Transaction` from `@codemirror/state` for the CM6 state update:

```typescript
import { EditorSelection } from "@codemirror/state";
```

---

## New private method: `_getPostFilterOpts()`

A convenience accessor used by all replace operations:

```typescript
private _getPostFilterOpts(): PostFilterOptions {
  return {
    matchCase: this._matchCase,
    wholeWord: this._wholeWord,
  };
}
```

---

## New private method: `_replaceInFile(path, findTerm, replaceTerm)`

This is the core file I/O method. It handles the dirty-tab collision (FR-9,
EC-7) and the on-disk write (FR-8).

```typescript
/**
 * Read, modify, and write a single file.
 *
 * @param path        - Absolute path to the target file.
 * @param findTerm    - The literal search term.
 * @param replaceTerm - The replacement string (may be empty for deletion, EC-13).
 * @returns The number of replacements made, or -1 if the operation was
 *          cancelled (user declined dirty-tab prompt).
 */
private async _replaceInFile(
  path: string,
  findTerm: string,
  replaceTerm: string,
): Promise<number> {
  // FR-8 step 1: Read current on-disk content.
  const readResult = await readFile(path);
  if (!readResult.ok) {
    console.error(`FindWidget: readFile failed for "${path}":`, readResult.error.message);
    return 0;
  }

  const opts = this._getPostFilterOpts();
  const { newContent, count } = applyStringReplace(
    readResult.value,
    findTerm,
    replaceTerm,
    opts,
  );

  // EC-6: If find term no longer exists in current content, skip the write.
  if (count === 0) {
    return 0;
  }

  // FR-9 / EC-7: Check for dirty-tab collision.
  const tm = (window as any).__MARKABLE_TAB_MANAGER__;
  const tabs: Array<{ filePath: string | null; isDirty: boolean; id: string }> =
    tm?.getTabs?.() ?? [];
  const openTab = tabs.find((t) => t.filePath === path);

  if (openTab?.isDirty) {
    // FR-9: Prompt the user — do not silently overwrite.
    const basename = path.split("/").pop() ?? path;
    const confirmed = await this._confirmDirtyTabReplace(basename);
    if (!confirmed) {
      // User cancelled this file — return -1 to signal a skip.
      return -1;
    }
    // FR-9: User confirmed — apply to CM6 editor state so the tab stays dirty.
    this._applyReplaceToEditorState(newContent);
    return count;
  }

  if (openTab && !openTab.isDirty) {
    // NFR-3: File is open but not dirty — apply replacement to CM6 state so
    // the user sees updated content immediately. Then write to disk.
    // This keeps undo history intact for in-memory changes.
    this._applyReplaceToEditorState(newContent);
  }

  // FR-8 step 3: Atomic write.
  const writeResult = await writeFile(path, newContent);
  if (!writeResult.ok) {
    console.error(`FindWidget: writeFile failed for "${path}":`, writeResult.error.message);
    // Return count even though write failed; the caller surfaces the error.
    // We throw here so step_04's batch loop can catch it as a per-file error.
    throw new Error(writeResult.error.message);
  }

  return count;
}
```

---

## New private method: `_confirmDirtyTabReplace(basename)`

Shows a browser-native confirm dialog. In a Tauri app this can use
`window.__TAURI_DIALOG__.confirm` which is already registered in `main.ts`
(line 916–922).

```typescript
private async _confirmDirtyTabReplace(basename: string): Promise<boolean> {
  const dialog = (window as any).__TAURI_DIALOG__;
  if (dialog?.confirm) {
    return dialog.confirm(
      `The file "${basename}" has unsaved changes. Replace anyway and discard unsaved changes?`,
      { title: "Unsaved Changes" }
    );
  }
  // Fallback to browser confirm (test environments).
  return window.confirm(
    `The file "${basename}" has unsaved changes. Replace anyway and discard unsaved changes?`
  );
}
```

---

## New private method: `_applyReplaceToEditorState(newContent)`

Updates the active CM6 editor view so in-memory content stays consistent with
the replacement (NFR-3, NFR-5). Also clears stale search decorations.

```typescript
private _applyReplaceToEditorState(newContent: string): void {
  if (!this.view) return;
  const currentDoc = this.view.state.doc.toString();
  if (currentDoc === newContent) return;

  // Replace the entire document content in a single CM6 transaction.
  this.view.dispatch({
    changes: {
      from: 0,
      to: this.view.state.doc.length,
      insert: newContent,
    },
    // Clear search decorations by dispatching an updated (empty) query.
    effects: setSearchQuery.of(
      new SearchQuery({ search: this.findInput.value })
    ),
  });
}
```

---

## New private method: `_replaceVaultMatch()`

Called by the "Replace" button click when vault scope is active and a match is
focused. If no match is focused, falls back to the single-file CM6 replace.

```typescript
private async _replaceVaultMatch(): Promise<void> {
  const match = this._focusedMatch;
  const replaceTerm = this.replaceInput.value;
  const findTerm = this.findInput.value;

  if (!match || this._scope === "file") {
    // AC-8: No focused match in vault results — fall back to CM6 replace.
    replaceNext(this.view);
    this._updateCount(this._buildSearchQuery());
    return;
  }

  const result = await this._replaceInFile(match.filePath, findTerm, replaceTerm);
  // -1 means user cancelled; 0 means nothing to replace.
  if (result > 0) {
    // Refresh results to reflect the change.
    await this._runVaultSearch();
  }
}
```

---

## New private method: `_replaceAllInFile()`

Called by the "In File" button. Replaces all matches in the focused file group.

```typescript
private async _replaceAllInFile(): Promise<void> {
  const filePath = this._focusedFilePath;
  const findTerm = this.findInput.value;
  const replaceTerm = this.replaceInput.value;

  if (!filePath || !findTerm) return;

  try {
    const result = await this._replaceInFile(filePath, findTerm, replaceTerm);
    if (result !== -1) {
      // Refresh results (including when result === 0, EC-6).
      await this._runVaultSearch();
    }
  } catch (err) {
    // NFR-6: Surface write error without aborting (no batch here, so just log).
    console.error("FindWidget: _replaceAllInFile error:", err);
  }
}
```

---

## Wire the new methods in `_attachEvents()`

### Modify the existing `replaceOneBtn` handler

The existing handler is (from the current file):

```typescript
this.replaceOneBtn.addEventListener("click", () => {
  replaceNext(this.view);
  this._updateCount(this._buildSearchQuery());
});
```

Replace it with:

```typescript
this.replaceOneBtn.addEventListener("click", () => {
  if (this._scope !== "file") {
    void this._replaceVaultMatch();
  } else {
    replaceNext(this.view);
    this._updateCount(this._buildSearchQuery());
  }
});
```

### Add the `replaceInFileBtn` handler (new button from step_02)

After the replaceOneBtn handler:

```typescript
this.replaceInFileBtn.addEventListener("click", () => {
  void this._replaceAllInFile();
});
```

### The `replaceAllBtn` handler stays unchanged for now

In step_04 it will be intercepted for vault scope. For this step it remains:

```typescript
this.replaceAllBtn.addEventListener("click", () => {
  if (this._scope === "file") {
    replaceAll(this.view);
    this._updateCount(this._buildSearchQuery());
  }
  // Vault scope "Replace All" will be wired in step_04.
  // Clicking it in vault scope does nothing yet (safe no-op).
});
```

---

## Tests to add to `tests/editor/find-widget-vault.test.ts`

These tests are pure-logic tests of `applyStringReplace` and the
`_replaceInFile` helper logic. Because `_replaceInFile` is a private method,
the tests exercise it by testing `applyStringReplace` + the surrounding
contract logic that the method implements.

No new test file is created — extend the existing
`tests/editor/find-widget-vault.test.ts` from step_02.

### Additional `applyStringReplace` tests

**Test AR-7 — applyStringReplace with special regex chars in find term (EC-14)**
```
result = applyStringReplace("price is $100 and $200", "$100", "$50", { matchCase: false, wholeWord: false })
assert result.newContent === "price is $50 and $200"
assert result.count === 1
```

**Test AR-8 — applyStringReplace wholeWord does not match partial term (EC-11)**
```
result = applyStringReplace("cats and concatenate and cat", "cat", "dog", { matchCase: false, wholeWord: true })
assert result.newContent === "dogs and concatenate and dog"
assert result.count === 2
```

**Test AR-9 — applyStringReplace with matchCase:true, wholeWord:true**
```
result = applyStringReplace("Cat cat CAT", "cat", "dog", { matchCase: true, wholeWord: true })
assert result.newContent === "Cat dog CAT"
assert result.count === 1
```

### Tests for `postFilterResults` with matchCase + wholeWord combined

**Test PF-6 — matchCase:true + wholeWord:true: only exact-case whole-word matches kept**
```
payload = makePayload([
  { path: "/a.md", title: "A", lines: [
    { lineText: "The Cat sat", lineNumber: 1, columnStart: 4 },      // "Cat" — correct case + whole word ✓
    { lineText: "The cat sat", lineNumber: 2, columnStart: 4 },      // "cat" — wrong case ✗
    { lineText: "The Catfish swam", lineNumber: 3, columnStart: 4 }, // "Cat" but partial word ✗
  ]},
])
result = postFilterResults(payload, "Cat", { matchCase: true, wholeWord: true })
assert result.results[0].matches.length === 1
assert result.results[0].matches[0].lineNumber === 1
```

---

## Acceptance criteria for this step

- AC-S3-1: Clicking "Replace" in vault scope with a focused match replaces that
  match and refreshes results.
- AC-S3-2: Clicking "Replace" in vault scope with no focused match falls back to
  CM6 `replaceNext` (single-file behaviour, AC-8).
- AC-S3-3: Clicking "In File" replaces all matches in the focused file group and
  refreshes results.
- AC-S3-4: When the target file is open in a tab with unsaved changes, a
  confirmation dialog is shown before writing (FR-9).
- AC-S3-5: Confirming the dirty-tab prompt applies the replacement to the CM6
  editor state (tab stays dirty); cancelling skips the file.
- AC-S3-6: When the find term is not present in the current file content (EC-6),
  no write is performed and no error is surfaced.
- AC-S3-7: All AR-* and PF-* tests pass (including new AR-7 through AR-9 and PF-6).
- AC-S3-8: Single-file replace behaviour is unchanged when scope is "file".

---

## After this step

```bash
npm run test:run -- tests/editor/find-widget-vault.test.ts
npm run test:run
```

All tests must pass. Proceed to step_04.

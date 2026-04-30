# Step 02 — New Helper Functions

**File**: `src/plugins/backlinks/backlinks.plugin.ts`
**Goal**: Add three new functions in the Step 10 section of the plugin, placed
immediately after `createPopoverElement` and before `dismissWikiPopover`.

The three functions are:

1. `resolveCreationPath` — pure function, no side effects
2. `createBrokenLinkPopoverElement` — DOM builder, analogous to `createPopoverElement`
3. `handleCreateNoteClick` — async orchestrator, exported for test access

---

## Placement in File

Insert all three functions between `createPopoverElement` (ends ~line 2621) and
the `dismissWikiPopover` comment block. Place them in this order:

```
// Step 10 section header (existing)
createPopoverElement()              ← existing, unchanged
// ── NEW: broken-link creation helpers ──
resolveCreationPath()               ← new
createBrokenLinkPopoverElement()    ← new
handleCreateNoteClick()             ← new
dismissWikiPopover()                ← existing, unchanged
showWikiPopover()                   ← existing, modified in step_03
```

---

## Function 1 — `resolveCreationPath`

Module-private. Pure function. No DOM access, no Tauri calls.

```typescript
/**
 * Resolve the absolute filesystem path where a new note should be created.
 *
 * Rules (FR-2):
 *  - No path prefix (e.g. "new idea")     → "{vaultRoot}/new idea.md"
 *  - Path prefix (e.g. "folder/note")     → "{vaultRoot}/folder/note.md"
 *  - Absolute path (leading "/")          → used verbatim, ".md" appended if absent
 *  - Anchor suffix (e.g. "note#intro")    → anchor stripped before extension
 *
 * Preserves the author's capitalisation of the raw target text.
 * Does NOT lowercase. The vault index lookup is case-insensitive so the
 * decoration re-classifies the link as valid regardless of case.
 *
 * @param rawTarget  - Raw wiki-link target string (from data-wiki-target attribute).
 * @param vaultRoot  - Absolute path of the vault root directory (no trailing slash).
 * @returns Absolute path for the new file (always ends in ".md").
 */
function resolveCreationPath(rawTarget: string, vaultRoot: string): string {
  // Strip #anchor suffix before constructing the filename (EC-15).
  const withoutAnchor = rawTarget.includes("#")
    ? rawTarget.slice(0, rawTarget.indexOf("#"))
    : rawTarget;

  // Ensure the path ends with ".md".
  const withExt = withoutAnchor.endsWith(".md")
    ? withoutAnchor
    : withoutAnchor + ".md";

  // Absolute path: return as-is (unusual but must not crash).
  if (withExt.startsWith("/")) {
    return withExt;
  }

  // Relative (with or without path prefix): always vault-root-relative (FR-2).
  return vaultRoot + "/" + withExt;
}
```

### Design notes

- `rawTarget` is the exact text from `data-wiki-target` on the span, which comes
  from `match.target` in `computeWikiLinkDecorationRanges`. This is the text
  between `[[` and `]]` (or before the pipe for `[[target|display]]` links).
- The function does NOT call `normalizeTarget()` because normalization
  lowercases the stem and strips whitespace, which would lose the author's
  intended capitalisation. FR-2 explicitly requires capitalisation to be
  preserved on disk.
- The function does NOT strip the path prefix for vault-relative resolution —
  the full relative path (`folder/note`) is appended to `vaultRoot` unchanged.
- Edge case: `rawTarget = "note.md"` → `withExt = "note.md"` (no double `.md`).

---

## Function 2 — `createBrokenLinkPopoverElement`

Module-private. DOM builder. Returns an unattached element (same contract as
`createPopoverElement`).

```typescript
/**
 * Build the "Create note" variant popover element for a broken wiki-link.
 *
 * Analogous to `createPopoverElement` but shows the stem title, the resolved
 * creation path, and a "Create note" button instead of a file excerpt.
 *
 * The returned element is NOT yet attached to the document. The caller
 * is responsible for appending it, setting `_activePopoverEl`, and
 * positioning it via `positionPopover`.
 *
 * @param displayStem       - The note title derived from the target (after
 *                            stripping path prefix and anchor). Used as the
 *                            title row text.
 * @param vaultRelativePath - Vault-root-relative path where the file will be
 *                            created (e.g. "folder/My Note.md"). Shown as the
 *                            subtitle row so the user knows where the file lands.
 * @returns A new `<div>` element with `data-markable-wiki-popover` attribute,
 *          title, path, and a button row appended.
 */
function createBrokenLinkPopoverElement(
  displayStem: string,
  vaultRelativePath: string
): HTMLElement {
  const popoverEl = document.createElement("div");
  popoverEl.setAttribute("data-markable-wiki-popover", "true");

  const titleEl = document.createElement("div");
  titleEl.className = "wl-popover-title";
  titleEl.textContent = displayStem;

  const pathEl = document.createElement("div");
  pathEl.className = "wl-popover-path";
  pathEl.textContent = vaultRelativePath;

  const btnEl = document.createElement("button");
  btnEl.className = "wl-popover-create-btn";
  btnEl.textContent = "Create note";
  // type="button" prevents accidental form submission in any ancestor form.
  btnEl.setAttribute("type", "button");

  popoverEl.appendChild(titleEl);
  popoverEl.appendChild(pathEl);
  popoverEl.appendChild(btnEl);

  return popoverEl;
}
```

### Design notes

- The excerpt row is intentionally omitted (the file does not exist yet).
- The button carries `type="button"` as a defensive best practice.
- No event listeners are attached here — `handleCreateNoteClick` is wired up
  by `showWikiPopover` after the element is built. This keeps the DOM builder
  pure and easily testable.

---

## Function 3 — `handleCreateNoteClick`

**Exported** (for test access). Async. Contains all file-creation side effects.

```typescript
/**
 * Handle the "Create note" button click.
 *
 * Called from an event listener wired by `showWikiPopover` when the user
 * clicks the button in the broken-link popover. Exported for test access.
 *
 * Steps:
 *  1. Version guard — abort if the popover was dismissed while the click
 *     event was in the browser queue (EC-11, NFR-4).
 *  2. Null-guard the window globals (EC-2).
 *  3. Call `ensure_directory` for the parent directory of the target path.
 *     On error: show an inline error message inside the popover and return.
 *  4. Call `write_file` with the initial content `# {displayStem}\n` (FR-3).
 *     On error: show an inline error message inside the popover and return.
 *  5. Fire-and-forget `reloadVaultIndex()` (FR-4 step 1).
 *  6. Fire-and-forget `openFileInTab(absolutePath)` (FR-4 step 2).
 *  7. Call `dismissWikiPopover()` (FR-4 step 3).
 *
 * @param absolutePath    - Resolved absolute path for the new file.
 * @param displayStem     - Display title used as the H1 heading in the new file.
 * @param capturedVersion - The `_hoverFetchVersion` value captured when the
 *                          button was rendered. Used for EC-11 race safety.
 */
export async function handleCreateNoteClick(
  absolutePath: string,
  displayStem: string,
  capturedVersion: number
): Promise<void> {
  // EC-11: abort if the popover was dismissed while this click was queued.
  if (capturedVersion !== _hoverFetchVersion) return;

  // EC-2: null-guard globals before use.
  const vaultManager = (window as any).__MARKABLE_VAULT_MANAGER__;
  const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;

  if (!vaultManager) {
    console.warn("[backlinks] handleCreateNoteClick: __MARKABLE_VAULT_MANAGER__ missing");
    return;
  }

  // Step 3: ensure parent directory exists (EC-8).
  const parentDir = absolutePath.slice(0, absolutePath.lastIndexOf("/"));
  if (parentDir) {
    try {
      await (window as any).__TAURI_INTERNALS__.invoke("ensure_directory", {
        path: parentDir,
      });
    } catch (err) {
      _showInlinePopoverError(`Could not create folder: ${err}`);
      return;
    }
  }

  // EC-11: re-check version after the first await.
  if (capturedVersion !== _hoverFetchVersion) return;

  // Step 4: write the new file atomically.
  const initialContent = `# ${displayStem}\n`;
  try {
    await (window as any).__TAURI_INTERNALS__.invoke("write_file", {
      path: absolutePath,
      content: initialContent,
    });
  } catch (err) {
    _showInlinePopoverError(`Could not create note: ${err}`);
    return;
  }

  // EC-11: re-check version after the second await.
  if (capturedVersion !== _hoverFetchVersion) return;

  // Step 5: rebuild vault index (non-fatal).
  try {
    void vaultManager.reloadVaultIndex?.();
  } catch (err) {
    console.error("[backlinks] handleCreateNoteClick: reloadVaultIndex failed:", err);
  }

  // Step 6: open the new file in a tab (non-fatal).
  if (!tabManager || typeof tabManager.openFileInTab !== "function") {
    console.warn("[backlinks] handleCreateNoteClick: __MARKABLE_TAB_MANAGER__ missing or invalid");
  } else {
    try {
      void tabManager.openFileInTab(absolutePath);
    } catch (err) {
      console.error("[backlinks] handleCreateNoteClick: openFileInTab failed:", err);
    }
  }

  // Step 7: dismiss the popover.
  dismissWikiPopover();
}
```

### Inline error helper

Add the following private helper immediately before `handleCreateNoteClick`. It
is used only by `handleCreateNoteClick` and is not exported:

```typescript
/**
 * Replace the "Create note" button in the active popover with an inline
 * error message.
 *
 * Called when `ensure_directory` or `write_file` fails (FR-5). The popover
 * remains open so the user can read the error. If no active popover exists
 * (already dismissed) this is a no-op.
 *
 * @param message - Human-readable error string.
 */
function _showInlinePopoverError(message: string): void {
  if (!_activePopoverEl) return;

  const btn = _activePopoverEl.querySelector(".wl-popover-create-btn");
  if (btn) {
    const errEl = document.createElement("div");
    errEl.className = "wl-popover-error-msg";
    errEl.textContent = message;
    btn.replaceWith(errEl);
  }
}
```

---

## Acceptance Criteria

- `resolveCreationPath("new idea", "/vault")` returns `"/vault/new idea.md"`.
- `resolveCreationPath("folder/note", "/vault")` returns `"/vault/folder/note.md"`.
- `resolveCreationPath("note#section", "/vault")` returns `"/vault/note.md"` (anchor stripped).
- `resolveCreationPath("note.md", "/vault")` returns `"/vault/note.md"` (no double extension).
- `resolveCreationPath("/abs/path", "/vault")` returns `"/abs/path.md"` (absolute passthrough).
- `createBrokenLinkPopoverElement("My Note", "My Note.md")` returns a div with three children:
  `.wl-popover-title`, `.wl-popover-path`, `.wl-popover-create-btn`.
- `createBrokenLinkPopoverElement` does NOT attach the element to `document.body`.
- `handleCreateNoteClick` aborts without calling `write_file` when `capturedVersion` mismatches.
- `handleCreateNoteClick` calls `ensure_directory` before `write_file`.
- `handleCreateNoteClick` shows inline error when `ensure_directory` throws.
- `handleCreateNoteClick` shows inline error when `write_file` throws.
- `handleCreateNoteClick` calls `dismissWikiPopover` after successful write.
- `handleCreateNoteClick` does NOT throw when `__MARKABLE_TAB_MANAGER__` is absent.

---

## TDD Notes

### Red phase

Write tests in `tests/plugins/backlinks/create-note-from-broken-wikilink.test.ts`
that import and call `resolveCreationPath` (module-private, so must be accessed
via a `_testing` extension — see step_04 for the `_testing` additions).

`handleCreateNoteClick` is exported directly, so tests import it normally.

`createBrokenLinkPopoverElement` is module-private — accessed via `_testing`.

### Green phase

Implement the three functions as specified above. `resolveCreationPath` tests
pass immediately (pure function). DOM tests require jsdom (already configured
in Vitest). Async handler tests use `vi.spyOn` on `window.__TAURI_INTERNALS__`.

### Refactor notes

- The `parentDir` computation `absolutePath.slice(0, absolutePath.lastIndexOf("/"))`
  handles paths like `"/vault/note.md"` → `"/vault"` correctly. No external
  path library is used (NFR-1).
- The two intermediate EC-11 version checks after each `await` are intentional
  — they prevent tab-open from firing if the user dismisses mid-creation.

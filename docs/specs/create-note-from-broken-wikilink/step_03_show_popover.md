# Step 03 — Modify `showWikiPopover`

**File**: `src/plugins/backlinks/backlinks.plugin.ts`
**Goal**: Change the body of `showWikiPopover` to detect a broken-link span,
build the "Create note" popover variant, and wire the button click to
`handleCreateNoteClick`. The existing valid-link code path is unchanged.

---

## Current `showWikiPopover` body (reference)

Lines ~2683–2765. Key landmarks:

```typescript
export async function showWikiPopover(
  spanEl: HTMLElement,
  target: string
): Promise<void> {
  if (!_enabled) return;

  const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
  if (!currentFile) return;                              // ← guard A (untitled doc)

  _hoverFetchVersion++;
  const myVersion = _hoverFetchVersion;

  const resolvedPath = resolveWikiLinkPath(currentFile, target);
  const result = await invokeReadFile(resolvedPath);

  if (myVersion !== _hoverFetchVersion) return;
  if (!_enabled) return;

  if (!result.ok) {                                      // ← EC-01: silently abort
    console.debug("[backlinks] hover-popover: file not found:", resolvedPath);
    return;
  }

  const { title, pathLabel, excerpt } = extractPopoverContent(result.value, resolvedPath);

  dismissWikiPopover();

  const popoverEl = createPopoverElement(title, pathLabel, excerpt);
  document.body.appendChild(popoverEl);
  _activePopoverEl = popoverEl;

  positionPopover(spanEl, popoverEl);

  popoverEl.style.opacity = "0";
  popoverEl.style.display = "block";
  void popoverEl.offsetHeight;
  popoverEl.style.transition = "opacity 100ms ease, transform 100ms ease";
  popoverEl.style.opacity = "1";
  popoverEl.style.transform = "translate(0, 0)";
}
```

---

## Required Changes

### Change A — Remove guard that blocks untitled documents

The current guard at the top:

```typescript
const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
if (!currentFile) return;
```

This must be retained for the valid-link path (which needs `currentFile` to
call `resolveWikiLinkPath`). However the broken-link path does NOT require
`currentFile` — it only needs the vault root. The guard must be moved inside
each branch rather than sitting above both.

### Change B — Detect broken-link span and branch early

After incrementing `_hoverFetchVersion` and capturing `myVersion`, check
`spanEl.classList.contains('cm-wiki-link-broken')`. If true, take the
broken-link path and return from that branch (no file read needed).

### Change C — In the broken-link branch, guard `getActiveVault()`

If `getActiveVault()` returns null, return early (EC-1). No popover is shown.
This matches the requirements: "When no vault is active, the broken-link
popover is suppressed entirely."

---

## New `showWikiPopover` Body

Replace the entire function body with the following:

```typescript
export async function showWikiPopover(
  spanEl: HTMLElement,
  target: string
): Promise<void> {
  /* Guard: plugin must be enabled. */
  if (!_enabled) return;

  /*
   * Increment the fetch version BEFORE any branch so that dismissWikiPopover
   * increments correctly for both broken and valid paths (NFR-4, EC-11).
   */
  _hoverFetchVersion++;
  const myVersion = _hoverFetchVersion;

  // ── Broken-link path ──────────────────────────────────────────────────────

  if (spanEl.classList.contains("cm-wiki-link-broken")) {
    /*
     * EC-1: no vault active — suppress the broken-link popover entirely.
     * getActiveVault() is null when no vault folder has been opened.
     */
    const vaultManager = (window as any).__MARKABLE_VAULT_MANAGER__;
    const vaultRoot: string | undefined =
      vaultManager?.getActiveVault?.()?.rootPaths?.[0];

    if (!vaultRoot) return;

    /* Resolve the absolute creation path (FR-2). */
    const absolutePath = resolveCreationPath(target, vaultRoot);

    /* Derive the vault-relative path for the subtitle row. */
    const vaultRelPath = absolutePath.startsWith(vaultRoot + "/")
      ? absolutePath.slice(vaultRoot.length + 1)
      : absolutePath;

    /*
     * Derive the display stem: strip path prefix and anchor from the raw
     * target, preserving capitalisation (FR-3 title row).
     */
    const withoutAnchor = target.includes("#")
      ? target.slice(0, target.indexOf("#"))
      : target;
    const slashIdx = withoutAnchor.lastIndexOf("/");
    const displayStem = slashIdx === -1
      ? withoutAnchor
      : withoutAnchor.slice(slashIdx + 1);

    /* Dismiss any previously visible popover (FR-4.4). */
    dismissWikiPopover();

    /* Build and attach the broken-link popover DOM. */
    const brokenPopoverEl = createBrokenLinkPopoverElement(displayStem, vaultRelPath);
    document.body.appendChild(brokenPopoverEl);
    _activePopoverEl = brokenPopoverEl;

    /* Wire the button click to the creation handler. */
    const btn = brokenPopoverEl.querySelector(
      ".wl-popover-create-btn"
    ) as HTMLButtonElement | null;
    if (btn) {
      btn.addEventListener("click", () => {
        void handleCreateNoteClick(absolutePath, displayStem, myVersion);
      });
    }

    /* Position and fade in (same pattern as valid-link popover). */
    positionPopover(spanEl, brokenPopoverEl);
    brokenPopoverEl.style.opacity = "0";
    brokenPopoverEl.style.display = "block";
    void brokenPopoverEl.offsetHeight;
    brokenPopoverEl.style.transition = "opacity 100ms ease, transform 100ms ease";
    brokenPopoverEl.style.opacity = "1";
    brokenPopoverEl.style.transform = "translate(0, 0)";

    return; // broken-link branch ends here
  }

  // ── Valid-link path (existing code, unchanged) ────────────────────────────

  /*
   * EC-07: an untitled (unsaved) document has no file path.
   * Without a current file we cannot resolve the wiki-link target.
   * This guard only applies to the valid-link path.
   */
  const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
  if (!currentFile) return;

  /* Resolve the absolute path from the current file's directory. */
  const resolvedPath = resolveWikiLinkPath(currentFile, target);

  /* Fetch the file content. */
  const result = await invokeReadFile(resolvedPath);

  /* Stale-result guard. */
  if (myVersion !== _hoverFetchVersion) return;

  /* Guard again after await. */
  if (!_enabled) return;

  /* EC-01: file not found or read error — silently abort. */
  if (!result.ok) {
    console.debug("[backlinks] hover-popover: file not found:", resolvedPath);
    return;
  }

  const { title, pathLabel, excerpt } = extractPopoverContent(
    result.value,
    resolvedPath
  );

  dismissWikiPopover();

  const popoverEl = createPopoverElement(title, pathLabel, excerpt);
  document.body.appendChild(popoverEl);
  _activePopoverEl = popoverEl;

  positionPopover(spanEl, popoverEl);

  popoverEl.style.opacity = "0";
  popoverEl.style.display = "block";
  void popoverEl.offsetHeight;
  popoverEl.style.transition = "opacity 100ms ease, transform 100ms ease";
  popoverEl.style.opacity = "1";
  popoverEl.style.transform = "translate(0, 0)";
}
```

---

## Key Design Decisions

### Why `_hoverFetchVersion++` happens before the branch check

The version counter must be incremented at the top of the function so that
`dismissWikiPopover` (which also increments it) and `showWikiPopover` stay
in sync regardless of which branch is taken. If the increment were inside
the valid-link branch only, a dismiss that fires while the broken-link popover
is being shown would observe an off-by-one mismatch. EC-11 race safety (NFR-4)
depends on this being the first thing that happens after the `_enabled` guard.

### Why `dismissWikiPopover()` is called inside each branch

The broken-link branch calls `dismissWikiPopover()` before building its DOM,
exactly as the valid-link path does before building its DOM. This ensures any
previously visible popover (from a different hover) is always removed before
a new one appears. This mirrors the existing comment `"FR-4.4"` in the original
valid-link code.

### Why `resolveWikiLinkPath` is NOT used in the broken-link branch

`resolveWikiLinkPath` resolves relative to the current file's directory (for
path-prefixed links). FR-2 explicitly requires that path-prefixed broken links
be resolved relative to the vault root, not the current file. The new
`resolveCreationPath` helper handles this correctly.

### Why `currentFile` is not needed for the broken-link path

Both un-prefixed and prefixed targets are resolved against `vaultRoot` in FR-2.
The current file's directory is irrelevant for note creation. This means the
broken-link popover works even in an untitled (unsaved) document (EC-12
resolution), as long as a vault is active.

---

## Acceptance Criteria

- `showWikiPopover` on a span with `cm-wiki-link-broken` class shows a popover
  containing a `.wl-popover-create-btn` button without reading a file.
- `showWikiPopover` on a span with `cm-wiki-link-broken` but no active vault
  (`getActiveVault()` returns null) shows no popover.
- `showWikiPopover` on a span WITHOUT `cm-wiki-link-broken` takes the existing
  code path unchanged — no regression.
- The "Create note" button click calls `handleCreateNoteClick` with the correct
  `absolutePath`, `displayStem`, and `myVersion` arguments.
- Version mismatch before the click fires prevents `handleCreateNoteClick` from
  executing (EC-11).
- `_testing.getActivePopoverEl()` returns a non-null element after
  `showWikiPopover` completes on a broken span with a vault present.
- All existing `hover-popover.test.ts` tests continue to pass.

---

## TDD Notes

### Red phase

Tests in `step_04_tests.md` section "showWikiPopover broken-link branch" must
be written BEFORE this function is modified. Running them against the current
code will fail (the early return on `!result.ok` still applies; no broken-link
popover is shown).

### Green phase

Apply the replacement body above. The branch on `cm-wiki-link-broken` is the
minimal change needed to make those tests pass.

### Refactor notes

- The valid-link path is identical to the original except that the `currentFile`
  guard is now inside the valid-link block. Confirm by diffing the original.
- No new state variables are introduced.
- The `_enabled` guard after `await` (inside the valid-link path) is retained
  from the original — do not remove it.

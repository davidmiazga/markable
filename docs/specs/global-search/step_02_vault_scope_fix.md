---
title: "Step 02 — Fix fetchWorkspaceFiles() to Use Vault Index"
last-updated: "2026-04-28"
review-cadence-days: 14
status: active
---

# Step 02 — Fix `fetchWorkspaceFiles()` to Use Vault Index

## Goal

Replace the `invoke("list_md_files", { dir })` call in `fetchWorkspaceFiles()` with a
synchronous read of `window.__MARKABLE_VAULT_MANAGER__.getVaultIndex()`. When a vault is
active the call is synchronous and vault-wide (FR-1, NFR-4). When no vault is active the
function falls back to the existing `list_md_files` behaviour (FR-2). Update the
`MODE_PLACEHOLDERS.files` string (FR-4).

This step touches only `command-bar.plugin.ts`. No other file changes.

---

## Files to Change

| File | Change |
|------|--------|
| `src/plugins/command-bar/command-bar.plugin.ts` | Rewrite `fetchWorkspaceFiles()`; update `MODE_PLACEHOLDERS.files` |

---

## 1. Update `MODE_PLACEHOLDERS.files`

Location: around line 214 in the current file.

```typescript
// Before:
const MODE_PLACEHOLDERS: Record<BarMode, string> = {
  files:       "Open file or tab…",
  commands:    "Type a command or search headings…",
  keybindings: "Search actions to assign shortcut…",
};

// After:
const MODE_PLACEHOLDERS: Record<BarMode, string> = {
  files:       "Search vault files…",
  commands:    "Type a command or search headings…",
  keybindings: "Search actions to assign shortcut…",
  // "content" entry is added in step_03
};
```

The `"content"` key is NOT added yet — it is part of step_03 where `BarMode` is extended.
TypeScript will report an error until step_03 is complete if the `Record<BarMode, string>`
type is enforced. Temporarily, if TypeScript compilation must pass between steps, the
developer may use `as const` with an explicit cast. Alternatively, both steps may be
committed together.

---

## 2. Rewrite `fetchWorkspaceFiles()`

Location: the function beginning at line 2567, up to and including the closing `}` at
approximately line 2631 in the current file. Replace the entire function body.

The new function body implements this decision tree:

```
getActiveVault()
  │
  ├─ null ──→ FALLBACK PATH (existing list_md_files behaviour)
  │              currentFile available?
  │                ├─ no  → set no-workspace state; return
  │                └─ yes → invoke("list_md_files", { dir: dirname(currentFile) })
  │                           success → build FilesResult[]; refreshFilesDisplay()
  │                           error   → set error state; return
  │
  └─ non-null ──→ VAULT PATH
                   getVaultIndex()
                     ├─ non-null → extract paths synchronously; build results; return
                     └─ null (building) → set loading state; schedule 1.5s retry
```

### Full replacement

```typescript
/**
 * Asynchronously fetch workspace .md files, then update the Files mode display.
 *
 * Path selection (FR-1, FR-2, FR-3):
 *   1. If a vault is active (`getActiveVault()` is non-null):
 *      a. If the vault index is already built (`getVaultIndex()` is non-null):
 *         extract absolute paths synchronously from entries (NFR-4). No Rust call.
 *      b. If the vault index is still building (null):
 *         show loading notice; schedule a single 1.5s retry (FR-3, AD-GS-08).
 *   2. If no vault is active (`getActiveVault()` is null):
 *      fall back to the previous behaviour: derive workspaceDir from
 *      __MARKABLE_CURRENT_FILE__ and invoke("list_md_files", { dir }). If
 *      __MARKABLE_CURRENT_FILE__ is also null, set no-workspace state (FR-2).
 *
 * Generation counter (EC-28/EC-12): the generation value is captured at call time
 * and compared after every await. Stale results are silently discarded.
 *
 * EC-17 (corrupt index): entries with a falsy path are silently skipped.
 *
 * @param generation - The generation value captured at openBar() time.
 */
async function fetchWorkspaceFiles(generation: number): Promise<void> {
  const vm = (window as any).__MARKABLE_VAULT_MANAGER__;

  // ── Vault path (FR-1, FR-3) ──────────────────────────────────────────────
  if (vm && typeof vm.getActiveVault === "function" && vm.getActiveVault() !== null) {
    const index = (typeof vm.getVaultIndex === "function") ? vm.getVaultIndex() : null;

    if (index !== null) {
      // FR-1: synchronous vault-index read (NFR-4 — no async latency).
      if (_openGeneration !== generation) return; // EC-28: stale guard
      const entries: Array<{ path: string }> = index.entries ?? [];
      // EC-17: skip entries with a falsy path.
      const workspaceFiles: string[] = entries
        .filter((e) => !!e.path)
        .map((e) => e.path);

      const tabs = getOpenTabs();
      const openPaths = new Set<string>(tabs.flatMap((t) => (t.filePath ? [t.filePath] : [])));
      _totalWorkspaceCount = countWorkspaceBeforeCap(workspaceFiles, openPaths);

      _fileModeResults = buildFilesResults({
        tabs,
        workspaceFiles,
        workspaceLoadState: "loaded",
        openTab: switchToTab,
        openFile: openFileInTab,
      });
      _fileListLoaded = true;
      _fileListError = false;

      if (_mode === "files" && _isOpen) refreshFilesDisplay();
      return;
    }

    // FR-3: vault active but index still building.
    if (_openGeneration !== generation) return;
    // Show loading notice immediately.
    _fileModeResults = buildFilesResults({
      tabs: getOpenTabs(),
      workspaceFiles: [],
      workspaceLoadState: "loading",
      openTab: switchToTab,
      openFile: openFileInTab,
    });
    _fileListLoaded = false;
    _fileListError = false;
    if (_mode === "files" && _isOpen) refreshFilesDisplay();

    // Single 1.5s retry (AD-GS-08).
    const genAtRetry = generation;
    setTimeout(() => {
      if (_openGeneration !== genAtRetry || !_isOpen || _mode !== "files") return;
      void fetchWorkspaceFiles(genAtRetry);
    }, 1500);
    return;
  }

  // ── Fallback path (FR-2): no vault active ────────────────────────────────
  const currentFile: string | null = (window as any).__MARKABLE_CURRENT_FILE__ ?? null;

  if (!currentFile) {
    // EC-1/EC-2: no open file and no vault — show no-workspace notice.
    if (_openGeneration !== generation) return;
    _fileListLoaded = true;
    _fileListError = false;
    refreshFilesDisplay();
    return;
  }

  const parts = currentFile.split("/");
  parts.pop();
  const workspaceDir = parts.join("/") || "/";

  let workspaceFiles: string[] = [];
  try {
    workspaceFiles = await (window as any).__TAURI_INTERNALS__.invoke(
      "list_md_files",
      { dir: workspaceDir },
    );
  } catch (_err) {
    if (_openGeneration !== generation) return;
    _fileListLoaded = true;
    _fileListError = true;
    refreshFilesDisplay();
    return;
  }

  if (_openGeneration !== generation) return;

  const tabs = getOpenTabs();
  const openPaths = new Set<string>(tabs.flatMap((t) => (t.filePath ? [t.filePath] : [])));
  _totalWorkspaceCount = countWorkspaceBeforeCap(workspaceFiles, openPaths);

  _fileModeResults = buildFilesResults({
    tabs,
    workspaceFiles,
    workspaceLoadState: "loaded",
    openTab: switchToTab,
    openFile: openFileInTab,
  });
  _fileListLoaded = true;
  _fileListError = false;

  if (_mode === "files" && _isOpen) refreshFilesDisplay();
}
```

---

## Acceptance Criteria

- [ ] `npm run test:run` passes — no regressions in the existing command-bar test suite.
- [ ] When a vault is active with a built index, opening the command bar in files mode shows
      files from all vault root paths (verified by manual smoke test or integration test).
- [ ] When a vault is active but the index is null, the loading notice appears and the retry
      fires after 1.5s.
- [ ] When no vault is active and a current file is open, the `list_md_files` fallback is
      called (verified by checking that the old file-scoping behavior persists).
- [ ] When no vault is active and no file is open, the no-workspace notice is shown.
- [ ] EC-17: an entry with `path: ""` or `path: null` is not added to workspaceFiles.
- [ ] EC-18: a 500-entry vault index passes all 500 paths to `buildFilesResults`. The existing
      `FILES_CAP = 200` display cap limits rendering.
- [ ] Files mode placeholder text in the input reads "Search vault files…".

---

## Test Requirements

Tests for this step are specified in `step_04_tests.md` under "Group B: vault scope fix".
Key test scenarios:

1. Vault active, index has 3 entries → `workspaceFiles` equals `[e1.path, e2.path, e3.path]`.
2. Vault active, index null → `workspaceLoadState === "loading"` passed to `buildFilesResults`.
3. No vault, current file set → `list_md_files` invoked with parent directory of current file.
4. No vault, no current file → `buildFilesResults` called with `workspaceFiles: []` and
   `workspaceLoadState: "no-workspace"`.
5. EC-17: entry `{ path: "" }` is filtered out.
6. EC-2 (fallback path): `invoke("list_md_files", ...)` is NOT called when vault is active.

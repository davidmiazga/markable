---
title: Step 02 — Paste Listener + Full Test Suite
last-updated: "2026-05-05"
review-cadence-days: 90
status: active
---

# Step 02 — Paste Listener + Full Test Suite

## Goal

Wire the paste event listener into `main.ts` and write the full TypeScript test
suite. After this step all AC-01 through AC-13 must be satisfied and
`npm run test:run` must pass with zero failures.

---

## Files to Modify

| Path | Change |
|---|---|
| `src/main.ts` | Add `paste` capture listener in `initApp()` after the `keydown` block; add `clipboard-image.ts` imports |

## Files to Create

| Path | Purpose |
|---|---|
| `tests/clipboard-image-paste.test.ts` | Complete unit test suite |

---

## Detailed Instructions

### 1. `src/main.ts` — imports

Add to the existing import block (group with the other `./lib/` imports):

```typescript
import { generateImageFilename, computeImageSnippet } from "./lib/clipboard-image";
import { writeBinaryFile, saveImageDialog } from "./lib/bridge";
import { ensureDirectory } from "./lib/bridge";
```

Note: `ensureDirectory` is already imported on the `bridge` line — check
before adding to avoid a duplicate. `writeBinaryFile` and `saveImageDialog`
must be added to the existing destructured `bridge` import.

### 2. `src/main.ts` — paste listener placement

The listener is added inside `initApp()`, immediately after the closing brace
of the `document.addEventListener("keydown", ...)` block (around line 1260 in
the current file). This is the exact location specified by FR-10.

The listener must be added AFTER the line `await tabManager.init(editor)` has
already run (it is placed after `tabManager.init` in the function body per the
placement constraint in FR-10 which states it comes after the `keydown` block,
and the `keydown` block is after `tabManager.init`). Confirm by reading the
file before editing.

### 3. Paste listener implementation

```typescript
// Clipboard image paste (FR-01 through FR-11).
// Registered at the capture phase so it fires before CM6 DOM event handlers.
// Guards are checked synchronously at call time (not at registration time)
// so that a null editor at startup never causes a spurious intercept (EC-20).
document.addEventListener("paste", async (e: ClipboardEvent) => {
  // Guard 1: must have image clipboard data
  const items = e.clipboardData?.items;
  if (!items) return;
  let imageItem: DataTransferItem | null = null;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.startsWith("image/")) {
      imageItem = items[i];
      break;
    }
  }
  if (!imageItem) return;

  // Guard 2: editor must be initialized and focused (EC-06, EC-20)
  if (!editor || !editor.hasFocus) return;

  // Guard 3: must have an active tab (EC-03)
  const activeTab = tabManager.getActiveTab();
  if (!activeTab) return;

  // Guard 4: must be an editor tab, not media or content (FR-11, EC-04, EC-05)
  if (activeTab.kind !== "editor") return;

  // Guard 5: getAsFile() must return a non-null Blob (EC-15)
  const file = imageItem.getAsFile();
  if (!file) return;

  // All guards passed — take ownership of the event
  e.preventDefault();

  // Read image bytes (EC-16: catch arrayBuffer rejection)
  let bytes: number[];
  try {
    const buffer = await file.arrayBuffer();
    bytes = Array.from(new Uint8Array(buffer));
  } catch (err) {
    alert("Could not read clipboard image data.");
    return;
  }

  const filename = generateImageFilename(new Date());

  const vault = vaultManager.getActiveVault();

  // Vault-active path (FR-03)
  if (vault && vault.rootPaths.length > 0) {
    const vaultRoot = vault.rootPaths[0];
    const assetsDir = `${vaultRoot}/assets`;
    const destPath  = `${assetsDir}/${filename}`;

    // EC-07: ensure assets/ directory exists
    try {
      await ensureDirectory(assetsDir);
    } catch (err) {
      alert(`Could not create assets directory: ${String(err)}`);
      return;
    }

    // EC-08: write binary file
    const writeResult = await writeBinaryFile(destPath, bytes);
    if (!writeResult.ok) {
      alert(`Could not save image: ${writeResult.error.message}`);
      return;
    }

    // FR-05: insert snippet at caret
    editor.dispatch({
      changes: {
        from: editor.state.selection.main.head,
        insert: `![](assets/${filename})`,
      },
      userEvent: "input.paste.image",
      scrollIntoView: true,
    });
    return;
  }

  // No-vault path (FR-04) — EC-18: treat empty rootPaths as no-vault
  const dialogResult = await saveImageDialog(filename);

  // EC-09: user cancelled
  if (dialogResult.cancelled) return;

  const chosenPath = dialogResult.path;

  // EC-10: write binary file
  const writeResult = await writeBinaryFile(chosenPath, bytes);
  if (!writeResult.ok) {
    alert(`Could not save image: ${writeResult.error.message}`);
    return;
  }

  // FR-04 snippet computation (EC-11, EC-12, EC-13)
  const snippet = computeImageSnippet(chosenPath, activeTab.filePath);

  // FR-05: insert snippet at caret
  editor.dispatch({
    changes: {
      from: editor.state.selection.main.head,
      insert: snippet,
    },
    userEvent: "input.paste.image",
    scrollIntoView: true,
  });
}, true); // true = capture phase
```

The final argument `true` to `addEventListener` is the capture flag (FR-10).

### 4. `tests/clipboard-image-paste.test.ts` — full test suite

The test file imports only from `src/lib/clipboard-image.ts`. The paste listener
in `main.ts` is integration-level behaviour; its logic is fully covered by testing
the extracted pure helpers plus the mock-based tests below.

For the mock-based tests (guard logic, vault/no-vault paths, error paths), use
`vi.fn()` to stub out `writeBinaryFile`, `saveImageDialog`, `ensureDirectory`,
and `vaultManager.getActiveVault`. These are tested as inline unit tests with
manually constructed mock objects — not with a live Tauri environment.

The test file should use the following structure:

```
describe("generateImageFilename", () => { ... })
describe("computeImageSnippet", () => { ... })
describe("pasteImageHandler (logic extracted)", () => { ... })
```

The `pasteImageHandler` describe block tests the extracted logic by calling a
standalone version of the handler that accepts its dependencies as parameters
rather than closing over module-level globals. Extraction strategy:

Extract a named async function `handleImagePaste` from `clipboard-image.ts` (or
a separate `src/lib/clipboard-image-handler.ts`) with the signature:

```typescript
export async function handleImagePaste(deps: {
  imageBlob: Blob;
  activeTab: { kind: string; filePath: string | null } | null;
  editorHasFocus: boolean;
  getActiveVault: () => { rootPaths: string[] } | null;
  ensureDirectory: (path: string) => Promise<void>;
  writeBinaryFile: (path: string, data: number[]) => Promise<{ ok: boolean; error?: { message: string } }>;
  saveImageDialog: (filename: string) => Promise<{ cancelled: boolean; path?: string }>;
  dispatch: (transaction: unknown) => void;
  getSelectionHead: () => number;
  now: Date;
}): Promise<void>
```

This function implements all the logic from the listener body (guards 3-5 and
the vault/no-vault branching), minus the DOM event guards (1-2) which are tested
structurally. It returns `void` and shows alerts on error. The paste listener in
`main.ts` then calls `handleImagePaste(...)` with the live dependencies injected.

NOTE: If the dev finds this extraction approach too invasive, they may instead
test the pure functions `generateImageFilename` and `computeImageSnippet` directly
(which covers the majority of the test surface from NFR-06) and write integration-
level assertions using a spy on `document.dispatchEvent`. The extraction approach
is preferred but not mandatory if it would require restructuring `main.ts` beyond
what is described here.

#### Test list — `generateImageFilename`

```
T-GIF-01  Normal date → correct format string
T-GIF-02  Midnight (00:00:00) → pads correctly
T-GIF-03  End-of-year (Dec 31 23:59:59) → correct output
T-GIF-04  Single-digit month/day/hour/min/sec all zero-padded
T-GIF-05  Extension is always ".png"
```

#### Test list — `computeImageSnippet`

```
T-CIS-01  activeFilePath null → absolute path form
T-CIS-02  Same directory → filename-only form
T-CIS-03  Different directory → absolute path form
T-CIS-04  activeFilePath in /a/, imagePath in /a/ → same dir (relative)
T-CIS-05  activeFilePath in /a/b/, imagePath in /a/ → different dir (absolute)
```

#### Test list — `handleImagePaste` (if extracted) or paste listener guards (if not)

```
T-HPG-01  Non-image clipboard item → falls through (no write, no dispatch)
T-HPG-02  Null activeTab → falls through
T-HPG-03  activeTab.kind = "media" → falls through
T-HPG-04  getAsFile() returns null → falls through
T-HPG-05  arrayBuffer() rejects → alert called, no write, no dispatch
T-HPG-06  Vault active, write succeeds → dispatch called with "![](assets/...)"
T-HPG-07  Vault active, ensureDirectory throws → alert called, no write
T-HPG-08  Vault active, writeBinaryFile fails → alert called, no dispatch
T-HPG-09  Vault rootPaths empty (EC-18) → falls to no-vault path
T-HPG-10  No vault, user cancels dialog → no write, no dispatch
T-HPG-11  No vault, write succeeds, same dir → dispatch with filename-only snippet
T-HPG-12  No vault, write succeeds, different dir → dispatch with absolute path
T-HPG-13  No vault, writeBinaryFile fails → alert called, no dispatch
T-HPG-14  Multiple image items in clipboardData → only first item used (EC-21)
```

---

## Interaction with Existing Paste Handler

`pasteURLHandler` in `src/editor/format.ts` (registered at `Prec.highest`) is
a CM6 event handler that operates on text clipboard data. Since the document-level
paste listener fires at the capture phase — before CM6 processes any DOM event —
and calls `event.preventDefault()` when an image is detected, the CM6 handler
never fires for image-only clipboards. For text-only clipboards the document
listener returns without calling `preventDefault()`, so CM6 handles the event
normally. There is no conflict and no change to `format.ts` is required. (DC-03)

---

## TDD Checklist (final)

- [ ] T-GIF-01 through T-GIF-05: `generateImageFilename` format tests
- [ ] T-CIS-01 through T-CIS-05: `computeImageSnippet` path logic tests
- [ ] T-HPG-01 through T-HPG-14: guard and handler behaviour tests
- [ ] All existing `npm run test:run` suites continue to pass (no regression)

---

## Acceptance Criteria (Step 02 — completes the feature)

- [ ] AC-01: Vault-active paste → correct file path written + correct snippet inserted
- [ ] AC-02: `assets/` auto-created if absent (ensureDirectory called with correct path)
- [ ] AC-03: Text paste falls through (T-HPG-01 covers the no-intercept case)
- [ ] AC-04: No-vault paste → `saveImageDialog` called with generated filename
- [ ] AC-05: Cancel → no write, no dispatch (T-HPG-10)
- [ ] AC-06: No-vault, same dir → relative filename snippet (T-HPG-11, T-CIS-02)
- [ ] AC-07: No-vault, untitled tab → absolute path snippet (T-HPG-12, T-CIS-01)
- [ ] AC-08: Editor not focused → not intercepted (guard 2 — structural; verified by not calling `preventDefault()`)
- [ ] AC-09: Read-only content tab → not intercepted (T-HPG-03 covers media; same guard for content tabs)
- [ ] AC-10: Rust tests pass (from step_01)
- [ ] AC-11: All EC-01 through EC-23 covered (see edge case table in 00_index.md)
- [ ] AC-12: `npm run test:run` passes with no regressions
- [ ] AC-13: `cargo test` passes (confirmed from step_01)

---

## Post-implementation Build Step

This feature is entirely in the main bundle (`src/main.ts`, `src/lib/*.ts`).
No plugin IIFE is touched. Therefore `npm run build:plugins && npm run sync:plugins`
is NOT required after this step (NFR-05).

The feature is live immediately when `npm run tauri dev` restarts or on the
next production build.

---

## Final Review Checklist

- [ ] No `invoke()` calls outside `bridge.ts` (DC-01)
- [ ] Image bytes read from `ClipboardEvent`, not Tauri clipboard plugin (DC-02)
- [ ] `write_binary_file` uses temp-file-swap (DC-04)
- [ ] `vaultRoot` = `vault.rootPaths[0]` (DC-05)
- [ ] `userEvent: "input.paste.image"` included in the dispatch transaction (FR-05)
- [ ] Listener registered with `true` (capture phase) as the third argument (FR-10)
- [ ] Window size invariant intact in `lib.rs` and `settings.ts` (CLAUDE.md)
- [ ] No TODO comments remain in source files (CLAUDE.md)

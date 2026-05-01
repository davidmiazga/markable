---
title: "Step 01 — file-browser-ops.ts: openFileInTab bug + extension logic"
last-updated: "2026-04-30"
review-cadence-days: 7
status: active
---

# Step 01 — `file-browser-ops.ts`: `openFileInTab` Bug + Extension Logic

## Goal

Fix two bugs in `src/plugins/file-browser/file-browser-ops.ts`:

1. `createNote` calls the non-existent `openFile` method on the tab manager instead
   of `openFileInTab`, causing new files to never open in a tab (Finding 2 / FR-11).
2. `createNote` always strips any extension and appends `.md`, so `notes.txt` becomes
   `notes.txt.md` (Finding 5 / FR-13).

Only `createNote` and a new private helper `hasExplicitExtension` are changed. No other
function in this file is touched.

---

## File: `src/plugins/file-browser/file-browser-ops.ts`

### Change 1 — Add `hasExplicitExtension` helper

Add this private helper function immediately before `createNote` (around line 241). It
is placed before `createNote` so it can be called at the function's use site without a
forward reference:

```typescript
/**
 * Return true when the name has an explicit file extension.
 *
 * A name has an explicit extension when it contains a dot after position 0
 * and that dot is not the final character (trailing dot = no real extension).
 *
 * Examples:
 *   "notes.txt"  → true    (explicit .txt extension)
 *   "my-note"    → false   (no dot → append .md)
 *   "trailingdot." → false (trailing dot → treat as stem, append .md)
 *   "My File.md" → true    (explicit .md, preserve as-is)
 *   "a.b.c"      → true    (last segment ".c" is the extension)
 *
 * @param name - The trimmed filename as typed by the user.
 * @returns true when the name should be used as-is (extension honoured).
 */
function hasExplicitExtension(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1;
}
```

### Change 2 — Rewrite extension-handling logic in `createNote`

Replace the current lines 247–249:

```typescript
// BEFORE (lines 247–249) — always strips extension and appends .md
const trimmed = filename.trim();
const stem = trimmed.endsWith(".md") ? trimmed.slice(0, -3) : trimmed;
const fullFilename = stem + ".md";
```

With:

```typescript
// AFTER — honours explicit extension; appends .md only when absent
const trimmed = filename.trim();
const fullFilename = hasExplicitExtension(trimmed)
  ? trimmed
  : trimmed.replace(/\.$/, "") + ".md";  // strip trailing dot before appending
const stem = hasExplicitExtension(trimmed)
  ? trimmed.slice(0, trimmed.lastIndexOf("."))
  : trimmed.replace(/\.$/, "");
```

Explanation of `trimmed.replace(/\.$/, "")`:
- `trailingdot.` → `trailingdot` → `trailingdot.md` (trailing dot stripped first)
- `my-note` → `my-note` → `my-note.md` (no dot, no-op replace)

The `stem` variable is still needed to pass to `validateFilename` and to build the
duplicate-detection error message. It now correctly represents the stem of the final
filename regardless of extension path.

### Change 3 — Fix the `openFile` call

On line 270, replace:

```typescript
// BEFORE
(window as any).__MARKABLE_TAB_MANAGER__?.openFile?.(fullPath);
```

With:

```typescript
// AFTER — openFileInTab is the correct method name (FR-11, Finding 2)
await (window as any).__MARKABLE_TAB_MANAGER__?.openFileInTab?.(fullPath);
```

The call is also promoted to `await` so that any rejection is captured by the surrounding
try/catch rather than becoming an unhandled promise rejection (EC-10).

### Change 4 — Wrap post-creation calls in try/catch (EC-9, EC-10)

The current code calls `reloadVaultIndex` and `openFile` without error handling after
`create_file` succeeds. Add explicit error handling:

```typescript
// AFTER — the full success branch of createNote
const fullPath = (dirPath.endsWith("/") ? dirPath : dirPath + "/") + fullFilename;

await invoke("create_file", { path: fullPath, content: "" });

// Reload the vault index so the new file appears in the tree (EC-9).
try {
  await (window as any).__MARKABLE_VAULT_MANAGER__?.reloadVaultIndex?.();
} catch (err) {
  console.error("[file-browser] vault reload failed after create_file:", err);
}

// Open the new file in a tab so the user can start editing immediately (EC-10).
try {
  await (window as any).__MARKABLE_TAB_MANAGER__?.openFileInTab?.(fullPath);
} catch (err) {
  console.error("[file-browser] openFileInTab failed after create_file:", err);
}
```

### Full revised `createNote` function

For zero ambiguity, the complete replacement function is:

```typescript
export async function createNote(
  dirPath: string,
  filename: string,
  container: HTMLElement,
): Promise<void> {
  const trimmed = filename.trim();
  const fullFilename = hasExplicitExtension(trimmed)
    ? trimmed
    : trimmed.replace(/\.$/, "") + ".md";
  const stem = hasExplicitExtension(trimmed)
    ? trimmed.slice(0, trimmed.lastIndexOf("."))
    : trimmed.replace(/\.$/, "");

  const validationError = validateFilename(trimmed);
  if (validationError) {
    showInlineError(container, validationError);
    return;
  }

  if (filenameExistsInDir(dirPath, fullFilename)) {
    showInlineError(container, `"${stem}" already exists in this folder.`);
    return;
  }

  const fullPath = (dirPath.endsWith("/") ? dirPath : dirPath + "/") + fullFilename;

  await invoke("create_file", { path: fullPath, content: "" });

  try {
    await (window as any).__MARKABLE_VAULT_MANAGER__?.reloadVaultIndex?.();
  } catch (err) {
    console.error("[file-browser] vault reload failed after create_file:", err);
  }

  try {
    await (window as any).__MARKABLE_TAB_MANAGER__?.openFileInTab?.(fullPath);
  } catch (err) {
    console.error("[file-browser] openFileInTab failed after create_file:", err);
  }
}
```

Key differences from original:
- `validateFilename(trimmed)` receives the full name (not just the stem) so it correctly
  rejects names like `bad:name.txt` (EC-6). The `validateFilename` implementation does
  not care about the extension — it checks for `:` and `/` anywhere in the string.
- `showInlineError` is kept as the error surface for validation/duplicate failures. These
  are user-visible errors that appear in the panel strip (not the inline `errSpan` — the
  `container` parameter is the panel, not the `<li>`). The caller (`buildInlineInputNode`)
  catches the thrown error from `createNote` and puts it in `errSpan`. Note: `createNote`
  currently returns early (does not throw) for validation errors. The caller in
  `buildInlineInputNode` wraps the call in `try/catch` and only reaches the `errSpan`
  assignment for thrown errors. This existing pattern is preserved.

---

## Acceptance Criteria

1. `createNote("notes.txt", ...)` creates a file named `notes.txt` (not `notes.txt.md`).
2. `createNote("my-note", ...)` creates a file named `my-note.md`.
3. `createNote("trailingdot.", ...)` creates a file named `trailingdot.md`.
4. `createNote("My File.md", ...)` creates a file named `My File.md`.
5. After successful creation, `__MARKABLE_TAB_MANAGER__.openFileInTab` is called with
   the full path.
6. `__MARKABLE_TAB_MANAGER__.openFile` is never called.
7. Vault reload failure is caught and logged; `openFileInTab` is still attempted.
8. `openFileInTab` failure is caught and logged; no uncaught promise rejection.

---

## TDD Notes

All tests for this step live in `tests/plugins/file-browser/create-file-folder.test.ts`
(Suite A: `createNote` — extension handling, Suite B: `createNote` — openFileInTab fix).

Run after implementation:

```
npm run test:run -- tests/plugins/file-browser/create-file-folder.test.ts
```

Build after any source change before running tests:

```
npm run build:plugins && npm run sync:plugins
```

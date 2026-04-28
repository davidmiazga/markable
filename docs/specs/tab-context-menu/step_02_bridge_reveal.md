---
title: Step 02 — Bridge: revealInFinder wrapper
last-updated: "2026-04-28"
review-cadence-days: 14
status: active
---

# Step 02 — Bridge: `revealInFinder` wrapper

## File to modify

`src/lib/bridge.ts`

Append to the end of the file (or insert after the last existing export, before
any trailing comment blocks).

---

## Background

The Rust command `reveal_in_finder` exists in
`src-tauri/src/commands/file_ops.rs` (line 386) and is registered in
`src-tauri/src/commands/mod.rs`. It accepts one argument `path: String` and
calls `open::commands(path).arg("-R")` on macOS, which opens Finder with the
file selected.

It is NOT currently wrapped in `bridge.ts`. The file-browser plugin reaches it
via a raw `__TAURI_INTERNALS__.invoke` call — that is pre-existing technical debt
and is out of scope here.

The canonical path for new callers (including `tab-context-menu.ts`) is the
typed bridge wrapper defined in this step.

---

## Function to add

```typescript
/**
 * Reveal a file in Finder (macOS only).
 *
 * Opens a Finder window with the file at `path` selected, equivalent to
 * "Show in Finder" in most macOS apps. Wraps the Rust `reveal_in_finder`
 * command.
 *
 * Errors are caught and logged via console.error. They are NOT re-thrown
 * because a Finder failure (e.g. file moved or deleted since the tab was
 * opened) is non-fatal — the user's tab and document are unaffected.
 *
 * @param path  Absolute path to the file to reveal.
 */
export async function revealInFinder(path: string): Promise<void> {
  try {
    await invoke("reveal_in_finder", { path });
  } catch (error) {
    console.error("revealInFinder failed:", error);
  }
}
```

---

## Acceptance criteria

- [ ] Function is exported from `bridge.ts`.
- [ ] Signature is exactly `export async function revealInFinder(path: string): Promise<void>`.
- [ ] Calls `invoke("reveal_in_finder", { path })`.
- [ ] Catches any error and calls `console.error(...)`.
- [ ] Does NOT re-throw — the function always resolves (never rejects).
- [ ] No changes to any other function in `bridge.ts`.

---

## EC-14: File deleted from disk

When `reveal_in_finder` is called with a path that no longer exists on disk,
macOS's `open -R` either silently succeeds (revealing the parent folder) or
returns a non-zero exit code. The Tauri command may propagate that as an error.
The `catch` block ensures this is never a user-visible crash — just a
`console.error` entry in the DevTools console.

No user-facing alert is shown. This matches the behavior of many native macOS
apps where "Reveal in Finder" for a missing file simply does nothing or opens
the parent directory.

---

## Usage in tab-context-menu.ts

The new module imports and calls this function as:

```typescript
import { revealInFinder } from "../lib/bridge";

// Inside the "Reveal in Finder" item handler:
void revealInFinder(tab.filePath!);
```

The `void` prefix is correct — the return value is unused and the error is
handled inside the wrapper. The caller does not need to await or catch.

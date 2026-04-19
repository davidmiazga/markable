---
title: "step_01 — Infrastructure"
last-updated: "2026-04-19"
review-cadence-days: 7
status: active
---

# step_01 — Infrastructure

## Goal

Wire the two prerequisites that the plugin depends on at runtime, and confirm that
`window.__CM_LANGUAGE__` already provides `syntaxTree` with no changes required.

1. Expose `convertFileSrc` as `window.__MARKABLE_CONVERT_FILE_SRC__` in `main.ts` so the
   IIFE plugin can convert local filesystem paths to Tauri `asset://` URLs without importing
   `@tauri-apps/api/core` directly (AD-1, FR-3).

2. Add a suppression flag check in `live-preview.ts` so the existing non-toggleable image
   rendering skips image widgets while the media-preview plugin is active (FR-6.2, AD-6).

3. Verify (read-only audit) that `window.__CM_LANGUAGE__` already exposes `syntaxTree` —
   the plugin calls `syntaxTree(state)` without any additional changes to `cm-globals.ts`.

---

## Files to Modify

### `src/main.ts`

**Location**: After the existing `__MARKABLE_TAB_MANAGER__` assignment (~line 817 in the
current file), before `applyEditorSettings`.

**Import to add** (at the top of `main.ts`, with the existing `@tauri-apps/api` imports):

```typescript
import { convertFileSrc } from "@tauri-apps/api/core";
```

Note: `convertFileSrc` is already imported in `live-preview.ts`. `main.ts` must add its
own import because this is a module-level import, not a re-export.

**Assignment to add** (in `initApp()`, alongside the existing window global assignments):

```typescript
// AD-1: Expose convertFileSrc so IIFE plugins (e.g. media-preview) can resolve
// local filesystem paths to Tauri asset:// URLs without bundling @tauri-apps/api.
(window as unknown as Record<string, unknown>)["__MARKABLE_CONVERT_FILE_SRC__"] =
  convertFileSrc;
```

Placement: after the `__TAURI_DIALOG__` block (around line 832 in the current file).
The exact line number will drift; use the comment "AD-3: expose the file-open dialog"
as a landmark — insert immediately after that block closes.

**Why `initApp()`?** The other globals (`__MARKABLE_EDITOR_VIEW__`,
`__MARKABLE_TAB_MANAGER__`, `__TAURI_DIALOG__`) are all assigned inside `initApp()`,
not at module top level. Follow that pattern exactly. `convertFileSrc` is a pure
synchronous function — assigning it early inside `initApp()` (before plugin loading)
is safe and avoids the EC-35 startup race condition.

### `src/editor/live-preview.ts`

**Location**: Inside `handleImage()`, at the very start of the function body.

**Current code** (lines 129–170):

```typescript
function handleImage(
  node: SyntaxNodeRef,
  state: EditorState,
  decorations: Range<Decoration>[]
) {
  const cursor = node.node.cursor();
  if (!cursor.firstChild()) return;
  // ... rest of function
```

**Add the following guard as the first statement inside `handleImage()`**:

```typescript
// FR-6.2 / AD-6: When the media-preview plugin is active, it owns all image
// rendering. Skip the core fallback to prevent double decoration.
/* eslint-disable @typescript-eslint/no-explicit-any */
if ((window as any).__MARKABLE_MEDIA_PREVIEW_ACTIVE__) return;
/* eslint-enable @typescript-eslint/no-explicit-any */
```

This is the only change to `live-preview.ts`. The function returns immediately when the
flag is set, producing no image decorations. The media-preview plugin's StateField
handles all image rendering instead.

**Verify**: the existing `ImageWidget` class in `live-preview.ts` is the *core fallback*.
It continues to function when the plugin is disabled (flag is falsy/undefined). The plugin
sets this flag to `true` in `onEnable` and clears it to `false` in `onDisable` (step_04).

---

## Files to Audit (No Changes Required)

### `src/lib/cm-globals.ts`

Read the file and confirm:
- `window.__CM_LANGUAGE__` is assigned as the full `@codemirror/language` module namespace.
- This namespace includes `syntaxTree` as a named export.

The plugin destructures `syntaxTree` from `window.__CM_LANGUAGE__` at IIFE evaluation time:

```typescript
const { syntaxTree } = (window as any).__CM_LANGUAGE__ as typeof import("@codemirror/language");
```

This is already safe — `__CM_LANGUAGE__` was added to support `table-toolbar.plugin.ts`
and is confirmed present in the current codebase.

---

## Implementation Notes

- `convertFileSrc` is a pure synchronous JavaScript function in `@tauri-apps/api/core`.
  It does not perform any async Rust call. Assigning it to a window global is equivalent
  to exporting a regular function reference.

- The TypeScript pattern `(window as unknown as Record<string, unknown>)["__KEY__"] = value`
  is the established codebase convention for window global assignment. Do not use
  `(window as any).__KEY__ = value` for assignments — only for reads inside plugin IIFEs.

- The `__MARKABLE_MEDIA_PREVIEW_ACTIVE__` flag is `window`-scoped. It is `undefined`
  (falsy) at startup, so `handleImage()` runs normally until the plugin enables.
  The flag check uses `(window as any).__MARKABLE_MEDIA_PREVIEW_ACTIVE__` (truthy test)
  — explicit `=== true` is not required, but is acceptable for clarity.

---

## Test Cases for This Step

These are verified manually or through integration (not Vitest unit tests):

1. After the change, `window.__MARKABLE_CONVERT_FILE_SRC__` is `typeof function` at
   runtime (log it from DevTools or a test plugin call).

2. Set `window.__MARKABLE_MEDIA_PREVIEW_ACTIVE__ = true` in DevTools. Add an image
   reference to the document. Confirm no `<img>` widget appears from the core fallback
   (raw Markdown is shown). Clear the flag and confirm the fallback re-renders the image.

3. TypeScript: `npm run check` (or `npx tsc --noEmit`) passes with no type errors in
   `main.ts` after adding the import and assignment.

---

## Definition of Done

- [ ] `convertFileSrc` is imported in `main.ts` and assigned to
  `window.__MARKABLE_CONVERT_FILE_SRC__` inside `initApp()`.
- [ ] `handleImage()` in `live-preview.ts` returns early when
  `window.__MARKABLE_MEDIA_PREVIEW_ACTIVE__` is truthy.
- [ ] `window.__CM_LANGUAGE__` audit confirms `syntaxTree` is present — no changes made
  to `cm-globals.ts`.
- [ ] TypeScript compilation passes with no new type errors (`npx tsc --noEmit`).
- [ ] No TODO comments in modified source.

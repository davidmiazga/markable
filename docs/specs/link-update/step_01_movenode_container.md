---
title: "Step 01 — Add container param to moveNode + same-stem guard"
last-updated: "2026-04-27"
review-cadence-days: 7
status: active
---

# Step 01 — Add `container` param to `moveNode` + same-stem guard

## Requirement Traceability

- FR-02.11.2 — Post-Move Detection
- AD-01 — Suppress banner when `oldStem === newStem`
- EC-05 — Move with same stem: no banner shown

---

## Context

`moveNode` in `src/plugins/file-browser/file-browser-ops.ts` (line 421) currently
has the signature:

```
moveNode(sourcePath: string, destinationDir: string): Promise<void>
```

It does not call `checkAndShowLinkBanner`. After a successful move, the file's stem
is unchanged (the filename does not change, only its directory path changes). Per
AD-01, the banner must be suppressed in this case.

The `checkAndShowLinkBanner` function is already exported and ready to be called.
`getFileStem` is already available in the same module.

The one call site for `moveNode` is in `attachDragDropListeners` in
`src/plugins/file-browser/file-browser.plugin.ts` at line 2403.

---

## Changes Required

### 1. `src/plugins/file-browser/file-browser-ops.ts`

**Signature change** — add a required `container: HTMLElement` parameter as the
third argument:

```
moveNode(sourcePath: string, destinationDir: string, container: HTMLElement): Promise<void>
```

**Body additions** — after the existing `reloadVaultIndex` and `renameFile` tab
manager calls, add:

1. Compute `oldStem = getFileStem(sourcePath)` (before the invoke call, so it
   captures the pre-move stem — but note the stem never changes during a move,
   so this can also be computed from `newPath` equivalently).
2. Compute `newStem = getFileStem(newPath)` where `newPath` is the string returned
   by the `move_file` Tauri command.
3. Call `checkAndShowLinkBanner(container, oldStem, newStem)` ONLY when
   `oldStem !== newStem`. Per AD-01 this condition will never be true for a standard
   move (stem is always preserved), but the guard documents intent and protects
   against any future code path that could produce differing stems.

The JSDoc comment on `moveNode` must be updated to document the new `container`
parameter and its purpose (hosts the link-update banner).

### 2. `src/plugins/file-browser/file-browser.plugin.ts`

**Call site** — line 2403, inside `attachDragDropListeners`:

```
void moveNode(sourcePath, path)
```

must become:

```
void moveNode(sourcePath, path, _panelContainer ?? document.createElement("div"))
```

The fallback `document.createElement("div")` is a dead element used only when
`_panelContainer` is null (panel is not mounted). This satisfies the `HTMLElement`
type contract and matches the EC-18 null-container behavior: the banner is never
shown because `showLinkUpdateBanner` would insert into a detached div. An
alternative is to make `container` accept `HTMLElement | null` and guard inside
`checkAndShowLinkBanner` — the Developer must choose one approach and update the
types consistently. The null-guard approach is preferred if it keeps the call site
cleaner.

> Preferred approach: change `container` to `HTMLElement | null` and add an early
> return in `checkAndShowLinkBanner` when `container` is null. This is consistent
> with the existing null-guard pattern for `_panelContainer` used elsewhere in the
> plugin.

---

## Function Signatures After This Step

```typescript
// file-browser-ops.ts
export async function moveNode(
  sourcePath: string,
  destinationDir: string,
  container: HTMLElement | null,
): Promise<void>

function checkAndShowLinkBanner(
  container: HTMLElement | null,
  oldStem: string,
  newStem: string,
): void
```

---

## Acceptance Criteria

1. TypeScript compiles with no errors (`npm run build` or `tsc --noEmit`).
2. The existing `moveNode error handling (EC-19)` test in `file-browser.test.ts`
   still passes (the test calls `moveNode` via the drop event; the plugin now passes
   `_panelContainer` which is set in the test via `_testing.setPanelContainer`).
3. The new EC-05 test added in step_03 passes: after a move where `oldStem ===
   newStem`, no `.file-browser-link-banner` element appears in the container.
4. The new EC-18 null-container test added in step_03 passes: calling
   `checkAndShowLinkBanner` with a null container does not throw.

---

## Files Touched

- `src/plugins/file-browser/file-browser-ops.ts`
- `src/plugins/file-browser/file-browser.plugin.ts`

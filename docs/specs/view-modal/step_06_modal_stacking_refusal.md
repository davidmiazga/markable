---
title: "step_06 — Modal stacking refusal (EC-12)"
last-updated: "2026-06-08"
review-cadence-days: 7
status: active
---

# step_06 — Modal stacking refusal (EC-12)

## Goal

Implement EC-12: when `openViewModal(...)` is called while any other
modal is open, it is a silent no-op. Uses a sentinel-id-list guard
(AD-8); no toast, no console log, no claim/release registry across
existing modals.

## Files touched

- **NEW** `src/lib/active-modal.ts` — the sentinel-id guard.
- **EDIT** `src/lib/codeblock-modal.ts` — call `isAnyModalOpen()` at the
  top of `openViewModal()`.
- **EDIT** existing `tests/view-modal/modal-mount.test.ts` — add the
  EC-12 case (previously stubbed in step_04).

## Function signatures

```typescript
// src/lib/active-modal.ts (NEW)

/**
 * Sentinel IDs of every modal overlay in the codebase. Used by the
 * View Modal's open path to refuse stacking (EC-12).
 *
 * If a new modal is added to the codebase, its overlay id is added
 * here. Missing entries fail open (the View Modal opens stacked),
 * which is recoverable; over-inclusion would block legitimate opens,
 * which is not.
 *
 * The smart-filter-builder modal is INTENTIONALLY excluded — it is
 * opened from within the View Modal's `+ Add filter` flow and must be
 * allowed to stack.
 */
export const KNOWN_MODAL_OVERLAY_IDS: readonly string[] = [
  "__codeblock-modal-overlay__",      // openViewModal (and legacy openCodeBlockModal until step_09)
  "__select-builder-overlay__",       // openSelectBuilderModal (legacy; deleted in step_09)
  "__template-picker-overlay__",      // openTemplatePicker (deleted in step_08)
  "__folder-icon-picker-overlay__",   // openFolderIconPicker
  "__settings-overlay__",             // openSettingsPanel
  // Architect verifies during step_06 implementation: command-bar overlay id.
];

/** True when any modal in the known list is currently mounted. */
export function isAnyModalOpen(): boolean;

/** Convenience for tests — returns the overlay id of the open modal, or null. */
export function currentModalOverlayId(): string | null;
```

## Failing tests FIRST

Add to `tests/view-modal/modal-mount.test.ts`:

1. **"EC-12 — open while settings panel is open → no-op"** — mount a stub element with `id="__settings-overlay__"`. Call `openViewModal("create", { folderPath: "/v/Foo" })`. Assert no `__codeblock-modal-overlay__` element appears in the DOM.
2. **"EC-12 — open while folder-icon picker is open → no-op"** — mount stub element with `id="__folder-icon-picker-overlay__"`. Call `openViewModal(...)`. Assert no view modal mounts.
3. **"EC-12 — open while another view modal is open → no-op (double-open guard)"** — open the modal, then try to open it again. Assert exactly one overlay in the DOM. (This was already implicitly tested via the `OVERLAY_ID` guard in step_04; this test makes the contract explicit.)
4. **"EC-12 does NOT block opening when the smart-filter-builder is the only thing open (intentional exception)"** — mount stub element with `id="__smart-folder-editor-overlay__"`. Call `openViewModal(...)`. Assert the view modal DOES mount. (The smart-filter-builder is opened from inside the View Modal; the reverse direction must also be allowed for testing.)
5. **"EC-12 — silent: no toast, no console.error"** — spy on `console.error` and on the toast helper; assert neither is called.
6. **"isAnyModalOpen unit — returns false when no overlay exists"**.
7. **"isAnyModalOpen unit — returns true for each id in KNOWN_MODAL_OVERLAY_IDS"** — loop test.

New tests are added to the existing `modal-mount.test.ts`; no new file.

EC mapping in this step: EC-12.

FR mapping: implicit in the locked decision (auto-mode resolution for
EC-12).

## Implementation outline

```typescript
// src/lib/active-modal.ts (NEW)

export const KNOWN_MODAL_OVERLAY_IDS = [
  "__codeblock-modal-overlay__",
  "__select-builder-overlay__",
  "__template-picker-overlay__",
  "__folder-icon-picker-overlay__",
  "__settings-overlay__",
] as const;

export function isAnyModalOpen(): boolean {
  return KNOWN_MODAL_OVERLAY_IDS.some((id) => !!document.getElementById(id));
}

export function currentModalOverlayId(): string | null {
  for (const id of KNOWN_MODAL_OVERLAY_IDS) {
    if (document.getElementById(id)) return id;
  }
  return null;
}
```

In `codeblock-modal.ts`, at the very top of `openViewModal()`:

```typescript
import { isAnyModalOpen } from "./active-modal";

export function openViewModal(mode: ViewModalMode, ctx: ViewModalContext): void {
  if (isAnyModalOpen()) return;  // EC-12 — silent no-op
  // ... existing step_04 / step_05 body ...
}
```

The double-open guard (`if (document.getElementById(OVERLAY_ID)) return;`)
from step_04 is retained — it's a more specific check than
`isAnyModalOpen()` and prevents a self-stack race even before
`isAnyModalOpen()` returns.

### Command-bar overlay id (Architect verification action)

During step_06 implementation, the Lead Developer greps
`src/plugins/command-bar/` for the scrim/overlay element it mounts and
adds its sentinel id to `KNOWN_MODAL_OVERLAY_IDS`. If the command bar
uses a class-based scrim (not an id), the entry uses a class-based
match instead. Adapt `isAnyModalOpen()` accordingly:

```typescript
export function isAnyModalOpen(): boolean {
  for (const id of KNOWN_MODAL_OVERLAY_IDS) {
    if (document.getElementById(id)) return true;
  }
  // Command bar fallback (if class-based):
  if (document.querySelector(".command-bar-scrim")) return true;
  return false;
}
```

The decision (id vs class) is locked once during step_06 grep work.

## Refactor opportunities

- A claim/release registry that each modal calls explicitly at open/close
  is cleaner but requires touching every modal. Deferred (DW-10).
- `KNOWN_MODAL_OVERLAY_IDS` could become a registry that modals push to
  on first open — automatic discovery, no manual list. Same deferral
  rationale.

## Definition of Done

- All 7 new tests in `tests/view-modal/modal-mount.test.ts` (the
  step_06 additions) pass.
- All step_04 tests continue to pass.
- `npm run test:run -- tests/view-modal/modal-mount.test.ts` is green.
- `npm run build` runs clean.
- Manual: open the settings panel, then try to right-click → New Folder
  View. The modal does NOT open. Close settings, retry — modal opens.
- Window-defaults invariant test continues to pass.

---
title: Step 02 — Vault Subscription for Decoration Refresh
last-updated: "2026-04-28"
review-cadence-days: 14
status: active
---

# Step 02 — Vault Subscription for Decoration Refresh

## Goal

Wire `onVaultChanged` and `onIndexUpdated` so that broken-link decorations
refresh whenever the vault index changes — without waiting for the next editor
transaction. This satisfies FR-5 and edge cases EC-08, EC-09, EC-10, and EC-14.

Prerequisites: step_01 must be complete. The subscription callbacks call
`buildWikiLinkDecorations` (which reads the vault index), so the stem-set
logic from step_01 must already exist.

After this step:
- Decorations update when a file is created or deleted in the vault (EC-08, EC-09).
- Decorations update when the user switches vaults (EC-10).
- Subscriptions are cleaned up on plugin disable so no dangling listeners
  dispatch effects to a detached view (EC-14).

---

## Files to Change

1. `src/plugins/backlinks/backlinks.plugin.ts` (only)

---

## Precise Changes

### Change A — Define `forceRebuildEffect` at module scope

**Location:** The module-level state section at the top of the file (after the
imports, before the first function). This section already has variables like
`let _enabled`, `let _view`, etc.

Add immediately after the other module-level `let` declarations:

```typescript
/**
 * A no-op StateEffect used to force a CM6 decoration rebuild when the
 * vault index changes outside of a document transaction (FR-5, AD-3).
 *
 * StateEffect lives in @codemirror/state, exposed as window.__CM_STATE__.
 * The null guard handles test environments where the global is absent.
 * Defined once at module scope so both the subscribe and dispatch sites
 * reference the same effect type.
 */
const { StateEffect } = (window as any).__CM_STATE__ as any ?? {};
const forceRebuildEffect: any = StateEffect?.define<void>() ?? null;
```

A `null` check at the dispatch site (Change C below) handles the case where
`__CM_STATE__` is absent in the test environment. Store it once at module
scope so the effect type is identical on both the dispatch and any future
filter site.

---

### Change B — Declare module-level callback variables

**Location:** The same module-level state section, alongside `_view`, `_enabled`, etc.

Add two new variables:

```typescript
/**
 * Subscription callbacks for vault-change events, held so they can be
 * unsubscribed by exact reference in onDisable (EC-14, AD-4).
 */
let _onVaultChangedForDecorations: ((v: any) => void) | null = null;
let _onIndexUpdatedForDecorations: ((e: any) => void) | null = null;
```

The `any` type annotation matches the pattern used in the rest of the plugin
for vault-manager window-global access, avoiding a TypeScript import
dependency on `vault-types.ts` from an IIFE-compiled plugin.

---

### Change C — Wire subscriptions in `_buildCmExtensions`

**Location:** `_buildCmExtensions` function, approximately line 2822. Add
after the existing comment `/* 1. Wiki-link decoration ViewPlugin (Step 4) */`
block, before the `api.addExtensions(extensions)` call at the end of the
function.

Add a new labelled block:

```typescript
/*
 * 6. Subscribe to vault index changes so broken-link decorations refresh
 *    when files are created, deleted, or when the vault is switched
 *    (FR-5, EC-08, EC-09, EC-10).
 *
 *    Both callbacks dispatch a forceRebuildEffect to _view. This triggers
 *    a CM6 update cycle that calls WikiLinkPlugin.update(), which calls
 *    buildWikiLinkDecorations with the freshly updated vault index.
 *
 *    forceRebuildEffect may be null in test environments where __CM_STATE__
 *    is unavailable; the dispatch is skipped in that case.
 */
const vaultManager = (window as any).__MARKABLE_VAULT_MANAGER__;
if (vaultManager) {
  _onVaultChangedForDecorations = (_vault: any) => {
    if (!_enabled) return;
    if (forceRebuildEffect && _view) {
      _view.dispatch({ effects: forceRebuildEffect.of(undefined) });
    }
  };

  _onIndexUpdatedForDecorations = (_event: any) => {
    if (!_enabled) return;
    if (forceRebuildEffect && _view) {
      _view.dispatch({ effects: forceRebuildEffect.of(undefined) });
    }
  };

  vaultManager.onVaultChanged(_onVaultChangedForDecorations);
  vaultManager.onIndexUpdated(_onIndexUpdatedForDecorations);
}
```

Both callbacks are deliberately identical in body. They are kept as separate
functions (not a shared reference) because `onVaultChanged` and
`onIndexUpdated` are separate event buses with separate `Set`s in
`vault-manager.ts`, and using the same reference would require registering it
on both, which is semantically correct but harder to trace during debugging.

**Guard on `_enabled`:** The `if (!_enabled) return;` guard matches the
pattern used by the existing `updateListener` (line ~2876) and the poll timer
(line ~2916). This prevents stale effects from a disabled plugin.

---

### Change D — Unsubscribe in `onDisable`

**Location:** `onDisable` function, approximately line 3040.

Find the existing cleanup block that handles `_wikiLinkClickHandler` and
`_pollTimer`. Add the vault subscription cleanup immediately before or after
the poll timer cleanup, in the same logical section:

```typescript
/* Unsubscribe vault-change decoration callbacks (EC-14, AD-4) */
const vaultMgr = (window as any).__MARKABLE_VAULT_MANAGER__;
if (vaultMgr) {
  if (_onVaultChangedForDecorations) {
    vaultMgr.offVaultChanged(_onVaultChangedForDecorations);
  }
  if (_onIndexUpdatedForDecorations) {
    vaultMgr.offIndexUpdated(_onIndexUpdatedForDecorations);
  }
}
_onVaultChangedForDecorations = null;
_onIndexUpdatedForDecorations = null;
```

The null-check before each `off*` call is defensive — in theory both are set
together in `_buildCmExtensions`, but guards against a partial-enable failure.

The variables are nulled after the `off*` calls (not before) to match the
pattern used by `_wikiLinkClickHandler` in the existing `onDisable`.

---

### Change E — Reset variables in the module-level state reset at the bottom of `onDisable`

**Location:** The final block in `onDisable` labeled `/* Step 6: Clear all
module-level state to initial values */`, approximately line 3106.

Add the two new variables alongside the existing resets:

```typescript
_onVaultChangedForDecorations = null;
_onIndexUpdatedForDecorations = null;
```

This is belt-and-suspenders: the unsubscribe block in Change D already nulls
them, but the canonical reset block should be complete.

---

## CM6 `StateEffect` Global Name — Confirmed

`StateEffect` is exported from `@codemirror/state`, which is exposed as
`window.__CM_STATE__` (confirmed in `src/lib/cm-globals.ts` line 41).

`Decoration` and `ViewPlugin` are exported from `@codemirror/view`, which is
`window.__CM_VIEW__`.

The module-level definition in Change A must therefore read:

```typescript
const { StateEffect } = (window as any).__CM_STATE__ as any;
const forceRebuildEffect: any = StateEffect?.define<void>() ?? null;
```

This matches the pattern used by the focus-mode and typewriter-mode plugins
that also consume `__CM_STATE__`.

---

## Acceptance Criteria

1. After a file is deleted from the vault (simulated by emitting an
   `onIndexUpdated` callback), `_view.dispatch` is called with
   `forceRebuildEffect`.

2. After a vault switch (simulated by emitting an `onVaultChanged` callback),
   `_view.dispatch` is called with `forceRebuildEffect`.

3. When the plugin is disabled and `onIndexUpdated` fires, no dispatch occurs
   (`_enabled` guard prevents it).

4. After `onDisable`, `vaultMgr.offVaultChanged` and `vaultMgr.offIndexUpdated`
   have been called with the exact function references that were passed to
   `onVaultChanged` and `onIndexUpdated`.

5. After `onDisable`, `_onVaultChangedForDecorations` and
   `_onIndexUpdatedForDecorations` are both `null`.

6. Rapid enable/disable cycle: no error thrown, no dangling listener.

---

## Test Requirements for This Step

Tests live in `tests/plugins/backlinks/wikilink-broken.test.ts` (step_03).
The following cases require step_02 to be complete:

- EC-08 (file deleted): trigger `onIndexUpdated`; assert dispatch called and
  decoration next render shows broken link.
- EC-09 (file created): trigger `onIndexUpdated`; assert dispatch called and
  decoration next render shows valid link.
- EC-10 (vault switch): trigger `onVaultChanged`; assert dispatch called.
- EC-14 (plugin disabled): assert subscriptions unregistered; subsequent
  `onIndexUpdated` does not dispatch.

These four tests require mocking `window.__MARKABLE_VAULT_MANAGER__` with
controllable `onVaultChanged`, `offVaultChanged`, `onIndexUpdated`,
`offIndexUpdated`, and a mock `_view` with a `dispatch` spy.

### Mock setup pattern

```typescript
// In the test file's beforeEach:
const vaultChangedListeners: Set<(v: any) => void> = new Set();
const indexUpdatedListeners: Set<(e: any) => void> = new Set();

const mockVaultManager = {
  onVaultChanged: (cb: (v: any) => void) => vaultChangedListeners.add(cb),
  offVaultChanged: (cb: (v: any) => void) => vaultChangedListeners.delete(cb),
  onIndexUpdated: (cb: (e: any) => void) => indexUpdatedListeners.add(cb),
  offIndexUpdated: (cb: (e: any) => void) => indexUpdatedListeners.delete(cb),
  getVaultIndex: vi.fn().mockReturnValue(null),
};

(window as any).__MARKABLE_VAULT_MANAGER__ = mockVaultManager;

// Helper to simulate events:
function emitIndexUpdated(event: any) {
  for (const cb of indexUpdatedListeners) cb(event);
}
function emitVaultChanged(vault: any) {
  for (const cb of vaultChangedListeners) cb(vault);
}
```

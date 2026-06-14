---
title: "Step 13 — Reference Integrity Hooks"
last-updated: "2026-06-05"
review-cadence-days: 7
status: active
---

# Step 13 — Vault-Manager Hook-Up

## Goal

Wire the reference-index built in step 03 into the vault-manager rename/delete pipelines so canonical-file renames and deletes propagate to every `references:` array without scanning the whole vault on each event.

## Files touched

- **Edit** `src/lib/vault-manager.ts` — add lifecycle hooks if absent
- **Edit** `src/plugins/file-browser/file-browser.plugin.ts` — subscribe `referenceIndex.rebuild` to vault-changed; subscribe `onCanonicalRenamed`/`onCanonicalDeleted` to the new hooks
- **New** `tests/collections/reference-integrity.test.ts`

## Function signatures to add (or verify)

```typescript
// vault-manager.ts (additive; verify existing signatures first)

export interface VaultLifecycleEvent {
  readonly kind: "renamed" | "moved" | "deleted";
  readonly oldVaultRel: string;
  readonly newVaultRel: string | null;   // null for deleted
}

/**
 * Subscribe to file lifecycle events (rename, move, delete) that
 * the vault-manager already detects. The callback fires AFTER the
 * underlying Rust call succeeds but BEFORE the vault index is
 * rebuilt — so subscribers can read the OLD index state to compute
 * fan-out.
 */
export function onVaultLifecycle(cb: (ev: VaultLifecycleEvent) => Promise<void>): () => void;
```

If vault-manager already exposes a similar listener (e.g., `onFileRenamed`, `onFileDeleted`), reuse the existing surface — do NOT add `onVaultLifecycle`. Step 13 implementation begins with an audit of `src/lib/vault-manager.ts`'s current event surface; the spec above is the fallback signature if no fit exists.

```typescript
// file-browser.plugin.ts (additive)

// On plugin init, after the vault is loaded:
referenceIndex.rebuild(vaultManager.getVaultIndex());
vaultManager.onVaultChanged(() => referenceIndex.rebuild(vaultManager.getVaultIndex()));
onVaultLifecycle(async (ev) => {
  if (ev.kind === "deleted") await referenceIndex.onCanonicalDeleted(ev.oldVaultRel);
  else if (ev.newVaultRel !== null) await referenceIndex.onCanonicalRenamed(ev.oldVaultRel, ev.newVaultRel);
});
```

## Failing tests to write FIRST

`tests/collections/reference-integrity.test.ts`. Use the existing vault-manager test harness (look at `tests/vault-manager/` for the pattern).

| Test name | EC / FR | Asserts |
|---|---|---|
| `canonical rename updates every references: array that pointed to old path` | FR-25 | mock vault: 3 stacks reference same canonical → after rename, all 3 _folder.md writes fire |
| `canonical rename updates the reference index in lockstep` | FR-25 | post-event: lookup(old) === [], lookup(new).length === 3 |
| `canonical move (cross-Stack) updates references same way` | FR-25, EC-7 | same as rename |
| `canonical delete removes the entry from every references: array` | FR-26 | mocked removeReference called once per owning stack |
| `canonical delete clears the reference-index entry` | FR-26 | lookup === [] after |
| `Finder-moved note (detected by watcher) triggers references rewrite` | EC-7 | simulated watcher event → same flow as rename |
| `broken reference path renders as broken in stack-panel` | EC-16 | with a references: entry whose target does not exist in vault index, stack-panel renders is-broken box (cross-step assertion) |
| `broken reference: Remove reference command removes only that entry` | EC-16 | other paths in references: array untouched |
| `reference to folder path is treated as broken` | EC-17 | when a references: entry resolves to a folder, render path treats it as broken (no crash) |
| `editing a reference box writes to canonical file` | EC-20 | bridge.writeFile call args = canonical absolute path |
| `editing reference: subsequent navigation to a different Stack referencing same canonical shows updated content` | EC-20 | render after edit reads fresh content (cache invalidated) |
| `cycle attempted via addReference where target is a folder → refused` | EC-21 | commands.addReference returns { ok: false } |
| `reference-index rebuild after bulk vault scan is idempotent` | hardening | rebuild × 2 → same state |
| `concurrent rename + delete events serialize correctly` | EC-10 | Promise.all of two events; no lost updates |

## Implementation outline

1. **Audit** the existing vault-manager event surface. Most likely candidates:
   - A `vault-changed` event fired after every file-system mutation. Too coarse — we'd lose `(old, new)` delta information.
   - Per-operation callbacks invoked from the rename/delete bridge wrappers themselves.
   - Watcher events from the Tauri side.
2. **Strategy A — existing per-operation hooks exist**: subscribe directly. Implementation reduces to two `subscribe()` calls in `file-browser.plugin.ts`'s init.
3. **Strategy B — no fit, add `onVaultLifecycle`**:
   - In `vault-manager.ts`, introduce a small EventEmitter-like surface:
     ```typescript
     const lifecycleListeners = new Set<(ev: VaultLifecycleEvent) => Promise<void>>();
     export function onVaultLifecycle(cb) { lifecycleListeners.add(cb); return () => lifecycleListeners.delete(cb); }
     async function emitLifecycle(ev) { for (const cb of lifecycleListeners) await cb(ev); }
     ```
   - Call `emitLifecycle({ kind: "renamed", oldVaultRel, newVaultRel })` from inside the existing `renameFile` / `moveFile` / `deleteFile` (and `deleteDirectory` if applicable) wrappers in vault-manager.
   - For Finder-detected moves (watcher events), the same emitter is called with the watcher-derived old/new paths.
4. **Subscriber wiring** in `file-browser.plugin.ts`:
   - On vault load, `referenceIndex.rebuild(getVaultIndex())`.
   - On vault-changed, debounce-rebuild (or rely on lifecycle events for in-process changes; rebuild only when the watcher detected an external change).
   - On lifecycle events, invoke the appropriate `onCanonicalRenamed` / `onCanonicalDeleted`.
5. **Broken-reference render** (cross-test with step 09): the stack-panel's reference-loading logic checks `vault-index.has(canonicalAbsPath)`. If absent → `kind: "broken"`. Tests in this step assert the integration with reference-index — the actual broken DOM is already covered in step 09 tests.
6. **Cycle protection** (EC-21): `commands.addReference` rejects when the canonical path resolves to a folder (already implemented in step 04). Test here is an integration assertion.

## Refactor opportunities

If Phase 2 (Books/Chapters) introduces additional reference relationships, the lifecycle event surface generalises to non-canonical relationships too. Leave the interface name event-shape generic (kind + old + new) so it scales.

## Definition of Done

```bash
npm run test:run -- tests/collections/reference-integrity.test.ts
```
Expected: 14 tests pass. Plugin rebuild required.

Manual: open a Collection with a referenced note; rename the canonical via the file tree; navigate to the referencing Stack and confirm the reference box renders the renamed path with no broken state.

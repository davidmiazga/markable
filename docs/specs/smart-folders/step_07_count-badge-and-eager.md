---
title: Step 07 — Eager evaluation triggers, match count badge wiring
last-updated: "2026-05-08"
review-cadence-days: 30
status: active
---

# Step 07 — Eager evaluation triggers, match count badge wiring

## Goal

Wire the four FR-29 evaluation triggers into the file-browser plugin
and confirm the match-count badge round-trips end-to-end. After this
step, Smart Folders are **fully visible** in the running app:

- Switch vaults → smart folders re-evaluate.
- Vault index finishes building → smart folders re-evaluate.
- Save the editor → smart folders re-evaluate.
- File system change in the vault → smart folders re-evaluate.

This is the final wiring step; step_08 is hardening, step_09 is tests.

---

## Files to modify

1. `src/plugins/file-browser/file-browser.plugin.ts` — add evaluation
   triggers in three existing callbacks: `_vaultChangedCb`,
   `_indexUpdatedCb`, and the explicit save flow that step_06 already
   set up.
2. `src/plugins/file-browser/smart-folders/index.ts` — add a small
   `triggerEvaluation` wrapper used by all three call sites.

---

## 1. Wrapper in `index.ts`

```typescript
/**
 * Single entry point for eager re-evaluation. All FR-29 triggers call
 * this. Idempotent — calling it back-to-back coalesces via the tag-scan
 * cache (5 s TTL).
 */
export async function triggerEvaluation(): Promise<void> {
  if (!_api) return;
  const vault = activeVault();
  if (!vault) return;

  const vaultIndex = currentVaultIndex();
  if (!vaultIndex) return;          // EC-12: index still building

  await evaluateAllSmartFolders(_smartFolders, vaultIndex, vault);
  renderPanel();                    // existing
}
```

`activeVault()` and `currentVaultIndex()` are tiny helpers that read
from `__MARKABLE_VAULT_MANAGER__`. Existing code already does this
shape; mirror it.

---

## 2. Trigger A — vault changed (FR-29 c)

Inside `_vaultChangedCb` (existing, search for `vaultChangedCb`):

```typescript
const vaultChangedCb = async (vault: VaultEntry | null): Promise<void> => {
  // existing: clear UI state, load expanded paths, etc.

  // NEW — Smart Folders:
  clearEvaluationCache();              // step_02 — drops stale results + tag-scan cache
  if (vault) {
    _smartFolders = await loadSmartFolders(_api!, vault.id);  // step_01
    await triggerEvaluation();
  } else {
    _smartFolders = [];
  }

  renderPanel();
};
```

The `clearEvaluationCache()` call is required to satisfy EC-07
(prior vault's expansion + result state must not bleed into the new
vault's tree).

---

## 3. Trigger B — index updated (FR-29 a, EC-17)

Inside `_indexUpdatedCb` (existing, debounced FS-watcher handler):

```typescript
const indexUpdatedCb = (event: VaultFileChangedEvent): void => {
  // existing diff logic …

  // NEW — Smart Folders:
  void triggerEvaluation();
};
```

Why `void` (fire-and-forget): the FS handler is synchronous and we
don't want to block the existing tree update. The 5 s tag-scan cache
absorbs back-to-back FS events; if the user makes a flurry of file
changes, only the first call inside the TTL hits the Tauri scan.

EC-17 is satisfied here: external file added/deleted/renamed →
`build_vault_index` rebuilds → `onIndexUpdated` fires → eager eval →
expanded smart folder's children list refreshes.

EC-12 (index still building): when the very first `onVaultChanged`
fires before the index is ready, `currentVaultIndex()` returns null
and `triggerEvaluation` exits silently. The next event (whether
`onIndexUpdated` or a later `onVaultChanged` after build completes)
will succeed.

---

## 4. Trigger C — smart folder created/edited/deleted (FR-29 b)

Already done in step_05 (`commitDraft`) and step_06 (`renameSmartFolder`,
`deleteSmartFolder`). Verify each calls `triggerEvaluation` (or its
inlined equivalent) **after** persisting to settings.

For consistency, refactor those handlers to use the shared
`triggerEvaluation` wrapper instead of inline calls.

---

## 5. Match-count badge wiring (verification)

The badge is **already wired** by:

- step_03 — `buildSmartFolderNode` sets `node.matchCount`.
- step_04 — `appendIconAndLabel` appends the suffix span.

This step adds an integration test that proves the round-trip:

```text
1. seed _smartFolders with one def
2. mock vaultIndex with N matching files
3. await triggerEvaluation()
4. assert: rendered <li[data-smart-folder-id]> contains
   ".tree-node-smart-suffix" with text "(N)"
```

If the badge fails to render, the failure is in step_04; not in this
step.

---

## 6. Performance verification (NFR-01)

Add a quick smoke at the trigger call site:

```typescript
const t0 = performance.now();
await evaluateAllSmartFolders(...);
const dt = performance.now() - t0;
if (dt > 250) {
  console.warn(`[smart-folders] evaluation pass took ${dt.toFixed(0)}ms`);
}
```

The 250 ms threshold is a soft warning; the hard NFR-01 budget is
100 ms for a 1k-file vault. The warning surfaces real-world
regressions during dogfooding without polluting logs in normal use.

---

## 7. Loading-state interaction (EC-12)

When `_isLoading === true`, `renderTreeContent` early-returns into the
loading state branch (existing line ~1477). Smart folder injection is
skipped automatically because the synthetic-node code path is below
that branch. Verify with a unit test that exercises the
`_isLoading=true` branch and asserts no `tree-node-smart-folder`
element exists.

---

## Tests to pass after this step

Add to `tests/plugins/file-browser/smart-folders.integration.test.ts`
(new file):

| Test name | Asserts |
|---|---|
| `vault changed clears evaluation cache and reloads defs` | EC-07 |
| `vault changed to null clears _smartFolders` | safety |
| `index updated triggers re-evaluation` | EC-17 |
| `commitDraft → triggerEvaluation → rendered tree contains new SF` | end-to-end |
| `match count badge renders "(N)" after evaluation` | A-5 |
| `loading state hides smart folders` | EC-12 |
| `triggerEvaluation is a no-op when vault index is null` | EC-12 |
| `back-to-back triggerEvaluation reuses tag-scan cache` | shared promise — EC-15 |

---

## Done when

- [ ] All triggers wired and unit-tested.
- [ ] End-to-end smoke: app starts → vault loads → smart folder
      appears in tree with correct count → click expands → file
      children open in tabs.
- [ ] No regression in existing `_vaultChangedCb` /
      `_indexUpdatedCb` behavior.

---

## Constraints

- Use `void triggerEvaluation()` from synchronous callers; never
  block the FS handler on `await`.
- Each function ≤ 30 lines.
- The `triggerEvaluation` wrapper is the **only** place that calls
  `evaluateAllSmartFolders`. Single point of dispatch keeps tracing
  simple.

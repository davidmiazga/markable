---
title: Step 08 — Edge case hardening
last-updated: "2026-05-08"
review-cadence-days: 30
status: active
---

# Step 08 — Edge case hardening

## Goal

Walk the full **EC-01 through EC-18** inventory. For each, confirm
the existing implementation handles it; where a gap exists, add the
minimum fix. This step is the dedicated checkpoint before tests so
no edge case slips through the implementation cracks.

---

## EC walkthrough

### EC-01 — Empty vault

- **Where**: `renderTreeContent` checks `hasContent` (line ~1481).
- **Existing**: skips the tree-build entirely, calls
  `renderEmptyState(wrapper, "no-files")`.
- **Smart Folder behavior**: smart folder injection is **bypassed**
  in this branch — no "Drafts (0)" row above an "empty" message,
  matching the architecture decision in 00_index AD-12.
- **Fix needed**: confirm step_07's `triggerEvaluation` exits
  gracefully when `vaultIndex.entries.length === 0` AND
  `nonMdFiles.length === 0`. The evaluator handles this naturally:
  `evaluateSmartFolder` produces an empty match list, count = 0.
- **Test**: `tests/plugins/file-browser/smart-folders.integration.test.ts`
  → `EC-01: empty vault, smart folder injection bypassed`.

### EC-02 — No Smart Folders defined yet

- **Where**: `loadSmartFolders` returns `[]` for missing field.
- **Existing**: `_smartFolders.length === 0` → tree builder receives
  empty injections array → `unshift(...[])` is a no-op.
- **Fix needed**: none.
- **Test**: assert tree DOM has zero `[data-smart-folder-id]`
  elements.

### EC-03 — Smart Folder matches zero files

- **Where**: step_03's `buildSmartFolderNode` synthesizes the
  empty-hint sentinel child.
- **Existing**: rendered as `.smart-folder-empty-hint` `<li>`.
- **Fix needed**: confirm the sentinel is **only** rendered when the
  smart folder is **expanded** — otherwise it would appear as a
  floating "No matches" between two top-level rows.
- **Implementation check**: in `buildSmartFolderNode`, set children
  to `[]` when `result.count === 0` AND `expanded === false`. Set to
  the sentinel only when `expanded === true`. Verify in code review.

### EC-04 — Tag/field referenced but no longer present

- **Where**: evaluator's tag rule.
- **Existing**: `pathToTags.get(candidate.path)?.has(rule.value)`
  returns false for every candidate → empty match.
- **Fix needed**: none. Document expected behavior in editor UI
  (step_05) tooltip: "Rules referencing tags that no longer exist
  silently match nothing."

### EC-05 — Rename while expanded

- **Where**: step_06's `renameSmartFolder` mutates only `name`,
  leaves `id` intact.
- **Existing**: `__smart__/<id>` key in `expandedPaths` survives.
- **Fix needed**: none. Test that after rename + re-render the
  expansion state is identical.

### EC-06 — Delete while expanded

- **Where**: step_06's `deleteSmartFolder`.
- **Existing**: explicitly purges `_expandedPaths.delete(synth)` and
  `removeEvaluationResult(id)`.
- **Fix needed**: also call `scheduleSettingsSave(activeVaultId())`
  AFTER the deletion so the cleaned `expandedPaths` is persisted.
  Confirmed already in step_06 spec.

### EC-07 — Vault switch while a smart folder is expanded

- **Where**: step_07's `_vaultChangedCb`.
- **Existing**: calls `clearEvaluationCache()` and reloads
  `_smartFolders` for the new vault.
- **Critical fix**: `_expandedPaths` is reloaded from the new vault's
  settings (existing behavior). Any `__smart__/<oldId>` keys from the
  prior vault are simply absent in the new vault's stored
  `expandedPaths` — clean.
- **Test**: switch vaults, assert no leftover `data-smart-folder-id`
  attributes from the previous vault appear.

### EC-08 — Persistence corruption

- **Where**: step_01's `sanitizeAll` / `sanitizeDef`.
- **Existing**: drops malformed entries with `console.warn`, returns
  clean shape.
- **Fix needed**: none if step_01 followed the spec.
- **Test**: feed a synthesized corrupted JSON through `loadSmartFolders`
  and verify the resulting array has only the valid defs.

### EC-09 — Conflicting rules

- **Where**: AND combinator in evaluator.
- **Existing**: `tag is research` AND `tag is not research` produces
  empty surviving set (no candidate satisfies both).
- **Fix needed**: none. Verifies as EC-03 once expanded.

### EC-10 — Very large vault (1k+ files)

- **Where**: NFR-01 budget. `buildInverseMaps` is single-pass O(N).
- **Test**: step_09's perf smoke uses 1000 synthetic entries × 10
  defs × 6 rule types and asserts < 100 ms.
- **Fallback**: if NFR-01 fails on real hardware, A-4 lazy-on-expand
  is the documented escape hatch. v1 ships eager.

### EC-11 — Many smart folders (50+)

- **Settings size**: each def at ~20 rules × ~50 chars = ~1 KB. 50
  defs ≈ 50 KB JSON. Well within `api.saveSettings` limits.
- **Fix needed**: none. NFR-02 acknowledges no hard cap. Architect
  watches for any regression in dogfooding.

### EC-12 — Initial vault index still building

- **Where**: `triggerEvaluation` exits when
  `currentVaultIndex() === null`.
- **Existing**: silent no-op until index ready; subsequent
  `onIndexUpdated` triggers eager eval.
- **Test**: simulate `vaultIndex` null, call `triggerEvaluation`,
  assert no errors and zero rendered smart folders.

### EC-13 — YAML field no longer exists

- Same as EC-04. Documented; no code path needed.

### EC-14 — Name collision with real subdirectory

- **Where**: tree-injection. Smart folder is **prepended** after
  `sortNodes` runs on real children.
- **Existing**: smart folder sits ABOVE real `research/` directory.
  Different `<li>` `data-path` (synthetic vs absolute) — no DOM
  collision.
- **Fix needed**: none.
- **Test**: build tree with smart folder named "research" and a real
  `research/` directory; assert order and assert distinct
  `data-path` attributes.

### EC-15 — Rapid edits race

- **Where**: tag-scan cache shares a Promise.
- **Existing**: two `triggerEvaluation` calls inside 5 s reuse the
  same in-flight tag scan.
- **Latest-write-wins**: `commitDraft` writes `_smartFolders` then
  awaits `evaluateAllSmartFolders`. Two back-to-back saves: each
  awaits its own `evaluateAll`, but the second save's `_smartFolders`
  state already reflects the first save's mutation. Final state is
  the second save.
- **Fix needed**: confirm `commitDraft` is **not** debounced.
  Persisting mid-keypress would be wrong; persisting on Save click
  is right.
- **Test**: simulate two `commitDraft` calls in rapid succession,
  assert final `_smartFolders` matches the second one and
  `_evaluationResults` reflects it.

### EC-16 — Validation

- Step_05's editor blocks Save when name empty or rules empty.
  Already covered.

### EC-17 — FS change while expanded

- Step_07's `_indexUpdatedCb` triggers `triggerEvaluation`.
- `renderPanel` rebuilds the tree, the smart folder's children list
  reflects the post-FS-change matches.

### EC-18 — Non-md file rules

- Step_02's evaluator: extension rules include nonMdFiles. Links
  rules return false for non-md candidates. `modified` rules: non-md
  files have `modified = 0` so they fail "in last N days" checks
  (which is fine — the user can use "before" if needed).
- **Documentation surface**: editor UI (step_05) does NOT need a
  warning — the behavior is transparent. Optional polish: tooltip on
  the "links" rule type "Only markdown files have links."
- **Test**: rule `extension is .pdf` matches PDFs from `nonMdFiles`
  and excludes `.md` entries.

---

## Cleanup tasks (collected here)

These are small refactors discovered during the EC walk:

1. **Empty-hint visibility check** — `buildSmartFolderNode` only
   emits the empty-hint sentinel when `expanded === true`.
2. **Performance warning** — the `>250 ms` console warning from
   step_07 is dev-only; gate it on `process.env.NODE_ENV !==
   "production"` if the build pipeline supports it. Otherwise leave
   unconditional (it's a one-line warning).
3. **Persistence cleanup on load** — when `sanitizeAll` actually
   pruned anything during `loadSmartFolders`, the cleaned shape is
   not auto-saved (per step_01 design — "let the next mutation carry
   it"). Confirm this is acceptable; if any user reports persistent
   corruption logs across launches, revisit.
4. **`_smartFolders` not reset on failed vault load** — guard:
   if `loadSmartFolders` throws (it shouldn't, but defensively),
   reset `_smartFolders = []` in a `try/catch` at the call site.

---

## Done when

- [ ] All 18 ECs walked and either confirmed handled or fixed in
      this step.
- [ ] Step's worth of small fixes landed (the four cleanup tasks).
- [ ] No new tests yet — that's step_09. This step's verification is
      via code review.
- [ ] Manual smoke: deliberately corrupt the settings file, restart
      the app, confirm warning logged and no crash.

---

## Constraints

- This step adds **no new files**. All changes are inline tweaks to
  files written in steps 01-07.
- Each function ≤ 30 lines (still applies to refactored helpers).
- No Rust changes (Locked #11).

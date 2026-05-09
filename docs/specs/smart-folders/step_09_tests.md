---
title: Step 09 — Tests (EC checklist, perf smoke, integration)
last-updated: "2026-05-08"
review-cadence-days: 30
status: active
---

# Step 09 — Tests (EC checklist, perf smoke, integration)

## Goal

Land the **complete test suite** for Smart Folders. Most unit tests
have been authored alongside their step (TDD-friendly), but this step
exists as the dedicated checkpoint where every requirement and every
edge case is mapped to at least one assertion. The Reviewer will use
this file as the "Definition of Tested" checklist before approving
the feature for merge.

---

## Test files (final inventory)

| File | Step that defined it | This step's role |
|---|---|---|
| `tests/plugins/file-browser/smart-folders.settings.test.ts` | step_01 | verify all FRs / ECs in step_01 inventory still green |
| `tests/plugins/file-browser/smart-folders.evaluator.test.ts` | step_02 | verify all FRs / ECs in step_02 inventory still green |
| `tests/plugins/file-browser/smart-folders.tree-injection.test.ts` | step_03 | verify FRs in step_03 inventory still green |
| `tests/plugins/file-browser/smart-folders.icon.test.ts` | step_04 | verify icon round-trip |
| `tests/plugins/file-browser/smart-folders.editor.test.ts` | step_05 | verify editor UI behavior |
| `tests/plugins/file-browser/smart-folders.context-menu.test.ts` | step_06 | verify lifecycle ops |
| `tests/plugins/file-browser/smart-folders.integration.test.ts` | step_07 + step_09 | end-to-end + EC matrix completion |
| `tests/plugins/file-browser/smart-folders.perf.test.ts` | step_09 (NEW) | NFR-01 perf smoke |

---

## Mandatory EC matrix coverage

Every EC must have at least one assertion. Cross-check against
00_index's EC table.

```text
EC-01 empty vault                        → integration.test.ts
EC-02 no SFs defined                     → settings.test.ts (load returns []) + integration (no DOM)
EC-03 zero matches                       → tree-injection.test.ts (empty-hint sentinel)
EC-04 tag removed from every file        → evaluator.test.ts (rule still defined, count = 0)
EC-05 rename while expanded              → context-menu.test.ts (id stable)
EC-06 delete while expanded              → context-menu.test.ts (purge expandedPaths + result)
EC-07 vault switch                       → integration.test.ts (clearEvaluationCache called)
EC-08 corruption                         → settings.test.ts (sanitizeAll drops bad entries)
EC-09 conflicting rules                  → evaluator.test.ts (AND → empty)
EC-10 large vault                        → perf.test.ts (1k entries < 100 ms)
EC-11 many SFs                           → settings.test.ts (50 defs serializes)
EC-12 index still building               → integration.test.ts (triggerEvaluation no-op)
EC-13 missing field                      → evaluator.test.ts (subset of EC-04)
EC-14 name collision with real dir       → tree-injection.test.ts (above + distinct paths)
EC-15 rapid edits                        → integration.test.ts (last write wins) + evaluator.test.ts (shared promise)
EC-16 validation                         → editor.test.ts (Save disabled)
EC-17 fs change while expanded           → integration.test.ts (indexUpdatedCb → reeval)
EC-18 non-md + outbound rule             → evaluator.test.ts (links returns false for non-md)
```

---

## NEW — `smart-folders.perf.test.ts` (NFR-01)

Deterministic synthetic dataset, fixed seed, uses Vitest's
`performance.now()`:

```typescript
import { describe, it, expect } from "vitest";
import { evaluateAll } from "../../src/plugins/file-browser/smart-folders/evaluator";
import type { VaultIndex, VaultIndexEntry } from "../../src/lib/vault-types";
import type { SmartFolderDef } from "../../src/plugins/file-browser/smart-folders/types";

describe("smart folders — NFR-01 performance", () => {
  it("evaluates 1000 entries × 10 SFs × 6 rule types in < 100 ms", () => {
    const entries: VaultIndexEntry[] = Array.from({ length: 1000 }, (_, i) => ({
      path: `/vault/file_${i}.md`,
      name: `file_${i}`,
      title: `File ${i}`,
      modified: 1_700_000_000_000 + i * 60_000,
      size: 1024,
      tags: i % 7 === 0 ? ["draft"] : [],
      outboundLinks: i % 5 === 0 ? [`file_${(i + 1) % 1000}`] : [],
    }));

    const vaultIndex: VaultIndex = {
      vaultId: "perf",
      builtAt: Date.now(),
      entries,
      totalFilesFound: 1000,
      skippedCount: 0,
      capped: false,
      nonMdFiles: [],
      directories: [],
    };

    const tagScan = [
      { tag: "draft", filePaths: entries.filter((_, i) => i % 7 === 0).map(e => e.path), count: 143 },
    ];

    const defs: SmartFolderDef[] = [
      { id: "sf-1",  name: "Drafts",   rules: [{ type: "tag",       operator: "is",                    value: "draft" }] },
      { id: "sf-2",  name: "By path",  rules: [{ type: "path",      operator: "contains",              value: "5" }] },
      { id: "sf-3",  name: "Md only",  rules: [{ type: "extension", operator: "is",                    value: ".md" }] },
      { id: "sf-4",  name: "Recent",   rules: [{ type: "modified",  operator: "in last N days",        value: 30 }] },
      { id: "sf-5",  name: "Linked",   rules: [{ type: "links",     operator: "outbound >= 1",         value: null as any }] },
      { id: "sf-6",  name: "Title",    rules: [{ type: "title",     operator: "contains",              value: "File" }] },
      { id: "sf-7",  name: "Combined", rules: [
        { type: "tag",       operator: "is",       value: "draft" },
        { type: "modified",  operator: "in last N days", value: 365 },
      ] },
      { id: "sf-8",  name: "Old",      rules: [{ type: "modified",  operator: "before", value: "2020-01-01" }] },
      { id: "sf-9",  name: "No links", rules: [{ type: "links",     operator: "outbound = 0", value: null as any }] },
      { id: "sf-10", name: "Not draft",rules: [{ type: "tag",       operator: "is not", value: "draft" }] },
    ];

    const t0 = performance.now();
    evaluateAll(defs, vaultIndex, tagScan, Date.now());
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(100);
  });
});
```

The test asserts the **synchronous** part of `evaluateAll` (after the
tag scan resolves) meets NFR-01. The Tauri `scan_vault_tags` cost is
out of scope for this benchmark — it is real-IO and varies per
machine.

---

## NEW — full integration test (`smart-folders.integration.test.ts`)

This is the file that completes the EC matrix coverage. It wires up
a faked `__MARKABLE_VAULT_MANAGER__` and `__MARKABLE_TAB_MANAGER__`
on `window`, mounts the panel via the plugin's exported `_testing`
hooks, and asserts DOM outcomes. Pattern mirrors
`tests/plugins/file-browser/file-browser.test.ts`.

Required scenarios (one `it` block each):

1. EC-01 empty vault → no smart-folder DOM rendered.
2. EC-02 no defs → no smart-folder DOM rendered.
3. EC-07 vault switch clears prior vault's smart folders from DOM.
4. EC-12 vault index null → triggerEvaluation no-op.
5. EC-15 rapid edits → final state reflects latest commit.
6. EC-17 fs change → smart folder children list updates.
7. End-to-end: create via Add row → editor → Save → SF in tree.
8. Match count badge round-trip: assert `(N)` text.
9. Loading state: `_isLoading=true` → no smart folders.
10. tag-scan cache: two triggerEvaluation calls within 5 s →
    `__TAURI_INTERNALS__.invoke` for `scan_vault_tags` called once.

---

## Reviewer-facing checklist

Reviewer signs off only when:

- [ ] All 8 test files green via `npm run test:run`.
- [ ] No skipped (`it.skip`) or pending tests in any of the 8 files.
- [ ] Every EC (EC-01 … EC-18) is grep-able as a comment in at
      least one test (e.g. `// EC-07: …`).
- [ ] Every FR (FR-01 … FR-29) is grep-able similarly OR justified
      as "covered by construction" with a one-line comment.
- [ ] `npm run build:plugins && npm run sync:plugins` succeeds with
      no warnings.
- [ ] Manual smoke per the workflow in step_07 + step_08.
- [ ] No console.error during normal use; `console.warn` only on
      genuine corruption (NFR-06).

---

## Done when

- [ ] Reviewer-facing checklist all green.
- [ ] PR-ready.
- [ ] User says: "Smart Folders feature approved."

---

## Constraints

- All test files use Vitest.
- DOM tests use the existing `jsdom` setup from
  `tests/plugins/file-browser/file-browser.test.ts`.
- Perf test must remain under the budget on the developer reference
  machine. If it flakes, raise the budget by 25 % and document
  rather than silencing — NFR-01 is a hard contract.
- No new test infrastructure (helpers, mocks, custom matchers)
  unless ≤ 50 LOC and shared by ≥ 3 files.

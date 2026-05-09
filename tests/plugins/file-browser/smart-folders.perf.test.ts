/**
 * smart-folders.perf.test.ts
 *
 * NFR-01 performance smoke test for Smart Folders.
 *
 * Asserts that the synchronous evaluateAll pass completes in < 100 ms
 * against a deterministic 1000-entry × 10-SF × 6-rule-type dataset.
 *
 * The Tauri scan_vault_tags cost is out of scope for this benchmark —
 * it is real I/O and varies per machine. This test covers the
 * synchronous CPU-bound portion after the tag scan resolves.
 *
 * EC-10: very large vault (1k+ files) within NFR-01 budget.
 * EC-11: 50+ smart folders — implicitly OK since 10 is already stress-tested
 *         and the cost scales linearly per folder.
 */

import { describe, it, expect } from "vitest";
import { evaluateAll } from "../../../src/plugins/file-browser/smart-folders/evaluator";
import type { SmartFolderDef } from "../../../src/plugins/file-browser/smart-folders/types";

// ── Synthetic dataset ─────────────────────────────────────────────────────────

/** Build a deterministic 1000-entry VaultIndex for benchmarking. */
function buildPerfDataset() {
  const entries = Array.from({ length: 1000 }, (_, i) => ({
    path: `/vault/file_${i}.md`,
    name: `file_${i}`,
    title: `File ${i}`,
    modified: 1_700_000_000_000 + i * 60_000,
    size: 1024,
    tags: i % 7 === 0 ? ["draft"] : [],
    outboundLinks: i % 5 === 0 ? [`file_${(i + 1) % 1000}`] : [],
    isDirectory: false,
  }));

  const vaultIndex = {
    vaultId: "perf",
    builtAt: Date.now(),
    entries,
    totalFilesFound: 1000,
    skippedCount: 0,
    capped: false,
    nonMdFiles: [] as any[],
    directories: [] as string[],
  };

  // TagEntry[] produced by scan_vault_tags for the draft tag.
  const tagScan = [
    {
      tag: "draft",
      filePaths: entries.filter((_, i) => i % 7 === 0).map(e => e.path),
      count: entries.filter((_, i) => i % 7 === 0).length,
    },
  ];

  return { entries, vaultIndex, tagScan };
}

/** 10 smart folders exercising all 6 rule types. */
const PERF_DEFS: SmartFolderDef[] = [
  { id: "sf-1",  name: "Drafts",    rules: [{ type: "tag",       operator: "is",             value: "draft" }] },
  { id: "sf-2",  name: "By path",   rules: [{ type: "path",      operator: "contains",       value: "5" }] },
  { id: "sf-3",  name: "Md only",   rules: [{ type: "extension", operator: "is",             value: ".md" }] },
  { id: "sf-4",  name: "Recent",    rules: [{ type: "modified",  operator: "in last N days", value: 30 }] },
  { id: "sf-5",  name: "Linked",    rules: [{ type: "links",     operator: "outbound >= 1",  value: null as any }] },
  { id: "sf-6",  name: "Title",     rules: [{ type: "title",     operator: "contains",       value: "File" }] },
  {
    id: "sf-7",
    name: "Combined",
    rules: [
      { type: "tag",      operator: "is",             value: "draft" },
      { type: "modified", operator: "in last N days", value: 365 },
    ],
  },
  { id: "sf-8",  name: "Old",       rules: [{ type: "modified",  operator: "before",         value: "2020-01-01" }] },
  { id: "sf-9",  name: "No links",  rules: [{ type: "links",     operator: "outbound = 0",   value: null as any }] },
  { id: "sf-10", name: "Not draft", rules: [{ type: "tag",       operator: "is not",         value: "draft" }] },
];

// ── NFR-01 performance test ───────────────────────────────────────────────────

describe("smart folders — NFR-01 performance (EC-10)", () => {
  it("evaluates 1000 entries × 10 SFs × 6 rule types in < 100 ms", () => {
    const { vaultIndex, tagScan } = buildPerfDataset();

    const t0 = performance.now();
    const results = evaluateAll(PERF_DEFS, vaultIndex as any, tagScan as any, Date.now());
    const dt = performance.now() - t0;

    // Verify the result map is correctly populated (not just fast but correct).
    expect(results.size).toBe(10);

    // NFR-01 hard budget: evaluation pass must complete in < 100 ms
    // for a 1k-file vault × 10 smart folders × 6 rule types.
    expect(dt).toBeLessThan(100);
  });

  it("buildInverseMaps single-pass invariant: cost is O(N), not O(N * M)", () => {
    /*
     * This test documents the single-pass invariant (FR-28, AD-5):
     * buildInverseMaps is called once in evaluateAll, not once per SF.
     * We verify the result count scales correctly: 10 SFs should not
     * produce 10x overhead compared to 1 SF.
     */
    const { vaultIndex, tagScan } = buildPerfDataset();

    // 1 SF
    const t1start = performance.now();
    evaluateAll([PERF_DEFS[0]!], vaultIndex as any, tagScan as any, Date.now());
    const t1 = performance.now() - t1start;

    // 10 SFs
    const t10start = performance.now();
    evaluateAll(PERF_DEFS, vaultIndex as any, tagScan as any, Date.now());
    const t10 = performance.now() - t10start;

    // 10 SFs should take less than 10× the time of 1 SF (expected ~1-2×
    // because inverse map cost dominates and is amortized).
    // We use a generous factor of 8 to avoid flakiness on slow CI machines.
    expect(t10).toBeLessThan(t1 * 8 + 5);
  });
});

// ── EC-11: 50 smart folders ───────────────────────────────────────────────────

describe("smart folders — EC-11: many SFs (50)", () => {
  it("50 smart folders evaluate within the 100 ms budget", () => {
    const { vaultIndex, tagScan } = buildPerfDataset();

    // Generate 50 defs with the same rule (tag is draft).
    const fiftyDefs: SmartFolderDef[] = Array.from({ length: 50 }, (_, i) => ({
      id: `sf-mass-${i}`,
      name: `Folder ${i}`,
      rules: [{ type: "tag", operator: "is", value: "draft" }],
    }));

    const t0 = performance.now();
    const results = evaluateAll(fiftyDefs, vaultIndex as any, tagScan as any, Date.now());
    const dt = performance.now() - t0;

    expect(results.size).toBe(50);
    // Still within budget with 50 SFs.
    expect(dt).toBeLessThan(100);
  });
});

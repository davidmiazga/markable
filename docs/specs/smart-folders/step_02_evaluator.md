---
title: Step 02 — Filter rule evaluator, inverse maps, tag-scan cache
last-updated: "2026-05-08"
review-cadence-days: 30
status: active
---

# Step 02 — Filter rule evaluator, inverse maps, tag-scan cache

## Goal

Implement the **pure evaluation engine** that turns
`(VaultIndex, scan_vault_tags result, SmartFolderDef[])` into
`Map<SmartFolderId, EvaluationResult>`. No UI, no DOM, no wiring into the
plugin yet — this step lands the engine and its public surface so step_07
can call it.

The evaluator is the hottest code path in the feature (NFR-01: 1k files ×
10 SFs × 6 rules ≤ 100 ms). Build the inverse maps **once per pass**
(FR-28).

---

## Files to create

1. `src/plugins/file-browser/smart-folders/evaluator.ts`
2. `src/plugins/file-browser/smart-folders/index.ts` (skeleton — fully
   populated in later steps; this step adds the evaluator re-exports
   and the module-level result-cache state).

---

## 1. `evaluator.ts` — pure functions

### Required exports

```typescript
import type { VaultIndexEntry, NonMdFile, VaultIndex } from "../../../lib/vault-types";
import type { TagEntry } from "../../../lib/bridge";   // type-only
import type {
  SmartFolderDef, SmartFolderRule, EvaluationResult, InverseMaps,
} from "./types";

/**
 * Build the inverse maps used by every rule matcher. Single pass over
 * the index. Called once per evaluation pass — FR-28.
 */
export function buildInverseMaps(
  vaultIndex: VaultIndex,
  tagScan: TagEntry[],
): InverseMaps;

/** Evaluate one rule against one candidate entry. Returns true/false. */
export function matchRule(
  rule: SmartFolderRule,
  candidate: Candidate,
  maps: InverseMaps,
  now: number,           // injected for deterministic "in last N days"
): boolean;

/** Evaluate all rules in AND combinator, return matching paths sorted by modified desc. */
export function evaluateSmartFolder(
  def: SmartFolderDef,
  vaultIndex: VaultIndex,
  maps: InverseMaps,
  now?: number,
): EvaluationResult;

/**
 * Evaluate every smart folder. Returns a Map keyed by id.
 * Caller is responsible for awaiting the tag scan via scanVaultTagsCached.
 */
export function evaluateAll(
  defs: SmartFolderDef[],
  vaultIndex: VaultIndex,
  tagScan: TagEntry[],
  now?: number,
): Map<string, EvaluationResult>;
```

`Candidate` is an internal type — the union of md and non-md files
flattened to a single shape:

```typescript
interface Candidate {
  path: string;
  name: string;
  title: string;        // for md: from VaultIndexEntry; for non-md: name
  modified: number;     // for md: from index; for non-md: 0 (unknown — see EC-18)
  isMd: boolean;        // distinguishes for the "links" rule type
}
```

### `buildInverseMaps` algorithm

Single pass:

```text
pathToTags        : Map<path, Set<string>>   = new Map()
pathToOutbound    : Map<path, number>        = new Map()
pathToInbound     : Map<path, number>        = new Map()
distinctExtensions: Set<string>              = new Set()

// 1. Tag scan → invert
for each entry in tagScan:
  for each filePath in entry.filePaths:
    pathToTags.get(filePath) ?? new Set() ; .add(entry.tag)

// 2. Walk md entries
stemToPath: Map<string, string> = new Map()    // entries[i].name → path
for each md entry e in vaultIndex.entries:
  pathToOutbound.set(e.path, e.outboundLinks.length)
  stemToPath.set(e.name, e.path)
  distinctExtensions.add(extOf(e.path))

// 3. Inbound counts (resolve outbound stems via stemToPath)
for each md entry e in vaultIndex.entries:
  for each outStem in e.outboundLinks:
    const target = stemToPath.get(outStem)
    if (target) pathToInbound.set(target, (pathToInbound.get(target) ?? 0) + 1)

// 4. Non-md file extensions
for each n in vaultIndex.nonMdFiles ?? []:
  distinctExtensions.add(extOf(n.path))

return { pathToTags, pathToOutboundCount, pathToInboundCount,
         distinctExtensions: [...distinctExtensions].sort() }
```

`extOf(path)` returns `"." + path.split(".").pop()!.toLowerCase()` or
`""` if no dot. Handle `"foo"` → `""`, `"a.tar.gz"` → `".gz"`.

**Performance note**: per NFR-01, this routine must complete inside the
100 ms budget for a 1k-file vault. The above is O(N + total outbound
links + total tag occurrences), all single-pass — well within budget.

### `matchRule` — one switch per rule type

The matcher is a `switch (rule.type)` with a nested switch on operator.
Each branch is ≤ 5 lines. Total file size ~120 lines.

#### Tag rules

```text
const tags = maps.pathToTags.get(candidate.path) ?? EMPTY_SET
const has  = tags.has(rule.value)
return rule.operator === "is" ? has : !has
```

#### Path rules

```text
switch (rule.operator):
  "contains"               → candidate.path.includes(rule.value)
  "does not contain"       → !candidate.path.includes(rule.value)
  "starts with"            → candidate.path.startsWith(rule.value)
  "does not start with"    → !candidate.path.startsWith(rule.value)
```

Use the **absolute path**. Editor UI is responsible for telling the user
which mode they chose; the matcher is dumb.

#### Extension rules

```text
const ext = extOf(candidate.path)
const want = rule.value.toLowerCase()       // editor stores ".pdf"
const eq = ext === want
return rule.operator === "is" ? eq : !eq
```

#### Modified rules

```text
switch (rule.operator):
  "in last N days":
    const cutoff = now - rule.value * 86_400_000
    return candidate.modified >= cutoff
  "not in last N days":
    const cutoff = now - rule.value * 86_400_000
    return candidate.modified < cutoff
  "before":
    const t = Date.parse(rule.value)            // ISO already validated by sanitizeDef
    return candidate.modified < t
  "after":
    const t = Date.parse(rule.value)
    return candidate.modified > t
```

**EC-18 reminder**: non-md files have `modified = 0`. They will be
included by "before <some recent date>" and excluded by "in last N days"
unless the date threshold is the epoch. This is acceptable v1 behavior;
document in the editor UI tooltip in step_05.

#### Links rules

```text
if (!candidate.isMd) {
  // Non-md files have no links; treat all link comparators as false
  // EXCEPT "outbound = 0" / "inbound = 0" which are vacuously true.
  // ARCHITECT DECISION: treat as false uniformly so non-md never matches
  // a "links" rule. Documented in EC-18 of the requirements; expected.
  return false
}

const outbound = maps.pathToOutboundCount.get(candidate.path) ?? 0
const inbound  = maps.pathToInboundCount.get(candidate.path) ?? 0

switch (rule.operator):
  "outbound = 0":   return outbound === 0
  "outbound >= 1":  return outbound >= 1
  "outbound >= N":  return outbound >= rule.value     // value validated > 0
  "inbound = 0":    return inbound === 0
  "inbound >= 1":   return inbound >= 1
  "inbound >= N":   return inbound >= rule.value
```

#### Title rules

```text
const haystack = (candidate.title + " " + candidate.name).toLowerCase()
const needle = rule.value.toLowerCase()
const has = haystack.includes(needle)
return rule.operator === "contains" ? has : !has
```

(FR-08: check both `title` and `name`.)

### `evaluateSmartFolder` algorithm

```text
const candidates: Candidate[] = [
  ...vaultIndex.entries.map(toMdCandidate),
  ...(vaultIndex.nonMdFiles ?? []).map(toNonMdCandidate),
]

let surviving = candidates
for each rule of def.rules:
  surviving = surviving.filter(c => matchRule(rule, c, maps, now))

surviving.sort((a, b) => b.modified - a.modified)    // Locked #12

return {
  smartFolderId: def.id,
  matches: surviving.map(c => c.path),
  count:   surviving.length,
}
```

Empty rules (which `sanitizeDef` already guards against) would match all
files — defense in depth: if `def.rules.length === 0` here, return
empty. Log warning once.

### `evaluateAll` algorithm

```text
const maps = buildInverseMaps(vaultIndex, tagScan)
const results = new Map<string, EvaluationResult>()
for each def of defs:
  results.set(def.id, evaluateSmartFolder(def, vaultIndex, maps, now))
return results
```

Single inverse-maps construction shared across all defs — FR-28 invariant.

---

## 2. `index.ts` — public surface scaffolding

This step adds the bare scaffolding. Later steps fill in the editor /
context-menu / tree-injection plumbing.

### Required exports (this step only)

```typescript
import type { SmartFolderDef, EvaluationResult } from "./types";
import type { VaultIndex } from "../../../lib/vault-types";
import type { TagEntry } from "../../../lib/bridge";

/** Module-level cache: smart folder id → evaluation result. */
let _evaluationResults = new Map<string, EvaluationResult>();

/** Module-level cache: tag-scan TTL = 5 s, shared promise. */
const TAG_SCAN_TTL_MS = 5_000;
let _tagScanCache: { vaultId: string; ts: number; promise: Promise<TagEntry[]> } | null = null;

/**
 * Re-scan tags if cache is stale; otherwise await the cached promise.
 * Returns [] on Tauri command failure (degraded mode — every "tag" rule
 * matches nothing). NFR-06 reminder: never throw.
 */
export async function scanVaultTagsCached(vault: VaultEntry): Promise<TagEntry[]>;

/** Run a full evaluation pass and store results in _evaluationResults. */
export async function evaluateAllSmartFolders(
  defs: SmartFolderDef[],
  vaultIndex: VaultIndex,
  vault: VaultEntry,
): Promise<void>;

/** Read the cached result for one smart folder (used by tree-injection). */
export function getEvaluationResult(id: string): EvaluationResult | null;

/** Read all cached results (for tree-injection iteration). */
export function getAllEvaluationResults(): Map<string, EvaluationResult>;

/** Clear the result cache and tag-scan cache (call on vault change). */
export function clearEvaluationCache(): void;
```

### `scanVaultTagsCached` implementation

```text
if (_tagScanCache && _tagScanCache.vaultId === vault.id) {
  if (Date.now() - _tagScanCache.ts < TAG_SCAN_TTL_MS) {
    return _tagScanCache.promise   // share in-flight or fresh result
  }
}

const promise = invokeScanVaultTags(vault)            // existing bridge wrapper
  .then(result => result.ok ? result.value : [])
  .catch(() => [])                                   // never throw

_tagScanCache = { vaultId: vault.id, ts: Date.now(), promise }
return promise
```

Use `__TAURI_INTERNALS__.invoke` directly per IIFE rules (no
`bridge.ts` runtime imports).

### `evaluateAllSmartFolders` implementation

```text
const tagScan = await scanVaultTagsCached(vault)
const map = evaluateAll(defs, vaultIndex, tagScan, Date.now())
_evaluationResults = map
```

### `clearEvaluationCache` implementation

```text
_evaluationResults = new Map()
_tagScanCache = null
```

Called from step_07 in the vault-changed handler (EC-07).

---

## 3. Modify `file-browser.plugin.ts`

Add a single new module-level reference so the eager-evaluation wiring in
step_07 has a name to call:

```typescript
import {
  evaluateAllSmartFolders,
  clearEvaluationCache,
  // (more added in later steps)
} from "./smart-folders";
```

No call sites in step_02 — wired in step_07. This import is "dead but
typechecked" until step_07 lands; that is intentional.

---

## Tests to pass after this step

Create `tests/plugins/file-browser/smart-folders.evaluator.test.ts`:

| Test name | Asserts |
|---|---|
| `buildInverseMaps: tag inversion` | three files, two tags, distribution correct |
| `buildInverseMaps: outbound count` | each entry's count matches `outboundLinks.length` |
| `buildInverseMaps: inbound count via stem resolution` | `[[Foo]]` from two files → `pathToInboundCount.get(fooPath) === 2` |
| `buildInverseMaps: non-md ext appears in distinctExtensions` | `.pdf` from nonMdFiles |
| `matchRule tag is/is not` | symmetric coverage |
| `matchRule path 4 operators` | each operator |
| `matchRule extension is/is not` | with leading-dot value |
| `matchRule modified in last N days` | timestamp arithmetic with injected `now` |
| `matchRule modified before / after` | ISO date parsing |
| `matchRule links 6 operators` | including ≥ N |
| `matchRule links: non-md returns false` | EC-18 |
| `matchRule title checks both title and name` | FR-08 |
| `evaluateSmartFolder AND combinator` | two rules together prune correctly |
| `evaluateSmartFolder sorted by modified desc` | Locked #12 |
| `evaluateAll builds inverse maps once` | spy on buildInverseMaps with 5 defs → 1 call (FR-28) |
| `evaluateSmartFolder with conflicting rules returns []` | EC-09 |
| `scanVaultTagsCached shares in-flight promise` | two simultaneous calls → 1 invoke (EC-15) |
| `scanVaultTagsCached respects 5 s TTL` | mocked timer + second call after 5.1 s → 2nd invoke |
| `clearEvaluationCache resets state` | post-clear `getAllEvaluationResults` is empty |
| `evaluateAll perf smoke` | 1000 entries × 10 SFs × 6 rule types under 100 ms (NFR-01) |

---

## Done when

- [ ] All evaluator unit tests pass.
- [ ] Perf smoke under 100 ms locally.
- [ ] No DOM, no `document`, no Tauri direct calls inside `evaluator.ts`
      (purity check — only `index.ts` may invoke `__TAURI_INTERNALS__`).
- [ ] `npm run build:plugins && npm run sync:plugins` succeeds.

---

## Constraints

- Each function ≤ 30 lines.
- `evaluator.ts` is **pure** — no `window`, no `console.error`. It may
  import types only.
- The "now" parameter is injected — never call `Date.now()` inside
  matchers. This makes "in last N days" tests deterministic.
- Inverse maps must be built **exactly once per `evaluateAll` call**.
  Add a unit test (spy) that proves this invariant.

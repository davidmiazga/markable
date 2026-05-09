---
title: Step 01 — Types, settings shape, persistence I/O
last-updated: "2026-05-08"
review-cadence-days: 30
status: active
---

# Step 01 — Types, settings shape, persistence I/O

## Goal

Land the **data model** and the **persistence layer** for Smart Folders
without any UI, evaluation, or tree integration. After this step, the
plugin can load and save `smartFolders` cleanly (including a corrupted
payload) but does not yet display anything.

This is a TDD-friendly foundation: every export here is testable in pure
TypeScript with no DOM mocking.

---

## Files to create

1. `src/plugins/file-browser/smart-folders/types.ts`
2. `src/plugins/file-browser/smart-folders/settings.ts`

## Files to modify

1. `src/plugins/file-browser/file-browser.plugin.ts` — extend
   `FileBrowserSettings`, call new load/save helpers.

---

## 1. `types.ts` — data shapes

This file is **types-only** (no runtime exports). It must compile with
`isolatedModules: true`.

### Required exports

```typescript
/** Stable id for a Smart Folder. Generated at create time, never mutated. */
export type SmartFolderId = string;

/** Six rule types — Locked #1 / FR-03 through FR-08. */
export type SmartFolderRuleType =
  | "tag" | "path" | "extension" | "modified" | "links" | "title";

/** All allowed operators across all rule types — FR-09. */
export type SmartFolderOperator =
  // tag
  | "is" | "is not"
  // path
  | "contains" | "does not contain" | "starts with" | "does not start with"
  // extension
  // (reuses "is" | "is not")
  // modified
  | "in last N days" | "not in last N days" | "before" | "after"
  // links
  | "outbound = 0" | "outbound >= 1" | "outbound >= N"
  | "inbound = 0"  | "inbound >= 1"  | "inbound >= N"
  // title (reuses "contains" | "does not contain")
  ;

/**
 * Discriminated union over rule types.
 * The `value` shape is type-specific so the matcher functions in step_02
 * can switch on `type` and trust the value's shape.
 */
export type SmartFolderRule =
  | { type: "tag";       operator: "is" | "is not"; value: string }
  | { type: "path";      operator: "contains" | "does not contain" | "starts with" | "does not start with"; value: string }
  | { type: "extension"; operator: "is" | "is not"; value: string }
  | { type: "modified";  operator: "in last N days" | "not in last N days"; value: number }
  | { type: "modified";  operator: "before" | "after"; value: string /* ISO date */ }
  | { type: "links";     operator: "outbound = 0" | "outbound >= 1" | "inbound = 0" | "inbound >= 1"; value: null }
  | { type: "links";     operator: "outbound >= N" | "inbound >= N"; value: number }
  | { type: "title";     operator: "contains" | "does not contain"; value: string };

/** Persisted shape for one Smart Folder. */
export interface SmartFolderDef {
  id: SmartFolderId;
  name: string;
  rules: SmartFolderRule[];
}

/** Result of evaluating one Smart Folder against the vault index. */
export interface EvaluationResult {
  smartFolderId: SmartFolderId;
  matches: string[];   // absolute paths, sorted by modified desc (Locked #12)
  count: number;       // === matches.length, denormalized for badge reads
}

/** Inverse maps built once per evaluation pass — FR-28. */
export interface InverseMaps {
  pathToTags: Map<string, Set<string>>;
  pathToInboundCount: Map<string, number>;
  pathToOutboundCount: Map<string, number>;
  distinctExtensions: string[];   // lowercase, with leading dot, sorted, unique
}
```

### Acceptance — types

- `tsc --noEmit` is clean.
- The discriminated-union form covers **every** operator in FR-09 with a
  matching value shape (numeric for "≥ N" and "in last N days"; string
  for date in "before"/"after"; `null` for the parameterless link
  comparators).
- No imports from `vault-types.ts` to keep this file pure-data.

---

## 2. `settings.ts` — load, save, validate, generate id

### Required exports

```typescript
/** Validate a candidate def, dropping invalid rules. Returns null if no rules survive. */
export function sanitizeDef(raw: unknown): SmartFolderDef | null;

/** Validate the full record. Returns a clean Record (never throws). */
export function sanitizeAll(raw: unknown): Record<string, SmartFolderDef[]>;

/** Generate a new stable id. */
export function generateSmartFolderId(): SmartFolderId;

/** Load smart folders for a vault from settings (returns []). */
export async function loadSmartFolders(
  api: MarkablePluginAPI,
  vaultId: string,
): Promise<SmartFolderDef[]>;

/** Persist smart folders for a vault (debounced via existing settings save). */
export async function saveSmartFolders(
  api: MarkablePluginAPI,
  vaultId: string,
  defs: SmartFolderDef[],
): Promise<void>;
```

### `sanitizeDef` validation rules (NFR-06, EC-08)

For each candidate `raw`:

1. `raw` must be a non-null object with `string id`, `string name`, `array rules`.
2. Each rule must:
   - Have a `type` ∈ `{ "tag", "path", "extension", "modified", "links", "title" }`.
   - Have an `operator` valid for that `type` (whitelist below).
   - Have a `value` whose shape matches the rule type per the union in
     `types.ts`. Reject `NaN`, negative `value` for "in last N days" /
     "≥ N", invalid ISO dates for "before"/"after".
3. Drop the **rule**, not the whole def, on validation failure (log a
   warning).
4. After pruning, if `rules.length === 0`, drop the **def** (FR-26 invariant).
5. If `name` is empty after `.trim()`, drop the def.

Operator whitelists per type (must match FR-09 exactly):

```text
tag       : { "is", "is not" }
path      : { "contains", "does not contain", "starts with", "does not start with" }
extension : { "is", "is not" }
modified  : { "in last N days", "not in last N days", "before", "after" }
links     : { "outbound = 0", "outbound >= 1", "outbound >= N",
              "inbound = 0",  "inbound >= 1",  "inbound >= N" }
title     : { "contains", "does not contain" }
```

### `generateSmartFolderId` implementation

```typescript
export function generateSmartFolderId(): SmartFolderId {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `sf-${crypto.randomUUID()}`;
  }
  // IIFE fallback: Tauri WKWebView usually has crypto, but be defensive.
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `sf-${Date.now().toString(36)}-${rand}`;
}
```

### `loadSmartFolders` flow

```text
const saved = await api.loadSettings() as FileBrowserSettings | null
const raw   = saved?.smartFolders ?? {}
const clean = sanitizeAll(raw)
return clean[vaultId] ?? []
```

If `sanitizeAll` actually pruned anything (track via a flag inside
`sanitizeAll`), call `saveSmartFolders` for **each** vault key that
changed so the cleaned shape lands on disk on the next mutation. **Do
not** save eagerly here — let the next user-initiated commit carry the
cleanup. Keep `loadSmartFolders` read-only.

### `saveSmartFolders` flow

Mirrors the existing pattern at `file-browser.plugin.ts:780-792` for
`scheduleSettingsSave`:

```text
const existing = (await api.loadSettings()) as FileBrowserSettings | null;
const expandedPaths = existing?.expandedPaths ?? {};
const pinnedPaths   = existing?.pinnedPaths   ?? {};
const smartFolders  = existing?.smartFolders  ?? {};
smartFolders[vaultId] = defs;
await api.saveSettings({ expandedPaths, pinnedPaths, smartFolders });
```

**Critical**: spread the existing record, mutate the slice, write the
whole thing back. Never overwrite `expandedPaths` / `pinnedPaths`.

---

## 3. Modify `file-browser.plugin.ts`

### Change 1 — extend `FileBrowserSettings`

Around line 740:

```typescript
interface FileBrowserSettings {
  expandedPaths: Record<string, string[]>;
  pinnedPaths?: Record<string, string[]>;
  smartFolders?: Record<string, SmartFolderDef[]>;   // NEW
}
```

Import `SmartFolderDef` from `./smart-folders/types`.

### Change 2 — extend `loadExpandedPaths`

Currently loads `_expandedPaths` and `_pinnedPaths`. Add a
`_smartFolders` module-level variable:

```typescript
let _smartFolders: SmartFolderDef[] = [];
```

Inside `loadExpandedPaths`, after loading pinned:

```typescript
_smartFolders = await loadSmartFolders(_api, vaultId);
```

### Change 3 — extend `scheduleSettingsSave`

When persisting, also write `smartFolders[vaultId] = _smartFolders` (same
spread-into-existing pattern documented above).

### Change 4 — re-export internal helpers for testing

In the `_testing` block at the bottom of the plugin:

```typescript
// Step 01 — exposed for unit tests
sanitizeDef,
sanitizeAll,
generateSmartFolderId,
loadSmartFolders,
saveSmartFolders,
```

---

## Tests to pass after this step

Create a new test file `tests/plugins/file-browser/smart-folders.settings.test.ts`:

| Test name | Asserts |
|---|---|
| `sanitizeDef accepts a well-formed def` | round-trips an obvious tag-rule def |
| `sanitizeDef drops unknown rule.type` | rule pruned, def survives if other rules valid |
| `sanitizeDef drops def with no rules after pruning` | returns null |
| `sanitizeDef rejects empty name` | returns null |
| `sanitizeDef whitelist: tag operator` | "is" passes; "matches" rejected |
| `sanitizeDef whitelist: links operator` | "outbound >= N" accepted with numeric value |
| `sanitizeDef value shape: in last N days requires positive int` | NaN/negatives dropped |
| `sanitizeDef value shape: before/after requires ISO date` | "2026-13-99" rejected |
| `sanitizeAll: malformed top-level returns {}` | array, null, primitive all return {} |
| `sanitizeAll: malformed per-vault returns []` | object instead of array → []; preserves siblings |
| `generateSmartFolderId returns sf-prefixed unique strings` | 1k iterations, all unique |
| `loadSmartFolders: missing field returns []` | EC-02 |
| `loadSmartFolders: corrupted entry pruned` | EC-08 |
| `saveSmartFolders preserves expandedPaths and pinnedPaths` | regression guard |

---

## Done when

- [ ] `tests/plugins/file-browser/smart-folders.settings.test.ts` passes.
- [ ] `npm run test:run` is green overall (no regression in existing tests).
- [ ] `npm run build:plugins && npm run sync:plugins` succeeds.
- [ ] No UI changes are visible in the running app — settings shape is
      ready but unused.

---

## Constraints

- Each function ≤ 30 lines, each file ≤ 30 functions (CLAUDE.md).
- No `any` in production code (the validators take `unknown` and narrow).
- No console.error — use `console.warn("[smart-folders] …")` for
  corruption logs (NFR-06).
- No Rust changes (Locked #11).

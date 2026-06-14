---
title: "Step 02 — Store (Collection + Stack CRUD)"
last-updated: "2026-06-05"
review-cadence-days: 7
status: active
---

# Step 02 — `_folder.md` Read/Write Store

## Goal

Provide one typed API that reads and writes every Collections-specific YAML key in `_folder.md`, composes the existing `yaml-frontmatter.ts` helpers, and serialises concurrent writes with a per-file queue.

## Files touched

- **New** `src/plugins/file-browser/collections/store.ts`
- **New** `tests/collections/store.test.ts`

## Function signatures to add

```typescript
// All Promises return FileResult<T> so callers can branch on { ok: true } / { ok: false }.

import type { FileResult } from "../../../lib/bridge";
import type { CollectionMeta, StackMeta } from "./types";

// ── Collection root ───────────────────────────────────────────────────────────

export async function readCollection(
  folderPath: string,
): Promise<FileResult<CollectionMeta>>;

export async function writeCollectionMeta(
  folderPath: string,
  patch: Partial<CollectionMeta>,
): Promise<FileResult<void>>;

// ── Stack ────────────────────────────────────────────────────────────────────

export async function readStack(
  folderPath: string,
): Promise<FileResult<StackMeta>>;

export async function writeStackMeta(
  folderPath: string,
  patch: Partial<StackMeta>,
): Promise<FileResult<void>>;

// ── stackOrder mutations (atomic, per-file-queued) ───────────────────────────

export async function appendStackToCollection(
  collectionPath: string,
  stackFolderName: string,
): Promise<FileResult<void>>;

export async function removeStackFromCollection(
  collectionPath: string,
  stackFolderName: string,
): Promise<FileResult<void>>;

export async function reorderStack(
  collectionPath: string,
  stackFolderName: string,
  direction: "up" | "down" | { toIndex: number },
): Promise<FileResult<void>>;

// ── Stack.order mutations ────────────────────────────────────────────────────

export async function appendNoteToStack(
  stackPath: string,
  noteFilename: string,
): Promise<FileResult<void>>;

export async function removeNoteFromStack(
  stackPath: string,
  noteFilename: string,
): Promise<FileResult<void>>;

export async function reorderNote(
  stackPath: string,
  noteFilename: string,
  direction: "up" | "down" | { toIndex: number },
): Promise<FileResult<void>>;

// ── references: mutations ────────────────────────────────────────────────────

export async function appendReference(
  stackPath: string,
  canonicalVaultRelPath: string,
): Promise<FileResult<void>>;

export async function removeReference(
  stackPath: string,
  canonicalVaultRelPath: string,
): Promise<FileResult<void>>;

export async function updateReferenceOnMove(
  stackPath: string,
  oldVaultRel: string,
  newVaultRel: string,
): Promise<FileResult<void>>;
```

Internal helpers (not exported):

```typescript
function folderMdPath(folderPath: string): string;  // `${folderPath}/_folder.md`

async function withFileQueue<T>(filePath: string, op: () => Promise<T>): Promise<T>;
// Per-file FIFO queue keyed by absolute path. Used by every writer to satisfy EC-10.

function defaultCollectionMeta(displayName: string): CollectionMeta;
function defaultStackMeta(displayName: string): StackMeta;

function buildFrontmatterFromMeta(
  meta: CollectionMeta | StackMeta,
): string;  // returns the full reconstructed file body
```

## Failing tests to write FIRST

`tests/collections/store.test.ts` — mock `bridge.readFile` / `bridge.writeFile` (the project already uses `vi.mock` for bridge in folder-icon tests; copy that pattern).

EC-coverage table:

| Test name | EC / FR | Asserts |
|---|---|---|
| `readCollection returns ok with parsed meta when type: collection` | FR-2 | parsed shape includes `displayName`, `stackOrder` |
| `readCollection returns ok with empty defaults if file missing` | EC-4 | `{ ok: true, value: defaultCollectionMeta(folderName) }` plus toast signal flag |
| `readCollection returns ok with defaults if frontmatter malformed` | EC-6 | same as above + toast flag |
| `writeCollectionMeta preserves unrelated keys (layout, icon, sort)` | EC-23 | round-trip diff has only Collections-specific keys changed |
| `writeCollectionMeta creates _folder.md if absent` | EC-6 fallback | writeFile called with reconstructed body |
| `readStack returns defaults if _folder.md missing` | EC-5 | `defaultStackMeta`, references: [] |
| `appendStackToCollection appends to stackOrder atomically` | FR-6 | parsed result has new entry at end |
| `reorderStack up swaps with previous` | Phase 1.5 hook | order after = [...before-2, before-1, before, ...rest] |
| `reorderStack with toIndex moves to exact position` | Phase 1.5 | targeted move |
| `appendNoteToStack appends to order` | FR-9 | `order` array length grows by 1 |
| `removeNoteFromStack removes by filename` | FR-12 | array no longer contains filename |
| `appendReference appends vault-rel path to references` | FR-23 | array contains new path |
| `removeReference removes only that entry, not duplicates of other paths` | FR-24 | other paths untouched |
| `updateReferenceOnMove replaces old path with new path` | FR-25 | array shows new path; old absent |
| `concurrent writes to same _folder.md serialize without corruption` | EC-10 | fire two writes in parallel via Promise.all; both ok; final state reflects both |
| `concurrent writes to different files do not serialize` | perf | timing assertion: both complete in roughly one-write duration, not two |
| `schemaVersion > known is read-only` | EC-13 | writer refuses with `{ ok: false, code: "schema-too-new" }` |
| `references containing a folder-shaped path is preserved as-is` | EC-17 setup | not the renderer's job; store doesn't validate references — that's reference-index/render layer |

## Implementation outline

1. `withFileQueue`: `Map<string, Promise<unknown>>`. Each call chains: `const prev = q.get(path) ?? Promise.resolve(); const next = prev.then(op).catch((e) => { /* swallow chain break */ throw e; }); q.set(path, next.finally(() => { if (q.get(path) === next) q.delete(path); })); return next;`
2. `readCollection`: `bridge.readFile` → `parseYamlFrontmatter` → pull `type`, `displayName`, `stackOrder`, `icon`. If `type !== "collection"`, fall back to defaults but still return `ok: true` (caller distinguishes via a side-channel — see step 05 for the toast contract).
3. `writeCollectionMeta`: read existing → `applyYamlKey` for each key in `patch` (or `removeYamlKey` for `undefined` values) → `reconstructFile` → atomic `writeFile`. All inside `withFileQueue`.
4. Stack functions: same shape against `_folder.md` of the Stack subfolder.
5. `appendStackToCollection`: `readCollection` → `writeCollectionMeta({ stackOrder: [...current, name] })`.
6. `reorderStack(direction)`: compute new array, then `writeCollectionMeta({ stackOrder })`.
7. Note/reference variants: identical shape against Stack `_folder.md`.
8. `schemaVersion` guard: at the top of every writer, `if ((current.schemaVersion ?? 1) > COLLECTIONS_SCHEMA_VERSION) return { ok: false, code: "schema-too-new" }`.

YAML serialisation of arrays uses block-sequence form (per the user's global frontmatter rule). `buildFrontmatterFromMeta` emits:

```yaml
schemaVersion: 1
type: collection
displayName: "MyCollection"
stackOrder:
  - "Stack 01"
  - "Stack 02"
```

Quote any string containing `: ` or starting with `[`/`{`/`-`/`?` (defensive — `applyYamlKey` already handles this for scalar keys; for array members use a small `escapeYamlString()` helper).

## Refactor opportunities

After step 03 lands, extract the `withFileQueue` helper to a shared location if reference-index needs it for the canonical-rename write fan-out. Don't pre-extract.

## Definition of Done

```bash
npm run test:run -- tests/collections/store.test.ts
```
Expected: 17 tests pass. Plugin rebuild required:

```bash
npm run build:plugins && npm run sync:plugins
```

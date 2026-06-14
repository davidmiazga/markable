---
title: "Step 04 — Commands"
last-updated: "2026-06-05"
review-cadence-days: 7
status: active
---

# Step 04 — Top-Level Commands

## Goal

One module exposes the high-level user-facing actions: Make/Unmake Collection, New Stack, Notecard-in-default-Stack, Add Reference. Each composes store.ts + bridge file ops + reference-index. Tested in isolation; wired into context menu + command bar in later steps.

## Files touched

- **New** `src/plugins/file-browser/collections/commands.ts`
- **New** `tests/collections/commands.test.ts`

## Function signatures to add

```typescript
import type { FileResult } from "../../../lib/bridge";

// ── Collection lifecycle ─────────────────────────────────────────────────────

/**
 * Convert a folder into a Collection.
 * EC-1: refuse if folder is already a Collection.
 * EC-2: refuse if any ancestor is a Collection (nested-not-supported).
 */
export async function makeCollection(
  folderPath: string,
): Promise<FileResult<void>>;

/**
 * Revert a Collection to a regular folder.
 * EC-23: preserves unrelated YAML keys; all .md files untouched.
 */
export async function unmakeCollection(
  collectionPath: string,
): Promise<FileResult<void>>;

// ── Stack lifecycle ──────────────────────────────────────────────────────────

/**
 * Create a new Stack in a Collection. Auto-name; folder + _folder.md
 * written atomically. Returns the new Stack's absolute path.
 * EC-3: name conflict → increment to next index.
 */
export async function newStack(
  collectionPath: string,
): Promise<FileResult<{ stackPath: string; stackName: string }>>;

// ── Notecard creation ────────────────────────────────────────────────────────

/**
 * Create an Untitled.md note in the default Stack of a Collection.
 * EC-12: if Collection has zero Stacks, auto-create "Stack 01" first.
 * Returns the new note's absolute path.
 */
export async function createNotecardInDefaultStack(
  collectionPath: string,
): Promise<FileResult<{ stackPath: string; notePath: string }>>;

/**
 * Create an Untitled.md note in a specific Stack.
 * Returns the new note's absolute path.
 */
export async function createNoteInStack(
  stackPath: string,
): Promise<FileResult<{ notePath: string }>>;

// ── References ───────────────────────────────────────────────────────────────

/**
 * Add a reference to canonicalNotePath in targetStackPath's references:.
 * FR-23. EC-17: refuses if canonicalNotePath resolves to a folder.
 */
export async function addReference(
  canonicalNotePath: string,
  targetStackPath: string,
): Promise<FileResult<void>>;

// ── Internal helpers (not exported) ──────────────────────────────────────────

async function isCollectionFolder(folderPath: string): Promise<boolean>;
async function hasCollectionAncestor(folderPath: string): Promise<boolean>;
function uniqueUntitled(stackPath: string, vaultIndex: VaultIndex): string;
// Returns "Untitled.md", "Untitled 2.md", ... whichever does not collide.
```

## Failing tests to write FIRST

`tests/collections/commands.test.ts`. Mock bridge + store; assert command behaviour.

| Test name | EC / FR | Asserts |
|---|---|---|
| `makeCollection writes type: collection to root _folder.md` | FR-1 | `writeCollectionMeta` called with `{ type: "collection", schemaVersion: 1, displayName, stackOrder: [] }` |
| `makeCollection refuses if already a Collection` | EC-1 | result `{ ok: false, code: "already-collection" }`; no write performed |
| `makeCollection refuses if nested inside another Collection` | EC-2 | walks parent chain via parseFolderMd; refuses |
| `makeCollection preserves existing unrelated keys (icon, layout)` | C-3, EC-23 | round-trip: `applyYamlKey` calls, no `removeYamlKey` calls |
| `unmakeCollection removes only Collections keys from root` | FR-4, EC-23 | `removeYamlKey` called for type, stackOrder; not for icon/layout |
| `unmakeCollection removes type, order, references from every Stack subfolder _folder.md` | FR-4 | each Stack's `_folder.md` rewritten with non-Collections keys preserved |
| `unmakeCollection leaves all .md files byte-identical` | EC-23 | no `writeFile` calls against any .md other than `_folder.md` files |
| `newStack writes Stack 01 with notebook icon when collection is empty` | FR-6, C-6 | `writeStackMeta` called with `{ type: "stack", icon: "notebook", displayName: "Stack 01", order: [], references: [] }`; `appendStackToCollection("Stack 01")` called |
| `newStack increments to Stack 02 when Stack 01 exists` | EC-3 | new path ends with "Stack 02" |
| `newStack skips gaps and picks max+1` | EC-3 | with ["Stack 01","Stack 03"] → "Stack 04" |
| `createNotecardInDefaultStack auto-creates Stack 01 when none exists` | EC-12 | `newStack` called first; then `createNoteInStack` against Stack 01 |
| `createNoteInStack writes empty Untitled.md and appends to order` | FR-11 | `writeFile(stackPath/Untitled.md, "")` + `appendNoteToStack("Untitled.md")` |
| `createNoteInStack picks Untitled 2.md when Untitled.md exists` | naming | unique filename selected |
| `addReference appends vault-rel canonical path to target Stack` | FR-23 | `appendReference(target, canonical-rel)` called |
| `addReference refuses if canonicalPath is a folder` | EC-17 | result `{ ok: false, code: "not-a-note" }`; no write |

## Implementation outline

1. **`makeCollection(folderPath)`**:
   - `if (await isCollectionFolder(folderPath))` → return refusal.
   - `if (await hasCollectionAncestor(folderPath))` → return refusal.
   - Otherwise: derive `displayName` from the folder basename, call `store.writeCollectionMeta(folderPath, defaultCollectionMeta(displayName))`.
   - Caller (step 14 context-menu / step 15 command-bar) re-triggers vault reload.
2. **`hasCollectionAncestor`**: walk `path.dirname` upward until we hit the vault root (or `/`); for each ancestor, `parseFolderMd(readFile(ancestor/_folder.md))` and check `frontmatter.type === "collection"`. Use the existing parser; the read is fast (one file per level).
3. **`unmakeCollection`**:
   - `const meta = await readCollection(collectionPath);`
   - For each `stackName` in `meta.stackOrder`, `removeYamlKey` for `type`, `order`, `references` from that Stack's `_folder.md`.
   - Then `removeYamlKey` for `type`, `stackOrder`, `references` from the Collection's root `_folder.md`.
4. **`newStack(collectionPath)`**:
   - Read current `stackOrder`; derive next name with `nextStackName`.
   - `await bridge.createDirectory(collectionPath/name)` (use existing wrapper or add in step 02's audit).
   - `await store.writeStackMeta(stackPath, defaultStackMeta(name))`.
   - `await store.appendStackToCollection(collectionPath, name)`.
   - Return `{ stackPath, stackName: name }`.
5. **`createNotecardInDefaultStack`**:
   - Read `stackOrder`; if empty, `await newStack(collectionPath)` first.
   - Pick first Stack as default.
   - Delegate to `createNoteInStack`.
6. **`createNoteInStack`**:
   - Compute unique filename via `uniqueUntitled`.
   - `await bridge.writeFile(notePath, "")`.
   - `await store.appendNoteToStack(stackPath, filename)`.
7. **`addReference`**:
   - Check via vault index: is `canonicalNotePath` a known `.md` file entry? If not (e.g., it's a folder), return refusal.
   - Compute vault-rel path: `canonicalNotePath.slice(vaultRoot.length + 1)`.
   - `await store.appendReference(targetStackPath, vaultRel)`.

Vault root resolution uses `vault-manager.getActiveVaultRoot()` (existing — verify exact name in step 04 implementation; if absent, use the same path the folder-icon-store uses to derive vault-rel paths).

## Refactor opportunities

Once step 13 lands, `addReference`'s file-existence check can be replaced by an O(1) lookup against the reference-index's known-paths set. Defer.

## Definition of Done

```bash
npm run test:run -- tests/collections/commands.test.ts
```
Expected: 15 tests pass. Plugin rebuild required.

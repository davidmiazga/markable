/**
 * reference-index.ts — In-memory reverse index for multi-reference notes.
 *
 * Maps `canonicalRel: string` → `Set<owningStackFolderMdPath: string>` so that
 * a canonical-file rename or delete fan-outs in O(1) to exactly the Stacks
 * whose `references:` arrays must be rewritten — rather than scanning every
 * `_folder.md` in the vault on each event (NFR-1).
 *
 * Sources of mutation:
 *   - rebuild(vaultIndex)        — fired on vault load and on a debounced
 *                                  vault-changed event. Iterates every
 *                                  `_folder.md` in the index, reads its
 *                                  `references:` array via the store layer,
 *                                  and builds a fresh map atomically.
 *   - onCanonicalRenamed(o, n)   — fired by the rename hook (step 13). Walks
 *                                  every owning Stack of `o` and dispatches
 *                                  `store.updateReferenceOnMove(stack, o, n)`,
 *                                  then re-keys the map entry.
 *   - onCanonicalDeleted(rel)    — fired by the delete hook. Walks every
 *                                  owning Stack and dispatches
 *                                  `store.removeReference(stack, rel)`.
 *
 * The index does NOT validate that a `references:` entry corresponds to a
 * real `.md` file in the vault — broken pointers (EC-16, EC-17) are still
 * indexed so that the renderer can find them and offer "Remove reference".
 *
 * @module collections/reference-index
 */

import type { VaultIndex } from "../../../lib/vault-types";
import * as store from "./store";

/** Public surface of one reference-index instance. */
export interface ReferenceIndexHandle {
  /**
   * Rebuild the map from the current vault index. Idempotent. Concurrent
   * calls are de-duplicated via a single in-flight promise.
   */
  rebuild(vaultIndex: VaultIndex | null): Promise<void>;

  /**
   * Returns the list of owning Stack `_folder.md` paths that reference the
   * given canonical (vault-relative) path. Empty array on miss.
   */
  lookup(canonicalRel: string): readonly string[];

  /**
   * Propagate a canonical rename: every owning Stack's `references:` array
   * is rewritten via the store layer; the map is re-keyed from `old` to
   * `new` in the same atomic step.
   */
  onCanonicalRenamed(oldVaultRel: string, newVaultRel: string): Promise<void>;

  /**
   * Propagate a canonical delete: every owning Stack's `references:` array
   * has the entry removed; the map clears that key.
   */
  onCanonicalDeleted(vaultRel: string): Promise<void>;

  /** For tests: number of canonical entries currently indexed. */
  size(): number;
}

/**
 * Compute the parent Stack folder path from a `_folder.md` absolute path.
 * `"/v/A/Stack 01/_folder.md"` → `"/v/A/Stack 01"`.
 */
function parentFolderOf(folderMdPath: string): string {
  const sep = folderMdPath.lastIndexOf("/_folder.md");
  return sep > 0 ? folderMdPath.slice(0, sep) : folderMdPath;
}

/**
 * Collect every `_folder.md` absolute path that the given vault index knows
 * about. The vault watcher emits non-md files separately, and the indexer
 * keeps them under `nonMdFiles`, so the path-suffix filter is the canonical
 * way to enumerate them — same approach the folder-icon-store uses.
 */
function collectFolderMdPaths(vaultIndex: VaultIndex | null): string[] {
  if (!vaultIndex) return [];
  const out: string[] = [];
  // Primary source: nonMdFiles (where the indexer parks _folder.md sidecars).
  if (vaultIndex.nonMdFiles) {
    for (const f of vaultIndex.nonMdFiles) {
      if (f.path.endsWith("/_folder.md")) out.push(f.path);
    }
  }
  // Fallback: some indexer paths leak _folder.md into entries[]; treat both
  // sources as a union so we never miss an owning Stack.
  for (const e of vaultIndex.entries) {
    if (e.path.endsWith("/_folder.md")) out.push(e.path);
  }
  // Deduplicate while preserving first-encounter order (a Set then spread).
  return Array.from(new Set(out));
}

/**
 * Factory for a reference-index instance. Module-level singleton is exported
 * below; the factory lets tests construct isolated instances.
 */
export function createReferenceIndex(): ReferenceIndexHandle {
  // The reverse map. Keys are canonical vault-rel paths; values are sets of
  // owning Stack `_folder.md` absolute paths. Set semantics deduplicate
  // automatically — relevant for the concurrent-rebuild test (EC-10).
  let map = new Map<string, Set<string>>();

  // De-dup concurrent rebuild calls — both callers await the same work.
  let rebuildLock: Promise<void> | null = null;

  async function rebuild(vaultIndex: VaultIndex | null): Promise<void> {
    if (rebuildLock) {
      await rebuildLock;
      return;
    }
    rebuildLock = (async () => {
      const folderMdPaths = collectFolderMdPaths(vaultIndex);
      const next = new Map<string, Set<string>>();
      // Read every owning Stack in parallel. The store layer queues per-file
      // writes but reads do not contend; concurrent readFile is safe.
      const reads = folderMdPaths.map(async (folderMd) => {
        const stackPath = parentFolderOf(folderMd);
        const res = await store.readStack(stackPath);
        if (!res.ok) return;
        for (const refRel of res.value.references) {
          let owners = next.get(refRel);
          if (!owners) {
            owners = new Set<string>();
            next.set(refRel, owners);
          }
          owners.add(folderMd);
        }
      });
      await Promise.all(reads);
      // Atomic swap — observers reading via lookup() during rebuild see the
      // old map until this assignment lands.
      map = next;
    })().finally(() => {
      rebuildLock = null;
    });
    await rebuildLock;
  }

  function lookup(canonicalRel: string): readonly string[] {
    const owners = map.get(canonicalRel);
    if (!owners) return [];
    return Array.from(owners);
  }

  async function onCanonicalRenamed(
    oldVaultRel: string,
    newVaultRel: string,
  ): Promise<void> {
    const owners = map.get(oldVaultRel);
    if (!owners || owners.size === 0) return;
    // Snapshot the owner set BEFORE we mutate the map so concurrent reads
    // see a consistent state.
    const ownerList = Array.from(owners);
    await Promise.all(
      ownerList.map((folderMd) =>
        store.updateReferenceOnMove(parentFolderOf(folderMd), oldVaultRel, newVaultRel),
      ),
    );
    // Re-key in lockstep.
    map.delete(oldVaultRel);
    const existingAtNew = map.get(newVaultRel);
    if (existingAtNew) {
      for (const o of owners) existingAtNew.add(o);
    } else {
      map.set(newVaultRel, owners);
    }
  }

  async function onCanonicalDeleted(vaultRel: string): Promise<void> {
    const owners = map.get(vaultRel);
    if (!owners || owners.size === 0) return;
    const ownerList = Array.from(owners);
    await Promise.all(
      ownerList.map((folderMd) =>
        store.removeReference(parentFolderOf(folderMd), vaultRel),
      ),
    );
    map.delete(vaultRel);
  }

  function size(): number {
    return map.size;
  }

  return { rebuild, lookup, onCanonicalRenamed, onCanonicalDeleted, size };
}

/**
 * Module-level singleton. Step 13 wires `referenceIndex.rebuild` into the
 * vault-changed event in `file-browser.plugin.ts`. Tests construct
 * isolated instances via `createReferenceIndex()` so they do not pollute
 * the singleton.
 */
export const referenceIndex: ReferenceIndexHandle = createReferenceIndex();

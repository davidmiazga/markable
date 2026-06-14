/**
 * commands.ts — Top-level Collections actions.
 *
 * Each export composes the store layer plus the bridge file-system primitives
 * to implement one user-visible action:
 *
 *   newStack
 *     Auto-name (`Stack NN`) + write the per-Stack `_folder.md` + append to
 *     the parent Collection's `stackOrder`. EC-3 covers the next-index logic.
 *
 *   createNotecardInDefaultStack
 *     EC-12: when the Collection has zero Stacks, auto-create `Stack 01`
 *     before placing the note.
 *
 *   createNoteInStack
 *     FR-11: writes `Untitled.md` (or `Untitled 2.md` on collision) into the
 *     Stack folder and appends to the Stack's `order:` array.
 *
 *   addReference
 *     FR-23: appends a canonical note's vault-relative path to the target
 *     Stack's `references:` array. Refuses non-files (EC-17).
 *
 * The MVP-era `makeCollection` / `unmakeCollection` lifecycle commands were
 * removed in refactor step_R01 (2026-06-06). Collections is now opted into
 * by selecting "Collection" via the display-options picker — the layout-key
 * `layout: collection-home` in `_folder.md` is the only discoverable marker.
 * See docs/specs/collections/00_index.md → "Refactor 2026-06-06" for the
 * full architectural shift.
 *
 * No raw `invoke()` calls — all I/O is through `bridge.ts` (C-4).
 *
 * @module collections/commands
 */

import { ensureDirectory, writeFile } from "../../../lib/bridge";
import * as store from "./store";
import * as vaultManager from "../../../lib/vault-manager";
import { nextStackName, COLLECTIONS_SCHEMA_VERSION, STACK_DEFAULT_ICON } from "./schema";
import type { FileResult } from "../../../lib/errors";
import type { StackMeta } from "./types";

/**
 * Default StackMeta for a newly-created Stack. The `notebook` icon is the
 * canonical default per C-6 / the prerequisite folder-icon-assignment spec.
 */
function defaultStackMeta(displayName: string): StackMeta {
  return {
    schemaVersion: COLLECTIONS_SCHEMA_VERSION,
    displayName,
    icon: STACK_DEFAULT_ICON,
    order: [],
    references: [],
  };
}

/**
 * Compute the vault-relative path of an absolute note path against the
 * active vault's first root. Returns the absolute path unchanged if the
 * vault root cannot be determined (defensive — the caller has already
 * checked that the note is in the vault index).
 */
function toVaultRel(absPath: string): string {
  const vault = vaultManager.getActiveVault();
  if (!vault || vault.rootPaths.length === 0) return absPath;
  // Pick the rootPath that the absolute path is under. Vaults may declare
  // multiple roots; the first match wins (stable ordering matches indexer).
  for (const root of vault.rootPaths) {
    const rootNoTrail = root.replace(/\/+$/, "");
    if (absPath.startsWith(rootNoTrail + "/")) {
      return absPath.slice(rootNoTrail.length + 1);
    }
  }
  return absPath;
}

/**
 * Pick a fresh `Untitled NN.md` filename that does not collide with any
 * `.md` file already present in `stackPath` (per the vault index).
 *
 * Returns `"Untitled.md"` when no collision exists; otherwise the lowest
 * `Untitled K.md` with K ≥ 2 that is free.
 */
function uniqueUntitled(stackPath: string): string {
  const index = vaultManager.getVaultIndex();
  const stackNoTrail = stackPath.replace(/\/+$/, "") + "/";
  const taken = new Set<string>();
  if (index) {
    for (const entry of index.entries) {
      if (entry.path.startsWith(stackNoTrail)) {
        const rel = entry.path.slice(stackNoTrail.length);
        // Only direct children — exclude nested files.
        if (!rel.includes("/")) {
          taken.add(rel);
        }
      }
    }
  }
  if (!taken.has("Untitled.md")) return "Untitled.md";
  for (let k = 2; k < 10000; k++) {
    const candidate = `Untitled ${k}.md`;
    if (!taken.has(candidate)) return candidate;
  }
  // Defensive fallback — exceedingly unlikely.
  return `Untitled ${Date.now()}.md`;
}

// ── Public commands ──────────────────────────────────────────────────────────

/**
 * Create a new Stack (FR-6, EC-3, C-6).
 *
 * Returns the absolute path and folder name of the new Stack. Caller (the
 * renderer / context-menu wiring) is responsible for re-reading the vault
 * index and re-rendering.
 */
export async function newStack(
  collectionPath: string,
): Promise<FileResult<{ stackPath: string; stackName: string }>> {
  const cur = await store.readCollection(collectionPath);
  if (!cur.ok) return cur;
  const name = nextStackName(cur.value.stackOrder);
  const stackPath = `${collectionPath.replace(/\/+$/, "")}/${name}`;
  // Ensure the directory exists. The bridge wrapper calls the Rust
  // ensure_directory command which is a no-op when the dir already exists.
  await ensureDirectory(stackPath);
  // Write the per-Stack _folder.md with default metadata.
  const writeRes = await store.writeStackMeta(stackPath, defaultStackMeta(name));
  if (!writeRes.ok) return writeRes;
  // Append to parent's stackOrder atomically.
  const appendRes = await store.appendStackToCollection(collectionPath, name);
  if (!appendRes.ok) return appendRes;
  return { ok: true, value: { stackPath, stackName: name } };
}

/**
 * Create a Notecard at the Collection's root (FR-5 revised, 2026-06-09).
 *
 * Writes an empty `Untitled.md` (or `Untitled 2.md`, etc.) directly into
 * the collection folder — NOT inside a Stack. The note appears in the
 * Home canvas's mixed grid alongside any Stack tiles via the vault
 * index's `listImmediateNotes` enumeration (no metadata bookkeeping
 * needed; the file's existence is the source of truth).
 *
 * Caller is responsible for reloading the vault index before the next
 * render so the new file appears in the tile grid.
 */
export async function createNotecardInCollection(
  collectionPath: string,
): Promise<FileResult<{ notePath: string }>> {
  const filename = uniqueUntitled(collectionPath);
  const notePath = `${collectionPath.replace(/\/+$/, "")}/${filename}`;
  const writeRes = await writeFile(notePath, "");
  if (!writeRes.ok) return writeRes;
  return { ok: true, value: { notePath } };
}

/**
 * Create a Notecard inside the default Stack (FR-5 original, EC-12).
 *
 * Retained for any caller that still needs the "auto-stack-and-place"
 * behaviour. The Home canvas's + popover uses
 * `createNotecardInCollection` instead per the 2026-06-09 directive.
 */
export async function createNotecardInDefaultStack(
  collectionPath: string,
): Promise<FileResult<{ stackPath: string; notePath: string }>> {
  let cur = await store.readCollection(collectionPath);
  if (!cur.ok) return cur;
  if (cur.value.stackOrder.length === 0) {
    const stackRes = await newStack(collectionPath);
    if (!stackRes.ok) return stackRes;
    cur = await store.readCollection(collectionPath);
    if (!cur.ok) return cur;
  }
  // Pick the first Stack as the default (matches FR-5 wording).
  const defaultStack = cur.value.stackOrder[0];
  const stackPath = `${collectionPath.replace(/\/+$/, "")}/${defaultStack}`;
  const noteRes = await createNoteInStack(stackPath);
  if (!noteRes.ok) return noteRes;
  return { ok: true, value: { stackPath, notePath: noteRes.value.notePath } };
}

/**
 * Create an `Untitled.md` in a specific Stack (FR-11).
 *
 * Writes an empty file via the atomic bridge writer, then appends the
 * filename to the Stack's `order:` array. Returns the new note's absolute
 * path.
 */
export async function createNoteInStack(
  stackPath: string,
): Promise<FileResult<{ notePath: string }>> {
  const filename = uniqueUntitled(stackPath);
  const notePath = `${stackPath.replace(/\/+$/, "")}/${filename}`;
  const writeRes = await writeFile(notePath, "");
  if (!writeRes.ok) return writeRes;
  const appendRes = await store.appendNoteToStack(stackPath, filename);
  if (!appendRes.ok) return appendRes;
  return { ok: true, value: { notePath } };
}

/**
 * Add a reference (FR-23).
 *
 * Refuses with `not-a-note` if `canonicalNotePath` is not present in the
 * vault index as a `.md` file (EC-17 — could be a folder, missing file, or
 * an entry the indexer hasn't seen yet).
 *
 * The vault-relative path is computed from the active vault's first
 * matching `rootPath`. The store layer is idempotent — duplicate adds are
 * silently absorbed.
 */
export async function addReference(
  canonicalNotePath: string,
  targetStackPath: string,
): Promise<FileResult<void>> {
  const index = vaultManager.getVaultIndex();
  const isKnownNote =
    !!index && index.entries.some((e) => e.path === canonicalNotePath);
  if (!isKnownNote) {
    return {
      ok: false,
      error: { message: "not-a-note", command: "add_reference", path: canonicalNotePath },
    };
  }
  const vaultRel = toVaultRel(canonicalNotePath);
  return store.appendReference(targetStackPath, vaultRel);
}

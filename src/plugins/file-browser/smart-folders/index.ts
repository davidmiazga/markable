/**
 * smart-folders/index.ts
 *
 * Public API barrel for the Smart Folders module.
 *
 * This module owns all module-level mutable state:
 *   - _evaluationResults: Map<id, EvaluationResult>
 *   - _tagScanCache:      per-vault tag-scan TTL cache (5 s, shared promise)
 *
 * It is the ONLY file in this module that may access window globals
 * (__TAURI_INTERNALS__) or call async I/O. evaluator.ts is kept pure.
 *
 * Later steps (step_03 through step_08) will add more exports here:
 * injectIntoTree, openFilterEditor, buildSmartFolderContextMenuItems, etc.
 * Each new export should be documented when it lands.
 *
 * @module smart-folders/index
 */

import type { VaultEntry, VaultIndex } from "../../../lib/vault-types";
import type { TagEntry } from "../../../lib/bridge";
import type { SmartFolderDef, EvaluationResult } from "./types";
import { buildInverseMaps, evaluateAll } from "./evaluator";
import { buildEditorElement, type EditorContext } from "./editor-ui";
import { generateSmartFolderId } from "./settings";

// ── Module-level state ────────────────────────────────────────────────────────

/**
 * Cache of evaluation results, keyed by smart folder id.
 *
 * Updated by evaluateAllSmartFolders(). Read by tree-injection (step_03)
 * and the count badge (step_07). Cleared by clearEvaluationCache() on
 * vault change (EC-07).
 */
let _evaluationResults = new Map<string, EvaluationResult>();

/**
 * Tag-scan result cache with a ~5 s TTL.
 *
 * A shared Promise (not a resolved value) ensures that concurrent evaluation
 * passes within the TTL await the same in-flight Tauri call rather than
 * issuing redundant requests — prevents race conditions on rapid edits (EC-15).
 *
 * Cache is invalidated when:
 *   - TTL expires (5 seconds).
 *   - vaultId changes (vault switch).
 *   - clearEvaluationCache() is called explicitly.
 */
const TAG_SCAN_TTL_MS = 5_000;
let _tagScanCache: { vaultId: string; ts: number; promise: Promise<TagEntry[]> } | null = null;

// ── Tag scan with TTL cache ───────────────────────────────────────────────────

/**
 * Scan vault tags, using a shared-promise cache with a 5 s TTL.
 *
 * Returns [] on failure (degraded mode — tag rules will match nothing).
 * Never throws (NFR-06).
 *
 * The cache entry stores the Promise itself (not the resolved value) so two
 * concurrent callers within the TTL window await the same I/O operation
 * rather than issuing two separate Tauri commands (EC-15 / AD-4).
 *
 * @param vault - The active vault to scan tags for.
 * @returns TagEntry[] for the vault (may be [] in degraded mode).
 */
export async function scanVaultTagsCached(vault: VaultEntry): Promise<TagEntry[]> {
  const now = Date.now();

  // Return cached promise if vault matches and TTL hasn't expired.
  if (
    _tagScanCache &&
    _tagScanCache.vaultId === vault.id &&
    now - _tagScanCache.ts < TAG_SCAN_TTL_MS
  ) {
    return _tagScanCache.promise;
  }

  // Build a new promise and cache it immediately (before awaiting) so
  // concurrent callers that arrive while the I/O is in-flight share it.
  const promise = invokeScanVaultTags(vault);
  _tagScanCache = { vaultId: vault.id, ts: now, promise };
  return promise;
}

/**
 * Invoke the Tauri scan_vault_tags command.
 *
 * Uses __TAURI_INTERNALS__.invoke per IIFE rules (no bridge.ts runtime import).
 * Returns [] on any failure (NFR-06 — never throw from the evaluator path).
 */
async function invokeScanVaultTags(vault: VaultEntry): Promise<TagEntry[]> {
  try {
    const invoke = (window as any).__TAURI_INTERNALS__?.invoke;
    if (!invoke) return [];
    const result = await invoke("scan_vault_tags", {
      rootPaths: vault.rootPaths,
      excludePatterns: vault.excludePatterns,
      vaultName: vault.name,
    });
    // The command returns TagEntry[] directly (unwrapped by Tauri)
    if (Array.isArray(result)) return result as TagEntry[];
    return [];
  } catch {
    return [];
  }
}

// ── Eager evaluation entry point ──────────────────────────────────────────────

/**
 * Run a full evaluation pass for all smart folders and store results.
 *
 * Called eagerly on: vault index ready, smart folder CRUD, vault changed
 * (FR-29, AD-4). Results are stored in _evaluationResults and read by
 * tree-injection and the count badge (step_03, step_07).
 *
 * @param defs       - The smart folder definitions for the active vault.
 * @param vaultIndex - The current vault index.
 * @param vault      - The active vault (for tag scan caching).
 */
export async function evaluateAllSmartFolders(
  defs: SmartFolderDef[],
  vaultIndex: VaultIndex,
  vault: VaultEntry,
): Promise<void> {
  const tagScan = await scanVaultTagsCached(vault);
  const maps = buildInverseMaps(vaultIndex, tagScan);
  setCachedDistinctExtensions(maps.distinctExtensions);
  setCachedKnownTags(tagScan.map(e => e.tag));
  const map = evaluateAll(defs, vaultIndex, tagScan, Date.now());
  _evaluationResults = map;
}

// ── Result accessors ─────────────────────────────────────────────────────────

/**
 * Read the cached evaluation result for one smart folder.
 *
 * Returns null when the id is not in the cache (e.g. before first evaluation
 * or after clearEvaluationCache()).
 *
 * @param id - The SmartFolderId to look up.
 * @returns The cached EvaluationResult or null.
 */
export function getEvaluationResult(id: string): EvaluationResult | null {
  return _evaluationResults.get(id) ?? null;
}

/**
 * Read all cached evaluation results.
 *
 * Returns the live Map — callers must not mutate it.
 * Used by tree-injection to iterate all results in one pass.
 *
 * @returns The module-level results Map.
 */
export function getAllEvaluationResults(): Map<string, EvaluationResult> {
  return _evaluationResults;
}

// ── Cache management ──────────────────────────────────────────────────────────

/**
 * Clear the evaluation result cache and the tag-scan cache.
 *
 * Must be called on vault change (EC-07) to prevent stale results from
 * a previous vault bleeding into the new vault's tree.
 */
export function clearEvaluationCache(): void {
  _evaluationResults = new Map();
  _tagScanCache = null;
}

/**
 * Remove a single entry from the evaluation results cache by id.
 *
 * Called by the delete lifecycle (step_06, EC-06) so that the renderer
 * does not synthesize a stale smart-folder node on the next renderPanel()
 * after a Smart Folder is deleted.
 *
 * Idempotent — safe to call when the id is not in the cache.
 *
 * @param id - The SmartFolderId whose result should be removed.
 */
export function removeEvaluationResult(id: string): void {
  _evaluationResults.delete(id);
}

// ── Filter editor state ───────────────────────────────────────────────────────

/**
 * Options for openFilterEditor.
 *
 * create mode: anchorPath is the vault root; opens a blank form.
 * edit mode:   anchorPath is the smart-folder synthetic path; seeds from def.
 */
export interface OpenFilterEditorOptions {
  mode: "create" | "edit";
  /** For create: vault root path. For edit: smart-folder synthetic path. */
  anchorPath: string;
  /** Edit mode only — the existing def to pre-populate the form. */
  def?: SmartFolderDef;
}

/**
 * Open editor instance. Only one editor may be open at a time.
 * Stores the DOM container and a cleanup function for removal.
 */
let _openEditor: {
  container: HTMLElement;
  cleanup: () => void;
  mode: "create" | "edit";
  defId?: string;
} | null = null;

// ── Callbacks for committing draft (set from file-browser.plugin.ts) ──────────

/**
 * Commit callback: called by Save to persist and re-evaluate.
 * Populated in step_07 when the plugin wires eager re-evaluation.
 * Until then, a no-op keeps the editor functional without crashing.
 */
let _commitDraftCb: ((mode: "create" | "edit", draft: SmartFolderDef) => void) | null = null;

/**
 * Register the commit-draft callback from the plugin layer (step_07).
 * Keeps the index module decoupled from the plugin's module-level state.
 */
export function registerCommitDraftCallback(
  cb: (mode: "create" | "edit", draft: SmartFolderDef) => void,
): void {
  _commitDraftCb = cb;
}

// ── Tag/extension context accessors ──────────────────────────────────────────

/**
 * Collect distinct extensions from the last evaluation pass.
 * Falls back to [] if no evaluation has been run yet.
 */
export function getDistinctExtensions(): string[] {
  // The inverse maps are rebuilt per evaluation pass and not retained here,
  // but distinctExtensions is available from the evaluation results indirectly.
  // We collect it from the tag scan cache's context; in step_07 this is wired
  // to the vaultIndex. For now, return [] as a safe default.
  return _cachedDistinctExtensions;
}

/** Module-level cache for distinct extensions (populated after evaluation). */
let _cachedDistinctExtensions: string[] = [];

/**
 * Store distinct extensions after an evaluation pass so the editor dropdown
 * is populated even before the user opens it.
 */
export function setCachedDistinctExtensions(exts: string[]): void {
  _cachedDistinctExtensions = exts;
}

/**
 * Collect all known tags from the last tag scan cache.
 * Falls back to [] when no scan has been run.
 */
export function getKnownTags(): string[] {
  return _cachedKnownTags;
}

/** Module-level cache for known tags (populated after tag scan). */
let _cachedKnownTags: string[] = [];

/**
 * Store known tags after a tag scan so the editor tag picker is populated.
 */
export function setCachedKnownTags(tags: string[]): void {
  _cachedKnownTags = tags;
}

// ── Filter editor lifecycle ───────────────────────────────────────────────────

/**
 * Close the open filter editor without saving.
 *
 * Idempotent — safe to call when no editor is open.
 * Removes the editor DOM element and clears module state.
 */
export function closeFilterEditor(): void {
  if (_openEditor) {
    _openEditor.cleanup();
    _openEditor = null;
  }
}

/**
 * Open the inline filter editor anchored to the row identified by anchorPath.
 *
 * Closes any previously open editor first. The editor is inserted as the next
 * sibling of the anchor <li> in the tree DOM (AD-8).
 *
 * @param opts - Mode, anchor path, and optional existing def for edit mode.
 */
export function openFilterEditor(opts: OpenFilterEditorOptions): void {
  // Close any existing editor first — only one at a time.
  closeFilterEditor();

  const initial: SmartFolderDef = opts.def ?? {
    id: generateSmartFolderId(),
    name: "",
    rules: [{ type: "tag", operator: "is", value: "" }],
  };

  const ctx: EditorContext = {
    distinctExtensions: getDistinctExtensions(),
    knownTags: getKnownTags(),
    onSave: (draft: SmartFolderDef) => {
      closeFilterEditor();
      if (_commitDraftCb) {
        _commitDraftCb(opts.mode, draft);
      }
    },
    onCancel: () => {
      closeFilterEditor();
    },
  };

  const editorEl = buildEditorElement(initial, ctx);
  document.body.appendChild(editorEl);

  // Focus the name field (FR-22)
  const nameInput = editorEl.querySelector<HTMLInputElement>(".sf-name-input");
  if (nameInput) setTimeout(() => nameInput.focus(), 0);

  const cleanup = (): void => { editorEl.remove(); };
  _openEditor = { container: editorEl, cleanup, mode: opts.mode, defId: initial.id };
}

// ── Re-exports from sub-modules (public surface) ─────────────────────────────

export { buildInverseMaps, matchRule, evaluateSmartFolder, evaluateAll } from "./evaluator";
export { sanitizeDef, sanitizeAll, generateSmartFolderId, loadSmartFolders, saveSmartFolders } from "./settings";
export type { SmartFolderDef, SmartFolderRule, EvaluationResult, InverseMaps } from "./types";

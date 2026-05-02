/**
 * vault-manager.ts
 *
 * In-memory vault state singleton, event bus, and generation counter.
 *
 * This module is NOT a plugin — it is a shared library imported by main.ts,
 * the File Browser plugin, and the Knowledge Graph plugin. Because it is
 * bundled via Rollup it does not need a window global for same-bundle
 * consumers. A window global IS exposed for IIFE plugins that cannot import
 * ES modules directly (see bottom of file).
 *
 * Responsibilities:
 * - Maintain the active VaultEntry reference and the current VaultIndex in memory.
 * - Provide CRUD operations that delegate persistence to the existing settings
 *   system (updateSettings / getCurrentSettings) and vault-specific Rust commands.
 * - Expose an event bus (onVaultChanged / onIndexUpdated) so UI components can
 *   react to vault and index changes without polling.
 * - Implement the generation counter pattern (EC-13) to discard stale index loads
 *   when the user switches vaults rapidly.
 *
 * Thread safety note: JavaScript is single-threaded. The "generation counter"
 * pattern here guards against the logical race between an awaited async index
 * load and a subsequent synchronous vault switch by the user.
 */

import { invoke } from "@tauri-apps/api/core";
import { getCurrentSettings, updateSettings } from "./settings";
import type {
  VaultEntry,
  VaultIndex,
  VaultChangedCallback,
  IndexUpdatedCallback,
  VaultFileChangedEvent,
} from "./vault-types";

// ── Module-level state ────────────────────────────────────────────────────────

/** The currently active vault, or null when no vault is selected. */
let activeVault: VaultEntry | null = null;

/** The in-memory index for the active vault, or null when not loaded. */
let vaultIndex: VaultIndex | null = null;

/**
 * Generation counter for rapid vault switching (EC-13).
 *
 * Every call to switchVault() increments this counter and captures its value
 * at the start of the async operation. Before applying the loaded index, the
 * operation checks whether the counter still matches — if not, the result is
 * discarded (a newer switch superseded this one).
 */
let switchGeneration = 0;

/** Registered listeners for vault activation / deactivation events. */
const vaultChangedListeners = new Set<VaultChangedCallback>();

/** Registered listeners for incremental index update events (Phase 2b). */
const indexUpdatedListeners = new Set<IndexUpdatedCallback>();

// ── Validation constants ──────────────────────────────────────────────────────

/** Maximum allowed vault name length (characters). */
const VAULT_NAME_MAX_LENGTH = 100;

/** Default soft cap for vault index size (files). */
const DEFAULT_MAX_INDEX_SIZE = 500;

/** Default glob patterns to exclude from index build. */
const DEFAULT_EXCLUDE_PATTERNS = ["node_modules", ".git", "*.log"];

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Emit a vault-changed event to all registered listeners.
 * Catches and logs errors from individual listeners to prevent one bad
 * listener from blocking the others.
 *
 * @param vault - The newly active vault, or null.
 */
function emitVaultChanged(vault: VaultEntry | null): void {
  for (const cb of vaultChangedListeners) {
    try {
      cb(vault);
    } catch (err) {
      console.error("[vault-manager] onVaultChanged listener threw:", err);
    }
  }
}

/**
 * Emit an index-updated event to all registered listeners.
 *
 * @param event - The file-system change event that triggered the update.
 */
function emitIndexUpdated(event: VaultFileChangedEvent): void {
  for (const cb of indexUpdatedListeners) {
    try {
      cb(event);
    } catch (err) {
      console.error("[vault-manager] onIndexUpdated listener threw:", err);
    }
  }
}

/**
 * Load the cached index for `vaultId` from disk via the Rust `get_vault_index`
 * command. Returns null if no cache exists or if the JSON is corrupt (EC-06).
 *
 * @param vaultId - The vault id whose index cache to read.
 */
async function loadCachedIndex(vaultId: string): Promise<VaultIndex | null> {
  try {
    const raw = await invoke<string | null>("get_vault_index", { vaultId });
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VaultIndex;
    // Basic sanity check: the parsed value must have the right vaultId.
    if (parsed.vaultId !== vaultId) {
      console.warn(
        `[vault-manager] Cached index vaultId "${parsed.vaultId}" does not ` +
          `match requested "${vaultId}". Discarding.`
      );
      return null;
    }
    return parsed;
  } catch (err) {
    // EC-06: Corrupted or missing cache — log and return null so the caller
    // triggers a fresh build.
    console.warn(`[vault-manager] Failed to load cached index for "${vaultId}":`, err);
    return null;
  }
}

/**
 * Build a fresh index for the given vault by invoking the Rust
 * `build_vault_index` command. Saves the result to disk asynchronously.
 *
 * @param vault - The vault whose index to build.
 * @returns The newly built VaultIndex.
 */
async function buildAndCacheIndex(vault: VaultEntry): Promise<VaultIndex> {
  const payload = await invoke<{
    vaultId: string;
    builtAt: number;
    entries: VaultIndex["entries"];
    totalFilesFound: number;
    skippedCount: number;
    capped: boolean;
    nonMdFiles: VaultIndex["nonMdFiles"];
    directories: VaultIndex["directories"];
  }>("build_vault_index", {
    vaultId: vault.id,
    rootPaths: vault.rootPaths,
    excludePatterns: vault.excludePatterns,
    maxCount: vault.maxIndexSize,
    // Pass vault name so the Rust command can exclude {name}_meta/ from the walk (FR-4).
    vaultName: vault.name,
  });

  const index: VaultIndex = {
    vaultId: payload.vaultId,
    builtAt: payload.builtAt,
    entries: payload.entries,
    totalFilesFound: payload.totalFilesFound,
    skippedCount: payload.skippedCount,
    capped: payload.capped,
    nonMdFiles: payload.nonMdFiles ?? [],
    directories: payload.directories ?? [],
  };

  // Persist to disk. EC-09: failure is logged but does not affect the in-memory
  // index — the vault continues to work without a disk cache.
  try {
    await invoke("save_vault_index", {
      vaultId: vault.id,
      indexJson: JSON.stringify(index),
    });
  } catch (err) {
    console.warn(`[vault-manager] Failed to save index cache for "${vault.id}":`, err);
  }

  return index;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialise the vault manager after settings have been loaded.
 *
 * Must be called once during app startup, after loadSettings() has populated
 * the in-memory settings singleton. Actions taken:
 * 1. Read the `vaults` array and `activeVaultId` from settings.
 * 2. Validate that `activeVaultId` references an existing vault (EC-11).
 *    If not, reset it to null and persist the correction.
 * 3. If a valid `activeVaultId` exists, activate that vault (load its index).
 */
export async function init(): Promise<void> {
  // NOTE (Phase 2): Per-entry staleness checking (comparing individual file modified
  // timestamps via list_vault_files) is deferred to Phase 2. Phase 1 only detects
  // whole-index corruption (EC-06) and triggers a full rebuild in that case.
  const settings = getCurrentSettings();
  const vaults = settings.vaults ?? [];
  const savedId = settings.activeVaultId ?? null;

  if (savedId !== null) {
    const found = vaults.find((v) => v.id === savedId) ?? null;
    if (found === null) {
      // EC-11: The saved activeVaultId no longer exists in the vaults array.
      // Reset it silently so the app starts in a clean no-vault state.
      console.warn(
        `[vault-manager] init: savedActiveVaultId "${savedId}" not found in vaults array. Resetting.`
      );
      await updateSettings((s) => ({ ...s, activeVaultId: null }));
      activeVault = null;
      vaultIndex = null;
      return;
    }

    // Valid saved vault — activate it without emitting the vaultChanged event
    // (this is init, not a user-triggered switch; the UI renders after init).
    activeVault = found;
    vaultIndex = await loadCachedIndex(found.id);
    if (vaultIndex === null) {
      // No cache or corrupt cache — build fresh (EC-06).
      try {
        vaultIndex = await buildAndCacheIndex(found);
      } catch (err) {
        console.error(`[vault-manager] Failed to build index on init:`, err);
        vaultIndex = null;
      }
    }
  } else {
    activeVault = null;
    vaultIndex = null;
  }
}

/**
 * Return the currently active vault, or null if none is active.
 *
 * Synchronous — reads from the in-memory state that init() / switchVault()
 * maintains. Safe to call at any time after init().
 */
export function getActiveVault(): VaultEntry | null {
  return activeVault;
}

/**
 * Return all configured vaults from the current in-memory settings.
 *
 * Synchronous — reads getCurrentSettings().vaults. Returns an empty array
 * when no vaults have been configured yet.
 */
export function getAllVaults(): VaultEntry[] {
  return getCurrentSettings().vaults ?? [];
}

/**
 * Return the in-memory index for the active vault, or null if not loaded.
 *
 * The index is loaded during init() and rebuilt via switchVault() /
 * reloadVaultIndex(). Plugins that need file data should subscribe to
 * onVaultChanged and onIndexUpdated rather than polling this function.
 */
export function getVaultIndex(): VaultIndex | null {
  return vaultIndex;
}

/**
 * Switch to a different vault.
 *
 * Increments the switchGeneration counter (EC-13), persists the new
 * activeVaultId to settings, loads or builds the index for the new vault,
 * and emits onVaultChanged when the switch completes.
 *
 * If id is the same as the currently active vault's id, this is a no-op
 * (no event fired, no index reload).
 *
 * @param id - The vault id to switch to.
 * @throws Error if id is not found in the current vaults list.
 */
export async function switchVault(id: string): Promise<void> {
  // No-op when switching to the already-active vault.
  if (activeVault?.id === id) return;

  const vaults = getAllVaults();
  const target = vaults.find((v) => v.id === id);
  if (!target) {
    throw new Error(`[vault-manager] switchVault: vault id "${id}" not found.`);
  }

  // Increment the generation counter BEFORE the first await so any concurrent
  // switch initiated while we await below will have a higher generation.
  switchGeneration++;
  const myGeneration = switchGeneration;

  // Persist the new activeVaultId and update lastOpened.
  // NOTE (LOW-3 trade-off): lastOpened is written before the index load completes.
  // If the index load fails, lastOpened is still updated. This is an accepted
  // trade-off — tracking "when the user attempted to open" is more useful than
  // tracking "when the index finished building".
  const now = new Date().toISOString();
  await updateSettings((s) => ({
    ...s,
    activeVaultId: id,
    vaults: (s.vaults ?? []).map((v) =>
      v.id === id ? { ...v, lastOpened: now } : v
    ),
  }));

  // Load or build the index. This is the async step that can be raced.
  let newIndex: VaultIndex | null = null;
  try {
    newIndex = await loadCachedIndex(id);
    if (newIndex === null) {
      newIndex = await buildAndCacheIndex(target);
    }
  } catch (err) {
    console.error(`[vault-manager] Failed to load/build index for vault "${id}":`, err);
  }

  // EC-13: Discard this result if a newer switch superseded us.
  if (switchGeneration !== myGeneration) {
    return;
  }

  // Update in-memory state. Re-read the vault from settings because the
  // lastOpened timestamp was mutated above.
  const updatedVaults = getCurrentSettings().vaults ?? [];
  activeVault = updatedVaults.find((v) => v.id === id) ?? target;
  vaultIndex = newIndex;

  emitVaultChanged(activeVault);
}

/**
 * Create a new vault, persist it to settings, and immediately activate it.
 *
 * Validates:
 * - `name` must be non-empty and ≤ 100 characters.
 * - `rootPaths` must have at least one entry.
 *
 * Generates a UUID v4 via `crypto.randomUUID()` and sets both `created` and
 * `lastOpened` to the current ISO 8601 timestamp.
 *
 * @param name            - Display name for the vault.
 * @param rootPaths       - One or more absolute directory paths.
 * @param excludePatterns - Glob patterns to exclude (defaults to DEFAULT_EXCLUDE_PATTERNS).
 * @param maxIndexSize    - Soft cap on indexed file count (defaults to DEFAULT_MAX_INDEX_SIZE).
 *                         Passed from the Manage Vaults form so the user's chosen value is
 *                         persisted. Without this parameter the form's maxIndexSize field was
 *                         silently ignored on vault creation (NEW-1 fix).
 * @returns The newly created VaultEntry.
 * @throws Error on validation failure.
 */
export async function createVault(
  name: string,
  rootPaths: string[],
  excludePatterns: string[] = DEFAULT_EXCLUDE_PATTERNS,
  maxIndexSize?: number
): Promise<VaultEntry> {
  // ── Validation ──────────────────────────────────────────────────────────────
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("[vault-manager] createVault: vault name must not be empty.");
  }
  if (trimmedName.length > VAULT_NAME_MAX_LENGTH) {
    throw new Error(
      `[vault-manager] createVault: vault name exceeds ${VAULT_NAME_MAX_LENGTH} characters.`
    );
  }
  if (!rootPaths.length) {
    throw new Error(
      "[vault-manager] createVault: rootPaths must contain at least one path."
    );
  }

  // Trim individual path entries to remove accidental leading/trailing whitespace
  // that could prevent path-existence checks from resolving correctly (LOW-5).
  const trimmedPaths = rootPaths.map((p) => p.trim()).filter(Boolean);
  if (!trimmedPaths.length) {
    throw new Error(
      "[vault-manager] createVault: rootPaths must contain at least one non-empty path."
    );
  }

  // ── Build the entry ─────────────────────────────────────────────────────────
  const now = new Date().toISOString();
  const entry: VaultEntry = {
    id: crypto.randomUUID(),
    name: trimmedName,
    rootPaths: trimmedPaths,
    excludePatterns,
    // Use the caller-supplied maxIndexSize when provided; fall back to the module
    // default. This ensures the Manage Vaults form's "Max Index Size" field is
    // actually persisted on vault creation (NEW-1 fix).
    maxIndexSize: maxIndexSize ?? DEFAULT_MAX_INDEX_SIZE,
    created: now,
    lastOpened: now,
  };

  // Persist to settings.
  await updateSettings((s) => ({
    ...s,
    vaults: [...(s.vaults ?? []), entry],
  }));

  // Immediately activate the new vault.
  await switchVault(entry.id);

  // Emit vaultChanged is handled inside switchVault. We additionally emit here
  // because spec test #16 checks that onVaultChanged fires on create.
  // switchVault already fires it — no duplicate needed.

  return entry;
}

/**
 * Update mutable fields on an existing vault entry.
 *
 * `id` and `created` are immutable and are silently ignored even if present
 * in the patch. If the updated vault is currently active and rootPaths or
 * excludePatterns changed, the index is rebuilt.
 *
 * @param id      - The vault to update.
 * @param updates - Partial patch of mutable fields.
 * @throws Error if id is not found.
 */
export async function updateVault(
  id: string,
  updates: Partial<Pick<VaultEntry, "name" | "rootPaths" | "excludePatterns" | "maxIndexSize">>
): Promise<void> {
  const vaults = getAllVaults();
  const existing = vaults.find((v) => v.id === id);
  if (!existing) {
    throw new Error(`[vault-manager] updateVault: vault id "${id}" not found.`);
  }

  // Validate name if provided.
  if (updates.name !== undefined) {
    const trimmed = updates.name.trim();
    if (!trimmed) {
      throw new Error("[vault-manager] updateVault: vault name must not be empty.");
    }
    if (trimmed.length > VAULT_NAME_MAX_LENGTH) {
      throw new Error(
        `[vault-manager] updateVault: vault name exceeds ${VAULT_NAME_MAX_LENGTH} characters.`
      );
    }
    updates = { ...updates, name: trimmed };
  }

  // Apply the patch (id and created are never overwritten).
  const updated: VaultEntry = {
    ...existing,
    ...(updates.name !== undefined ? { name: updates.name } : {}),
    ...(updates.rootPaths !== undefined ? { rootPaths: updates.rootPaths } : {}),
    ...(updates.excludePatterns !== undefined ? { excludePatterns: updates.excludePatterns } : {}),
    ...(updates.maxIndexSize !== undefined ? { maxIndexSize: updates.maxIndexSize } : {}),
  };

  await updateSettings((s) => ({
    ...s,
    vaults: (s.vaults ?? []).map((v) => (v.id === id ? updated : v)),
  }));

  // If the active vault was updated, refresh the in-memory reference.
  if (activeVault?.id === id) {
    activeVault = updated;

    // Re-index if the scan parameters changed.
    const pathsChanged =
      JSON.stringify(updates.rootPaths) !== JSON.stringify(existing.rootPaths) ||
      JSON.stringify(updates.excludePatterns) !== JSON.stringify(existing.excludePatterns);

    if (pathsChanged || updates.maxIndexSize !== undefined) {
      try {
        vaultIndex = await buildAndCacheIndex(updated);
      } catch (err) {
        console.error(`[vault-manager] updateVault: rebuild failed:`, err);
      }
    }

    emitVaultChanged(activeVault);
  }
}

/**
 * Delete a vault entry from settings and remove its index cache from disk.
 *
 * If the deleted vault was active, sets activeVaultId to null and emits
 * onVaultChanged(null) (EC-10).
 *
 * NOTE: This function is a no-op (resolves without throwing) when `id` is not
 * found in the vaults array — the caller does not need to check existence first.
 *
 * @param id - The vault to delete.
 */
export async function deleteVault(id: string): Promise<void> {
  const wasActive = activeVault?.id === id;

  // Remove from settings.
  await updateSettings((s) => ({
    ...s,
    vaults: (s.vaults ?? []).filter((v) => v.id !== id),
    ...(wasActive ? { activeVaultId: null } : {}),
  }));

  // Ask Rust to delete the index cache file (best-effort — no-op if absent).
  try {
    await invoke("delete_vault", { id });
  } catch (err) {
    console.warn(`[vault-manager] deleteVault: Rust cleanup failed for "${id}":`, err);
  }

  if (wasActive) {
    activeVault = null;
    vaultIndex = null;
    emitVaultChanged(null);
  }
}

/**
 * Force a full index rebuild for the active vault.
 *
 * No-op when no vault is active (returns immediately).
 * Emits onVaultChanged with the current vault after the rebuild so UI
 * components can re-render with the fresh index data.
 */
export async function reloadVaultIndex(): Promise<void> {
  if (!activeVault) return;

  const currentVault = activeVault;
  try {
    vaultIndex = await buildAndCacheIndex(currentVault);
  } catch (err) {
    console.error(`[vault-manager] reloadVaultIndex failed:`, err);
  }

  // Emit vaultChanged so consumers know the index changed.
  emitVaultChanged(activeVault);
}

// ── Event subscriptions ───────────────────────────────────────────────────────

/**
 * Subscribe to vault switch / create / delete events.
 * The callback receives the newly active VaultEntry, or null.
 *
 * @param cb - Callback to invoke on each vault change.
 */
export function onVaultChanged(cb: VaultChangedCallback): void {
  vaultChangedListeners.add(cb);
}

/**
 * Unsubscribe a previously registered onVaultChanged callback.
 *
 * @param cb - The exact function reference passed to onVaultChanged.
 */
export function offVaultChanged(cb: VaultChangedCallback): void {
  vaultChangedListeners.delete(cb);
}

/**
 * Subscribe to incremental index update events emitted by the fs watcher
 * (Phase 2b). The callback receives the raw VaultFileChangedEvent from Rust.
 *
 * @param cb - Callback to invoke on each file-system change.
 */
export function onIndexUpdated(cb: IndexUpdatedCallback): void {
  indexUpdatedListeners.add(cb);
}

/**
 * Unsubscribe a previously registered onIndexUpdated callback.
 *
 * @param cb - The exact function reference passed to onIndexUpdated.
 */
export function offIndexUpdated(cb: IndexUpdatedCallback): void {
  indexUpdatedListeners.delete(cb);
}

/**
 * Emits a vault-file-changed event to all registered listeners.
 *
 * NOTE (Phase 2b): In-memory index mutation via applyIndexUpdate is deferred
 * to Phase 2b when the fs watcher is implemented. In Phase 1, only the event
 * notification is emitted; callers subscribing via onIndexUpdated will be notified
 * but getVaultIndex() will not yet reflect the change.
 *
 * @param event - The file-system change event payload.
 */
export function handleFileChangedEvent(event: VaultFileChangedEvent): void {
  // Only process events for the active vault.
  if (!activeVault || event.vaultId !== activeVault.id) return;
  if (!vaultIndex) return;

  // Emit to subscribers (they may trigger their own async re-parse if needed).
  emitIndexUpdated(event);
}

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * Reset all module-level state to initial values.
 *
 * FOR TESTING ONLY — do not call from production code.
 * Allows each test to start with a clean slate without re-importing the module.
 */
export function _resetForTests(): void {
  activeVault = null;
  vaultIndex = null;
  switchGeneration = 0;
  vaultChangedListeners.clear();
  indexUpdatedListeners.clear();
}

// ── Window global (for IIFE plugin access) ───────────────────────────────────

/**
 * Expose vault-manager functions on window so IIFE plugins (which cannot
 * import ES modules directly) can access vault state and operations.
 *
 * Set up by main.ts after init() completes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__MARKABLE_VAULT_MANAGER__ = {
  init,
  createVault,
  deleteVault,
  updateVault,
  switchVault,
  getActiveVault,
  getAllVaults,
  getVaultIndex,
  reloadVaultIndex,
  onVaultChanged,
  offVaultChanged,
  onIndexUpdated,
  offIndexUpdated,
  handleFileChangedEvent,
};

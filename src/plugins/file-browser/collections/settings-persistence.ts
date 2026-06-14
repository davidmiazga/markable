/**
 * settings-persistence.ts — Per-vault, per-Collection navigation state.
 *
 * Persists two pieces of state through the project's existing settings
 * machinery (C-7):
 *
 *   lastOpenedStackByCollection — when re-entering a Collection tab, the
 *                                 renderer auto-navigates to the saved Stack.
 *   scrollPositionByStack       — when re-entering a Stack section view, the
 *                                 renderer restores the saved scrollTop.
 *
 * All reads are null-safe (`?? {}` everywhere). Reads do not throw and do
 * not require the `collections` map to be present in `settings.json`.
 *
 * Window-size invariant: this module does NOT touch `settings.window`. The
 * NFR-3 regression test (`tests/settings/window-defaults.test.ts`) is
 * unaffected by these changes.
 *
 * @module collections/settings-persistence
 */

import {
  getCurrentSettings,
  updateSettings,
  type CollectionsPerVaultState,
  type MarkableSettings,
} from "../../../lib/settings";

/**
 * Read the per-vault state. Returns an empty object when no state has been
 * saved yet — callers should treat the result as defaults.
 */
export function loadCollectionsState(vaultId: string): CollectionsPerVaultState {
  const settings = getCurrentSettings();
  return settings.collections?.[vaultId] ?? {};
}

/**
 * Save the last-opened Stack for a Collection. Composes a partial update so
 * unrelated state (other Collections, other vaults) is preserved.
 */
export async function saveLastOpenedStack(
  vaultId: string,
  collectionPath: string,
  stackPath: string,
): Promise<void> {
  await updateSettings((current: MarkableSettings) => {
    const collections = { ...(current.collections ?? {}) };
    const vaultState: CollectionsPerVaultState = { ...(collections[vaultId] ?? {}) };
    vaultState.lastOpenedStackByCollection = {
      ...(vaultState.lastOpenedStackByCollection ?? {}),
      [collectionPath]: stackPath,
    };
    collections[vaultId] = vaultState;
    return { ...current, collections };
  });
}

/**
 * Save the scroll position for a Stack. Same composition pattern as above.
 */
export async function saveScrollPosition(
  vaultId: string,
  stackPath: string,
  scrollTop: number,
): Promise<void> {
  await updateSettings((current: MarkableSettings) => {
    const collections = { ...(current.collections ?? {}) };
    const vaultState: CollectionsPerVaultState = { ...(collections[vaultId] ?? {}) };
    vaultState.scrollPositionByStack = {
      ...(vaultState.scrollPositionByStack ?? {}),
      [stackPath]: scrollTop,
    };
    collections[vaultId] = vaultState;
    return { ...current, collections };
  });
}

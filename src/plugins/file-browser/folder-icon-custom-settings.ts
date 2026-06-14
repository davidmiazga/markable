/**
 * folder-icon-custom-settings.ts — Cross-vault custom-icons helper (step_06c).
 *
 * Thin façade over the global settings module that gives the folder-icon
 * picker (step_06) a typed add/remove/list API for the `customFolderIcons`
 * list. The list itself is a regular field on `MarkableSettings` — this
 * helper is sugar so the picker does not need to know about settings
 * mutation patterns.
 *
 * Importantly, **none of these functions touch `_folder.md`**. Removing an
 * entry from the picker's favourites does NOT clear folder assignments —
 * `_folder.md` is the source of truth for assignment, and folders that
 * still reference a removed path continue to render via the custom-SVG
 * cache (EC-21). This separation of concerns is intentional and is
 * structurally enforced by the fact that this module imports nothing from
 * `folder-icon-store.ts` or any bridge file-mutation primitive.
 */

import {
  getCurrentSettings,
  updateSettings,
  type CustomIconEntry,
} from "../../lib/settings";

/**
 * Hard cap on the cross-vault custom icons list (FR-18 / EC-20).
 *
 * 100 entries — picked to keep the picker scrollable and the settings file
 * lean. The cap is a soft UX constraint, not a correctness one — the render
 * path tolerates arbitrary paths in `_folder.md`.
 */
export const CUSTOM_ICON_CAP = 100;

/**
 * Discriminated result for `addCustomIcon`. The picker maps `reason` to a
 * localised inline error message — see step_06 picker.
 */
export type AddCustomIconResult =
  | { ok: true }
  | { ok: false; reason: "cap_reached" | "duplicate" };

/**
 * Read the current custom-icon list.
 *
 * Always returns an array — an absent settings field is coerced to `[]`.
 * Sorted by `addedAt` descending (newest first) so the picker surfaces the
 * user's most recent additions at the top of the Custom section.
 *
 * @returns Sorted copy of the entries (caller may mutate freely).
 */
export function getCustomIcons(): CustomIconEntry[] {
  const list = getCurrentSettings().customFolderIcons ?? [];
  return list.slice().sort((a, b) => b.addedAt - a.addedAt);
}

/**
 * Add a new entry to the custom-icon list.
 *
 * Refuse-add behaviour:
 *   - At cap (`CUSTOM_ICON_CAP` entries) → `{ ok: false, reason: "cap_reached" }`.
 *     The picker maps this to "Custom icon limit reached. Remove an icon
 *     from the Custom section first." (FR-18 exact wording.) NOT silent FIFO
 *     eviction (would surprise users who curated their list).
 *   - Duplicate path → `{ ok: false, reason: "duplicate" }`. The picker
 *     maps to "Already in your Custom list."
 *
 * On success, persists via `updateSettings()` which writes to disk through
 * the existing Rust `save_settings` command. Atomic per the Rust side.
 *
 * @param entry - The new custom-icon entry to add.
 * @returns A result the caller switches on; never throws.
 */
export async function addCustomIcon(
  entry: CustomIconEntry,
): Promise<AddCustomIconResult> {
  const current = getCurrentSettings().customFolderIcons ?? [];
  if (current.length >= CUSTOM_ICON_CAP) {
    return { ok: false, reason: "cap_reached" };
  }
  if (current.some((e) => e.path === entry.path)) {
    return { ok: false, reason: "duplicate" };
  }
  await updateSettings((s) => ({
    ...s,
    customFolderIcons: [...(s.customFolderIcons ?? []), entry],
  }));
  return { ok: true };
}

/**
 * Remove an entry by absolute path. Idempotent — removing a path that is
 * not in the list is a no-op (returns without writing).
 *
 * IMPORTANT (EC-21): this does **not** touch any `_folder.md`. Folders
 * whose `icon:` field still references this path continue to render via
 * the custom-SVG cache. The picker simply no longer surfaces this path as
 * a quick pick.
 *
 * @param path - Absolute path of the entry to drop from the picker's list.
 */
export async function removeCustomIcon(path: string): Promise<void> {
  await updateSettings((s) => ({
    ...s,
    customFolderIcons: (s.customFolderIcons ?? []).filter(
      (e) => e.path !== path,
    ),
  }));
}

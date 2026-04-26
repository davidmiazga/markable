/**
 * Preset Manager for the Modal Command Bar (Step 05).
 *
 * Handles all CRUD operations on keybinding presets — pure functions that
 * receive a `PresetApiDeps` bag for storage access. This design means the
 * functions have zero Tauri/window coupling and can be exercised directly
 * in Vitest with mock implementations (no global patching required).
 *
 * Preset storage model:
 *   - Each preset is a plugin-settings entry keyed `"keybinding-preset-<slug>"`.
 *   - Discovery uses `listPresetFiles()` which calls the Rust `list_preset_files`
 *     command — it returns .json filenames from the `keybinding-presets/` folder.
 *   - The "Default" preset is synthetic (never persisted) and always appears first.
 *
 * Edge cases covered:
 *   EC-24/EC-33: empty or non-existent directory → only Default returned.
 *   EC-25: duplicate preset name → validation error thrown.
 *   EC-26: "Default" is a reserved name → validation error thrown.
 *   EC-34: malformed bindings field → preset skipped with console.warn.
 *   EC-36: loadSettings returns null → preset skipped with console.warn.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/** A loaded preset entry as consumed by the Command Bar UI. */
export interface PresetEntry {
  /** Display name shown in the dropdown. */
  name: string;
  /** Keybinding map: action id → key combo string. */
  bindings: Record<string, string>;
  /** True only for the synthetic "Default" entry (never persisted on disk). */
  isDefault: boolean;
}

/**
 * API surface injected into preset functions.
 *
 * All implementations wire through window globals (Tauri invoke). Tests inject
 * mocks so no globals are required during unit testing.
 */
export interface PresetApiDeps {
  /**
   * Load settings JSON for a named namespace.
   * Returns null if nothing is stored under that namespace.
   */
  loadSettings: (namespace: string) => Promise<Record<string, unknown> | null>;

  /**
   * Save settings JSON for a named namespace.
   * Passing null writes a tombstone (effectively deletes the preset file).
   */
  saveSettings: (namespace: string, data: Record<string, unknown> | null) => Promise<void>;

  /**
   * List all .json filenames in the keybinding-presets directory.
   * The Rust command uses AppHandle internally; no path argument is needed here.
   */
  listPresetFiles: () => Promise<string[]>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** The reserved display name for the built-in read-only preset. */
export const DEFAULT_PRESET_NAME = "Default";

/**
 * Prefix applied to storage namespace keys for all user presets.
 * e.g. "My Preset" → stored under "keybinding-preset-my-preset".
 */
export const PRESET_NAMESPACE_PREFIX = "keybinding-preset-";

// ── Name helpers ──────────────────────────────────────────────────────────────

/**
 * Convert a user-visible preset name to a storage namespace key.
 *
 * Lowercases the name and replaces any non-alphanumeric character with a
 * hyphen. This keeps namespace keys filesystem-safe and avoids ambiguity
 * between names that differ only in punctuation.
 *
 * Examples:
 *   "My Preset"  → "my-preset"
 *   "My Preset!" → "my-preset-"
 *   "VimLike"    → "vimlike"
 *
 * @param name - User-visible preset name.
 * @returns Lowercased, hyphenated slug suitable for use as a namespace key.
 */
export function sanitizePresetName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "-");
}

/**
 * Build the full storage namespace key for a preset by name.
 *
 * @param name - User-visible preset name (will be sanitized).
 * @returns Full namespace key, e.g. "keybinding-preset-my-preset".
 */
export function presetNamespace(name: string): string {
  return PRESET_NAMESPACE_PREFIX + sanitizePresetName(name);
}

// ── Validation ─────────────────────────────────────────────────────────────────

/**
 * Validate a proposed preset name against uniqueness and reserved-name rules.
 *
 * EC-25: Duplicate name check is case-insensitive to prevent user confusion.
 * EC-26: "Default" (any casing) is reserved for the built-in preset and may
 *        not be used as a user preset name.
 *
 * @param name          - The proposed new preset name (may have leading/trailing whitespace).
 * @param existingNames - Names of all existing user presets (excluding Default).
 * @returns An error message string if invalid, or null if the name is acceptable.
 */
export function validatePresetName(name: string, existingNames: string[]): string | null {
  if (!name.trim()) {
    return "Preset name cannot be empty";
  }

  // EC-26: "Default" is the built-in preset name and cannot be used for user presets.
  if (name.trim().toLowerCase() === DEFAULT_PRESET_NAME.toLowerCase()) {
    return `"${DEFAULT_PRESET_NAME}" is reserved`;
  }

  // EC-25: Duplicate check is case-insensitive so "VIM" and "vim" are treated as the same.
  if (existingNames.some((n) => n.toLowerCase() === name.trim().toLowerCase())) {
    return `A preset named "${name.trim()}" already exists`;
  }

  return null;
}

// ── Load presets ──────────────────────────────────────────────────────────────

/**
 * Load all presets from the keybinding-presets directory.
 *
 * Always returns the synthetic "Default" preset first, followed by any user
 * presets found on disk in filename sort order (determined by the Rust command).
 *
 * Individual presets that cannot be read or that have malformed data are
 * skipped with a `console.warn` so a single bad file cannot break the whole
 * preset system (EC-34, EC-36).
 *
 * EC-24/EC-33: an empty or non-existent directory results in only Default.
 *
 * @param api - Injected API deps (Tauri-wired in production, mocked in tests).
 * @returns Array of PresetEntry objects; Default is always index 0.
 */
export async function loadPresets(api: PresetApiDeps): Promise<PresetEntry[]> {
  // The Default preset is synthetic — it represents "use whatever the user
  // has set as their current keybindings" without applying any stored bindings.
  const presets: PresetEntry[] = [
    { name: DEFAULT_PRESET_NAME, bindings: {}, isDefault: true },
  ];

  let filenames: string[] = [];
  try {
    filenames = await api.listPresetFiles();
  } catch (err) {
    // If the Rust command fails (e.g. app data dir unreachable), return only Default.
    console.warn("[PresetManager] Failed to scan preset directory:", err);
    return presets;
  }

  for (const filename of filenames) {
    // Strip the .json suffix to get the display name candidate.
    const name = filename.replace(/\.json$/i, "");
    if (!name) continue;

    try {
      const data = await api.loadSettings(presetNamespace(name));

      // EC-36: loadSettings returned null — the file exists but has no settings data.
      if (!data || typeof data !== "object") {
        console.warn(
          `[PresetManager] Preset "${filename}" has no valid settings data (EC-36)`,
          filename,
        );
        continue;
      }

      const bindings = (data.bindings ?? {}) as Record<string, string>;

      // EC-34: bindings must be a plain object (not an array, not a string, etc.).
      if (typeof bindings !== "object" || Array.isArray(bindings)) {
        console.warn(
          `[PresetManager] Preset "${filename}" has malformed bindings (EC-34)`,
          filename,
        );
        continue;
      }

      // Use the stored `name` field if present; otherwise fall back to the filename stem.
      // This handles cases where the file was created without a name field.
      const displayName =
        typeof data.name === "string" && data.name.trim() ? data.name.trim() : name;

      presets.push({ name: displayName, bindings, isDefault: false });
    } catch (err) {
      // Any read error on an individual preset is non-fatal — skip and continue.
      console.warn(`[PresetManager] Failed to load preset "${filename}":`, err);
    }
  }

  return presets;
}

// ── Save a new preset ─────────────────────────────────────────────────────────

/**
 * Save a new user preset and return the updated preset list.
 *
 * Validates the name before writing. Throws on validation failure (EC-25, EC-26)
 * so the caller can display the error without modifying state.
 *
 * @param name            - Proposed display name for the new preset.
 * @param bindings        - Keybinding map to store (current app keybindings snapshot).
 * @param existingPresets - Current preset list (used for duplicate detection).
 * @param api             - Injected API deps.
 * @returns Updated preset list including the new entry appended at the end.
 * @throws Error with human-readable message on validation failure.
 */
export async function saveNewPreset(
  name: string,
  bindings: Record<string, string>,
  existingPresets: PresetEntry[],
  api: PresetApiDeps,
): Promise<PresetEntry[]> {
  // Extract only user preset names for uniqueness check (Default is excluded).
  const existingNames = existingPresets.filter((p) => !p.isDefault).map((p) => p.name);
  const validationError = validatePresetName(name, existingNames);
  if (validationError) throw new Error(validationError);

  const trimmedName = name.trim();

  // Write the preset data using the plugin-settings mechanism.
  await api.saveSettings(presetNamespace(trimmedName), { name: trimmedName, bindings });

  // Append to the existing list (immutable update — caller replaces _presets).
  return [...existingPresets, { name: trimmedName, bindings, isDefault: false }];
}

// ── Delete a preset ───────────────────────────────────────────────────────────

/**
 * Delete a user preset and return the updated preset list.
 *
 * Throws if the caller attempts to delete the Default preset, which is
 * a synthetic entry and cannot be removed.
 *
 * @param name            - Display name of the preset to delete.
 * @param existingPresets - Current preset list.
 * @param api             - Injected API deps.
 * @returns Updated preset list with the named preset removed.
 * @throws Error if name is DEFAULT_PRESET_NAME.
 */
export async function deletePreset(
  name: string,
  existingPresets: PresetEntry[],
  api: PresetApiDeps,
): Promise<PresetEntry[]> {
  if (name === DEFAULT_PRESET_NAME) {
    throw new Error("Cannot delete the Default preset");
  }

  // Writing null via saveSettings acts as a tombstone — the plugin-settings
  // Rust command will store an empty object, effectively clearing the preset.
  await api.saveSettings(presetNamespace(name), null);

  return existingPresets.filter((p) => p.name !== name);
}

// ── Rename a preset ───────────────────────────────────────────────────────────

/**
 * Rename an existing user preset and return the updated preset list.
 *
 * Copies the old bindings to a new namespace key, writes a tombstone to the
 * old key, and returns the updated list with the entry renamed in-place.
 *
 * Throws if:
 *   - `oldName` is DEFAULT_PRESET_NAME (cannot rename the built-in preset).
 *   - `newName` fails validation (duplicate or reserved — EC-25, EC-26).
 *
 * @param oldName         - Current display name of the preset to rename.
 * @param newName         - Proposed new display name.
 * @param existingPresets - Current preset list.
 * @param api             - Injected API deps.
 * @returns Updated preset list with the renamed entry.
 * @throws Error on invalid names or immutable Default preset.
 */
export async function renamePreset(
  oldName: string,
  newName: string,
  existingPresets: PresetEntry[],
  api: PresetApiDeps,
): Promise<PresetEntry[]> {
  if (oldName === DEFAULT_PRESET_NAME) {
    throw new Error("Cannot rename the Default preset");
  }

  // Validate newName against all presets except the one being renamed
  // (a preset may be "renamed" to itself without conflict).
  const existingNames = existingPresets
    .filter((p) => !p.isDefault && p.name !== oldName)
    .map((p) => p.name);
  const validationError = validatePresetName(newName, existingNames);
  if (validationError) throw new Error(validationError);

  // Read the existing bindings so they can be written under the new key.
  const oldData = await api.loadSettings(presetNamespace(oldName));
  const bindings = ((oldData?.bindings ?? {}) as Record<string, string>);

  const trimmedNew = newName.trim();

  // Write new key first, then tombstone old key (write-then-delete for safety).
  await api.saveSettings(presetNamespace(trimmedNew), { name: trimmedNew, bindings });
  await api.saveSettings(presetNamespace(oldName), null);

  // Return updated list with the renamed entry in the same position.
  return existingPresets.map((p) => (p.name === oldName ? { ...p, name: trimmedNew } : p));
}

/**
 * Settings migration for the Unified Plugin System — step_03c.
 *
 * migratePluginSettings() converts old flat boolean settings keys into the
 * unified `plugins` map. It runs once during initApp(), before loadPlugins().
 *
 * Migration table (docs/specs/unified-plugins/step_03c_settings_migration.md):
 *
 *   Old key                       → New key
 *   focusMode: true               → plugins["focus-mode"].enabled = true
 *   typewriterMode: true          → plugins["typewriter-mode"].enabled = true
 *   wordCount: true               → plugins["word-count"].enabled = true
 *   statusBar: { visible: true }  → plugins["status-bar"].enabled = true
 *   userPlugins["x"].enabled      → plugins["x"].enabled  (kind: "user")
 *
 * Idempotency (EC-26, EC-27, EC-28):
 *   If settings.plugins is already defined and non-empty, no migration runs —
 *   the settings object is returned unchanged (same reference).
 *   Old fields are NOT deleted; they remain for backward compatibility until
 *   step_04c removes them from the type.
 */

import type { MarkableSettings, PluginEnableRecord } from "../lib/settings";

// ── Migration map ─────────────────────────────────────────────────────────────

/**
 * Maps each legacy flat boolean settings key to its canonical kebab-case plugin id.
 *
 * These keys (focusMode, typewriterMode, wordCount) were removed from the
 * MarkableSettings TypeScript interface in step_04b. They may still exist in
 * settings.json files written by pre-Chunk-3 versions of Markable. The oldKey
 * type is `string` (not `keyof MarkableSettings`) to avoid TypeScript errors
 * after the interface fields were removed.
 *
 * Using a ReadonlyArray ensures this list is never accidentally mutated at
 * runtime. The order is insignificant — all four entries are always written.
 */
const FLAT_KEY_TO_PLUGIN_ID: ReadonlyArray<{
  oldKey: string;
  pluginId: string;
}> = [
  { oldKey: "focusMode",      pluginId: "focus-mode" },
  { oldKey: "typewriterMode", pluginId: "typewriter-mode" },
  { oldKey: "wordCount",      pluginId: "word-count" },
];

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Migrate old plugin settings keys to the unified `plugins` map.
 *
 * Returns a new settings object (does not mutate the input). If
 * `settings.plugins` is already defined with at least one key, the input
 * is returned unchanged (same reference) — idempotent per EC-26/27/28.
 *
 * All four core plugin entries (focus-mode, typewriter-mode, word-count,
 * status-bar) are always written after a migration run, defaulting to
 * `enabled: false` when the old key is absent or false.
 *
 * User plugins (from the old `userPlugins` record) are migrated with
 * `kind: "user"`. If a user plugin id collides with a core id, the core
 * entry wins (EC-28: user entry is skipped).
 *
 * @param settings  The settings object loaded from disk.
 * @returns         A new settings object with `plugins` populated, or the
 *                  original settings object if migration is a no-op.
 */
export function migratePluginSettings(settings: MarkableSettings): MarkableSettings {
  // EC-26/27/28: if plugins already exists with at least one key, migration has
  // already run on a previous launch. Return the original reference unchanged.
  if (settings.plugins && Object.keys(settings.plugins).length > 0) {
    return settings;
  }

  const plugins: Record<string, PluginEnableRecord> = {};

  // ── 1. Migrate flat boolean keys ──────────────────────────────────────────
  // Each entry in FLAT_KEY_TO_PLUGIN_ID is always written. An absent or falsy
  // old key maps to enabled: false (matches the old default of "disabled").
  for (const { oldKey, pluginId } of FLAT_KEY_TO_PLUGIN_ID) {
    const value = (settings as unknown as Record<string, unknown>)[oldKey];
    plugins[pluginId] = {
      // Only `=== true` counts as "was enabled" — undefined/false both → false.
      enabled: value === true,
      kind: "core",
    };
  }

  // ── 2. Migrate statusBar (EC-27: object shape, not plain boolean) ─────────
  // The old format is `statusBar: { visible: boolean }`. These fields are no
  // longer in the MarkableSettings TypeScript interface (removed in step_04b),
  // but the raw JSON in settings files may still contain them. The cast to
  // Record<string, unknown> reads the raw value safely without TypeScript errors.
  // Using optional chaining ensures a corrupted/absent statusBar safely → false.
  const rawSettings = settings as unknown as Record<string, unknown>;
  const legacyStatusBar = rawSettings["statusBar"] as { visible?: boolean } | undefined;
  plugins["status-bar"] = {
    enabled: legacyStatusBar?.visible === true,
    kind: "core",
  };

  // ── 3. Migrate userPlugins record (EC-28) ─────────────────────────────────
  // Each entry maps 1:1 to plugins[id] with kind "user". Core ids (written in
  // steps 1–2 above) are never overwritten, guarding against corrupted settings
  // where a user plugin id accidentally matches a built-in plugin id.
  // The cast reads the deprecated field from the raw JSON without TypeScript errors.
  const legacyUserPlugins = rawSettings["userPlugins"] as
    | Record<string, { enabled: boolean }>
    | undefined;
  if (legacyUserPlugins) {
    for (const [id, record] of Object.entries(legacyUserPlugins)) {
      if (!(id in plugins)) {
        plugins[id] = {
          enabled: record.enabled === true,
          kind: "user",
        };
      }
    }
  }

  // Return a new settings object; the spread preserves all original fields
  // (including the now-deprecated flat keys) for backward compatibility.
  return {
    ...settings,
    plugins,
  };
}

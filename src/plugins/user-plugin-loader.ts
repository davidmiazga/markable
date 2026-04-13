/**
 * UserPluginLoader — evaluate, validate, and build API for user plugins.
 *
 * Evaluation strategy: new Function('api', '"use strict";\n' + source + '\nreturn __markablePlugin__;').
 * See docs/specs/user-plugins/00_index.md §1 for full trade-off analysis.
 *
 * EC-14: window/document are accessible from within the plugin execution
 * context (same WebView). The UserPluginAPI parameter is the only explicit
 * injection. This limitation is documented and convention-enforced only.
 */

import type { UnifiedPlugin } from "./markable-plugin-api";

/**
 * Local result type for evaluatePlugin.
 *
 * When kind is provided the plugin is validated as a UnifiedPlugin (requires
 * version). When kind is omitted (legacy path) the object is validated against
 * the looser UserPlugin contract (no version required), but the result is still
 * typed as UnifiedPlugin via a cast in the caller — the version field will simply
 * be absent at runtime on the legacy path, which is acceptable for backward compat.
 */
type UserPluginLoadResult =
  | { ok: true; plugin: UnifiedPlugin }
  | { ok: false; filename: string; reason: string };

// ── Validation ────────────────────────────────────────────────────────────────

/** Fields required on every plugin object (base contract, no version). */
const REQUIRED_FIELDS: ReadonlyArray<string> = [
  "id",
  "name",
  "description",
  "onEnable",
  "onDisable",
];

/**
 * Characters that make a plugin id invalid as a settings key.
 * EC-20: empty string, '.', '/', '\', NUL.
 */
const INVALID_ID_RE = /[./\\\0]/;

/**
 * Validate that obj satisfies UserPlugin structurally.
 *
 * Returns null on success; an error string describing the first violation
 * on failure. The caller logs this string and skips the plugin.
 *
 * EC-4: null/non-object default export rejected here.
 * EC-5: missing required fields detected here with named-field list.
 * EC-20: invalid id characters rejected here.
 */
function validate(obj: unknown, filename: string): string | null {
  if (obj === null || typeof obj !== "object") {
    return `${filename}: default export is not an object (got ${obj === null ? "null" : typeof obj})`;
  }

  const missing: string[] = [];
  for (const field of REQUIRED_FIELDS) {
    if (!(field in (obj as Record<string, unknown>))) {
      missing.push(field);
    }
  }
  if (missing.length > 0) {
    return `${filename}: missing required field(s): ${missing.join(", ")}`;
  }

  const record = obj as Record<string, unknown>;

  if (typeof record.id !== "string" || record.id.trim() === "") {
    return `${filename}: 'id' must be a non-empty string`;
  }

  if (INVALID_ID_RE.test(record.id as string)) {
    return `${filename}: 'id' contains invalid characters (got "${record.id}")`;
  }

  if (typeof record.name !== "string" || record.name.trim() === "") {
    return `${filename}: 'name' must be a non-empty string`;
  }

  if (typeof record.description !== "string" || record.description.trim() === "") {
    return `${filename}: 'description' must be a non-empty string`;
  }

  if (typeof record.onEnable !== "function") {
    return `${filename}: 'onEnable' must be a function`;
  }

  if (typeof record.onDisable !== "function") {
    return `${filename}: 'onDisable' must be a function`;
  }

  return null; // valid
}

/**
 * Validate that obj satisfies UnifiedPlugin structurally.
 *
 * All UserPlugin validations apply, plus:
 *   - version:  non-empty string (EC-22).
 *
 * Returns null on success; an error string on first violation.
 * Used by evaluatePlugin when called with kind = "core" | "user".
 */
function validateUnified(obj: unknown, filename: string): string | null {
  // Reuse existing structural checks (id, name, description, onEnable, onDisable).
  const baseError = validate(obj, filename);
  if (baseError !== null) return baseError;

  const record = obj as Record<string, unknown>;

  // EC-22: version field required on unified plugins.
  if (typeof record.version !== "string" || record.version.trim() === "") {
    return `${filename}: 'version' must be a non-empty string`;
  }

  return null;
}

// ── API builder re-export ─────────────────────────────────────────────────────

/**
 * Re-export of the canonical unified factory.
 * Callers import buildMarkablePluginAPI from here or directly from markable-plugin-api.
 */
export { buildMarkablePluginAPI } from "./markable-plugin-api";

// ── Evaluator ─────────────────────────────────────────────────────────────────

/**
 * Evaluate plugin source text and return a validated plugin or an error.
 *
 * When `kind` is provided ("core" or "user"), the full UnifiedPlugin interface
 * is required (including `version`). When `kind` is omitted, the legacy
 * minimal interface is validated (no `version` requirement) — this path is
 * retained for backward compatibility with user plugin files that predate
 * the version field requirement.
 *
 * EC-2: empty/whitespace-only source → error.
 * EC-3: syntax errors caught.
 * EC-4: non-object return rejected.
 * EC-5: missing required fields rejected.
 * EC-22: version field required when kind is provided.
 *
 * @param source    UTF-8 text of the plugin file.
 * @param filename  Original filename, used in error messages.
 * @param kind      "core" | "user" to apply UnifiedPlugin validation; omit for
 *                  legacy UserPlugin validation.
 */
export function evaluatePlugin(
  source: string,
  filename: string,
  kind?: "core" | "user",
): UserPluginLoadResult {
  // EC-2: reject empty or whitespace-only source.
  if (source.trim().length === 0) {
    return {
      ok: false,
      filename,
      reason: `${filename}: file is empty or contains only whitespace`,
    };
  }

  let pluginObj: unknown;

  try {
    // Prepend strict mode. The plugin source is the function body.
    // The plugin must `return { id, name, ... }` at the top level of its source.
    // A stub api (null cast) is passed; the real api is injected at enable time.
    const factory = new Function("api", `"use strict";\n${source}\nreturn __markablePlugin__;`);
    pluginObj = factory(null);
  } catch (err) {
    // EC-3: syntax error or runtime error during evaluation.
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      filename,
      reason: `${filename}: evaluation error — ${message}`,
    };
  }

  // EC-4, EC-5, EC-22: structural validation.
  // When kind is provided, apply unified validation (requires version field).
  // When kind is omitted, apply legacy UserPlugin validation.
  const validationError =
    kind !== undefined
      ? validateUnified(pluginObj, filename)
      : validate(pluginObj, filename);

  if (validationError !== null) {
    return { ok: false, filename, reason: validationError };
  }

  // Cast to UnifiedPlugin. When kind is provided validateUnified() has confirmed
  // the version field is present. When kind is omitted (legacy path), version may
  // be absent at runtime — the caller handles this gracefully.
  return { ok: true, plugin: pluginObj as UnifiedPlugin };
}

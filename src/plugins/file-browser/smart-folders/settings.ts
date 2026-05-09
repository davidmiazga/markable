/**
 * smart-folders/settings.ts
 *
 * Load, save, validate, and generate IDs for Smart Folder definitions.
 *
 * Responsibilities:
 *   - sanitizeDef:             Validate one raw def, dropping invalid rules
 *                              without throwing (NFR-06, EC-08, AD-10).
 *   - sanitizeAll:             Validate the full Record<vaultId, def[]>;
 *                              returns a clean record never throwing.
 *   - generateSmartFolderId:   Produce a stable `sf-<uuid>` ID (AD-3).
 *   - loadSmartFolders:        Read+sanitize defs for a vault (EC-02, EC-08).
 *   - saveSmartFolders:        Spread-into-existing then write whole settings
 *                              object, preserving expandedPaths/pinnedPaths.
 *
 * All exported functions are pure or async with no side effects on module
 * state — module state lives in file-browser.plugin.ts.
 *
 * @module smart-folders/settings
 */

import type { SmartFolderDef, SmartFolderRule, SmartFolderId } from "./types";
import type { MarkablePluginAPI } from "../../markable-plugin-api";

// ── Operator whitelists (FR-09) ───────────────────────────────────────────────

/**
 * Valid operators per rule type.
 *
 * Kept as a plain object rather than a Map so validators can reference it
 * without runtime overhead. Any operator not in the appropriate set is dropped.
 */
const VALID_OPERATORS: Record<string, Set<string>> = {
  tag:       new Set(["is", "is not"]),
  path:      new Set(["contains", "does not contain", "starts with", "does not start with"]),
  extension: new Set(["is", "is not"]),
  modified:  new Set(["in last N days", "not in last N days", "before", "after"]),
  links:     new Set(["outbound = 0", "outbound >= 1", "outbound >= N", "inbound = 0", "inbound >= 1", "inbound >= N"]),
  title:     new Set(["contains", "does not contain"]),
};

/** All known rule types — used as a fast membership check. */
const VALID_RULE_TYPES = new Set(Object.keys(VALID_OPERATORS));

// ── Value shape validators ────────────────────────────────────────────────────

/**
 * Return true when `v` is a positive integer (> 0, no NaN, no float).
 * Used for "in last N days" and "outbound >= N" / "inbound >= N".
 */
function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && Number.isInteger(v);
}

/**
 * Return true when `s` is a valid ISO date string (YYYY-MM-DD).
 *
 * The Date constructor accepts many formats, so we narrow to exactly the
 * YYYY-MM-DD pattern and verify that the resulting Date is not NaN and
 * round-trips — this catches invalid dates like 2026-13-99.
 */
function isValidIsoDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s);
  // Check the date is valid and its ISO string starts with the same YYYY-MM-DD
  return !isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

// ── Rule validator ────────────────────────────────────────────────────────────

/**
 * Validate a single raw rule candidate.
 *
 * Returns the typed SmartFolderRule on success, or null if any invariant is
 * violated. Logs a console.warn on failure (NFR-06 — never throw).
 *
 * Validation checks:
 *   1. `type` must be in VALID_RULE_TYPES.
 *   2. `operator` must be in VALID_OPERATORS[type].
 *   3. `value` shape must match the operator (see inline comments).
 */
function sanitizeRule(raw: unknown): SmartFolderRule | null {
  if (!raw || typeof raw !== "object") {
    console.warn("[smart-folders] dropping non-object rule:", raw);
    return null;
  }

  const r = raw as Record<string, unknown>;
  const type = r["type"];
  const operator = r["operator"];
  const value = r["value"];

  if (typeof type !== "string" || !VALID_RULE_TYPES.has(type)) {
    console.warn("[smart-folders] dropping rule with unknown type:", type);
    return null;
  }

  if (typeof operator !== "string" || !VALID_OPERATORS[type].has(operator)) {
    console.warn("[smart-folders] dropping rule with invalid operator for type", type, ":", operator);
    return null;
  }

  // Value shape validation per operator
  if (operator === "in last N days" || operator === "not in last N days") {
    if (!isPositiveInt(value)) {
      console.warn("[smart-folders] dropping modified rule: value must be positive int, got:", value);
      return null;
    }
  } else if (operator === "before" || operator === "after") {
    if (!isValidIsoDate(value)) {
      console.warn("[smart-folders] dropping modified rule: value must be ISO date YYYY-MM-DD, got:", value);
      return null;
    }
  } else if (operator === "outbound >= N" || operator === "inbound >= N") {
    if (!isPositiveInt(value)) {
      console.warn("[smart-folders] dropping links rule: value must be positive int, got:", value);
      return null;
    }
  } else if (operator === "outbound = 0" || operator === "outbound >= 1" || operator === "inbound = 0" || operator === "inbound >= 1") {
    // These operators encode the full predicate; value must be null
    // We are lenient here — we just ignore the value and coerce to null
    // so that slightly-off serializations survive.
  } else if (type === "tag" || type === "path" || type === "extension" || type === "title") {
    // String-valued rules
    if (typeof value !== "string") {
      console.warn("[smart-folders] dropping", type, "rule: value must be string, got:", value);
      return null;
    }
  }

  // For the null-value link operators, coerce value to null in the returned rule
  const coercedValue =
    (operator === "outbound = 0" || operator === "outbound >= 1" ||
     operator === "inbound = 0"  || operator === "inbound >= 1")
    ? null
    : value;

  return { type, operator, value: coercedValue } as SmartFolderRule;
}

// ── Public exports ────────────────────────────────────────────────────────────

/**
 * Validate a candidate SmartFolderDef, dropping invalid rules.
 *
 * Returns null when:
 *   - `raw` is not an object, or missing required fields.
 *   - `name` is empty after trim.
 *   - All rules are invalid (none survive pruning).
 *
 * Individual rules that fail validation are dropped with a console.warn
 * rather than failing the whole def (AD-10 / NFR-06).
 *
 * @param raw - Untrusted input from settings JSON.
 * @returns A clean SmartFolderDef or null.
 */
export function sanitizeDef(raw: unknown): SmartFolderDef | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    console.warn("[smart-folders] dropping non-object def:", raw);
    return null;
  }

  const r = raw as Record<string, unknown>;
  const id   = r["id"];
  const name = r["name"];
  const rulesRaw = r["rules"];

  if (typeof id !== "string" || id.trim() === "") {
    console.warn("[smart-folders] dropping def with missing/empty id");
    return null;
  }

  if (typeof name !== "string" || name.trim() === "") {
    console.warn("[smart-folders] dropping def with empty name, id:", id);
    return null;
  }

  if (!Array.isArray(rulesRaw)) {
    console.warn("[smart-folders] dropping def with non-array rules, id:", id);
    return null;
  }

  const rules: SmartFolderRule[] = [];
  for (const ruleRaw of rulesRaw) {
    const rule = sanitizeRule(ruleRaw);
    if (rule !== null) rules.push(rule);
  }

  if (rules.length === 0) {
    // A def with zero rules after pruning is invalid per FR-26.
    console.warn("[smart-folders] dropping def with no valid rules after pruning, id:", id);
    return null;
  }

  return { id, name: name.trim(), rules };
}

/**
 * Validate the full smartFolders record from settings.
 *
 * Returns a clean Record<vaultId, SmartFolderDef[]>. Never throws.
 * Malformed top-level input returns {}. Per-vault non-array values return [].
 *
 * @param raw - Untrusted top-level value from settings JSON.
 * @returns Clean per-vault record, always an object with array values.
 */
export function sanitizeAll(raw: unknown): Record<string, SmartFolderDef[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const result: Record<string, SmartFolderDef[]> = {};
  const r = raw as Record<string, unknown>;

  for (const vaultId of Object.keys(r)) {
    const perVault = r[vaultId];
    if (!Array.isArray(perVault)) {
      // Log but coerce to empty array so the vault key survives
      console.warn("[smart-folders] per-vault value is not an array for vault:", vaultId);
      result[vaultId] = [];
      continue;
    }
    const clean: SmartFolderDef[] = [];
    for (const entry of perVault) {
      const def = sanitizeDef(entry);
      if (def !== null) clean.push(def);
    }
    result[vaultId] = clean;
  }

  return result;
}

/**
 * Generate a new stable Smart Folder ID.
 *
 * Prefers `crypto.randomUUID()` (available in Tauri WKWebView and modern
 * browsers). Falls back to a timestamp+random string when `crypto` is
 * unavailable (IIFE environments that pre-date the Web Crypto API).
 *
 * The `sf-` prefix ensures the ID can never collide with vault-relative
 * file paths, which begin with an absolute filesystem path (AD-3).
 *
 * @returns A unique string prefixed with "sf-".
 */
export function generateSmartFolderId(): SmartFolderId {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `sf-${crypto.randomUUID()}`;
  }
  // Fallback: combine timestamp (base-36) with a random fraction (base-36).
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `sf-${Date.now().toString(36)}-${rand}`;
}

/**
 * Load Smart Folders for a specific vault from persisted plugin settings.
 *
 * Always returns a clean array — never throws. Malformed entries are pruned
 * via sanitizeAll (EC-08, NFR-06). Missing vaultId returns [] (EC-02).
 *
 * This function is deliberately read-only: it does NOT re-save the cleaned
 * data to avoid triggering a disk write on every panel open. Cleanup
 * persists on the next user-initiated mutation.
 *
 * @param api     - MarkablePluginAPI for settings I/O.
 * @param vaultId - The vault whose Smart Folders to load.
 * @returns Clean array of SmartFolderDef for the vault.
 */
export async function loadSmartFolders(
  api: Pick<MarkablePluginAPI, "loadSettings">,
  vaultId: string,
): Promise<SmartFolderDef[]> {
  try {
    const saved = (await api.loadSettings()) as Record<string, unknown> | null;
    const rawSmartFolders = saved?.["smartFolders"];
    const clean = sanitizeAll(rawSmartFolders);
    return clean[vaultId] ?? [];
  } catch (err) {
    console.warn("[smart-folders] loadSmartFolders failed, returning []:", err);
    return [];
  }
}

/**
 * Persist Smart Folders for a specific vault.
 *
 * Uses the spread-into-existing pattern to preserve all other settings keys
 * (expandedPaths, pinnedPaths, other vaults' smartFolders). Mirrors the
 * scheduleSettingsSave pattern in file-browser.plugin.ts.
 *
 * CRITICAL: always load current settings first, mutate the slice, write back
 * the full object. Never overwrite expandedPaths or pinnedPaths.
 *
 * @param api     - MarkablePluginAPI for settings I/O.
 * @param vaultId - The vault to save Smart Folders for.
 * @param defs    - The complete array of defs for this vault.
 */
export async function saveSmartFolders(
  api: Pick<MarkablePluginAPI, "loadSettings" | "saveSettings">,
  vaultId: string,
  defs: SmartFolderDef[],
): Promise<void> {
  const existing = (await api.loadSettings()) as Record<string, unknown> | null;
  const expandedPaths = (existing?.["expandedPaths"] as Record<string, unknown>) ?? {};
  const pinnedPaths   = (existing?.["pinnedPaths"]   as Record<string, unknown>) ?? {};
  const smartFolders  = (existing?.["smartFolders"]  as Record<string, unknown>) ?? {};
  smartFolders[vaultId] = defs;
  await api.saveSettings({ expandedPaths, pinnedPaths, smartFolders });
}

/**
 * YAML Pane Plugin
 *
 * Provides a "Properties" sidebar panel that reads and renders a document's
 * YAML front matter as structured, editable form controls. Supports type
 * inference, schema-driven controlled vocabularies, date pickers, tag chips,
 * and single-transaction CM6 write-back.
 *
 * Architecture overview (see docs/specs/yaml-pane/00_index.md):
 *   Step 01 — Pure parser: detectFrontMatterBlock, parseFrontMatter, buildFieldModel
 *   Step 02 — Write-back engine: rewriteScalarLine, buildFrontMatterString, dispatchFrontMatterUpdate
 *   Step 03 — Schema loader: validateSchemaJson, loadSchema, mergeWithSchema, loadSettings
 *   Step 04 — Panel DOM: renderPanel, renderFieldRow, renderChipWidget, commit functions
 *   Step 05 — Plugin lifecycle: onEnable, onDisable, CM6 updateListener
 *
 * IIFE boundary contract:
 *   This file is compiled into an IIFE bundle. It MUST NOT import from other app
 *   modules at runtime. The outside world is accessed exclusively via:
 *     - window.__CM_VIEW__              — CodeMirror EditorView constructor/statics
 *     - window.__MARKABLE_EDITOR_VIEW__ — live CM6 EditorView instance
 *     - window.__MARKABLE_CURRENT_FILE__ — current file path string
 *     - window.__TAURI_INTERNALS__.invoke(cmd, args) — Tauri commands
 *
 * @module yaml-pane.plugin
 */

import jsYaml from "js-yaml";
import type { MarkablePluginAPI } from "../markable-plugin-api";

// ---------------------------------------------------------------------------
// Step 01 — Types
// ---------------------------------------------------------------------------

/**
 * The set of YAML field types that the pane can represent.
 * "date" is detected by regex on string values — js-yaml CORE_SCHEMA does NOT
 * auto-convert date strings to Date objects, which we rely on to preserve them.
 */
export type YamlFieldType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "array"
  | "object"
  | "null";

/**
 * Pure parsed representation of a single front matter field.
 * Produced by buildFieldModel and consumed by write-back and DOM rendering.
 */
export interface YamlField {
  /** The YAML key exactly as it appears in the source (unquoted display form). */
  key: string;
  /** The JS-parsed value. Arrays are as js-yaml returned them. */
  value: unknown;
  /** Type inferred from the parsed value (or overridden by schema in step_03). */
  rawType: YamlFieldType;
  /**
   * 0-based index into originalLines[] where "key:" appears as a top-level key.
   * -1 means the line was not found (e.g. key was added during this session
   * but not yet written back).
   */
  lineIndex: number;
  /**
   * True if the original YAML source line uses block scalar syntax (| or >).
   * Detected by scanning originalLines for "key: |" or "key: >" patterns.
   */
  isBlockScalar: boolean;
}

/**
 * Discriminated union result from parseFrontMatter.
 * Consumers must check `.kind` before accessing other properties.
 */
export type FrontMatterParseResult =
  | { kind: "none" }
  | { kind: "error"; message: string }
  | {
      kind: "ok";
      fields: YamlField[];
      /** Lines between the --- delimiters (excluding delimiter lines themselves). */
      originalLines: string[];
      /**
       * Character offset of the last character of the closing --- line in the document.
       * Used as the `to` position in the CM6 write-back transaction.
       */
      closingOffset: number;
    };

// ---------------------------------------------------------------------------
// Step 01 — Pure Parser Functions
// ---------------------------------------------------------------------------

/**
 * Escapes all regex metacharacters in a string so it can be used safely
 * inside a RegExp constructor without accidentally matching regex syntax.
 *
 * Standard implementation from MDN / ECMAScript 2024 proposal.
 * Exported for direct test coverage.
 *
 * @param str - The raw string to escape.
 * @returns The string with all regex metacharacters prefixed with `\`.
 */
export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scans an array of YAML source lines for a line whose leading token is
 * the specified top-level key (no leading whitespace, followed by optional
 * whitespace then `:`).
 *
 * Uses a regex constructed from the escaped key so that keys containing regex
 * special characters (e.g. "tags.v2") are matched literally.
 *
 * @param lines - The YAML source lines (excluding --- delimiters).
 * @param key   - The key to search for.
 * @returns 0-based index of the matching line, or -1 if not found.
 */
export function findKeyLineIndex(lines: string[], key: string): number {
  // The pattern anchors at ^ so only top-level keys (no leading whitespace) match.
  // Partial key names are prevented by requiring \s*: immediately after the key.
  const pattern = new RegExp("^" + escapeRegExp(key) + "\\s*:");
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      return i;
    }
  }
  return -1;
}

/**
 * Detects whether the YAML source line at the given index uses block scalar
 * syntax (| for literal block, > for folded block).
 *
 * Block scalar syntax looks like:  `key: |`  or  `key: > # optional comment`
 *
 * @param lines     - The YAML source lines.
 * @param lineIndex - 0-based index of the line to check. -1 → always false.
 * @returns true if the line's value portion starts with `|` or `>`.
 */
export function detectBlockScalar(lines: string[], lineIndex: number): boolean {
  if (lineIndex < 0 || lineIndex >= lines.length) return false;
  // Match a colon followed by optional whitespace, then | or >, optionally
  // followed by an inline comment (space + #).
  return /:\s*[|>](\s*(#.*)?)?$/.test(lines[lineIndex]);
}

/**
 * Infers the YamlFieldType for a parsed JS value.
 *
 * The "date" type is detected by regex on string values (ISO 8601 YYYY-MM-DD).
 * js-yaml with CORE_SCHEMA leaves date strings as strings — we do NOT coerce
 * them to JS Date objects, which would silently drop timezone information.
 *
 * @param value       - The parsed JS value from js-yaml.
 * @param originalLines - Source lines (unused at present; reserved for future use).
 * @param key         - Field key (unused at present; reserved for future use).
 * @returns The inferred YamlFieldType.
 */
export function inferType(
  value: unknown,
  _originalLines: string[],
  _key: string,
): YamlFieldType {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") {
    // Strict ISO 8601 date: exactly YYYY-MM-DD (4-2-2 digits, dash-separated).
    // This regex intentionally does NOT accept partial dates like "2026-4-17".
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date";
    return "string";
  }
  return "string";
}

/**
 * Converts a js-yaml parsed object into an array of YamlField structs.
 * Preserves key insertion order (V8 preserves string key order via Object.entries).
 *
 * For each key/value pair:
 *   1. Infer the rawType.
 *   2. Find the line index in originalLines.
 *   3. Detect block scalar syntax.
 *
 * @param parsed        - The object returned by js-yaml.load(). Must be a plain object.
 * @param originalLines - YAML source lines (excluding --- delimiters).
 * @returns Ordered array of YamlField structs.
 */
export function buildFieldModel(
  parsed: Record<string, unknown>,
  originalLines: string[],
): YamlField[] {
  return Object.entries(parsed).map(([key, value]) => {
    const rawType = inferType(value, originalLines, key);
    const lineIndex = findKeyLineIndex(originalLines, key);
    const isBlockScalar = detectBlockScalar(originalLines, lineIndex);
    return { key, value, rawType, lineIndex, isBlockScalar };
  });
}

/**
 * Detects whether `docText` begins with a valid YAML front matter block.
 *
 * Detection rules (FR-1.1, EC-25):
 *   1. First line, trimmed of whitespace, must equal "---".
 *   2. Subsequent lines are scanned for the first line whose trimmed content
 *      equals "---" or "..." — this is the closing delimiter.
 *   3. If no closing delimiter is found, returns null (EC-3).
 *
 * `closingOffset` calculation: the character offset of the last character
 * of the closing delimiter line in `docText`. This is used as the `to`
 * position for the CM6 write-back transaction, meaning the slice
 * `docText.slice(0, closingOffset + 1)` equals everything up to and including
 * the closing `---`.
 *
 * @param docText - The full CM6 document string.
 * @returns Object with `innerText` (YAML between delimiters) and `closingOffset`,
 *          or null if no valid front matter block was found.
 */
export function detectFrontMatterBlock(
  docText: string,
): { innerText: string; closingOffset: number } | null {
  if (!docText) return null;

  const lines = docText.split("\n");
  if (lines.length === 0) return null;

  // Opening delimiter: first line, trimmed, must be exactly "---"
  if (lines[0].trim() !== "---") return null;

  // Scan for the closing delimiter starting at line 1
  let closingLineIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "---" || trimmed === "...") {
      closingLineIndex = i;
      break;
    }
  }

  if (closingLineIndex === -1) return null; // EC-3: no closing delimiter

  // innerText: all lines between the opening and closing delimiters
  const innerLines = lines.slice(1, closingLineIndex);
  const innerText = innerLines.join("\n");

  // closingOffset: the exclusive end position of the closing delimiter line.
  //
  // Formula: sum of (length + 1) for each line before the closing delimiter,
  //          plus the length of the closing line itself.
  //
  // This produces the same value as the spec's "Sum of lengths of all preceding
  // lines plus their \n separators, plus the closing line's length."
  //
  // The resulting value is one past the last character of "---", which is:
  //   - The correct exclusive-end `to` position for a CM6 transaction.
  //   - doc.slice(0, closingOffset) == everything up to and including "---".
  let offset = 0;
  for (let i = 0; i < closingLineIndex; i++) {
    offset += lines[i].length + 1; // +1 for the \n separator after each line
  }
  const closingLine = lines[closingLineIndex];
  const closingOffset = offset + closingLine.length;

  return { innerText, closingOffset };
}

/**
 * Top-level front matter parser. Returns a discriminated FrontMatterParseResult.
 *
 * Sequence:
 *   1. Call detectFrontMatterBlock → if null, return { kind: "none" }.
 *   2. Parse innerText with js-yaml using CORE_SCHEMA (no auto type coercion).
 *   3. Validate result is a plain object mapping.
 *   4. Build field model from the parsed object.
 *
 * @param docText - The full CM6 document string.
 * @returns A FrontMatterParseResult discriminated union.
 */
export function parseFrontMatter(docText: string): FrontMatterParseResult {
  const detected = detectFrontMatterBlock(docText);
  if (!detected) return { kind: "none" };

  const { innerText, closingOffset } = detected;

  let parsed: unknown;
  try {
    // CORE_SCHEMA: disables timestamp coercion and other implicit type conversions.
    // Date strings stay as strings; booleans are still parsed correctly.
    parsed = jsYaml.load(innerText, { schema: jsYaml.CORE_SCHEMA });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "error", message };
  }

  // null/undefined means empty front matter block (EC-4) or comment-only (EC-5)
  if (parsed === null || parsed === undefined) {
    return { kind: "ok", fields: [], originalLines: [], closingOffset };
  }

  // Front matter must be a plain object (YAML mapping), not a scalar or array
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      kind: "error",
      message: "Front matter must be a YAML mapping (key: value pairs)",
    };
  }

  const originalLines = innerText.split("\n");
  const fields = buildFieldModel(parsed as Record<string, unknown>, originalLines);

  return { kind: "ok", fields, originalLines, closingOffset };
}

// ---------------------------------------------------------------------------
// Step 02 — Write-back Engine Types
// ---------------------------------------------------------------------------

/**
 * Describes the type of change that triggered a write-back.
 * The discriminator selects between in-place line rewrite (fast, preserves
 * surrounding content) and full re-serialization (required for structural changes).
 */
export type FrontMatterChangeType =
  | { kind: "scalar-edit"; key: string; newValue: unknown }
  | { kind: "structural" };

/**
 * The CM6 userEvent string set on all YAML Pane write-back transactions.
 * Used by the updateListener to identify self-dispatched transactions and
 * suppress unnecessary re-renders.
 */
export const YAML_PANE_USER_EVENT = "yaml-pane.edit";

// ---------------------------------------------------------------------------
// Step 02 — Pure Write-back Functions
// ---------------------------------------------------------------------------

/**
 * Determines whether a YAML string value needs to be wrapped in double quotes.
 *
 * A string is "unsafe" (requires quoting) if it:
 *   - Is empty
 *   - Starts or ends with whitespace
 *   - Contains any of: `:`, `#`, `[`, `]`, `{`, `}`, `&`, `*`, `!`, `|`, `>`,
 *     `'`, `"`, `%`, `@`, backtick, or newline
 *   - Matches a YAML boolean/null literal (case-insensitive):
 *     true, false, null, ~, yes, no, on, off
 *
 * @param str - The string value to check.
 * @returns true if the string must be wrapped in YAML double quotes.
 */
export function requiresQuoting(str: string): boolean {
  if (str === "") return true;
  if (str !== str.trim()) return true; // starts or ends with whitespace

  // Special characters that break bare YAML scalars.
  // The original had %% (double percent) which was a typo — corrected to single %
  // (Finding 7). Spaces are intentionally NOT in the class because bare YAML scalars
  // may contain embedded spaces without quoting (e.g. "hello world" is valid bare).
  // eslint-disable-next-line no-useless-escape
  if (/[:#\[\]{}&*!|>'"@`%\n]/.test(str)) return true;

  // YAML 1.1 and 1.2 boolean/null reserved words (case-insensitive)
  const reserved = /^(true|false|null|~|yes|no|on|off)$/i;
  if (reserved.test(str)) return true;

  return false;
}

/**
 * Converts a JS value to its YAML-compatible inline string representation.
 *
 * Strings that require quoting (per requiresQuoting) are wrapped in double
 * quotes with internal double quotes escaped as `\"`.
 * All other types use their natural string representation.
 *
 * @param value - The JS value to format.
 * @returns A YAML-safe string suitable for insertion after `key: `.
 */
export function formatScalarValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  // String handling: quote if necessary
  const str = String(value);
  if (requiresQuoting(str)) {
    // Escape internal double quotes before wrapping
    const escaped = str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return str;
}

/**
 * Rewrites the value portion of a `key: value` YAML line.
 *
 * The key portion (everything up to and including the first `:`) is preserved.
 * The value is replaced with the formatted new value.
 *
 * Note: inline comments on modified lines are NOT preserved.
 * This is documented behavior per Out of Scope item 9 in the requirements.
 *
 * @param line     - The original YAML source line (e.g., "title: Old Value").
 * @param newValue - The new value to write (will be formatted by formatScalarValue).
 * @returns The rewritten line with the new value.
 */
export function rewriteScalarLine(line: string, newValue: unknown): string {
  // Find the first colon — this is the key/value separator.
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return line; // malformed line, leave as-is

  const keyPortion = line.slice(0, colonIdx); // key without the colon
  const formatted = formatScalarValue(newValue);
  return `${keyPortion}: ${formatted}`;
}

/**
 * Determines whether a YAML key name requires double-quote wrapping.
 *
 * Keys require quoting when they contain structural YAML characters or
 * match reserved words. Note: spaces in keys are technically valid YAML
 * without quoting, but colons, braces, and commas would break parsing.
 *
 * @param key - The key name as entered by the user.
 * @returns true if the key must be wrapped in double quotes.
 */
export function needsKeyQuoting(key: string): boolean {
  if (key === "") return true;
  // Structural characters that break YAML key parsing
  if (/[:#\[\]{},\n]/.test(key)) return true;
  // Reserved scalar words as keys would be misinterpreted
  const reserved = /^(true|false|null|~|yes|no|on|off)$/i;
  if (reserved.test(key)) return true;
  return false;
}

/**
 * Returns the quoted or unquoted form of a YAML key.
 *
 * If the key needs quoting (per needsKeyQuoting), it is wrapped in double
 * quotes with internal double quotes escaped. Otherwise returned verbatim.
 * The display label in the panel always shows the unquoted form.
 *
 * @param key - The key name.
 * @returns The key in its YAML-safe form (quoted or unquoted).
 */
export function formatYamlKey(key: string): string {
  if (!needsKeyQuoting(key)) return key;
  const escaped = key.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Full re-serialization of a YamlField array into a YAML string (without delimiters).
 *
 * Uses js-yaml.dump() with settings optimized for Obsidian-compatible front matter:
 *   - lineWidth: -1    → no line wrapping
 *   - indent: 2        → 2-space indent for nested/array values
 *   - noCompatMode: true → YAML 1.2 output (no !! type tags)
 *   - flowLevel: -1    → always block style (never inline { } or [ ])
 *
 * This produces `tags:` as a block sequence, not `tags: [a, b, c]`.
 * Multi-line strings (block scalars) are emitted with `|` style automatically
 * when the string contains newlines.
 *
 * @param fields - The ordered field array to serialize.
 * @returns A YAML string without front matter delimiters, with trailing newline trimmed.
 */
export function serializeFrontMatter(fields: YamlField[]): string {
  if (fields.length === 0) return "";

  // Build a plain JS object preserving insertion order.
  const obj: Record<string, unknown> = {};
  for (const field of fields) {
    obj[field.key] = field.value;
  }

  const dumped = jsYaml.dump(obj, {
    lineWidth: -1,
    indent: 2,
    noCompatMode: true,
    flowLevel: -1,
  });

  // js-yaml.dump always appends a trailing newline; trim it so callers
  // can control wrapping precisely.
  return dumped.replace(/\n$/, "");
}

/**
 * Top-level write-back function. Returns the full front matter string
 * (including `---` delimiters) ready for insertion into the CM6 document.
 *
 * Two tiers (AD-2):
 *   - scalar-edit: rewrites only the affected line in-place, forwarding all
 *     other lines verbatim. Preserves surrounding content and blank lines.
 *   - structural: full re-serialization via js-yaml.dump(). Used for add,
 *     delete, and type-change operations where the line count changes.
 *
 * The output always starts with "---\n" and ends with "\n---\n".
 *
 * @param fields       - The current field model (after the edit is applied).
 * @param originalLines - YAML source lines from the last successful parse.
 * @param changeType   - Discriminated union describing the edit.
 * @returns Full front matter string with delimiters.
 */
export function buildFrontMatterString(
  fields: YamlField[],
  originalLines: string[],
  changeType: FrontMatterChangeType,
): string {
  if (changeType.kind === "scalar-edit") {
    // Tier 1: in-place line rewrite
    const { key, newValue } = changeType;

    // Find the field's lineIndex
    const field = fields.find(f => f.key === key);
    const lineIdx = field?.lineIndex ?? -1;

    // Clone originalLines to avoid mutating shared state
    const lines = [...originalLines];

    if (lineIdx >= 0 && lineIdx < lines.length) {
      lines[lineIdx] = rewriteScalarLine(lines[lineIdx], newValue);
    } else {
      // lineIndex === -1: new field not yet in original source — append it
      const formattedKey = formatYamlKey(key);
      lines.push(`${formattedKey}: ${formatScalarValue(newValue)}`);
    }

    const innerYaml = lines.join("\n");
    return `---\n${innerYaml}\n---\n`;
  }

  // Tier 2: full re-serialization
  const serialized = serializeFrontMatter(fields);
  if (serialized === "") {
    // Empty field list — produce an empty front matter block
    return "---\n\n---\n";
  }
  return `---\n${serialized}\n---\n`;
}

/**
 * Dispatches a CM6 transaction that replaces the front matter block in the editor.
 *
 * Replaces the range [0, closingOffset] (inclusive) with `newFrontMatterString`.
 * Each call produces a single undo step via `userEvent: YAML_PANE_USER_EVENT`.
 *
 * EC-20 guard: if the view is null/destroyed or the document is empty, the
 * dispatch is silently skipped. This prevents errors on plugin disable or
 * rapid toggle cycles.
 *
 * NOTE: This is the only function in Step 02 that accesses a window global.
 * It is kept separate from the pure functions so that tests can call all
 * pure functions without needing to mock window globals.
 *
 * @param newFrontMatterString - The full replacement string (with delimiters).
 * @param closingOffset        - The last char position of the closing --- line.
 */
export function dispatchFrontMatterUpdate(
  newFrontMatterString: string,
  closingOffset: number,
): void {
  const view = (window as unknown as Record<string, unknown>)[
    "__MARKABLE_EDITOR_VIEW__"
  ] as { state: { doc: { length: number } }; dispatch: (tr: unknown) => void } | undefined;

  // EC-20: guard against destroyed view or empty document
  if (!view || !view.state || view.state.doc.length === 0) return;

  view.dispatch({
    changes: {
      // closingOffset is the exclusive end position of the closing --- line,
      // so using it directly as `to` replaces the entire front matter block
      // (CM6 transactions use exclusive end for range replacements).
      from: 0,
      to: closingOffset,
      insert: newFrontMatterString,
    },
    userEvent: YAML_PANE_USER_EVENT,
  });
}

// ---------------------------------------------------------------------------
// Step 03 — Schema Types
// ---------------------------------------------------------------------------

/**
 * Definition of a single field in the user's schema file.
 * The `type` field controls which UI control is rendered for the field.
 */
export interface SchemaFieldDef {
  type: "string" | "number" | "boolean" | "date" | "array" | "select" | "multiselect";
  /** Allowed values for 'select' and 'multiselect' types. */
  values?: string[];
  /** Optional description shown as a sub-label in the panel. */
  description?: string;
}

/**
 * The validated schema loaded from the user's JSON file.
 * Maps field key names to their definitions.
 */
export interface YamlSchema {
  fields: Record<string, SchemaFieldDef>;
}

/**
 * Plugin settings persisted to disk via Tauri plugin settings storage.
 */
export interface YamlPaneSettings {
  /** Absolute path to the JSON schema file, or empty string if not configured. */
  schemaPath: string;
  /** Which sidebar the Properties panel is attached to. */
  defaultSide: "left" | "right";
}

/**
 * Default settings used on first run when no settings file exists yet.
 */
export const DEFAULT_SETTINGS: YamlPaneSettings = {
  schemaPath: "",
  defaultSide: "right",
};

/**
 * All known valid schema field type values.
 * Unknown types are degraded to "string" with a console.warn (EC-12).
 */
export const VALID_SCHEMA_TYPES = [
  "string",
  "number",
  "boolean",
  "date",
  "array",
  "select",
  "multiselect",
] as const;

// ---------------------------------------------------------------------------
// Step 03 — Schema Loader Functions
// ---------------------------------------------------------------------------

/**
 * Validates the raw JSON.parse() output of a schema file against the required
 * structure. Returns a cleaned YamlSchema or throws an Error for top-level
 * structural failures.
 *
 * Field-level issues are handled gracefully:
 *   - Unknown type: degraded to "string" + console.warn (EC-12).
 *   - Non-string values in values[]: silently filtered out.
 *   - Non-boolean required: treated as false.
 *   - Non-string description: dropped.
 *
 * @param raw - The parsed JSON value (unknown type).
 * @returns A validated and cleaned YamlSchema.
 * @throws Error if the top-level structure is invalid (not an object, missing fields).
 */
export function validateSchemaJson(raw: unknown): YamlSchema {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Schema must be a JSON object");
  }

  const obj = raw as Record<string, unknown>;

  if (!("fields" in obj) || obj.fields === null || typeof obj.fields !== "object" || Array.isArray(obj.fields)) {
    throw new Error("Schema must have a 'fields' object property");
  }

  const rawFields = obj.fields as Record<string, unknown>;
  const cleanedFields: Record<string, SchemaFieldDef> = {};

  for (const [key, rawDef] of Object.entries(rawFields)) {
    if (rawDef === null || typeof rawDef !== "object" || Array.isArray(rawDef)) {
      // Skip invalid field definitions silently
      continue;
    }

    const def = rawDef as Record<string, unknown>;

    // Validate / degrade type
    let type: SchemaFieldDef["type"] = "string";
    if (typeof def.type === "string") {
      if ((VALID_SCHEMA_TYPES as readonly string[]).includes(def.type)) {
        type = def.type as SchemaFieldDef["type"];
      } else {
        // EC-12: graceful degradation for unknown type
        console.warn(
          `[yaml-pane] Schema field "${key}" has unknown type "${def.type}". Defaulting to "string".`,
        );
        type = "string";
      }
    }

    // Validate values[] — filter non-strings silently
    let values: string[] | undefined;
    if (Array.isArray(def.values)) {
      values = (def.values as unknown[]).filter((v): v is string => typeof v === "string");
    }

    // Validate description — must be a string; non-string → dropped
    const description: string | undefined =
      typeof def.description === "string" ? def.description : undefined;

    const cleaned: SchemaFieldDef = { type };
    if (values !== undefined) cleaned.values = values;
    if (description !== undefined) cleaned.description = description;

    cleanedFields[key] = cleaned;
  }

  return { fields: cleanedFields };
}

/**
 * Loads and validates the schema file from the given absolute path.
 *
 * Returns a discriminated union so callers can distinguish between a
 * successfully loaded schema and any failure mode without throwing.
 *
 * Failure modes returned as { error: string }:
 *   EC-10: schema file not found or unreadable
 *   EC-11: schema file contains invalid JSON
 *   Structural: schema has correct JSON but invalid shape
 *
 * @param schemaPath - Absolute path to the JSON schema file.
 * @returns { schema } on success, { error } on any failure.
 */
export async function loadSchema(
  schemaPath: string,
): Promise<{ schema: YamlSchema } | { error: string }> {
  if (!schemaPath) {
    return { error: "No schema path configured" };
  }

  let fileContent: string;
  try {
    fileContent = await (
      window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<string> } }
    ).__TAURI_INTERNALS__.invoke("read_file", { path: schemaPath });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Schema file not found or unreadable: ${msg}` };
  }

  // Strip // and /* */ comments so the file can be a .jsonc with inline docs.
  const stripped = fileContent
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
    .replace(/\/\/[^\n]*/g, "");         // line comments

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Schema file contains invalid JSON: ${msg}` };
  }

  try {
    const schema = validateSchemaJson(parsed);
    return { schema };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Schema has invalid structure: ${msg}` };
  }
}

/**
 * Looks up a field definition in the schema by exact (case-sensitive) key match.
 *
 * @param schema - The loaded YamlSchema, or null if no schema is configured.
 * @param key    - The field key to look up.
 * @returns The SchemaFieldDef if found, null otherwise.
 */
export function getSchemaFieldDef(
  schema: YamlSchema | null,
  key: string,
): SchemaFieldDef | null {
  if (!schema) return null;
  return schema.fields[key] ?? null;
}

/**
 * Resolves the effective display type for a field, with schema taking priority
 * over the inferred rawType.
 *
 * Priority:
 *   1. If schema has a definition for field.key → use schema type.
 *   2. Otherwise → use field.rawType.
 *
 * This allows the schema to override inferred types (e.g., treat a string
 * field as a "select" or "multiselect" control).
 *
 * @param field  - The parsed YamlField.
 * @param schema - The loaded YamlSchema, or null.
 * @returns The effective type string used by the DOM renderer.
 */
export function resolveFieldType(
  field: YamlField,
  schema: YamlSchema | null,
): SchemaFieldDef["type"] | YamlFieldType {
  const def = getSchemaFieldDef(schema, field.key);
  return def ? def.type : field.rawType;
}

/**
 * A YamlField enriched with schema metadata and placeholder flags.
 * This is the final model consumed by the DOM renderer.
 */
export interface EnrichedField {
  key: string;
  value: unknown;
  effectiveType: SchemaFieldDef["type"] | YamlFieldType;
  isBlockScalar: boolean;
  lineIndex: number;
  /** Allowed values from schema (for select/multiselect controls). */
  schemaValues?: string[];
  /** Optional description shown as sub-label. */
  description?: string;
}

/**
 * Produces an enriched field array by combining parsed fields with schema
 * metadata.
 *
 * @param fields - Parsed fields from the current document.
 * @param schema - The loaded schema, or null if none is configured.
 * @returns Enriched fields with schema metadata applied.
 */
export function mergeWithSchema(
  fields: YamlField[],
  schema: YamlSchema | null,
): EnrichedField[] {
  return fields.map(field => {
    const def = getSchemaFieldDef(schema, field.key);
    const enriched: EnrichedField = {
      key: field.key,
      value: field.value,
      effectiveType: resolveFieldType(field, schema),
      isBlockScalar: field.isBlockScalar,
      lineIndex: field.lineIndex,
    };
    if (def?.values !== undefined) enriched.schemaValues = def.values;
    if (def?.description !== undefined) enriched.description = def.description;
    return enriched;
  });
}

/**
 * Loads plugin settings from Tauri storage via the `read_plugin_settings` command.
 *
 * Always returns a valid YamlPaneSettings — never throws. Falls back to
 * DEFAULT_SETTINGS on any error or missing storage.
 *
 * @returns The loaded settings merged with defaults, or DEFAULT_SETTINGS.
 */
export async function loadSettings(): Promise<YamlPaneSettings> {
  try {
    const raw = await (
      window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<string | null> } }
    ).__TAURI_INTERNALS__.invoke("read_plugin_settings", { pluginId: "yaml-pane" });

    if (!raw) return { ...DEFAULT_SETTINGS };

    const loaded = JSON.parse(raw) as Partial<YamlPaneSettings>;

    // Merge with defaults so missing keys fall back gracefully
    const merged: YamlPaneSettings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
    };

    // Validate defaultSide — must be 'left' or 'right'
    if (merged.defaultSide !== "left" && merged.defaultSide !== "right") {
      merged.defaultSide = "right";
    }

    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Persists plugin settings via the `write_plugin_settings` Tauri command.
 *
 * Non-fatal: logs a console.warn on failure but does not throw.
 * The plugin remains functional even if settings cannot be saved.
 *
 * @param settings - The settings object to persist.
 */
export async function saveSettings(settings: YamlPaneSettings): Promise<void> {
  try {
    await (
      window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<void> } }
    ).__TAURI_INTERNALS__.invoke("write_plugin_settings", {
      pluginId: "yaml-pane",
      data: JSON.stringify(settings),
    });
  } catch (err: unknown) {
    console.warn("[yaml-pane] saveSettings failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Step 03 — Module-level Schema Cache
// ---------------------------------------------------------------------------

/**
 * Module-level schema cache. Populated in onEnable; cleared in onDisable.
 * Read directly by the DOM renderer and commit functions.
 */
let _schema: YamlSchema | null = null;

/**
 * Non-null when the last schema load attempt failed.
 * Shown in the panel header warning banner.
 */
let _schemaLoadError: string | null = null;

/**
 * Current plugin settings. Populated in onEnable; reset in onDisable.
 */
let _settings: YamlPaneSettings = { ...DEFAULT_SETTINGS };

// ---------------------------------------------------------------------------
// Step 04 — Panel DOM Types and State
// ---------------------------------------------------------------------------

/**
 * The three possible states of the YAML Pane panel.
 * The DOM renderer switches between these on every updateListener call.
 */
type PanelState =
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "fields"; fields: EnrichedField[] };

// Module-level panel state
let _panelContainer: HTMLElement | null = null;
let _panelState: PanelState = { kind: "empty" };
// @ts-ignore TS6133: assigned for future use / state tracking
let _editingKey: string | null = null;
let _addFieldVisible: boolean = false;
let _nestedExpanded: Set<string> = new Set();

// ---------------------------------------------------------------------------
// Step 04 — CSS
// ---------------------------------------------------------------------------

/**
 * All CSS for the YAML Pane panel. Injected as a <style> tag in onEnable.
 * All colors use CSS variables from the active theme (NFR-4).
 */
const YAML_PANE_CSS = `
.yaml-pane-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-family: var(--ui-font, system-ui, sans-serif);
  font-size: 12px;
  color: var(--text-primary, #333);
}
.yaml-pane-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}
.yaml-pane-warning {
  background: color-mix(in srgb, #f5a623 20%, var(--bg-secondary, #f8f8f8));
  border-bottom: 1px solid color-mix(in srgb, #f5a623 40%, var(--border-color, #ddd));
  padding: 6px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.yaml-pane-warning-text {
  flex: 1;
  font-size: 12px;
  color: var(--text-primary, #333);
}
.yaml-pane-reload-btn {
  font-size: 12px;
  padding: 2px 6px;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 3px;
  background: transparent;
  color: var(--text-primary, #333);
  cursor: pointer;
  white-space: nowrap;
}
.yaml-pane-toolbar {
  display: flex;
  justify-content: flex-end;
  padding: 3px 8px;
  border-bottom: 1px solid var(--border-color, #e0e0e0);
  flex-shrink: 0;
}
.yaml-pane-edit-props-btn {
  font-size: 11px;
  padding: 2px 6px;
  border: none;
  background: transparent;
  color: var(--text-muted, #888);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.yaml-pane-edit-props-btn:hover {
  color: var(--text-primary, #333);
}
.yaml-pane-field-row {
  display: flex;
  flex-direction: column;
  padding: 4px 10px;
  position: relative;
}
.yaml-pane-field-row:hover .yaml-pane-delete-btn {
  visibility: visible;
}
.yaml-pane-field-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary, #666);
  margin-bottom: 2px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.yaml-pane-field-description {
  font-size: 11px;
  color: var(--text-secondary, #666);
  opacity: 0.7;
  margin-bottom: 2px;
}
.yaml-pane-control {
  width: 100%;
  box-sizing: border-box;
  background-color: hsla(0, 0%, 100%, 0.025);
  color: var(--text-primary, #333);
  border: none;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 12px;
  font-family: var(--ui-font, system-ui, sans-serif);
}
.yaml-pane-control:focus {
  outline: none;
  background-color: hsla(0, 0%, 100%, 0.05);
}
.yaml-pane-delete-btn {
  visibility: hidden;
  position: absolute;
  top: 6px;
  right: 10px;
  width: 16px;
  height: 16px;
  border: none;
  background: none;
  color: var(--text-secondary, #888);
  cursor: pointer;
  padding: 0;
  font-size: 14px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 2px;
}
.yaml-pane-delete-btn:hover {
  color: #e53e3e;
}
.yaml-pane-chips-container {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  border: none;
  border-bottom: 1px solid var(--border-color, #ccc);
  padding: 2px 0;
  background: transparent;
  min-height: 24px;
  align-items: center;
}
.yaml-pane-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: color-mix(in srgb, var(--accent-color, #4a90e2) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent-color, #4a90e2) 40%, var(--border-color, #ccc));
  border-radius: 10px;
  padding: 1px 6px;
  font-size: 11px;
  color: var(--text-primary, #333);
}
.yaml-pane-chip--warning {
  border-color: var(--accent-color);
  background: transparent;
  color: var(--text-primary);
  /* Subtle warning indicator using the accent colour: both border and outline
     use the accent variable only — no hex fallbacks (NFR-3). All Markable
     themes must define --accent-color and --text-primary; fallbacks would
     hide missing theme variable errors. */
  outline: 1px solid var(--accent-color);
}
.yaml-pane-chip-remove {
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  color: var(--text-secondary, #888);
}
.yaml-pane-chip-remove:hover { color: #e53e3e; }
.yaml-pane-chip-input {
  border: none;
  outline: none;
  background: transparent;
  font-size: 12px;
  color: var(--text-primary, #333);
  min-width: 80px;
  flex: 1;
  font-family: var(--ui-font, system-ui, sans-serif);
}
.yaml-pane-chip-error {
  font-size: 11px;
  color: #e53e3e;
  margin-top: 2px;
}
.yaml-pane-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px 16px;
  color: var(--text-secondary, #888);
  font-size: 12px;
  text-align: center;
}
.yaml-pane-error-state {
  padding: 16px;
  background: color-mix(in srgb, #e53e3e 10%, transparent);
  border: 1px solid color-mix(in srgb, #e53e3e 30%, var(--border-color, #ccc));
  margin: 8px;
  border-radius: 4px;
  color: var(--text-primary, #333);
  font-size: 12px;
}
.yaml-pane-error-detail {
  font-family: var(--mono-font, monospace);
  font-size: 11px;
  color: #e53e3e;
  margin-top: 6px;
  white-space: pre-wrap;
  word-break: break-word;
}
.yaml-pane-add-fm-btn {
  padding: 6px 16px;
  border: 1px solid var(--accent-color, #4a90e2);
  border-radius: 4px;
  background: var(--accent-color, #4a90e2);
  color: #fff;
  cursor: pointer;
  font-size: 12px;
  font-family: var(--ui-font, system-ui, sans-serif);
}
.yaml-pane-add-fm-btn:hover { opacity: 0.9; }
.yaml-pane-add-field-row {
  display: flex;
  gap: 4px;
  padding: 4px 10px;
  align-items: center;
  flex-wrap: wrap;
}
.yaml-pane-add-field-key,
.yaml-pane-add-field-val {
  flex: 1;
  min-width: 60px;
  background: transparent;
  color: var(--text-primary, #333);
  border: none;
  border-bottom: 1px solid var(--border-color, #ccc);
  border-radius: 0;
  padding: 2px 0;
  font-size: 12px;
  font-family: var(--ui-font, system-ui, sans-serif);
}
.yaml-pane-add-field-key:focus,
.yaml-pane-add-field-val:focus {
  outline: none;
  border-bottom-color: var(--accent-color, #4a90e2);
}
.yaml-pane-add-field-btn {
  padding: 3px 8px;
  border: 1px solid var(--border-color, #ccc);
  border-radius: 3px;
  background: transparent;
  color: var(--text-primary, #333);
  cursor: pointer;
  font-size: 12px;
  font-family: var(--ui-font, system-ui, sans-serif);
}
.yaml-pane-add-field-btn.confirm {
  border-color: var(--accent-color, #4a90e2);
  color: var(--accent-color, #4a90e2);
}
.yaml-pane-add-field-btn.confirm:hover { background: color-mix(in srgb, var(--accent-color, #4a90e2) 10%, transparent); }
.yaml-pane-add-field-error {
  width: 100%;
  font-size: 11px;
  color: #e53e3e;
  padding: 0 2px;
}
.yaml-pane-add-field-section {
  padding: 4px 10px;
  border-top: 1px solid var(--border-color, #eee);
}
.yaml-pane-add-field-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary, #888);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 0;
  font-family: var(--ui-font, system-ui, sans-serif);
}
.yaml-pane-add-field-toggle:hover { color: var(--accent-color, #4a90e2); }
.yaml-pane-nested-section {
  border: 1px solid var(--border-color, #eee);
  border-radius: 3px;
  margin-top: 2px;
  overflow: hidden;
}
.yaml-pane-nested-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 12px;
  font-family: var(--ui-font, system-ui, sans-serif);
  color: var(--text-secondary, #666);
  width: 100%;
  text-align: left;
}
.yaml-pane-nested-body {
  padding: 4px 8px;
}
.yaml-pane-nested-row {
  display: flex;
  gap: 6px;
  padding: 2px 0;
  font-size: 12px;
}
.yaml-pane-nested-key {
  font-weight: 500;
  color: var(--text-secondary, #666);
  min-width: 60px;
  flex-shrink: 0;
}
.yaml-pane-nested-val {
  color: var(--text-primary, #333);
  word-break: break-word;
}
.yaml-pane-raw-value {
  width: 100%;
  box-sizing: border-box;
  background: transparent;
  color: var(--text-secondary, #666);
  border: none;
  border-bottom: 1px solid var(--border-color, #ccc);
  border-radius: 0;
  padding: 2px 0;
  font-family: var(--mono-font, monospace);
  font-size: 11px;
  resize: vertical;
  min-height: 48px;
}
`;

// ---------------------------------------------------------------------------
// Step 04 — CSS Lifecycle Helpers
// ---------------------------------------------------------------------------

/**
 * Injects the YAML Pane CSS into document.head.
 * Idempotent — skips if the style tag already exists.
 */
function injectYamlPaneCSS(): void {
  if (document.getElementById("__markable_yaml_pane_css__")) return;
  const style = document.createElement("style");
  style.id = "__markable_yaml_pane_css__";
  style.textContent = YAML_PANE_CSS;
  document.head.appendChild(style);
}

/**
 * Removes the YAML Pane CSS <style> tag from document.head.
 * No-op if the tag does not exist.
 */
function removeYamlPaneCSS(): void {
  const el = document.getElementById("__markable_yaml_pane_css__");
  if (el) el.remove();
}

// ---------------------------------------------------------------------------
// Step 04 — Panel DOM Functions
// ---------------------------------------------------------------------------

/**
 * Entry point for the sidebar panel render() callback.
 * Stores the container reference and triggers the initial DOM build.
 *
 * @param container - The HTMLElement provided by the sidebar manager.
 */
function renderPanel(container: HTMLElement): void {
  _panelContainer = container;
  rebuildPanelDOM();
}

/**
 * Fully rebuilds the panel container's DOM from current _panelState.
 *
 * Delegates to one of three renderers based on state kind.
 * If a schema warning exists, prepends the warning banner above the content.
 *
 * This is intentionally a full clear-and-rebuild (same strategy as backlinks
 * and auto-toc). With up to 50+ fields the rebuild is still fast enough;
 * avoid premature optimization.
 */
function rebuildPanelDOM(): void {
  if (!_panelContainer) return;

  // Clear all children
  _panelContainer.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "yaml-pane-container";

  // Schema warning banner — always visible, outside the scroll area (NFR-4)
  if (_schemaLoadError) {
    const banner = document.createElement("div");
    banner.className = "yaml-pane-warning";

    const text = document.createElement("span");
    text.className = "yaml-pane-warning-text";
    text.textContent = `Schema warning: ${_schemaLoadError}`;

    const reloadBtn = document.createElement("button");
    reloadBtn.className = "yaml-pane-reload-btn";
    reloadBtn.textContent = "Reload";
    reloadBtn.addEventListener("click", () => {
      if (_settings.schemaPath) {
        loadSchema(_settings.schemaPath).then(result => {
          if ("schema" in result) {
            _schema = result.schema;
            _schemaLoadError = null;
          } else {
            _schema = null;
            _schemaLoadError = result.error;
          }
          rebuildPanelDOM();
        });
      }
    });

    banner.appendChild(text);
    banner.appendChild(reloadBtn);
    wrapper.appendChild(banner);
  }

  // "Edit Properties file" quick-link — opens the vault's _properties.md in a tab.
  const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
  const activeVault = vm && typeof vm.getActiveVault === "function" ? vm.getActiveVault() : null;
  if (activeVault) {
    // eslint-disable-next-line no-control-regex
    const safeName = activeVault.name.replace(/[/:\x00]/g, "_");
    const propsPath = `${activeVault.rootPaths[0]}/VaultSettings/${safeName}_properties.md`;

    const toolbar = document.createElement("div");
    toolbar.className = "yaml-pane-toolbar";

    const editLink = document.createElement("button");
    editLink.className = "yaml-pane-edit-props-btn";
    editLink.textContent = "Edit Properties file";
    editLink.title = "Open the vault properties vocabulary file";
    editLink.addEventListener("click", () => {
      const tm = (window as any).__MARKABLE_TAB_MANAGER__;
      if (tm && typeof tm.openFileInTab === "function") {
        void tm.openFileInTab(propsPath);
      }
    });

    toolbar.appendChild(editLink);
    wrapper.appendChild(toolbar);
  }

  const scrollEl = document.createElement("div");
  scrollEl.className = "yaml-pane-scroll";

  if (_panelState.kind === "empty") {
    renderEmptyState(scrollEl);
  } else if (_panelState.kind === "error") {
    renderErrorState(scrollEl, _panelState.message);
  } else if (_panelState.kind === "fields") {
    renderFieldsState(scrollEl, _panelState.fields);
  }

  wrapper.appendChild(scrollEl);
  _panelContainer.appendChild(wrapper);
}

/**
 * Derives the document title for auto-population when "Add Front Matter" is clicked.
 *
 * Priority (FR-6.1):
 *   1. First H1 heading in the document, with inline Markdown stripped.
 *   2. Filename without extension, with dashes/underscores replaced by spaces.
 *   3. "Untitled" (EC-18: no H1 and no file path).
 *
 * Pure function (reads window globals for input, but does not mutate state).
 *
 * @returns The derived title string.
 */
export function deriveTitle(): string {
  const view = (window as unknown as Record<string, unknown>)[
    "__MARKABLE_EDITOR_VIEW__"
  ] as { state: { doc: { toString: () => string } } } | undefined;

  if (view?.state?.doc) {
    const docText = view.state.doc.toString();
    const h1Match = docText.match(/^# (.+)/m);
    if (h1Match) {
      // Strip inline Markdown: bold (**), italic (_), inline code (`), links [text](url)→text
      let title = h1Match[1];
      title = title.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"); // links
      title = title.replace(/\*\*(.+?)\*\*/g, "$1");          // bold
      title = title.replace(/__(.+?)__/g, "$1");              // bold alt
      title = title.replace(/_(.+?)_/g, "$1");                // italic
      title = title.replace(/`(.+?)`/g, "$1");                // code
      return title.trim();
    }
  }

  const filePath = (window as unknown as Record<string, unknown>)[
    "__MARKABLE_CURRENT_FILE__"
  ] as string | undefined;

  if (filePath) {
    // Extract filename without extension and humanize it
    const filename = filePath.split("/").pop() ?? filePath;
    const stem = filename.replace(/\.[^.]+$/, "");
    return stem.replace(/[-_]/g, " ");
  }

  return "Untitled";
}

/**
 * Renders the empty state: "No front matter" message + "Add Front Matter" button.
 *
 * @param container - The scroll container element.
 */
export function renderEmptyState(container: HTMLElement): void {
  const div = document.createElement("div");
  div.className = "yaml-pane-empty-state";

  const msg = document.createElement("span");
  msg.textContent = "No front matter";
  div.appendChild(msg);

  const btn = document.createElement("button");
  btn.className = "yaml-pane-add-fm-btn";
  btn.textContent = "Add Front Matter";
  btn.addEventListener("click", () => {
    const title = deriveTitle();
    const date = new Date().toISOString().slice(0, 10);

    const newFields: YamlField[] = [
      { key: "date", value: date, rawType: "date", lineIndex: -1, isBlockScalar: false },
      { key: "title", value: title, rawType: "string", lineIndex: -1, isBlockScalar: false },
    ];

    const fmString = buildFrontMatterString(newFields, [], { kind: "structural" });
    // Insert at position 0 — no existing front matter to replace
    const view = (window as unknown as Record<string, unknown>)[
      "__MARKABLE_EDITOR_VIEW__"
    ] as { state: { doc: { length: number } }; dispatch: (tr: unknown) => void } | undefined;

    // Insert at position 0 regardless of doc length. Both the "doc has content"
    // and "empty doc" branches dispatched the identical transaction, so the
    // guard on doc.length > 0 was redundant (Finding 6: dead code removed).
    if (view) {
      view.dispatch({
        changes: { from: 0, to: 0, insert: fmString },
        userEvent: YAML_PANE_USER_EVENT,
      });
    }

    // Update panel state immediately without waiting for updateListener
    const enriched = mergeWithSchema(newFields, _schema);
    _panelState = { kind: "fields", fields: enriched };
    rebuildPanelDOM();
  });

  div.appendChild(btn);
  container.appendChild(div);
}

/**
 * Renders the error state: styled message + raw error detail in monospace.
 *
 * @param container - The scroll container element.
 * @param message   - The parse error message from js-yaml.
 */
export function renderErrorState(container: HTMLElement, message: string): void {
  const div = document.createElement("div");
  div.className = "yaml-pane-error-state";

  const main = document.createElement("div");
  main.textContent = "Front matter contains invalid YAML. Edit the raw text to fix it.";
  div.appendChild(main);

  const detail = document.createElement("div");
  detail.className = "yaml-pane-error-detail";
  detail.textContent = message;
  div.appendChild(detail);

  container.appendChild(div);
}

/**
 * Renders the full field list for the "fields" state.
 * Appends an "Add Field" toggle section at the bottom.
 *
 * @param container - The scroll container element.
 * @param fields    - The enriched field array to render.
 */
export function renderFieldsState(container: HTMLElement, fields: EnrichedField[]): void {
  for (const field of fields) {
    renderFieldRow(container, field);
  }

  // Add Field section at the bottom
  const addSection = document.createElement("div");
  addSection.className = "yaml-pane-add-field-section";

  if (_addFieldVisible) {
    renderAddFieldRow(addSection);
  } else {
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "yaml-pane-add-field-toggle";
    toggleBtn.textContent = "+ Add field";
    toggleBtn.addEventListener("click", () => {
      _addFieldVisible = true;
      rebuildPanelDOM();
    });
    addSection.appendChild(toggleBtn);
  }

  container.appendChild(addSection);
}

/**
 * Renders a single field row: label (+ optional description) + control + delete button.
 *
 * @param container - The parent container to append the row to.
 * @param field     - The enriched field data.
 */
export function renderFieldRow(container: HTMLElement, field: EnrichedField): void {
  const row = document.createElement("div");
  row.className = "yaml-pane-field-row";

  // Label section
  const labelDiv = document.createElement("div");
  labelDiv.className = "yaml-pane-field-label";

  const labelText = document.createElement("span");
  labelText.textContent = field.key;
  labelDiv.appendChild(labelText);

  row.appendChild(labelDiv);

  if (field.description) {
    const desc = document.createElement("div");
    desc.className = "yaml-pane-field-description";
    desc.textContent = field.description;
    row.appendChild(desc);
  }

  // Control
  renderFieldControl(field, row);

  // Delete button (hidden by default, visible on hover via CSS)
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "yaml-pane-delete-btn";
  deleteBtn.textContent = "×";
  deleteBtn.title = `Delete "${field.key}"`;
  deleteBtn.addEventListener("click", () => {
    commitFieldDelete(field.key);
  });
  row.appendChild(deleteBtn);

  container.appendChild(row);
}

// ---------------------------------------------------------------------------
// Step 04 — renderFieldControl private sub-helpers (Finding 5 refactor)
// These are module-private helpers extracted to keep renderFieldControl short.
// ---------------------------------------------------------------------------

/**
 * Renders a checkbox for a boolean field.
 * @param field - Enriched boolean field.
 * @param container - Parent element.
 */
function renderBooleanInput(field: EnrichedField, container: HTMLElement): void {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "yaml-pane-control";
  input.checked = Boolean(field.value);
  input.addEventListener("change", () => {
    commitScalarEdit(field.key, input.checked);
  });
  container.appendChild(input);
}

/**
 * Renders a number input for a numeric field.
 * Commits on blur or Enter; sets _editingKey on focus.
 * @param field - Enriched number field.
 * @param container - Parent element.
 */
function renderNumberInput(field: EnrichedField, container: HTMLElement): void {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "yaml-pane-control";
  input.value = field.value !== null && field.value !== undefined ? String(field.value) : "";
  input.addEventListener("focus", () => { _editingKey = field.key; });
  input.addEventListener("blur", () => {
    commitScalarEdit(field.key, input.value === "" ? null : Number(input.value));
    _editingKey = null;
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      commitScalarEdit(field.key, input.value === "" ? null : Number(input.value));
      _editingKey = null;
      input.blur();
    }
  });
  container.appendChild(input);
}

/**
 * Renders a date input (<input type="date">) for a date field.
 * Commits on change; requires value in YYYY-MM-DD format.
 * @param field - Enriched date field.
 * @param container - Parent element.
 */
function renderDateInput(field: EnrichedField, container: HTMLElement): void {
  const input = document.createElement("input");
  input.type = "date";
  input.className = "yaml-pane-control";
  input.value = typeof field.value === "string" ? field.value : "";
  input.addEventListener("focus", () => { _editingKey = field.key; });
  input.addEventListener("change", () => {
    commitScalarEdit(field.key, input.value);
    _editingKey = null;
  });
  input.addEventListener("blur", () => { _editingKey = null; });
  container.appendChild(input);
}

/**
 * Renders a text input or textarea for string/null fields.
 * Block scalars (multi-line) use a <textarea>; everything else uses <input type="text">.
 * @param field - Enriched string, null, or unknown-type field.
 * @param container - Parent element.
 */
function renderTextInput(field: EnrichedField, container: HTMLElement): void {
  if (field.isBlockScalar) {
    const textarea = document.createElement("textarea");
    textarea.className = "yaml-pane-control";
    textarea.value = field.value !== null && field.value !== undefined ? String(field.value) : "";
    textarea.rows = 3;
    textarea.addEventListener("focus", () => { _editingKey = field.key; });
    textarea.addEventListener("blur", () => {
      commitScalarEdit(field.key, textarea.value);
      _editingKey = null;
    });
    container.appendChild(textarea);
    return;
  }

  const input = document.createElement("input");
  input.type = "text";
  input.className = "yaml-pane-control";
  if (field.effectiveType === "null") {
    // Null fields show an empty placeholder — the user can type to create a string value
    input.placeholder = "(empty)";
    input.value = "";
  } else {
    input.value = field.value !== null && field.value !== undefined ? String(field.value) : "";
  }
  input.addEventListener("focus", () => { _editingKey = field.key; });
  input.addEventListener("blur", () => {
    commitScalarEdit(field.key, input.value || null);
    _editingKey = null;
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      commitScalarEdit(field.key, input.value || null);
      _editingKey = null;
      input.blur();
    }
  });
  container.appendChild(input);
}

/**
 * Selects and renders the appropriate input control based on the field's effectiveType.
 *
 * Acts as a pure dispatch table: each branch delegates to a dedicated helper
 * function (renderBooleanInput, renderNumberInput, renderDateInput, renderTextInput)
 * or to a top-level renderer (renderChipWidget, renderSelectControl, renderNestedSection).
 *
 * @param field     - The enriched field data.
 * @param container - The parent field row element.
 */
export function renderFieldControl(field: EnrichedField, container: HTMLElement): void {
  const type = field.effectiveType;

  if (type === "boolean") { renderBooleanInput(field, container); return; }
  if (type === "number")  { renderNumberInput(field, container);  return; }
  if (type === "date")    { renderDateInput(field, container);    return; }

  if (type === "array" || type === "multiselect") { renderChipWidget(field, container);   return; }
  if (type === "select")                          { renderSelectControl(field, container); return; }
  if (type === "object")                          { renderNestedSection(field, container); return; }

  // string, null, or any unrecognised type — render a text input or textarea
  renderTextInput(field, container);
}

// ---------------------------------------------------------------------------
// Step 04 — renderChipWidget private sub-helpers (Finding 5 refactor)
// ---------------------------------------------------------------------------

/**
 * Return the meta vocabulary for `fieldKey` from window.__MARKABLE_META__,
 * or null when no vocabulary is defined or the vocabulary is empty.
 *
 * Null return value means "no vocabulary configured for this field" —
 * suppresses warning chips entirely (FR-11).
 *
 * This function is a self-contained copy of the same logic in meta-manager.ts.
 * The IIFE cannot import ES modules, so the logic is duplicated here intentionally
 * (AD-2: IIFE plugins access shared state only via window globals).
 *
 * Reads window.__MARKABLE_META__ synchronously — no I/O (NFR-7).
 *
 * @param fieldKey - YAML field name (e.g. "tags", "author").
 * @returns Vocabulary string array or null.
 *
 * @remarks Exported for unit tests only.
 */
export function getVocabularyForField(fieldKey: string): string[] | null {
  const meta: any = (window as any).__MARKABLE_META__;
  if (!meta) return null;

  const key = fieldKey.toLowerCase();

  if (key === "tags") {
    // FR-11: return null (not []) when tags vocabulary is empty — suppresses warnings.
    return meta.tags && meta.tags.length > 0 ? meta.tags : null;
  }

  // Fields are stored with lowercase keys (parsePropertiesFile normalises them).
  const vocab = meta.fields?.[key];
  // FR-11: same empty-check for non-tags fields.
  return vocab && vocab.length > 0 ? vocab : null;
}

/**
 * Creates a single chip element (text + remove button) for the chip widget.
 *
 * Adds a `.yaml-pane-chip--warning` modifier when the chip value is not in
 * the meta vocabulary for this field (FR-9, FR-10). The warning is suppressed
 * when no vocabulary is defined (FR-11, EC-12).
 *
 * @param val           - The chip's text value.
 * @param currentValues - The full array of current values (used for remove).
 * @param fieldKey      - The parent field key (forwarded to commitArrayEdit).
 * @returns The chip <span> element ready to append.
 *
 * @remarks Exported for unit tests only.
 */
export function buildChipElement(val: string, currentValues: string[], fieldKey: string): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "yaml-pane-chip";

  // FR-9/FR-10: check meta vocabulary for this field synchronously.
  // getVocabularyForField returns null when no vocabulary is defined (FR-11
  // suppression) — in that case we skip the warning entirely (EC-12).
  const vocab = getVocabularyForField(fieldKey);
  if (vocab !== null && !vocab.includes(val)) {
    // Case-sensitive exact-match comparison (EC-8, EC-9).
    chip.classList.add("yaml-pane-chip--warning");
    chip.title = `"${val}" is not in the ${fieldKey} vocabulary`;
  }

  const chipText = document.createElement("span");
  chipText.textContent = val;
  chip.appendChild(chipText);

  const removeBtn = document.createElement("button");
  removeBtn.className = "yaml-pane-chip-remove";
  removeBtn.textContent = "×";
  removeBtn.title = `Remove "${val}"`;
  removeBtn.addEventListener("click", () => {
    // Filter by identity (case-sensitive) to remove the first matching item.
    const newArray = currentValues.filter(v => v !== val);
    commitArrayEdit(fieldKey, newArray);
  });

  chip.appendChild(removeBtn);
  return chip;
}

/**
 * Creates the chip text input element with optional datalist autocomplete.
 * Attaches the datalist to the outer container so the input can reference it.
 *
 * @param field         - The enriched field (used for schemaValues and key).
 * @param currentValues - The current chip values (used to filter datalist).
 * @param container     - The outer container (datalist appended here, not to chips).
 * @returns The configured chip <input> element.
 */
function buildChipInput(field: EnrichedField, currentValues: string[], container: HTMLElement): HTMLInputElement {
  const input = document.createElement("input");
  input.className = "yaml-pane-chip-input";
  input.type = "text";
  input.placeholder = "Add...";

  // Datalist for schema autocomplete — filtered to values not already in chips
  if (field.schemaValues && field.schemaValues.length > 0) {
    const listId = `yaml-pane-datalist-${field.key}`;
    const datalist = document.createElement("datalist");
    datalist.id = listId;
    for (const opt of field.schemaValues.filter(v => !currentValues.includes(v))) {
      const option = document.createElement("option");
      option.value = opt;
      datalist.appendChild(option);
    }
    // Datalist must be in the document (not inside the chips flex container)
    // so the browser can reference it via the `list` attribute.
    container.appendChild(datalist);
    input.setAttribute("list", listId);
  }

  return input;
}

/**
 * Renders the chip/tag widget for array and multiselect fields.
 *
 * Each existing array value is shown as a removable chip (via buildChipElement).
 * A text input at the end allows adding new values (via buildChipInput).
 * Schema values are surfaced as a <datalist> for autocomplete.
 *
 * Validation rules:
 *   - Duplicates (case-insensitive) are rejected with an inline error.
 *   - For multiselect OR array with schemaValues: values not in the list are
 *     rejected (EC-9, FR-5.4). Finding 3: both types enforce the allowed list.
 *
 * @param field     - The enriched field data.
 * @param container - The parent element to append the widget to.
 */
export function renderChipWidget(field: EnrichedField, container: HTMLElement): void {
  const chips = document.createElement("div");
  chips.className = "yaml-pane-chips-container";

  const currentValues: string[] = Array.isArray(field.value)
    ? (field.value as unknown[]).map(String)
    : [];

  // Render existing chips using the extracted helper
  for (const val of currentValues) {
    chips.appendChild(buildChipElement(val, currentValues, field.key));
  }

  // Build the chip input (datalist appended to outer container, not chips div)
  const input = buildChipInput(field, currentValues, container);
  chips.appendChild(input);

  // Inline error element shown when validation fails
  const errorEl = document.createElement("div");
  errorEl.className = "yaml-pane-chip-error";
  errorEl.style.display = "none";

  /**
   * Attempts to add the current input value as a new chip.
   * Validates for duplicates and schema constraints before committing.
   */
  const tryAddChip = () => {
    const val = input.value.trim();
    if (!val) return;

    // Duplicate check (case-insensitive) — OQ-4: block exact duplicates
    if (currentValues.some(v => v.toLowerCase() === val.toLowerCase())) {
      errorEl.textContent = "Already added";
      errorEl.style.display = "block";
      return;
    }

    // Schema value enforcement for multiselect AND array fields that have
    // schemaValues defined (FR-5.4, EC-9). Both types enforce the allowed
    // values list when one is present (Finding 3 fix).
    if (
      (field.effectiveType === "multiselect" || field.effectiveType === "array") &&
      field.schemaValues &&
      field.schemaValues.length > 0 &&
      !field.schemaValues.includes(val)
    ) {
      errorEl.textContent = `"${val}" is not in the allowed values`;
      errorEl.style.display = "block";
      return;
    }

    errorEl.style.display = "none";
    const newArray = [...currentValues, val];
    commitArrayEdit(field.key, newArray);
    input.value = "";
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      tryAddChip();
    }
  });

  input.addEventListener("blur", () => {
    if (input.value.trim()) tryAddChip();
  });

  container.appendChild(chips);
  container.appendChild(errorEl);
}

/**
 * Renders a <select> dropdown for "select" type fields.
 *
 * EC-24: if schemaValues is empty, renders a disabled select with a placeholder.
 *
 * @param field     - The enriched field data.
 * @param container - The parent element to append the control to.
 */
export function renderSelectControl(field: EnrichedField, container: HTMLElement): void {
  const select = document.createElement("select");
  select.className = "yaml-pane-control";

  if (!field.schemaValues || field.schemaValues.length === 0) {
    // EC-24: warn and render a disabled placeholder select
    console.warn(`[yaml-pane] Field "${field.key}" is type "select" but has no values defined in schema.`);
    select.disabled = true;
    const placeholder = document.createElement("option");
    placeholder.textContent = "No options defined";
    select.appendChild(placeholder);
    container.appendChild(select);
    return;
  }

  for (const val of field.schemaValues) {
    const option = document.createElement("option");
    option.value = val;
    option.textContent = val;
    if (field.value === val) option.selected = true;
    select.appendChild(option);
  }

  select.addEventListener("change", () => {
    commitScalarEdit(field.key, select.value);
  });

  container.appendChild(select);
}

/**
 * Renders a collapsible nested section for "object" type fields.
 *
 * Top-level sub-keys are shown as read-only label/value pairs.
 * Deeply nested sub-values (objects, arrays) are displayed as raw YAML in
 * a read-only textarea (EC-6).
 *
 * @param field     - The enriched field data (value must be a plain object).
 * @param container - The parent element to append the section to.
 */
export function renderNestedSection(field: EnrichedField, container: HTMLElement): void {
  const section = document.createElement("div");
  section.className = "yaml-pane-nested-section";

  const isExpanded = _nestedExpanded.has(field.key);

  const toggle = document.createElement("button");
  toggle.className = "yaml-pane-nested-toggle";
  toggle.textContent = `${isExpanded ? "▾" : "▸"} ${field.key}`;
  toggle.addEventListener("click", () => {
    if (_nestedExpanded.has(field.key)) {
      _nestedExpanded.delete(field.key);
    } else {
      _nestedExpanded.add(field.key);
    }
    rebuildPanelDOM();
  });
  section.appendChild(toggle);

  if (isExpanded && field.value && typeof field.value === "object" && !Array.isArray(field.value)) {
    const body = document.createElement("div");
    body.className = "yaml-pane-nested-body";

    for (const [subKey, subVal] of Object.entries(field.value as Record<string, unknown>)) {
      const subRow = document.createElement("div");
      subRow.className = "yaml-pane-nested-row";

      const keyEl = document.createElement("span");
      keyEl.className = "yaml-pane-nested-key";
      keyEl.textContent = `${subKey}:`;
      subRow.appendChild(keyEl);

      // Deeply nested values → raw YAML display (EC-6)
      if (subVal !== null && typeof subVal === "object") {
        const raw = document.createElement("textarea");
        raw.className = "yaml-pane-raw-value";
        raw.readOnly = true;
        raw.value = jsYaml.dump(subVal, { lineWidth: -1, indent: 2 }).trim();
        subRow.appendChild(raw);
      } else {
        const valEl = document.createElement("span");
        valEl.className = "yaml-pane-nested-val";
        valEl.textContent = subVal !== null && subVal !== undefined ? String(subVal) : "(empty)";
        subRow.appendChild(valEl);
      }

      body.appendChild(subRow);
    }
    section.appendChild(body);
  }

  container.appendChild(section);
}

// ---------------------------------------------------------------------------
// Step 04 — renderAddFieldRow private sub-helpers (Finding 5 refactor)
// ---------------------------------------------------------------------------

/**
 * Builds the key name input for the "Add Field" row.
 * If a schema is loaded, attaches a datalist of schema field names not yet
 * present in the document (OQ-5: hybrid free-text + schema suggestions).
 *
 * The datalist is appended to `container` (not the row) so the browser can
 * find it via the `list` attribute regardless of DOM hierarchy.
 *
 * @param container - The outer container (datalist appended here).
 * @returns The configured key <input> element.
 */
function buildKeyInput(container: HTMLElement): HTMLInputElement {
  const keyInput = document.createElement("input");
  keyInput.type = "text";
  keyInput.className = "yaml-pane-add-field-key";
  keyInput.placeholder = "Field name...";

  if (_schema) {
    // Collect already-present field keys so we only suggest absent ones
    const presentKeys = _panelState.kind === "fields"
      ? new Set(_panelState.fields.map(f => f.key))
      : new Set<string>();

    const listId = "yaml-pane-add-field-datalist";
    const datalist = document.createElement("datalist");
    datalist.id = listId;

    for (const schemaKey of Object.keys(_schema.fields)) {
      if (!presentKeys.has(schemaKey)) {
        const option = document.createElement("option");
        option.value = schemaKey;
        datalist.appendChild(option);
      }
    }
    container.appendChild(datalist);
    keyInput.setAttribute("list", listId);
  }

  return keyInput;
}

/**
 * Builds the value input for the "Add Field" row.
 * All new fields are initially typed as strings — the panel re-infers the type
 * after the CM6 write-back triggers the next updateListener cycle.
 *
 * @returns The configured value <input> element.
 */
function buildValueInput(): HTMLInputElement {
  const valInput = document.createElement("input");
  valInput.type = "text";
  valInput.className = "yaml-pane-add-field-val";
  valInput.placeholder = "Value...";
  return valInput;
}

/**
 * Renders the "Add Field" inline input row.
 *
 * Wires together the key input (buildKeyInput), value input (buildValueInput),
 * Add button, Cancel button, and inline error element.
 *
 * EC-21 duplicate key validation is performed in the doAdd callback before
 * delegating to commitAddField.
 *
 * @param container - The parent element to append the row to.
 */
export function renderAddFieldRow(container: HTMLElement): void {
  const row = document.createElement("div");
  row.className = "yaml-pane-add-field-row";

  // Helpers build their respective elements; datalist is appended to container
  const keyInput = buildKeyInput(container);
  const valInput = buildValueInput();

  const errorEl = document.createElement("div");
  errorEl.className = "yaml-pane-add-field-error";
  errorEl.style.display = "none";

  const addBtn = document.createElement("button");
  addBtn.className = "yaml-pane-add-field-btn confirm";
  addBtn.textContent = "Add";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "yaml-pane-add-field-btn";
  cancelBtn.textContent = "Cancel";

  const doAdd = () => {
    const key = keyInput.value.trim();
    const val = valInput.value;

    if (!key) {
      errorEl.textContent = "Field name is required";
      errorEl.style.display = "block";
      return;
    }

    // EC-21: duplicate key check — prevent adding a key that already exists
    if (_panelState.kind === "fields" && _panelState.fields.some(f => f.key === key)) {
      errorEl.textContent = `"${key}" already exists`;
      errorEl.style.display = "block";
      return;
    }

    errorEl.style.display = "none";
    commitAddField(key, val);
  };

  addBtn.addEventListener("click", doAdd);

  valInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doAdd();
    if (e.key === "Escape") {
      _addFieldVisible = false;
      rebuildPanelDOM();
    }
  });

  keyInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      _addFieldVisible = false;
      rebuildPanelDOM();
    }
  });

  cancelBtn.addEventListener("click", () => {
    _addFieldVisible = false;
    rebuildPanelDOM();
  });

  row.appendChild(keyInput);
  row.appendChild(valInput);
  row.appendChild(addBtn);
  row.appendChild(cancelBtn);
  row.appendChild(errorEl);
  container.appendChild(row);
}

// ---------------------------------------------------------------------------
// Step 04 — Commit Functions
// ---------------------------------------------------------------------------

/**
 * Updates the in-memory field model for a scalar edit, writes the new front
 * matter to the editor, and refreshes the panel.
 *
 * Uses the `closingOffset` returned by `getOriginalLines()` rather than the
 * module-level `_closingOffset` directly. This prevents document corruption
 * on rapid sequential edits where the module-level offset may be stale (Finding 2).
 *
 * @param key      - The field key that was edited.
 * @param newValue - The new scalar value.
 */
function commitScalarEdit(key: string, newValue: unknown): void {
  if (_panelState.kind !== "fields") return;

  // Tab-switch race condition guard (Finding 8): if the file changed between the
  // user initiating the edit and this commit firing, the panel DOM is about to be
  // rebuilt for the new file — silently discard this stale commit.
  const currentFile = (window as unknown as Record<string, unknown>)[
    "__MARKABLE_CURRENT_FILE__"
  ] as string | undefined;
  if (currentFile !== _lastKnownFile) return;

  // Update the in-memory value for the edited field
  const updatedFields = _panelState.fields.map(f =>
    f.key === key ? { ...f, value: newValue } : f
  );
  _panelState = { kind: "fields", fields: updatedFields };

  const yamlFields: YamlField[] = updatedFields.map(f => ({
    key: f.key,
    value: f.value,
    // EnrichedField does not carry rawType at the interface level; fall back to
    // "string" so the write-back serialiser always has a valid type (Finding 4).
    rawType: ((f as unknown as { rawType?: YamlFieldType }).rawType ?? "string") as YamlFieldType,
    lineIndex: f.lineIndex,
    isBlockScalar: f.isBlockScalar,
  }));

  // Destructure closingOffset from the fresh parse so rapid sequential edits
  // always use the up-to-date front matter end position (Finding 2).
  const { lines: originalLines, closingOffset } = getOriginalLines();
  const changeType: FrontMatterChangeType = { kind: "scalar-edit", key, newValue };
  const newFm = buildFrontMatterString(yamlFields, originalLines, changeType);
  dispatchFrontMatterUpdate(newFm, closingOffset);

  rebuildPanelDOM();
}

/**
 * Updates the in-memory array value for a chip widget, writes back, and
 * refreshes the panel.
 *
 * Uses the `closingOffset` from a fresh parse to avoid stale-offset corruption
 * on rapid sequential chip edits (Finding 2).
 *
 * @param key      - The field key for the array.
 * @param newArray - The new array value after add/remove.
 */
function commitArrayEdit(key: string, newArray: unknown[]): void {
  if (_panelState.kind !== "fields") return;

  // Tab-switch race condition guard (Finding 8).
  const currentFile = (window as unknown as Record<string, unknown>)[
    "__MARKABLE_CURRENT_FILE__"
  ] as string | undefined;
  if (currentFile !== _lastKnownFile) return;

  const updatedFields = _panelState.fields.map(f =>
    f.key === key ? { ...f, value: newArray } : f
  );
  _panelState = { kind: "fields", fields: updatedFields };

  const yamlFields: YamlField[] = updatedFields.map(f => ({
    key: f.key,
    value: f.value,
    // Fall back to "string" when rawType is not present on EnrichedField (Finding 4).
    rawType: ((f as unknown as { rawType?: YamlFieldType }).rawType ?? "string") as YamlFieldType,
    lineIndex: f.lineIndex,
    isBlockScalar: f.isBlockScalar,
  }));

  const { lines: originalLines, closingOffset } = getOriginalLines();
  const newFm = buildFrontMatterString(yamlFields, originalLines, { kind: "structural" });
  dispatchFrontMatterUpdate(newFm, closingOffset);
  rebuildPanelDOM();
}

/**
 * Removes a field from the model, writes back the structural change, and
 * refreshes the panel.
 *
 * Uses the `closingOffset` from a fresh parse to avoid stale-offset corruption
 * (Finding 2).
 *
 * @param key - The key of the field to delete.
 */
function commitFieldDelete(key: string): void {
  if (_panelState.kind !== "fields") return;

  // Tab-switch race condition guard (Finding 8).
  const currentFile = (window as unknown as Record<string, unknown>)[
    "__MARKABLE_CURRENT_FILE__"
  ] as string | undefined;
  if (currentFile !== _lastKnownFile) return;

  const updatedFields = _panelState.fields.filter(f => f.key !== key);
  _panelState = { kind: "fields", fields: updatedFields };

  const yamlFields: YamlField[] = updatedFields.map(f => ({
    key: f.key,
    value: f.value,
    // Fall back to "string" when rawType is not present on EnrichedField (Finding 4).
    rawType: ((f as unknown as { rawType?: YamlFieldType }).rawType ?? "string") as YamlFieldType,
    lineIndex: f.lineIndex,
    isBlockScalar: f.isBlockScalar,
  }));

  const { lines: originalLines, closingOffset } = getOriginalLines();
  const newFm = buildFrontMatterString(yamlFields, originalLines, { kind: "structural" });
  dispatchFrontMatterUpdate(newFm, closingOffset);

  _addFieldVisible = false;
  rebuildPanelDOM();
}

/**
 * Adds a new field to the model, writes back the structural change, hides
 * the "Add Field" row, and refreshes the panel.
 *
 * EC-21: duplicate key check is done in renderAddFieldRow before calling this.
 * EC-22: key quoting is applied via formatYamlKey in buildFrontMatterString.
 *
 * Uses the `closingOffset` from a fresh parse to avoid stale-offset corruption
 * on rapid sequential edits (Finding 2).
 *
 * @param key   - The new field's key (display form, unquoted).
 * @param value - The new field's initial value as a string.
 */
function commitAddField(key: string, value: string): void {
  if (_panelState.kind !== "fields" && _panelState.kind !== "empty") return;

  // Tab-switch race condition guard (Finding 8).
  const currentFile = (window as unknown as Record<string, unknown>)[
    "__MARKABLE_CURRENT_FILE__"
  ] as string | undefined;
  if (currentFile !== _lastKnownFile) return;

  const existingFields: EnrichedField[] =
    _panelState.kind === "fields" ? _panelState.fields : [];

  // EnrichedField does not formally include rawType, but commit functions need
  // it to map back to YamlField. Carry it forward via the unknown cast (Finding 4).
  const newField: EnrichedField = {
    key,
    value,
    effectiveType: "string",
    isBlockScalar: false,
    lineIndex: -1,
    rawType: "string",
  } as unknown as EnrichedField;

  const updatedFields = [...existingFields, newField];
  _panelState = { kind: "fields", fields: updatedFields };

  const yamlFields: YamlField[] = updatedFields.map(f => ({
    key: f.key,
    value: f.value,
    // Fall back to "string" when rawType is not present (Finding 4).
    rawType: ((f as unknown as { rawType?: YamlFieldType }).rawType ?? "string") as YamlFieldType,
    lineIndex: f.lineIndex,
    isBlockScalar: f.isBlockScalar,
  }));

  const { lines: originalLines, closingOffset } = getOriginalLines();
  const newFm = buildFrontMatterString(yamlFields, originalLines, { kind: "structural" });
  dispatchFrontMatterUpdate(newFm, closingOffset);

  _addFieldVisible = false;
  rebuildPanelDOM();
}

/**
 * Updates panel state from the CM6 updateListener.
 * Called after the debounce fires with a new parse result.
 *
 * @param newState - The new panel state to render.
 */
export function updatePanelState(newState: PanelState): void {
  _panelState = newState;
  rebuildPanelDOM();
}

/**
 * Helper to retrieve original YAML lines and the current closing offset from
 * the live editor document. Re-parses the document on every call to guarantee
 * the offset is fresh — preventing document corruption when multiple rapid
 * sequential edits occur before the updateListener debounce fires (Finding 2).
 *
 * Side-effect: updates the module-level `_closingOffset` when a fresh parse
 * succeeds, so subsequent calls within the same tick still use the correct offset.
 *
 * @returns Object with `lines` (YAML source lines) and `closingOffset`.
 */
function getOriginalLines(): { lines: string[]; closingOffset: number } {
  const view = (window as unknown as Record<string, unknown>)[
    "__MARKABLE_EDITOR_VIEW__"
  ] as { state: { doc: { toString: () => string } } } | undefined;

  if (!view) return { lines: [], closingOffset: _closingOffset };

  const docText = view.state.doc.toString();
  const result = parseFrontMatter(docText);

  if (result.kind === "ok") {
    // Keep module-level offset in sync after each commit so a second rapid
    // edit uses the offset produced by the first commit, not the stale one.
    _closingOffset = result.closingOffset;
    return { lines: result.originalLines, closingOffset: result.closingOffset };
  }

  // Parse failed or no front matter — return empty lines and the last known offset
  return { lines: [], closingOffset: _closingOffset };
}

// ---------------------------------------------------------------------------
// Step 05 — Lifecycle State
// ---------------------------------------------------------------------------

let _enabled = false;
let _lastKnownFile: string | null = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _pollTimer: ReturnType<typeof setInterval> | null = null;
/** Current character offset of the closing --- in the editor document. */
let _closingOffset: number = 0;

// ---------------------------------------------------------------------------
// Step 05 — CM6 Update Listener
// ---------------------------------------------------------------------------

/**
 * Builds the CM6 updateListener extension array for the YAML Pane.
 *
 * Called inside onEnable — NOT at module load time — so that the CM6 globals
 * are definitely available when the factory runs.
 *
 * The listener:
 *   1. Skips updates when the plugin is disabled.
 *   2. Detects tab switches by comparing __MARKABLE_CURRENT_FILE__.
 *   3. Debounces at 150ms (FR-1.4) to avoid re-parsing on every keystroke.
 *   4. Calls parseFrontMatter and updates _panelState accordingly.
 *
 * @returns An array of CM6 Extension objects, or [] if CM6 globals unavailable.
 */
function buildUpdateListenerExtension(): unknown[] {
  const cmView = (window as unknown as Record<string, unknown>)["__CM_VIEW__"] as
    | { EditorView: { updateListener: { of: (fn: (update: unknown) => void) => unknown } } }
    | undefined;

  if (!cmView || !cmView.EditorView) {
    console.warn("[yaml-pane] __CM_VIEW__ not available; live updates disabled.");
    return [];
  }

  return [
    cmView.EditorView.updateListener.of((update: unknown) => {
      if (!_enabled) return;

      const upd = update as {
        docChanged: boolean;
        state: { doc: { toString: () => string } };
        transactions: Array<{ isUserEvent?: (s: string) => boolean }>;
      };

      // Tab switch detection
      const currentFile = (window as unknown as Record<string, unknown>)[
        "__MARKABLE_CURRENT_FILE__"
      ] as string | null;
      const tabSwitched = currentFile !== _lastKnownFile;

      if (tabSwitched) {
        _lastKnownFile = currentFile;
        // EC-17: discard in-progress edit on tab switch
        _editingKey = null;
        _addFieldVisible = false;
      }

      // Only re-parse if doc changed or tab switched
      if (!upd.docChanged && !tabSwitched) return;

      // Debounce at 150ms
      if (_debounceTimer !== null) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
      }

      const docText = upd.state.doc.toString();

      _debounceTimer = setTimeout(() => {
        if (!_enabled) return;

        const result = parseFrontMatter(docText);

        if (result.kind === "ok") {
          _closingOffset = result.closingOffset;
          const enriched = mergeWithSchema(result.fields, _schema);
          _panelState = { kind: "fields", fields: enriched };
        } else if (result.kind === "error") {
          _panelState = { kind: "error", message: result.message };
        } else {
          _panelState = { kind: "empty" };
        }

        rebuildPanelDOM();
      }, 150);
    }),
  ];
}

// ---------------------------------------------------------------------------
// Step 05 — Schema Path Setting UI (renderDetailExtra)
// ---------------------------------------------------------------------------

/** Sample schema file content written when the user clicks "Save Sample Schema". */
const SAMPLE_SCHEMA = `// Markable YAML Pane — Schema File
//
// This file controls how front matter fields appear in the Properties panel.
// Save it anywhere, then link it via the "Choose Schema File" button.
//
// Supported field types:
//   string      → plain text input
//   number      → numeric input
//   boolean     → checkbox
//   date        → date picker  (values must be YYYY-MM-DD)
//   array       → chip input, free-text, no restriction
//   multiselect → chip input, only entries in values[] are accepted
//   select      → dropdown, only entries in values[] are shown
//
// The "description" key adds a hint line under the field label.
// Fields not listed here are still shown — they just use inferred types.

{
  "fields": {

    // Plain text
    "title": {
      "type": "string",
      "description": "Document title"
    },

    // Date picker — value must be YYYY-MM-DD
    "date": {
      "type": "date",
      "description": "Creation or publication date"
    },

    // Dropdown — user picks exactly one value from the list
    "status": {
      "type": "select",
      "values": ["draft", "in-progress", "review", "published"],
      "description": "Publishing status"
    },

    // Tag chips — autocomplete from the list; rejects entries not in it
    "tags": {
      "type": "multiselect",
      "values": ["engineering", "design", "research", "ops", "strategy"],
      "description": "Topic tags"
    },

    // Free-form chips — no restriction on values
    "keywords": {
      "type": "array",
      "description": "Search keywords (free text)"
    },

    // Checkbox
    "published": {
      "type": "boolean",
      "description": "Whether this document is live"
    },

    // Numeric input
    "version": {
      "type": "number",
      "description": "Document version number"
    }

  }
}
`;

/**
 * Opens a native file picker filtered to .json/.jsonc files and, if the user
 * selects a file, updates settings and reloads the schema.
 *
 * Shared by the "+" header action button and the "Choose" button in the
 * Plugins Panel detail view.
 */
async function openSchemaPicker(): Promise<void> {
  const dialog = (window as unknown as Record<string, unknown>)[
    "__TAURI_DIALOG__"
  ] as { open: (opts: unknown) => Promise<string | null> } | undefined;
  if (!dialog) return;

  const selected = await dialog.open({
    title: "Choose Schema File",
    filters: [{ name: "Schema", extensions: ["json", "jsonc"] }],
    multiple: false,
  });

  if (!selected) return;

  _settings = { ..._settings, schemaPath: selected };
  saveSettings(_settings);

  const result = await loadSchema(selected);
  if ("schema" in result) {
    _schema = result.schema;
    _schemaLoadError = null;
  } else {
    _schema = null;
    _schemaLoadError = result.error;
  }
  rebuildPanelDOM();
}

/**
 * Renders the schema settings section for the Plugins Panel detail view.
 * Provides a "Choose" button (file picker), a path display, a reload button,
 * and a "Save Sample Schema" button.
 *
 * @param container - The container element provided by the Plugins Panel.
 */
function renderSchemaPathSetting(container: HTMLElement): void {
  const btnStyle =
    "padding:3px 10px;border:1px solid var(--border-color,#ccc);border-radius:3px;" +
    "background:transparent;color:var(--text-primary,#333);cursor:pointer;font-size:12px;" +
    "font-family:var(--ui-font,sans-serif);";
  const accentBtnStyle =
    "padding:3px 10px;border:1px solid var(--accent-color,#4a90e2);border-radius:3px;" +
    "background:transparent;color:var(--accent-color,#4a90e2);cursor:pointer;font-size:12px;" +
    "font-family:var(--ui-font,sans-serif);";

  // ── Row 1: Choose + current path display ──────────────────────────────────
  const row1 = document.createElement("div");
  row1.style.cssText = "display:flex;gap:8px;align-items:center;padding:8px 0;flex-wrap:wrap;";

  const label = document.createElement("span");
  label.textContent = "Schema file:";
  label.style.cssText = "font-size:12px;color:var(--text-secondary,#666);white-space:nowrap;";

  const pathDisplay = document.createElement("span");
  pathDisplay.style.cssText =
    "flex:1;font-size:12px;color:var(--text-primary,#333);word-break:break-all;" +
    "min-width:0;";
  pathDisplay.textContent = _settings.schemaPath || "(none)";

  const chooseBtn = document.createElement("button");
  chooseBtn.textContent = "Choose…";
  chooseBtn.style.cssText = accentBtnStyle;
  chooseBtn.addEventListener("click", () => {
    openSchemaPicker().then(() => {
      pathDisplay.textContent = _settings.schemaPath || "(none)";
    });
  });

  const reloadBtn = document.createElement("button");
  reloadBtn.textContent = "Reload";
  reloadBtn.style.cssText = btnStyle;
  reloadBtn.addEventListener("click", () => {
    if (_settings.schemaPath) {
      loadSchema(_settings.schemaPath).then(result => {
        if ("schema" in result) {
          _schema = result.schema;
          _schemaLoadError = null;
        } else {
          _schema = null;
          _schemaLoadError = result.error;
        }
        rebuildPanelDOM();
      });
    }
  });

  row1.appendChild(label);
  row1.appendChild(pathDisplay);
  row1.appendChild(chooseBtn);
  row1.appendChild(reloadBtn);
  container.appendChild(row1);

  // ── Row 2: Save sample schema ─────────────────────────────────────────────
  const row2 = document.createElement("div");
  row2.style.cssText = "display:flex;gap:8px;align-items:center;padding:4px 0 8px;";

  const sampleBtn = document.createElement("button");
  sampleBtn.textContent = "Save Sample Schema…";
  sampleBtn.style.cssText = btnStyle;
  sampleBtn.addEventListener("click", async () => {
    const dialog = (window as unknown as Record<string, unknown>)[
      "__TAURI_DIALOG__"
    ] as { save: (opts: unknown) => Promise<string | null> } | undefined;
    if (!dialog) return;

    const savePath = await dialog.save({
      title: "Save Sample Schema",
      defaultPath: "schema.jsonc",
      filters: [{ name: "Schema", extensions: ["jsonc", "json"] }],
    });
    if (!savePath) return;

    await (window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<void> }
    }).__TAURI_INTERNALS__.invoke("write_file", {
      path: savePath,
      content: SAMPLE_SCHEMA,
    });

    // Automatically set it as the active schema after saving
    _settings = { ..._settings, schemaPath: savePath };
    saveSettings(_settings);
    pathDisplay.textContent = savePath;
    const result = await loadSchema(savePath);
    if ("schema" in result) {
      _schema = result.schema;
      _schemaLoadError = null;
    } else {
      _schema = null;
      _schemaLoadError = result.error;
    }
    rebuildPanelDOM();
  });

  row2.appendChild(sampleBtn);
  container.appendChild(row2);
}

// ---------------------------------------------------------------------------
// Step 05 — Plugin Export
// ---------------------------------------------------------------------------

/**
 * YAML Pane plugin export.
 *
 * Loaded by the Markable IIFE plugin loader. Provides a "Properties" sidebar
 * panel that renders and edits YAML front matter as structured form controls.
 */
export default {
  id: "yaml-pane",
  name: "File Properties",
  version: "1.0.0",
  description: "Display and edit document front matter as structured fields",
  detail:
    "Shows a 'Properties' sidebar panel that reads your document's YAML front matter " +
    "and presents each field as an editable form control. Supports type inference, " +
    "date pickers, tag chips, and schema-driven controlled vocabularies.",
  sidebarPanelId: "yaml-pane",

  /**
   * Renders extra settings UI in the Plugins Panel detail view.
   * Provides the schema file path input and reload button.
   */
  renderDetailExtra(container: HTMLElement): void {
    renderSchemaPathSetting(container);
  },

  /**
   * Enable sequence (FR-8.2):
   *   1. Inject CSS.
   *   2. Register sidebar panel (synchronous — panel is immediately visible).
   *   3. Register CM6 updateListener extension.
   *   4. Set initial file tracking.
   *   5. Start polling fallback for tab switches.
   *   6. Load settings and schema asynchronously (fire-and-forget).
   */
  onEnable(api: MarkablePluginAPI): void {
    _enabled = true;

    // 1. Inject CSS
    injectYamlPaneCSS();

    // 2. Register sidebar panel
    api.registerSidebarPanel({
      id: "yaml-pane",
      title: "Properties",
      side: _settings.defaultSide,
      defaultWidth: 240,
      headerActions: [
        {
          icon: "+",
          title: "Choose schema file",
          onClick: () => { void openSchemaPicker(); },
        },
      ],

      render(container: HTMLElement): void {
        renderPanel(container);

        // Initial parse from current document
        const view = (window as unknown as Record<string, unknown>)[
          "__MARKABLE_EDITOR_VIEW__"
        ] as { state: { doc: { toString: () => string } } } | undefined;

        if (view) {
          const result = parseFrontMatter(view.state.doc.toString());
          if (result.kind === "ok") {
            _closingOffset = result.closingOffset;
            const enriched = mergeWithSchema(result.fields, _schema);
            _panelState = { kind: "fields", fields: enriched };
          } else if (result.kind === "error") {
            _panelState = { kind: "error", message: result.message };
          } else {
            _panelState = { kind: "empty" };
          }
          rebuildPanelDOM();
        }
      },

      destroy(_container: HTMLElement): void {
        _panelContainer = null;
        _editingKey = null;
        _addFieldVisible = false;
        if (_debounceTimer !== null) {
          clearTimeout(_debounceTimer);
          _debounceTimer = null;
        }
      },
    });

    // 3. Register CM6 updateListener
    const extensions = buildUpdateListenerExtension();
    api.addExtensions(extensions as import("@codemirror/state").Extension[]);

    // 4. Initial file tracking
    _lastKnownFile =
      ((window as unknown as Record<string, unknown>)["__MARKABLE_CURRENT_FILE__"] as string | null) ??
      null;

    // 5. Polling fallback for tab switches (same pattern as backlinks)
    _pollTimer = setInterval(() => {
      if (!_enabled) return;
      const currentFile = (window as unknown as Record<string, unknown>)[
        "__MARKABLE_CURRENT_FILE__"
      ] as string | null;

      if (currentFile !== _lastKnownFile) {
        _lastKnownFile = currentFile;
        _editingKey = null;
        _addFieldVisible = false;

        const view = (window as unknown as Record<string, unknown>)[
          "__MARKABLE_EDITOR_VIEW__"
        ] as { state: { doc: { toString: () => string } } } | undefined;

        if (!view) {
          _panelState = { kind: "empty" };
          rebuildPanelDOM();
          return;
        }

        const result = parseFrontMatter(view.state.doc.toString());
        if (result.kind === "ok") {
          _closingOffset = result.closingOffset;
          const enriched = mergeWithSchema(result.fields, _schema);
          _panelState = { kind: "fields", fields: enriched };
        } else if (result.kind === "error") {
          _panelState = { kind: "error", message: result.message };
        } else {
          _panelState = { kind: "empty" };
        }
        rebuildPanelDOM();
      }
    }, 500);

    // 6. Load settings + schema asynchronously (fire-and-forget)
    // CSS injection and panel registration happen synchronously above so the
    // panel is immediately visible. Settings/schema are applied when ready.
    loadSettings().then(settings => {
      _settings = settings;
      if (settings.schemaPath) {
        return loadSchema(settings.schemaPath);
      }
      return Promise.resolve(null);
    }).then(schemaResult => {
      if (!schemaResult) return;
      if ("schema" in schemaResult) {
        _schema = schemaResult.schema;
        _schemaLoadError = null;
      } else {
        _schema = null;
        _schemaLoadError = schemaResult.error;
      }
      rebuildPanelDOM();
    }).catch(err => {
      console.warn("[yaml-pane] Settings/schema load error:", err);
    });
  },

  /**
   * Disable sequence (FR-8.3):
   *   1. Cancel all timers.
   *   2. Remove CM6 extensions.
   *   3. Unregister sidebar panel (calls destroy internally).
   *   4. Remove CSS.
   *   5. Clear all module-level state.
   */
  onDisable(api: MarkablePluginAPI): void {
    _enabled = false;

    // 1. Cancel timers
    if (_debounceTimer !== null) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }
    if (_pollTimer !== null) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }

    // 2. Remove CM6 extensions
    api.removeExtensions();

    // 3. Unregister sidebar panel
    api.unregisterSidebarPanel("yaml-pane");

    // 4. Remove CSS
    removeYamlPaneCSS();

    // 5. Clear module-level state
    _panelContainer = null;
    _panelState = { kind: "empty" };
    _editingKey = null;
    _addFieldVisible = false;
    _nestedExpanded = new Set();
    _schema = null;
    _schemaLoadError = null;
    _settings = { ...DEFAULT_SETTINGS };
    _lastKnownFile = null;
    _closingOffset = 0;
  },
};

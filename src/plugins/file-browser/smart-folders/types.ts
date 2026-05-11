/**
 * smart-folders/types.ts
 *
 * Pure type definitions for the Smart Folders feature.
 *
 * This file contains ONLY TypeScript types and interfaces — no runtime
 * exports. It compiles cleanly with isolatedModules: true.
 *
 * The discriminated union over SmartFolderRule encodes each rule's valid
 * operators AND value shapes at the type level, so matcher functions in
 * evaluator.ts can switch on `rule.type` and receive fully-typed `value`
 * fields without extra runtime assertions.
 *
 * References:
 *   FR-01 through FR-09 — rule type definitions and operator whitelists
 *   Locked decisions #1, #2, #3
 *
 * @module smart-folders/types
 */

// ── Primitive aliases ──────────────────────────────────────────────────────────

/**
 * Stable identifier for a Smart Folder.
 * Generated once at create time via generateSmartFolderId() and never mutated.
 * The `sf-` prefix ensures uniqueness against vault paths (AD-3).
 */
export type SmartFolderId = string;

// ── Rule type discriminator ───────────────────────────────────────────────────

/**
 * The six v1 filter types. Each maps to a branch in the SmartFolderRule
 * discriminated union and a corresponding matcher function in evaluator.ts.
 *
 * Locked #1 / FR-03 through FR-08.
 */
export type SmartFolderRuleType =
  | "tag"
  | "path"
  | "extension"
  | "file-type"
  | "modified"
  | "links"
  | "title";

// ── Operator union ────────────────────────────────────────────────────────────

/**
 * All allowed operators across all rule types.
 *
 * Negation is encoded in the operator string, NOT as a separate boolean
 * (Locked #2 / FR-09 / Mac Finder pattern).
 *
 * Some operators are shared across types ("is" / "is not" for tag and
 * extension; "contains" / "does not contain" for path and title).
 */
export type SmartFolderOperator =
  // tag
  | "is"
  | "is not"
  // path
  | "contains"
  | "does not contain"
  | "starts with"
  | "does not start with"
  // modified
  | "in last N days"
  | "not in last N days"
  | "before"
  | "after"
  // links — comparator encoded in operator string to avoid a separate value control
  | "outbound = 0"
  | "outbound >= 1"
  | "outbound >= N"
  | "inbound = 0"
  | "inbound >= 1"
  | "inbound >= N";

// ── Rule discriminated union ───────────────────────────────────────────────────

/**
 * Discriminated union over all Smart Folder rule types.
 *
 * Each member constrains `operator` and `value` to exactly the shapes that
 * are valid for that rule type. Matcher functions in evaluator.ts narrow via
 * `switch (rule.type)` and receive a fully-typed payload with no casts.
 *
 * Key design choices:
 *   - "modified in last N days" uses `value: number` (positive integer of days).
 *   - "modified before/after" uses `value: string` (ISO date YYYY-MM-DD).
 *   - "links = 0" / "links >= 1" use `value: null` (no extra data needed).
 *   - "links >= N" uses `value: number` (the minimum count N).
 */
export type SmartFolderRule =
  | { type: "tag";       operator: "is" | "is not";                                           value: string  }
  | { type: "path";      operator: "contains" | "does not contain" | "starts with" | "does not start with"; value: string  }
  | { type: "extension"; operator: "is" | "is not";                                           value: string  }
  | { type: "file-type"; operator: "is" | "is not";                                           value: string  }
  | { type: "modified";  operator: "in last N days" | "not in last N days";                   value: number  }
  | { type: "modified";  operator: "before" | "after";                                        value: string  }
  | { type: "links";     operator: "outbound = 0" | "outbound >= 1" | "inbound = 0" | "inbound >= 1"; value: null    }
  | { type: "links";     operator: "outbound >= N" | "inbound >= N";                          value: number  }
  | { type: "title";     operator: "contains" | "does not contain";                           value: string  };

// ── Top-level definition ─────────────────────────────────────────────────────

/**
 * The complete persisted shape for one Smart Folder.
 *
 * Stored in FileBrowserSettings.smartFolders[vaultId][].
 * The `id` is permanent — renames only update `name`, preserving expansion
 * state which is keyed by `__smart__/<id>` (AD-3, Locked #14).
 */
export interface SmartFolderDef {
  /** Stable synthetic id, never changes after creation. */
  id: SmartFolderId;
  /** User-visible display name. Must be non-empty (FR-26 invariant). */
  name: string;
  /** Ordered list of filter rules combined with AND semantics (FR-10). */
  rules: SmartFolderRule[];
}

// ── Evaluation output ─────────────────────────────────────────────────────────

/**
 * Result of evaluating one Smart Folder against the current vault index.
 *
 * `matches` is an array of absolute file paths sorted by modified descending
 * (Locked #12 / A-1). `count` is denormalized from `matches.length` so the
 * badge renderer can read it without calling `.length` each time.
 */
export interface EvaluationResult {
  /** Identifies which Smart Folder produced this result. */
  smartFolderId: SmartFolderId;
  /** Absolute paths of matching files, sorted by modified descending. */
  matches: string[];
  /** === matches.length — denormalized for efficient badge reads (AD-7). */
  count: number;
}

// ── Inverse maps (FR-28, AD-5) ────────────────────────────────────────────────

/**
 * Intermediate data structures built ONCE per evaluation pass.
 *
 * Building them once per pass (rather than per-rule or per-file) is the core
 * performance guarantee for NFR-01 (≤100 ms for 1k files × 10 smart folders).
 *
 * pathToTags:          path → set of tag strings AND "field:value" strings
 *                      (plain tags and YAML field values share the same set per FR-03).
 * pathToInboundCount:  path → number of files that link to this file.
 *                      Computed by inverting outboundLinks across all entries.
 * pathToOutboundCount: path → outboundLinks.length for that entry.
 * distinctExtensions:  lowercase unique extensions with leading dot,
 *                      used to populate the extension dropdown in the editor.
 */
export interface InverseMaps {
  pathToTags: Map<string, Set<string>>;
  pathToInboundCount: Map<string, number>;
  pathToOutboundCount: Map<string, number>;
  /** Lowercase, leading-dot, sorted, unique. E.g. [".md", ".pdf", ".png"]. */
  distinctExtensions: string[];
}

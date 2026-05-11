/**
 * smart-folders/evaluator.ts
 *
 * Pure evaluation engine for Smart Folders.
 *
 * This module is intentionally side-effect-free:
 *   - No DOM access
 *   - No window globals
 *   - No console output
 *   - No Date.now() — the caller injects `now` for determinism
 *
 * The entry point is evaluateAll(), which:
 *   1. Builds inverse maps ONCE per call (FR-28, NFR-01).
 *   2. Calls evaluateSmartFolder() for each def.
 *   3. Returns a Map<id, EvaluationResult>.
 *
 * Performance target: ≤100 ms for 1000 files × 10 smart folders × 6 rule types
 * on the developer reference machine (NFR-01). The inverse-map build is O(N +
 * total outbound links + total tag occurrences) — single pass. Per-rule work is
 * O(1) lookup (tags, links) or O(path length) substring check (path, title,
 * extension). Both are well within budget.
 *
 * @module smart-folders/evaluator
 */

import type { VaultIndex, VaultIndexEntry, NonMdFile } from "../../../lib/vault-types";
import type { TagEntry } from "../../../lib/bridge";
import type {
  SmartFolderDef,
  SmartFolderRule,
  EvaluationResult,
  InverseMaps,
} from "./types";

// ── File-type groups ─────────────────────────────────────────────────────────

/**
 * Pre-defined extension sets for the "file-type" rule type.
 *
 * Keys are lowercase group names used as the rule's `value` field.
 * Exported so editor-ui can derive the dropdown labels from the same source.
 */
export const FILE_TYPE_GROUPS: Record<string, ReadonlySet<string>> = {
  images: new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif", ".bmp", ".ico", ".tiff", ".tif", ".heic", ".heif"]),
  video:  new Set([".mp4", ".avi", ".mov", ".mkv", ".wmv", ".flv", ".webm", ".m4v", ".mpeg", ".mpg", ".3gp"]),
  audio:  new Set([".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a", ".wma", ".opus"]),
};

// ── Internal candidate type ───────────────────────────────────────────────────

/**
 * Flat, uniform representation of both md and non-md files.
 *
 * Used internally during an evaluation pass so matchers don't need to
 * branch on the source type. `isMd` distinguishes for the "links" rule type
 * (non-md files cannot have outbound links — see EC-18).
 */
interface Candidate {
  path: string;
  name: string;
  /** For md: VaultIndexEntry.title; for non-md: the filename stem. */
  title: string;
  /** For md: VaultIndexEntry.modified; for non-md: 0 (unknown). */
  modified: number;
  /** True for .md entries, false for nonMdFiles. */
  isMd: boolean;
}

// ── Helper: file extension ────────────────────────────────────────────────────

/**
 * Extract the lowercase extension (with leading dot) from an absolute path.
 *
 * Examples:
 *   extOf("/notes/foo.md")     → ".md"
 *   extOf("/notes/a.tar.gz")   → ".gz"
 *   extOf("/notes/noext")      → ""
 */
function extOf(path: string): string {
  const lastDot = path.lastIndexOf(".");
  const lastSlash = path.lastIndexOf("/");
  if (lastDot < 0 || lastDot < lastSlash) return "";
  return path.slice(lastDot).toLowerCase();
}

// ── Candidate constructors ────────────────────────────────────────────────────

/** Convert a VaultIndexEntry to the Candidate shape. */
function toMdCandidate(e: VaultIndexEntry): Candidate {
  return { path: e.path, name: e.name, title: e.title, modified: e.modified, isMd: true };
}

/** Convert a NonMdFile to the Candidate shape. Modified is unknown → 0. */
function toNonMdCandidate(n: NonMdFile): Candidate {
  // Extract the filename stem as the "title" for non-md files
  const dot = n.name.lastIndexOf(".");
  const stem = dot > 0 ? n.name.slice(0, dot) : n.name;
  return { path: n.path, name: n.name, title: stem, modified: 0, isMd: false };
}

// ── Inverse map construction (FR-28) ─────────────────────────────────────────

/**
 * Build the inverse maps needed by all rule matchers.
 *
 * Called ONCE per evaluation pass — FR-28, AD-5, NFR-01.
 *
 * Algorithm is a single pass over the index:
 *   1. Tag scan → invert (TagEntry[].filePaths → Set of tags per path).
 *   2. Walk md entries → outbound counts, build stem→path lookup.
 *   3. Inbound counts — resolve outbound stems via stem→path map.
 *   4. Non-md file extensions → contribute to distinctExtensions.
 *
 * @param vaultIndex - The current vault index.
 * @param tagScan    - Result of scan_vault_tags (may be [] in degraded mode).
 * @returns InverseMaps object for use across all rule matchers.
 */
export function buildInverseMaps(vaultIndex: VaultIndex, tagScan: TagEntry[]): InverseMaps {
  const pathToTags         = new Map<string, Set<string>>();
  const pathToOutboundCount = new Map<string, number>();
  const pathToInboundCount  = new Map<string, number>();
  const extSet              = new Set<string>();

  // Step 1: invert tag scan
  for (const entry of tagScan) {
    for (const filePath of entry.filePaths) {
      let tags = pathToTags.get(filePath);
      if (!tags) { tags = new Set(); pathToTags.set(filePath, tags); }
      tags.add(entry.tag);
    }
  }

  // Step 2: walk md entries — outbound counts and stem→path
  const stemToPath = new Map<string, string>();
  for (const e of vaultIndex.entries) {
    pathToOutboundCount.set(e.path, e.outboundLinks.length);
    stemToPath.set(e.name, e.path);
    const ext = extOf(e.path);
    if (ext) extSet.add(ext);
  }

  // Step 3: inbound counts — single pass through outbound links
  for (const e of vaultIndex.entries) {
    for (const outStem of e.outboundLinks) {
      const target = stemToPath.get(outStem);
      if (target) {
        pathToInboundCount.set(target, (pathToInboundCount.get(target) ?? 0) + 1);
      }
    }
  }

  // Step 4: non-md file extensions
  for (const n of vaultIndex.nonMdFiles ?? []) {
    const ext = extOf(n.path);
    if (ext) extSet.add(ext);
  }

  const distinctExtensions = Array.from(extSet).sort();
  return { pathToTags, pathToInboundCount, pathToOutboundCount, distinctExtensions };
}

// ── Rule matchers ─────────────────────────────────────────────────────────────

/** Reusable empty Set to avoid allocations in the hot tag-lookup path. */
const EMPTY_TAG_SET: ReadonlySet<string> = new Set();

/**
 * Evaluate a single rule against one candidate file.
 *
 * Returns true if the candidate passes the rule; false otherwise.
 *
 * @param rule      - The rule to evaluate.
 * @param candidate - The candidate file being tested.
 * @param maps      - Pre-built inverse maps for O(1) lookups.
 * @param now       - Current timestamp (injected for determinism in time rules).
 */
export function matchRule(
  rule: SmartFolderRule,
  candidate: Candidate,
  maps: InverseMaps,
  now: number,
): boolean {
  switch (rule.type) {
    case "tag": {
      const tags = maps.pathToTags.get(candidate.path) ?? EMPTY_TAG_SET;
      // Strip a leading '#' so "tag is #research" and "tag is research" both work,
      // since the Rust scanner stores tags without the '#' prefix.
      const needle = rule.value.startsWith("#") ? rule.value.slice(1) : rule.value;
      const has = tags.has(needle);
      return rule.operator === "is" ? has : !has;
    }

    case "path": {
      const p = candidate.path.toLowerCase();
      const v = rule.value.toLowerCase();
      if (!v) return rule.operator === "does not contain" || rule.operator === "does not start with";
      switch (rule.operator) {
        case "contains":            return p.includes(v);
        case "does not contain":    return !p.includes(v);
        case "starts with":         return p.startsWith(v);
        case "does not start with": return !p.startsWith(v);
      }
      break;
    }

    case "extension": {
      const ext = extOf(candidate.path);
      const want = rule.value.toLowerCase();
      const eq = ext === want;
      return rule.operator === "is" ? eq : !eq;
    }

    case "file-type": {
      const ext = extOf(candidate.path);
      const group = FILE_TYPE_GROUPS[rule.value.toLowerCase()];
      const inGroup = group ? group.has(ext) : false;
      return rule.operator === "is" ? inGroup : !inGroup;
    }

    case "modified": {
      const m = candidate.modified;
      switch (rule.operator) {
        case "in last N days": {
          const cutoff = now - rule.value * 86_400_000;
          return m >= cutoff;
        }
        case "not in last N days": {
          const cutoff = now - rule.value * 86_400_000;
          return m < cutoff;
        }
        case "before": {
          const t = Date.parse(rule.value);
          return m < t;
        }
        case "after": {
          const t = Date.parse(rule.value);
          return m > t;
        }
      }
      break;
    }

    case "links": {
      // Non-md files have no links — all link rules return false for them (EC-18).
      if (!candidate.isMd) return false;
      const outbound = maps.pathToOutboundCount.get(candidate.path) ?? 0;
      const inbound  = maps.pathToInboundCount.get(candidate.path) ?? 0;
      switch (rule.operator) {
        case "outbound = 0":   return outbound === 0;
        case "outbound >= 1":  return outbound >= 1;
        case "outbound >= N":  return outbound >= rule.value;
        case "inbound = 0":    return inbound === 0;
        case "inbound >= 1":   return inbound >= 1;
        case "inbound >= N":   return inbound >= rule.value;
      }
      break;
    }

    case "title": {
      const needle = rule.value.toLowerCase();
      if (!needle) return rule.operator === "does not contain";
      const haystack = (candidate.title + " " + candidate.name).toLowerCase();
      const has      = haystack.includes(needle);
      return rule.operator === "contains" ? has : !has;
    }
  }
  // Unreachable in well-typed code; included for runtime safety
  return false;
}

// ── Smart folder evaluation ───────────────────────────────────────────────────

/**
 * Evaluate a single SmartFolderDef against the vault, returning matching paths.
 *
 * Rules are combined with AND semantics (FR-10, Locked #3): the candidate must
 * pass ALL rules to appear in the result.
 *
 * Results are sorted by modified descending (Locked #12 / A-1).
 *
 * @param def        - The Smart Folder definition to evaluate.
 * @param vaultIndex - The vault to evaluate against.
 * @param maps       - Pre-built inverse maps (built once per pass by evaluateAll).
 * @param now        - Injected timestamp for determinism (defaults to Date.now()).
 * @returns EvaluationResult with matches sorted by modified descending.
 */
export function evaluateSmartFolder(
  def: SmartFolderDef,
  vaultIndex: VaultIndex,
  maps: InverseMaps,
  now: number = Date.now(),
): EvaluationResult {
  // Defense-in-depth: a def with zero rules matches nothing (sanitizeDef guards
  // this upstream, but we guard here too per NFR-06).
  if (def.rules.length === 0) {
    return { smartFolderId: def.id, matches: [], count: 0 };
  }

  // Flatten md entries and non-md files into a uniform Candidate array.
  let surviving: Candidate[] = [
    ...vaultIndex.entries.map(toMdCandidate),
    ...(vaultIndex.nonMdFiles ?? []).map(toNonMdCandidate),
  ];

  // AND combinator: each rule narrows the candidate set.
  for (const rule of def.rules) {
    surviving = surviving.filter((c) => matchRule(rule, c, maps, now));
  }

  // Sort by modified descending (Locked #12 / A-1).
  surviving.sort((a, b) => b.modified - a.modified);

  const matches = surviving.map((c) => c.path);
  return { smartFolderId: def.id, matches, count: matches.length };
}

/**
 * Evaluate every Smart Folder definition in a single pass.
 *
 * This is the top-level entry point for the evaluation engine. Builds inverse
 * maps ONCE (FR-28, NFR-01), then calls evaluateSmartFolder for each def.
 *
 * @param defs       - Smart folder definitions to evaluate.
 * @param vaultIndex - The vault to evaluate against.
 * @param tagScan    - Pre-fetched tag scan result (caller is responsible for cache).
 * @param now        - Injected timestamp for "modified" rule determinism.
 * @returns Map from smart folder id to its EvaluationResult.
 */
export function evaluateAll(
  defs: SmartFolderDef[],
  vaultIndex: VaultIndex,
  tagScan: TagEntry[],
  now: number = Date.now(),
): Map<string, EvaluationResult> {
  // Single inverse-map build covers all defs — FR-28.
  const maps = buildInverseMaps(vaultIndex, tagScan);
  const results = new Map<string, EvaluationResult>();
  for (const def of defs) {
    results.set(def.id, evaluateSmartFolder(def, vaultIndex, maps, now));
  }
  return results;
}

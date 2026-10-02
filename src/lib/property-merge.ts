import { foldVocabKey, nearDupClusters, normalizeVocabKey } from "./near-dup-clusters";

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const row = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[b.length];
}

/**
 * Sanitize a definition name so all segments contain only letters, numbers,
 * dashes, and underscores. Replaces spaces and special characters with dashes.
 * Dashes are explicitly supported.
 */
export function sanitizeDefinitionName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  // Split by slashes to preserve slash-nested hierarchies
  const rawSegments = trimmed.split("/").map((seg) => seg.trim()).filter(Boolean);
  if (rawSegments.length === 0) return "";

  const sanitizedSegments = rawSegments.map((seg) => {
    // Replace spaces, colons, hashes, at-signs and illegal chars with dashes
    let s = seg.replace(/[^A-Za-z0-9_-]+/g, "-");
    // Collapse repeated dashes
    s = s.replace(/-+/g, "-");
    // Trim leading/trailing dashes and underscores
    s = s.replace(/^[-_]+|[-_]+$/g, "");
    // If segment starts with numbers, prefix with 't-' if needed, or leave alphanumeric
    return s;
  }).filter(Boolean);

  return sanitizedSegments.join("/");
}

function validSegment(segment: string): boolean {
  if (!segment || !/^[A-Za-z]/.test(segment)) return false;
  return /^[A-Za-z0-9_-]+$/.test(segment);
}

export interface MergeFieldValidation {
  valid: boolean;
  error?: string;
  suggested?: string;
}

/**
 * Validate an individual field in the merge definitions list.
 * Flags empty values, self-merges, and special characters.
 * Provides a suggested sanitized name when special characters are detected.
 */
export function validateMergeField(valueRaw: string, targetRaw: string): MergeFieldValidation {
  const value = valueRaw.trim();
  const target = targetRaw.trim();

  if (!value) {
    return { valid: false, error: "Definition cannot be empty." };
  }

  if (value === target) {
    return { valid: false, error: "Cannot merge definition into itself." };
  }

  if (value.startsWith("/") || value.endsWith("/") || value.includes("//")) {
    const suggested = sanitizeDefinitionName(value);
    return {
      valid: false,
      error: "Name cannot start, end, or contain empty slash segments.",
      suggested: suggested && suggested !== value ? suggested : undefined,
    };
  }

  const segments = value.split("/");
  const hasInvalid = segments.some((s) => !validSegment(s));
  if (hasInvalid) {
    const suggested = sanitizeDefinitionName(value);
    return {
      valid: false,
      error: `Special characters detected in "${value}".`,
      suggested: suggested && suggested !== value ? suggested : undefined,
    };
  }

  return { valid: true };
}

/**
 * Scan a known vocabulary list for definitions that are similar to `target`.
 * Case-sensitive candidate list: preserves the exact casing found in `existing`.
 */
export function findSimilarDefinitions(targetRaw: string, existing: string[]): string[] {
  const target = targetRaw.trim();
  if (!target) return [];

  const targetLower = target.toLowerCase();
  const targetNorm = normalizeVocabKey(target);
  const targetFold = foldVocabKey(target);

  const candidates = new Set<string>();

  // 1. Check nearDupClusters
  const clusters = nearDupClusters(existing);
  for (const c of clusters) {
    if (c.members.includes(target)) {
      for (const m of c.members) {
        if (m !== target) candidates.add(m);
      }
    }
  }

  // 2. Direct comparison with existing items
  for (const item of existing) {
    const trimmed = item.trim();
    if (!trimmed || trimmed === target) continue;

    // Case difference
    if (trimmed.toLowerCase() === targetLower) {
      candidates.add(trimmed);
      continue;
    }

    // Separator difference
    if (normalizeVocabKey(trimmed) === targetNorm) {
      candidates.add(trimmed);
      continue;
    }

    // Folded difference
    const foldItem = foldVocabKey(trimmed);
    if (foldItem === targetFold) {
      candidates.add(trimmed);
      continue;
    }

    // Levenshtein edit distance for stems of length >= 4
    if (targetFold.length >= 4 && Math.abs(foldItem.length - targetFold.length) <= 1) {
      if (levenshtein(targetFold, foldItem) <= 1) {
        candidates.add(trimmed);
      }
    }
  }

  return [...candidates].sort((a, b) => a.localeCompare(b));
}

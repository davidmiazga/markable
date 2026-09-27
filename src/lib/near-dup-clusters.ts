/**
 * Cluster near-duplicate vocabulary values (tags / category values).
 *
 * Never auto-deletes. Callers present clusters for the user to accept.
 *
 * Groups:
 *   - case: Recipe / recipe
 *   - separator: daily-note / daily_note / daily note
 *   - edit-distance: colour / color (short tokens, distance 1)
 *
 * Nested prefixes (work vs work/project) are related, not merge clusters.
 */

export type NearDupKind = "case" | "separator" | "edit-distance";

export interface NearDupCluster {
  canonical: string;
  members: string[];
  kind: NearDupKind;
}

export interface NestedRelation {
  parent: string;
  children: string[];
}

/** Fold case and treat hyphen / underscore / space as the same separator. */
export function normalizeVocabKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s-]+/g, "-");
}

/** Same as normalizeVocabKey but with separators stripped — for case+separator grouping. */
export function foldVocabKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s-]+/g, "");
}

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

function canonicalScore(value: string): number {
  let score = 0;
  if (value === value.toLowerCase()) score += 2;
  if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)) score += 3;
  score -= value.length * 0.01;
  return score;
}

function pickCanonical(members: string[]): string {
  return [...members].sort((a, b) => {
    const diff = canonicalScore(b) - canonicalScore(a);
    if (diff !== 0) return diff;
    return a.localeCompare(b);
  })[0];
}

function clusterKind(members: string[]): NearDupKind {
  const folded = new Set(members.map(foldVocabKey));
  if (folded.size === 1) {
    const seps = new Set(members.map((m) => m.trim().toLowerCase()));
    return seps.size === 1 ? "case" : "separator";
  }
  return "edit-distance";
}

/**
 * Cluster near-duplicates. Singleton values are omitted.
 * Nested parent/child pairs are not clustered here — see relatedNested().
 */
export function nearDupClusters(values: string[]): NearDupCluster[] {
  const unique: string[] = [];
  const seenExact = new Set<string>();
  for (const raw of values) {
    const v = raw.trim();
    if (!v || seenExact.has(v)) continue;
    seenExact.add(v);
    unique.push(v);
  }

  const byFold = new Map<string, string[]>();
  for (const v of unique) {
    const key = foldVocabKey(v);
    if (!key) continue;
    const list = byFold.get(key) ?? [];
    list.push(v);
    byFold.set(key, list);
  }

  const clusters: NearDupCluster[] = [];
  const clustered = new Set<string>();

  for (const members of byFold.values()) {
    if (members.length < 2) continue;
    for (const m of members) clustered.add(m);
    clusters.push({
      canonical: pickCanonical(members),
      members: [...members].sort((a, b) => a.localeCompare(b)),
      kind: clusterKind(members),
    });
  }

  const leftovers = unique.filter((v) => !clustered.has(v));
  const used = new Set<string>();
  for (let i = 0; i < leftovers.length; i++) {
    const a = leftovers[i];
    if (used.has(a)) continue;
    const foldA = foldVocabKey(a);
    if (foldA.length < 4) continue;
    const group = [a];
    for (let j = i + 1; j < leftovers.length; j++) {
      const b = leftovers[j];
      if (used.has(b)) continue;
      const foldB = foldVocabKey(b);
      if (foldB.length < 4) continue;
      if (Math.abs(foldA.length - foldB.length) > 1) continue;
      if (levenshtein(foldA, foldB) === 1) {
        group.push(b);
      }
    }
    if (group.length < 2) continue;
    for (const m of group) used.add(m);
    clusters.push({
      canonical: pickCanonical(group),
      members: [...group].sort((a, b) => a.localeCompare(b)),
      kind: "edit-distance",
    });
  }

  return clusters.sort((a, b) => a.canonical.localeCompare(b.canonical));
}

/**
 * List parent/child relations for slash-nested values (work + work/project).
 * These are related, not merge candidates.
 */
export function relatedNested(values: string[]): NestedRelation[] {
  const unique = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  const byLower = new Map(unique.map((v) => [v.toLowerCase(), v]));
  const childrenOf = new Map<string, string[]>();

  for (const v of unique) {
    const slash = v.lastIndexOf("/");
    if (slash <= 0) continue;
    const parentKey = v.slice(0, slash).toLowerCase();
    const parent = byLower.get(parentKey);
    if (!parent) continue;
    const list = childrenOf.get(parent) ?? [];
    list.push(v);
    childrenOf.set(parent, list);
  }

  return [...childrenOf.entries()]
    .map(([parent, children]) => ({
      parent,
      children: children.sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.parent.localeCompare(b.parent));
}

/**
 * Split a scan_vault_tags entry into a plain tag or a field:value category.
 * Field pairs use the first colon (status:draft → status / draft).
 */
export function classifyScanTag(
  tag: string,
): { kind: "tag"; value: string } | { kind: "field"; field: string; value: string } {
  const trimmed = tag.trim();
  const colon = trimmed.indexOf(":");
  if (colon > 0 && colon < trimmed.length - 1) {
    const field = trimmed.slice(0, colon).trim().toLowerCase();
    const value = trimmed.slice(colon + 1).trim();
    if (field && value && !field.includes(" ")) {
      return { kind: "field", field, value };
    }
  }
  return { kind: "tag", value: trimmed };
}

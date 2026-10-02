/**
 * Vault search clauses of the form `tag:#recipe` and `-tag:#recipe`.
 *
 * Include clauses must all match. Exclude clauses reject a note that has the value.
 * A leftover plain-text fragment is returned for a content search intersect.
 */

import { classifyScanTag } from "./near-dup-clusters";

export interface TagClause {
  exclude: boolean;
  /** "tag" for the tag list, or a lowercased field name such as "category". */
  field: string;
  value: string;
}

export interface ScanTagEntry {
  tag: string;
  filePaths: string[];
}

const TOKEN = /(-)?([A-Za-z][A-Za-z0-9_-]*):#(?:"([^"]+)"|([^\s"]+))/g;

export function parseTagSearch(query: string): { clauses: TagClause[]; text: string } {
  const clauses: TagClause[] = [];
  const text = query
    .replace(TOKEN, (_full, minus: string | undefined, field: string, quoted?: string, bare?: string) => {
      const value = (quoted ?? bare ?? "").trim();
      if (!value) return " ";
      const normalized = field.toLowerCase() === "tags" ? "tag" : field.toLowerCase();
      clauses.push({ exclude: Boolean(minus), field: normalized, value });
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { clauses, text };
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function marksFor(entries: ScanTagEntry[]): Map<string, Array<{ field: string; value: string }>> {
  const map = new Map<string, Array<{ field: string; value: string }>>();
  const push = (path: string, field: string, value: string): void => {
    const list = map.get(path) ?? [];
    list.push({ field, value });
    map.set(path, list);
  };
  for (const entry of entries) {
    const classified = classifyScanTag(entry.tag);
    const marks =
      classified.kind === "tag"
        ? classified.value
            .split(",")
            .map((part) => part.trim().replace(/,+$/, ""))
            .filter(Boolean)
            .map((value) => ({ field: "tag", value }))
        : [{ field: classified.field, value: classified.value }];
    for (const path of entry.filePaths ?? []) {
      for (const mark of marks) push(path, mark.field, mark.value);
    }
  }
  return map;
}

function noteMatches(
  marks: Array<{ field: string; value: string }>,
  clauses: TagClause[],
): boolean {
  const has = (field: string, value: string): boolean =>
    marks.some((mark) => mark.field === field && sameText(mark.value, value));
  for (const clause of clauses) {
    const hit = has(clause.field, clause.value);
    if (clause.exclude && hit) return false;
    if (!clause.exclude && !hit) return false;
  }
  return true;
}

/**
 * Notes that satisfy every clause in `query`.
 * `knownPaths` is the vault index (so an exclude can return notes that have no tags).
 * Scan paths are included so a tagged note missing from the index still matches an include.
 */
export function filesMatchingTagQuery(
  knownPaths: string[],
  entries: ScanTagEntry[],
  query: string,
): { active: boolean; paths: string[]; text: string } {
  const parsed = parseTagSearch(query);
  if (parsed.clauses.length === 0) {
    return { active: false, paths: [], text: parsed.text };
  }
  const marks = marksFor(entries);
  const universe = new Set<string>([...knownPaths, ...marks.keys()]);
  const paths = [...universe]
    .filter((path) => noteMatches(marks.get(path) ?? [], parsed.clauses))
    .sort((a, b) => a.localeCompare(b));
  return { active: true, paths, text: parsed.text };
}

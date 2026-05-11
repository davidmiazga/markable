---
title: "Step 03 — frontmatter-reader.ts Module"
last-updated: "2026-05-11"
review-cadence-days: 30
status: active
---

# Step 03 — frontmatter-reader.ts Module

## Goal

Create the new `extractFrontmatterKeys` helper module and write T-09 through T-13.
This step has no dependency on `tab.ts` or `table-renderer.ts`.

TDD order: write tests first (RED), then implement (GREEN).

---

## New file: `src/plugins/file-browser/folder-view/frontmatter-reader.ts`

```typescript
/**
 * frontmatter-reader.ts — Lightweight YAML frontmatter key extractor.
 *
 * Extracts a specified set of keys from a Markdown file's YAML frontmatter
 * block. This is intentionally a narrow, fast utility — it does not attempt
 * to parse full YAML and does not reuse parseFolderMd() (which returns a
 * FolderViewConfig, the wrong type for child-file reads).
 *
 * Used by the enrichment phase in tab.ts (FR-09, FR-10).
 *
 * Design:
 *   - Scans between the first "---" and the closing "---".
 *   - For each declared key, matches lines of the form "key: value".
 *   - Strips inline comments (" #...") and surrounding quotes from values,
 *     matching the behaviour of parseYamlLines() for scalar values.
 *   - Never throws; any error returns {}.
 *
 * @module folder-view/frontmatter-reader
 */

/**
 * Extract specific frontmatter keys from the content of a Markdown file.
 *
 * @param content - Raw file content string.
 * @param keys    - Array of YAML key names to extract.
 * @returns A Record mapping each found key to its trimmed string value.
 *          Keys not found in the frontmatter are absent from the result.
 *          If the file has no frontmatter or any error occurs, returns {}.
 */
export function extractFrontmatterKeys(
  content: string,
  keys: string[],
): Record<string, string> {
  try {
    if (!keys.length) return {};

    const trimmed = content.trimStart();
    if (!trimmed.startsWith("---")) return {};

    const afterOpen = trimmed.slice(3);
    const closeIdx = afterOpen.indexOf("\n---");
    if (closeIdx === -1) return {};

    const yamlBlock = afterOpen.slice(0, closeIdx);
    const result: Record<string, string> = {};
    const keySet = new Set(keys);

    for (const raw of yamlBlock.split("\n")) {
      const line = raw.trimEnd();
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;

      // Only consider top-level keys (no leading whitespace).
      if (line.length !== line.trimStart().length) continue;

      const lineKey = line.slice(0, colonIdx).trim();
      if (!keySet.has(lineKey)) continue;

      let value = line.slice(colonIdx + 1).trim();

      // Strip inline comment.
      const commentIdx = value.indexOf(" #");
      if (commentIdx !== -1) value = value.slice(0, commentIdx).trim();

      // Strip surrounding quotes.
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      result[lineKey] = value;
    }

    return result;
  } catch {
    return {};
  }
}
```

---

## File to change: `tests/folder-view/tab.test.ts`

Add a new import at the top of the file (alongside the existing imports):

```typescript
import { extractFrontmatterKeys } from "../../src/plugins/file-browser/folder-view/frontmatter-reader";
```

Append a new `describe` block at the end of the file:

```typescript
describe("extractFrontmatterKeys", () => {
  // T-09 — Key present in frontmatter
  it("T-09: file with 'status: in-progress' returns {status: 'in-progress'}", () => {
    const content = "---\nstatus: in-progress\n---\n# Body";
    expect(extractFrontmatterKeys(content, ["status"])).toEqual({ status: "in-progress" });
  });

  // T-10 — No frontmatter
  it("T-10: file with no frontmatter returns {}", () => {
    const content = "# Just a heading\nNo frontmatter here.";
    expect(extractFrontmatterKeys(content, ["status"])).toEqual({});
  });

  // T-11 — Key absent from frontmatter
  it("T-11: key absent from frontmatter returns {} for that key", () => {
    const content = "---\ntitle: My Note\n---\n";
    expect(extractFrontmatterKeys(content, ["status"])).toEqual({});
  });

  // T-12 — Inline comment stripped
  it("T-12: inline comment stripped: 'status: done # comment' → 'done'", () => {
    const content = "---\nstatus: done # this is a comment\n---\n";
    expect(extractFrontmatterKeys(content, ["status"])).toEqual({ status: "done" });
  });

  // T-13 — Quoted value stripped
  it("T-13: double-quoted value stripped: 'status: \"in-progress\"' → 'in-progress'", () => {
    const content = "---\nstatus: \"in-progress\"\n---\n";
    expect(extractFrontmatterKeys(content, ["status"])).toEqual({ status: "in-progress" });
  });

  it("T-13b: single-quoted value stripped: \"status: 'done'\" → 'done'", () => {
    const content = "---\nstatus: 'done'\n---\n";
    expect(extractFrontmatterKeys(content, ["status"])).toEqual({ status: "done" });
  });

  // EC-04 — No frontmatter delimiters
  it("EC-04: no --- delimiters → returns {}", () => {
    const content = "status: in-progress\nno frontmatter";
    expect(extractFrontmatterKeys(content, ["status"])).toEqual({});
  });

  // EC-05 — Value that looks like a YAML object/sequence is returned as-is
  it("EC-05: list value stored as raw string, no crash", () => {
    const content = "---\ntags: [a, b]\n---\n";
    expect(() => extractFrontmatterKeys(content, ["tags"])).not.toThrow();
    // The exact value is implementation-defined; it must be a string.
    const result = extractFrontmatterKeys(content, ["tags"]);
    expect(typeof result["tags"]).toBe("string");
  });

  // Multiple keys at once
  it("extracts multiple keys in one pass", () => {
    const content = "---\nstatus: done\npriority: high\ntitle: My Note\n---\n";
    expect(extractFrontmatterKeys(content, ["status", "priority"])).toEqual({
      status: "done",
      priority: "high",
    });
  });

  // Empty keys array
  it("empty keys array returns {} immediately", () => {
    const content = "---\nstatus: done\n---\n";
    expect(extractFrontmatterKeys(content, [])).toEqual({});
  });
});
```

---

## Tests to run after this step

```bash
npm run test:run -- tests/folder-view/tab.test.ts
```

T-09 through T-13 plus the supplementary tests must be green. Existing tab.ts
tests must still pass.

---

## Definition of done

- `src/plugins/file-browser/folder-view/frontmatter-reader.ts` compiles and exports
  `extractFrontmatterKeys`.
- All T-09 through T-13 tests pass.
- All pre-existing `tab.test.ts` tests pass.
- The function never throws (any error path returns `{}`).

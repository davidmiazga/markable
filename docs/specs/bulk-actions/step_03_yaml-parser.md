---
title: "Step 03 — YAML Frontmatter Parser and Writer"
last-updated: "2026-05-11"
review-cadence-days: 7
status: active
---

# Step 03 — YAML Frontmatter Parser and Writer

## Goal

Replace the four stubs in `yaml-frontmatter.ts` with working implementations.
Write comprehensive unit tests covering all YAML edge cases from the
requirements (EC-08 through EC-24).

This step has no DOM dependencies and no Tauri dependencies. It can be tested
in complete isolation.

---

## Files to Modify

### `src/plugins/file-browser/folder-view/yaml-frontmatter.ts`

Replace the stub implementations with the following concrete implementations.

#### `parseYamlFrontmatter(content: string)`

Algorithm:

1. Split content into lines: `content.split("\n")`.
2. If the first line (trimmed) is not exactly `---`, return
   `{ hasFrontmatter: false, malformed: false, frontmatterLines: [], bodyLines: lines }`.
3. Search lines[1..] for the closing `---`. The closing delimiter line must be
   exactly `---` after trimming.
4. If no closing `---` is found, return
   `{ hasFrontmatter: false, malformed: true, frontmatterLines: [], bodyLines: lines }`.
5. Otherwise: `frontmatterLines = lines[1..closingIndex-1]` (lines between the
   two `---` lines, not including the delimiter lines themselves).
   `bodyLines = lines[closingIndex+1..]`.
   Return `{ hasFrontmatter: true, malformed: false, frontmatterLines, bodyLines }`.

Edge cases:
- A file whose content is exactly `---\n---\n` has `frontmatterLines: []` and
  `bodyLines: []`.
- A value that contains `---` inside a quoted string (`key: "--- not a delim"`)
  is never a delimiter line — the delimiter check is exact: the entire trimmed
  line is `---`, not just a prefix. So `key: "---"` is a safe key-value line
  that will not trigger closure (EC-24).

**Return type:**

```typescript
export function parseYamlFrontmatter(
  content: string,
): ParsedFile & { malformed: boolean }
```

#### `applyYamlKey(frontmatterLines: string[], key: string, value: string): string[]`

Algorithm:

1. Determine the serialized value string:
   - If `value` contains `:` or starts/ends with whitespace: wrap in double
     quotes, escaping any existing `"` with `\"`: `"${value.replace(/"/g, '\\"')}"`.
   - Otherwise: use `value` as-is.
2. Construct the new line: `${key}: ${serializedValue}`.
3. Search `frontmatterLines` for a line whose leading characters match
   `${key}:` followed by a space or end-of-string. Use a simple prefix check:
   `line === key + ":" || line.startsWith(key + ": ") || line.startsWith(key + ":\t")`.
4. If found: replace that element in a copy of the array with the new line.
5. If not found: append the new line to a copy of the array.
6. Return the modified copy (do not mutate the input).

#### `removeYamlKey(frontmatterLines: string[], key: string): string[]`

Algorithm:

1. Filter `frontmatterLines` to exclude any line that starts with
   `${key}:` followed by space, tab, or end-of-string.
2. Return the filtered copy (do not mutate).
3. If no such line exists, return an identical copy (not an error — EC-09).

#### `reconstructFile(parsed: ParsedFile): string`

Algorithm:

```
if parsed.hasFrontmatter && parsed.frontmatterLines.length > 0:
  return "---\n"
       + parsed.frontmatterLines.join("\n")
       + "\n---\n"
       + parsed.bodyLines.join("\n")

if parsed.hasFrontmatter && parsed.frontmatterLines.length === 0:
  // EC-23: empty frontmatter block removed entirely.
  return parsed.bodyLines.join("\n")

if !parsed.hasFrontmatter:
  return parsed.bodyLines.join("\n")
```

Note: the body lines already include a trailing empty string if the original
file ended with a newline (because `"a\n".split("\n")` yields `["a", ""]`).
`reconstructFile` must not add an extra newline — it only reassembles what
`parseYamlFrontmatter` split.

---

## Files to Create

### `tests/folder-view/yaml-frontmatter.test.ts`

```typescript
/**
 * tests/folder-view/yaml-frontmatter.test.ts
 *
 * Unit tests for the line-oriented YAML frontmatter parser and writer.
 *
 * Covers FR-6, EC-08 through EC-24.
 */

import { describe, it, expect } from "vitest";
import {
  parseYamlFrontmatter,
  applyYamlKey,
  removeYamlKey,
  reconstructFile,
} from "../../src/plugins/file-browser/folder-view/yaml-frontmatter";
```

Tests to implement (each as a separate `it()` block):

**parseYamlFrontmatter:**

| Test ID | Description | Input | Expected output |
|---|---|---|---|
| P-01 | File with frontmatter and body | `---\ntitle: hello\n---\nBody text` | `hasFrontmatter:true, malformed:false, frontmatterLines:["title: hello"], bodyLines:["Body text"]` |
| P-02 | File with no frontmatter | `Just content` | `hasFrontmatter:false, malformed:false, bodyLines:["Just content"]` |
| P-03 | File with empty frontmatter block | `---\n---\nBody` | `hasFrontmatter:true, frontmatterLines:[], bodyLines:["Body"]` |
| P-04 | Malformed: opening --- no close | `---\ntitle: x` | `hasFrontmatter:false, malformed:true` |
| P-05 | Value containing --- does NOT close block (EC-24) | `---\nkey: "--- not a delim"\n---\nbody` | `hasFrontmatter:true, frontmatterLines:['key: "--- not a delim"'], bodyLines:["body"]` |
| P-06 | Multiple key lines preserved | `---\na: 1\nb: 2\nc: 3\n---\n` | `hasFrontmatter:true, frontmatterLines:["a: 1","b: 2","c: 3"]` |
| P-07 | File that is empty string | `""` | `hasFrontmatter:false, malformed:false, bodyLines:[""]` |
| P-08 | Body begins immediately after closing --- | `---\nk: v\n---\nLine1\nLine2` | `bodyLines:["Line1","Line2"]` |

**applyYamlKey:**

| Test ID | Description | Input | Expected |
|---|---|---|---|
| A-01 | Add new key (not present) | lines=[], key="status", value="done" | `["status: done"]` |
| A-02 | Update existing key | lines=["status: old"], key="status", value="new" | `["status: new"]` |
| A-03 | Value with colon is quoted (EC-13) | key="desc", value="foo: bar" | line is `desc: "foo: bar"` |
| A-04 | Value with leading whitespace is quoted (EC-13) | value=" padded" | line contains double-quoted value |
| A-05 | Value with trailing whitespace is quoted | value="padded " | line contains double-quoted value |
| A-06 | Value containing --- is quoted (EC-24) | value="--- heading" | line is `key: "--- heading"` |
| A-07 | Normal value without colon or whitespace | value="active" | line is `key: active` (no quotes) |
| A-08 | Does not mutate input array | input=["a: 1"], call applyYamlKey → input still has length 1 unchanged | |
| A-09 | Existing quote in value is escaped | value='say "hi"' | written as `key: "say \"hi\""` |

**removeYamlKey:**

| Test ID | Description | Input | Expected |
|---|---|---|---|
| R-01 | Remove existing key | lines=["status: done", "title: x"], key="status" | `["title: x"]` |
| R-02 | Key absent — no error, returns copy (EC-09) | lines=["title: x"], key="status" | `["title: x"]` (unchanged) |
| R-03 | Does not mutate input array | | |
| R-04 | Removes only the matching key line, preserves others | lines=["a: 1","b: 2","a-extra: 3"], key="a" | removes "a: 1" only, keeps "b: 2" and "a-extra: 3" |

**reconstructFile:**

| Test ID | Description | Input | Expected |
|---|---|---|---|
| RC-01 | Roundtrip: parse then reconstruct preserves content | `---\ntitle: x\n---\nBody\n` | output === input |
| RC-02 | Empty frontmatter block is removed (EC-23) | `{ hasFrontmatter:true, frontmatterLines:[], bodyLines:["Body"] }` | `"Body"` |
| RC-03 | No frontmatter — body returned as-is | `{ hasFrontmatter:false, frontmatterLines:[], bodyLines:["Hello"] }` | `"Hello"` |
| RC-04 | Non-.md file (no frontmatter) roundtrips cleanly | parse "plain text file" → reconstruct → same | |

---

## Acceptance Criteria

1. All tests in `tests/folder-view/yaml-frontmatter.test.ts` pass.
2. `parseYamlFrontmatter` returns `malformed:true` for files with an opening
   `---` but no closing `---`.
3. A line like `key: "--- not a delimiter"` does NOT cause `parseYamlFrontmatter`
   to close the block prematurely.
4. `applyYamlKey` quotes values containing `:` or leading/trailing whitespace.
5. `removeYamlKey` leaves the array unchanged when the key is absent.
6. `reconstructFile` with an empty `frontmatterLines` produces body-only output
   (no `---\n---\n` stub).
7. No function mutates its input array.
8. `npm run test:run -- tests/folder-view/yaml-frontmatter.test.ts` passes.

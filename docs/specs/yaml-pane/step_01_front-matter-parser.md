---
title: "YAML Pane — Step 01: Front Matter Parser"
last-updated: "2026-04-17"
review-cadence-days: 7
status: active
---

# Step 01 — Front Matter Parser

## Goal

Implement and test all **pure parsing functions** that take a CM6 document string and produce the `FrontMatterParseResult` discriminated union. No DOM, no CM6 globals, no Tauri invocations in this step.

These functions are the single source of truth for front matter detection and field modeling. Every downstream component (write-back, DOM renderer, CM6 listener) consumes the types defined here.

---

## Files to Create / Modify

| Action | File |
|---|---|
| Create | `src/plugins/yaml-pane/yaml-pane.plugin.ts` (scaffolded — types + parser only) |
| Create | `tests/plugins/yaml-pane/yaml-pane.test.ts` (parser tests only at this step) |
| Modify | `package.json` — add `js-yaml` and `@types/js-yaml` dependencies |

### Install command (run before implementing)

```bash
npm install js-yaml
npm install --save-dev @types/js-yaml
```

---

## Interfaces and Types to Define

Define these at the top of `yaml-pane.plugin.ts`, exported for test imports. All are pure TypeScript — no CM6 or DOM imports at this level.

```typescript
export type YamlFieldType =
  | "string"
  | "number"
  | "boolean"
  | "date"
  | "array"
  | "object"
  | "null";

export interface YamlField {
  /** The YAML key exactly as it appears in the source (unquoted display form). */
  key: string;
  /** The JS-parsed value. Arrays are string[] after coercion. */
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

export type FrontMatterParseResult =
  | { kind: "none" }
  | { kind: "error"; message: string }
  | {
      kind: "ok";
      fields: YamlField[];
      originalLines: string[];   // lines between the --- delimiters (excluding delimiters)
      closingOffset: number;     // char offset of the end of the closing --- line in the document
    };
```

---

## Functions to Implement

All functions are pure and exported for test imports.

### `detectFrontMatterBlock(docText: string): { innerText: string; closingOffset: number } | null`

Detects whether `docText` begins with a valid YAML front matter block.

Rules (from FR-1.1 and EC-25):
1. Split `docText` on `\n`. The first line, trimmed of whitespace, must equal `---`.
2. Scan subsequent lines for the first line whose trimmed content equals `---` or `...`. This is the closing delimiter.
3. If no closing delimiter is found, return `null` (EC-3).
4. `innerText` is the text between the two delimiter lines (lines 1 through N-1), joined with `\n`.
5. `closingOffset` is the character offset of the end of the closing delimiter line in `docText`:
   - Sum of lengths of all preceding lines plus their `\n` separators, plus the closing line's length.
   - This is the `to` position for the CM6 transaction (FR-1.5).

Edge cases:
- `docText` is empty → `null`
- Opening `---` has trailing whitespace → still valid (EC-25 whitespace tolerance)
- Closing delimiter on line 2 (empty front matter block) → `innerText` is `""`, `closingOffset` points to end of line 2 (EC-4)

### `parseFrontMatter(docText: string): FrontMatterParseResult`

Top-level parser. Calls `detectFrontMatterBlock`, then `js-yaml`'s `load()`.

1. Call `detectFrontMatterBlock(docText)`. If `null` → return `{ kind: "none" }`.
2. Call `jsYaml.load(innerText, { schema: jsYaml.CORE_SCHEMA })`.
   - If `load()` throws → return `{ kind: "error", message: error.message }`.
   - If result is `null` or `undefined` (empty block, EC-4/EC-5) → treat as `{}` (empty mapping), proceed with empty `fields` array.
   - If result is not an object (e.g. a scalar YAML value) → return `{ kind: "error", message: "Front matter must be a YAML mapping" }`.
3. Call `buildFieldModel(parsedObject, originalLines)` to produce `YamlField[]`.
4. Return `{ kind: "ok", fields, originalLines, closingOffset }`.

### `buildFieldModel(parsed: Record<string, unknown>, originalLines: string[]): YamlField[]`

Converts the raw `js-yaml` output into `YamlField[]`. Preserves key order (Object.entries preserves insertion order for string keys in V8).

For each `[key, value]` pair:
1. Determine `rawType` using `inferType(value, originalLines, key)`.
2. Find `lineIndex` using `findKeyLineIndex(originalLines, key)`.
3. Detect `isBlockScalar` using `detectBlockScalar(originalLines, lineIndex)`.
4. Push `{ key, value, rawType, lineIndex, isBlockScalar }`.

### `inferType(value: unknown, originalLines: string[], key: string): YamlFieldType`

Infers the field type from its parsed JS value:

| Condition | YamlFieldType |
|---|---|
| `value === null` or `value === undefined` | `"null"` |
| `typeof value === "boolean"` | `"boolean"` |
| `typeof value === "number"` | `"number"` |
| `Array.isArray(value)` | `"array"` |
| `typeof value === "object"` | `"object"` |
| `typeof value === "string"` and matches `/^\d{4}-\d{2}-\d{2}$/` | `"date"` |
| `typeof value === "string"` (otherwise) | `"string"` |

Note: `js-yaml` with `CORE_SCHEMA` does NOT auto-convert date strings to `Date` objects. Date strings remain as strings; we detect them by regex. This is intentional — prevents silent type coercion of user data.

### `findKeyLineIndex(lines: string[], key: string): number`

Scans `lines` for a line matching the pattern `^{key}\s*:` at the start of the line (top-level key, no leading whitespace). Returns the 0-based index of the first match, or `-1` if not found.

Implementation: use `RegExp` constructed as `new RegExp('^' + escapeRegExp(key) + '\\s*:')` where `escapeRegExp` escapes special regex characters in the key name.

### `detectBlockScalar(lines: string[], lineIndex: number): boolean`

If `lineIndex` is `-1`, return `false`. Otherwise check if `lines[lineIndex]` matches `/:\s*[|>](\s*#.*)?$/` (the value portion of the line is a block scalar indicator, optionally followed by an inline comment). Return `true` if matched.

### `escapeRegExp(str: string): string`

Escapes special regex metacharacters in a string. Standard implementation:
```
return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
```

Exported for test coverage.

---

## Test Cases to Write First (Red Phase)

File: `tests/plugins/yaml-pane/yaml-pane.test.ts`

### Group: `detectFrontMatterBlock`

```
1. Empty string → null
2. Document with no --- → null
3. Document starting with "---\n---\n" (empty block) → { innerText: "", closingOffset: 7 }
4. Document "---\ntitle: Foo\n---\n# Content" → { innerText: "title: Foo", closingOffset: 18 }
5. Document "---\ntitle: Foo" (no closing ---) → null
6. Document "---   \ntitle: Foo\n---\n" (trailing whitespace on opener) → valid (EC-25)
7. Document "---\ntitle: Foo\n...\n# Content" (... as closer) → valid
8. Closing offset calculation: verify the offset points to the character after the closing --- line
```

### Group: `parseFrontMatter`

```
9.  Plain text (no front matter) → { kind: "none" }
10. "---\n---\n" (empty block) → { kind: "ok", fields: [] }
11. "---\n# comment only\n---\n" → { kind: "ok", fields: [] }  (EC-5)
12. "---\ntitle: Hello\n---\n" → { kind: "ok", fields: [{ key: "title", value: "Hello", rawType: "string" }] }
13. "---\ncount: 42\n---\n" → rawType: "number"
14. "---\ndraft: true\n---\n" → rawType: "boolean"
15. "---\ndate: 2026-04-17\n---\n" → rawType: "date"
16. "---\ntags:\n  - a\n  - b\n---\n" → rawType: "array", value: ["a", "b"]
17. "---\nmeta:\n  author: Alice\n---\n" → rawType: "object"
18. "---\n\ttitle: bad tab\n---\n" → { kind: "error", ... }  (tab indentation invalid YAML)
19. Front matter is a scalar, not a mapping: "---\njust a string\n---\n" → { kind: "error", message contains "mapping" }
20. "---\nvalue: null\n---\n" → rawType: "null"
```

### Group: `inferType`

```
21. null → "null"
22. undefined → "null"
23. true → "boolean"
24. false → "boolean"
25. 42 → "number"
26. 3.14 → "number"
27. [] → "array"
28. ["a"] → "array"
29. {} → "object"
30. "2026-04-17" → "date"
31. "2026-4-17" (not ISO 8601) → "string"
32. "hello" → "string"
33. "" → "string"
```

### Group: `findKeyLineIndex`

```
34. lines=["title: Hello", "date: 2026-04-17"], key="title" → 0
35. lines=["title: Hello", "date: 2026-04-17"], key="date" → 1
36. lines=["title: Hello"], key="missing" → -1
37. lines=["title: Hello"], key="titl" → -1 (no partial match)
38. key with regex special chars e.g. "tags.v2" → correctly escaped, no throws
39. lines=["  indented: value"], key="indented" → -1 (not top-level key, has leading space)
```

### Group: `detectBlockScalar`

```
40. lines=["desc: |", "  Line one."], lineIndex=0 → true
41. lines=["desc: >", "  Folded."], lineIndex=0 → true
42. lines=["title: Hello"], lineIndex=0 → false
43. lineIndex=-1 → false
44. lines=["desc: | # comment"], lineIndex=0 → true (inline comment after |)
```

### Group: `buildFieldModel` (integration)

```
45. Parsed {"title": "Hello", "date": "2026-04-17"} with matching lines → two fields, correct lineIndex
46. Field ordering preserved: Object.entries order matches YAML source order
47. Block scalar field detected: "desc: |" → isBlockScalar=true
48. Nested object field detected: rawType="object"
```

---

## Implementation Notes

1. **`js-yaml` import in the plugin file:** Use `import jsYaml from 'js-yaml'` (default import for CJS compat). Vite will bundle this correctly into the IIFE with zero externals (non-`@codemirror` deps are not external in `build-plugins.mjs`).

2. **Type import pattern:** The existing `import type { MarkablePluginAPI }` pattern (seen in `backlinks.plugin.ts`) is the model. All type-only imports are safe because `tsc` erases them.

3. **`CORE_SCHEMA` usage:** Pass `{ schema: jsYaml.CORE_SCHEMA }` to `jsYaml.load()`. This disables timestamp auto-parsing and other implicit type coercions. Date strings stay as strings; booleans are still parsed correctly.

4. **Handling `js-yaml` anchor/alias detection (Out of Scope):** If the `innerText` contains `&` (anchor) or `*` (alias) characters at the start of a word following YAML value syntax, we do not attempt to detect or block them. `js-yaml` handles anchors/aliases correctly in its parser — the plugin just does not provide editing UI for them. Fields with anchor/alias values will show as `rawType: "object"` or `rawType: "string"` depending on the resolved value. No special handling needed for MVP.

5. **Test file setup:** The test file imports pure functions directly from `yaml-pane.plugin.ts` by their named exports. No window globals, no Tauri invocations, no DOM required for these tests. Vitest's `jsdom` environment is not needed — use `environment: 'node'` for this test file or rely on the default.

---

## Acceptance Criteria

- [ ] All 48 test cases pass (`npm test`)
- [ ] `detectFrontMatterBlock` correctly handles all delimiter variants and returns accurate `closingOffset`
- [ ] `parseFrontMatter` returns the correct discriminated union kind for all document types
- [ ] `inferType` returns `"date"` only for strict ISO 8601 `YYYY-MM-DD` strings
- [ ] `findKeyLineIndex` does not match indented keys or partial key names
- [ ] `detectBlockScalar` correctly identifies `|` and `>` block scalar syntax
- [ ] No `window`, `document`, or `__CM_VIEW__` globals accessed in any function in this step
- [ ] `js-yaml` installed and importable (`npm ls js-yaml` shows version ^4.x)

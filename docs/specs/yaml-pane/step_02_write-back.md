---
title: "YAML Pane — Step 02: Write-back Engine"
last-updated: "2026-04-17"
review-cadence-days: 7
status: active
---

# Step 02 — Write-back Engine

## Goal

Implement and test the **pure write-back functions** that convert an edited field model back into a YAML front matter string, and the **CM6 dispatch function** that applies that string to the editor document.

No DOM, no sidebar rendering in this step. The write-back engine is a pure transformation layer that sits between the field model (Step 01) and the panel (Step 04).

---

## Files to Modify

| Action | File |
|---|---|
| Modify | `src/plugins/yaml-pane/yaml-pane.plugin.ts` — add write-back functions |
| Modify | `tests/plugins/yaml-pane/yaml-pane.test.ts` — add write-back tests |

---

## Context: Two-Tier Write-back Strategy (AD-2)

The write-back has two tiers:

**Tier 1 — Scalar in-place rewrite** (string, number, boolean, date, null → scalar):
When a field's value changes to a new scalar, its line in `originalLines` is rewritten in-place. All other lines are forwarded verbatim. Result: no structural change, surrounding lines and comments preserved.

**Tier 2 — Full re-serialization** (structural changes):
When a field is deleted, a new field is added, or a value type changes structurally (scalar → array, array item added/removed), the entire front matter block is re-serialized from the in-memory model using `js-yaml.dump()`. Comments within the modified block are lost (documented Out of Scope).

The discriminator: `buildFrontMatterString` decides tier based on the `changeType` parameter passed by the panel.

---

## Functions to Implement

All functions are pure and exported for test imports. None access `window` globals.

### `rewriteScalarLine(line: string, newValue: unknown): string`

Rewrites the value portion of a `key: value` YAML line.

Input: the full original line (e.g., `title: Old Value  # comment`).

Algorithm:
1. Find the `:` separator (first `:` in the line, which separates key from value).
2. Extract the key portion (including the `:`): everything up to and including the first `:`.
3. Check for an inline comment: scan from the end of the value for a ` #` pattern that is not inside a quoted string. If found, preserve it.
4. Format the new value using `formatScalarValue(newValue)`.
5. Return `keyPortion + " " + formattedValue` (plus preserved inline comment if any).

Edge cases:
- Quoted keys (e.g., `"true": value`) — the colon detector must skip the colon inside quotes.
- Practical simplification: since we only call `rewriteScalarLine` for fields we found via `findKeyLineIndex` (which only matches lines without leading whitespace), the key is always unquoted in our use case. A simple "first colon" rule is sufficient.

### `formatScalarValue(value: unknown): string`

Converts a JS value to its YAML-compatible inline string representation.

| Value type | Output |
|---|---|
| `string` that requires quoting (contains `:`, `#`, `[`, `]`, `{`, `}`, `&`, `*`, `!`, `|`, `>`, `'`, `"`, `%`, `@`, `` ` ``, or starts/ends with whitespace, or is a YAML reserved word like `true`/`false`/`null`/`~`) | Wrap in double quotes, escape internal double quotes with `\"` |
| `string` (safe, no special chars) | Output verbatim |
| `number` | `String(value)` |
| `boolean` | `"true"` or `"false"` |
| `null` | `"null"` |
| `Date` | ISO 8601 string (should not occur since we use CORE_SCHEMA, but defensive) |

**YAML string quoting rule (simplified for scalar values):** A string is "safe" and does not require quoting if:
- It does not contain any of: `: # [ ] { } & * ! | > ' " % @ ` (backtick) `\n`
- It does not match a YAML boolean/null/tilde literal: `true`, `false`, `null`, `~`, `yes`, `no`, `on`, `off` (case-insensitive)
- It does not start or end with whitespace
- It is not the empty string (empty string should be quoted as `""`)

### `requiresQuoting(str: string): boolean`

Pure helper extracted from `formatScalarValue`. Returns `true` if `str` needs to be wrapped in YAML double quotes.

Export this function for direct test coverage.

### `serializeFrontMatter(fields: YamlField[]): string`

Full re-serialization of a field array into a YAML string (without delimiters).

Algorithm:
1. Build a plain JS object from `fields` in order, preserving key order.
2. For array fields: ensure the value is an actual array.
3. For block scalar fields (`isBlockScalar === true`): use `jsYaml.dump()` with `{ lineWidth: -1, flowLevel: -1 }` settings — the `|` style is set per-key by passing the field value as a multi-line string, which `js-yaml` will auto-detect and emit with block scalar syntax.
4. Call `jsYaml.dump(obj, { lineWidth: -1, indent: 2, noCompatMode: true })`.
5. Trim trailing newline added by `js-yaml`.

Note: `jsYaml.dump()` does not support per-key style overrides in the standard API. For block scalars, the workaround is to embed the multi-line string as-is — `js-yaml` will use block style when the string contains newlines. This means block scalar content is round-tripped correctly.

### `buildFrontMatterString(fields: YamlField[], originalLines: string[], changeType: FrontMatterChangeType): string`

The top-level write-back function. Returns the full front matter string including delimiters.

```typescript
type FrontMatterChangeType =
  | { kind: "scalar-edit"; key: string; newValue: unknown }
  | { kind: "structural" };   // add field, delete field, array mutation
```

Algorithm:

For `kind === "scalar-edit"`:
1. Find the field's `lineIndex` in `fields`.
2. Clone `originalLines`.
3. If `lineIndex >= 0`: call `rewriteScalarLine(originalLines[lineIndex], newValue)` and replace that line.
4. If `lineIndex === -1` (new field not yet in original): append a new line `key: value` to the clone.
5. Join lines with `\n`.
6. Wrap: `"---\n" + innerYaml + "\n---\n"`.

For `kind === "structural"`:
1. Call `serializeFrontMatter(fields)`.
2. Wrap: `"---\n" + serialized + "\n---\n"`.

### `dispatchFrontMatterUpdate(newFrontMatterString: string, closingOffset: number): void`

Dispatches the CM6 transaction that replaces the front matter block in the editor document.

**This is the one function in this step that accesses a window global.** It is kept separate from the pure functions so that tests can mock it or call the pure functions without it.

```typescript
function dispatchFrontMatterUpdate(
  newFrontMatterString: string,
  closingOffset: number
): void {
  const view = (window as any).__MARKABLE_EDITOR_VIEW__;

  // EC-20: guard against destroyed view
  if (!view || !view.state || view.state.doc.length === 0) return;

  view.dispatch({
    changes: {
      from: 0,
      to: closingOffset,
      insert: newFrontMatterString,
    },
    // NFR-3: each committed edit is one undo step
    userEvent: "yaml-pane.edit",
  });
}
```

Note on `userEvent`: setting this to `"yaml-pane.edit"` ensures CM6's history groups this as one undo step per commit. It also allows the update listener (Step 05) to detect when a transaction was self-dispatched and optionally skip re-rendering for that specific update (optimization for Step 05, not required for correctness).

### `requiresYamlKeyQuoting(key: string): boolean`

Determines whether a YAML key requires quoting. Used when adding new fields via "Add Field" (EC-22).

A key requires quoting if:
- It contains any of: `: # [ ] { } , \n` or starts/ends with whitespace
- It matches a YAML scalar literal: `null`, `true`, `false`, `~`, `yes`, `no`, `on`, `off` (case-insensitive)
- It is an empty string

Returns the key wrapped in double quotes (with internal double quotes escaped) if quoting is needed; otherwise returns the key unchanged. Note: this function returns the *quoted form* of the key, not just a boolean — rename the boolean helper `needsKeyQuoting(key)` and the formatter `formatYamlKey(key): string` for clarity.

Implement both:
- `needsKeyQuoting(key: string): boolean`
- `formatYamlKey(key: string): string` — returns quoted or unquoted form

---

## Test Cases to Write First (Red Phase)

### Group: `requiresQuoting`

```
1.  "hello" → false
2.  "hello world" (no special chars, has space — space alone is safe in YAML values) → false
3.  "key: value" (contains colon) → true
4.  "# comment" (starts with #) → true
5.  "[array]" → true
6.  "{map}" → true
7.  "true" → true (YAML boolean reserved)
8.  "false" → true
9.  "null" → true
10. "True" → true (case-insensitive)
11. "NULL" → true
12. "" (empty string) → true
13. "  leading space" → true
14. "trailing space  " → true
15. "safe-string-with-dashes" → false
16. "safe_string_with_underscores" → false
17. "2026-04-17" (date-like string, safe in values) → false
18. "yes" → true (YAML 1.1 boolean)
19. "no" → true
```

### Group: `formatScalarValue`

```
20. "hello" → "hello"
21. "title: My Doc" → "\"title: My Doc\""
22. true → "true"
23. false → "false"
24. null → "null"
25. 42 → "42"
26. 3.14 → "3.14"
27. "" → "\"\""
28. "She said \"hi\"" (contains double quote) → properly escaped
```

### Group: `rewriteScalarLine`

```
29. "title: Old Title" with newValue "New Title" → "title: New Title"
30. "count: 5" with newValue 10 → "count: 10"
31. "draft: false" with newValue true → "draft: true"
32. "title: Old" with newValue "Has: Colon" → "title: \"Has: Colon\""
33. "title: Old  # important" with newValue "New" → "title: New  # important"
    Note: comment preservation in rewriteScalarLine is a best-effort feature;
    the implementation may or may not preserve it — document the behavior in
    the test. If the implementation does NOT preserve inline comments (simpler),
    the test asserts "title: New" and this is acceptable per Out of Scope item 9.
```

### Group: `buildFrontMatterString` — scalar-edit tier

```
34. Single field "title: Hello", edit title to "World" →
    "---\ntitle: World\n---\n"

35. Two fields, edit first field only → second field line unchanged, comment on second field preserved

36. Field with lineIndex=-1 (new field, not yet in original source) → appended to end

37. Empty originalLines, scalar-edit → structural fallback (or handled gracefully)
```

### Group: `buildFrontMatterString` — structural tier

```
38. Add new field to existing model → js-yaml dump contains all fields

39. Delete field from model → deleted field absent from output

40. Array field ["a", "b", "c"] → serialized as YAML sequence

41. Field order preserved in output (js-yaml dump preserves insertion order)
```

### Group: `serializeFrontMatter`

```
42. Single string field → "title: Hello\n" (no leading ---)
43. Number field → "count: 42\n"
44. Boolean field → "draft: true\n"
45. Array field → "tags:\n  - a\n  - b\n" (block sequence, not inline)
46. Multi-line string (block scalar) → emitted with | syntax when string contains \n
47. Empty fields array → "" (empty string, results in "---\n\n---\n" when wrapped)
```

### Group: `needsKeyQuoting` / `formatYamlKey`

```
48. "title" → false / "title"
49. "my key" (has space) → false / "my key"  
    Note: YAML key spaces are valid without quoting in most parsers. Revisit this.
    Actually "my key" as a key IS valid YAML — only special chars force quoting.
    Test: "my:key" (colon in key) → true / "\"my:key\""
50. "null" → true / "\"null\""
51. "true" → true / "\"true\""
52. "" (empty key) → true / "\"\""
53. "valid-key_123" → false / "valid-key_123"
```

### Group: `dispatchFrontMatterUpdate` (mock-based test)

```
54. With a mock window.__MARKABLE_EDITOR_VIEW__ that has a spy on dispatch:
    calling dispatchFrontMatterUpdate("---\ntitle: X\n---\n", 20) calls
    view.dispatch with { changes: { from: 0, to: 20, insert: "---\ntitle: X\n---\n" } }

55. With window.__MARKABLE_EDITOR_VIEW__ = undefined → no throw, silent no-op

56. With view.state.doc.length === 0 → no dispatch called (EC-20 guard)
```

---

## Implementation Notes

1. **`js-yaml.dump()` options for correct front matter output:**
   ```typescript
   jsYaml.dump(obj, {
     lineWidth: -1,      // no line wrapping
     indent: 2,          // 2-space indent for nested/array values
     noCompatMode: true, // use YAML 1.2 output (no !! tags)
     flowLevel: -1,      // always use block style (never inline {key: val})
   })
   ```
   This produces clean Obsidian-compatible front matter with `tags:` as a block sequence, not `tags: [a, b, c]`.

2. **Block scalar round-trip:** `js-yaml.dump()` auto-detects multi-line strings and emits `|` block style when `lineWidth: -1`. Strings containing `\n` will be emitted as block scalars automatically. This handles EC-7 correctly without requiring per-key style configuration.

3. **Inline comment preservation in `rewriteScalarLine`:** This is genuinely hard to do correctly (requires parsing quoted strings to find the comment start). For MVP, implement a simple version that does NOT preserve inline comments — the value portion of the line is everything after the first `: ` and is replaced wholesale. Document this in a comment: `// Note: inline comments on modified lines are not preserved (see Out of Scope item 9).`

4. **Test isolation for `dispatchFrontMatterUpdate`:** Use `vi.stubGlobal('__MARKABLE_EDITOR_VIEW__', mockView)` in Vitest to mock the global. Clean up with `vi.unstubAllGlobals()` in `afterEach`.

5. **`userEvent` on CM6 transaction:** Setting `userEvent: "yaml-pane.edit"` is the mechanism for the update listener (Step 05) to identify self-dispatched transactions and suppress re-rendering. The string value is arbitrary but must be consistent between this step and Step 05. Define it as a module-level constant: `const YAML_PANE_USER_EVENT = "yaml-pane.edit"` and export it for use in Step 05.

---

## Acceptance Criteria

- [ ] All write-back test cases pass
- [ ] `formatScalarValue` never produces unquoted output for YAML-reserved strings
- [ ] `buildFrontMatterString` always produces a string starting with `---\n` and ending with `\n---\n`
- [ ] `serializeFrontMatter` with `flowLevel: -1` always produces block sequences (not `[a, b, c]`)
- [ ] `dispatchFrontMatterUpdate` is guarded against null/destroyed views (EC-20)
- [ ] The `YAML_PANE_USER_EVENT` constant is exported and documented
- [ ] No `document` or sidebar globals accessed in any pure function

---
title: "step_02 — Parser"
last-updated: "2026-05-11"
review-cadence-days: 30
status: active
---

# Step 02 — Parser

## Goal

Add `BUILTIN_FIELDS`, `extractFieldsRaw()`, and the `config.fields` /
derived-`extraFields` logic to `parser.ts`. When `fields:` is absent or empty,
all existing behaviour is identical to today. When `fields:` is present and
non-empty, `config.fields` is set to the extracted string array and
`config.extraFields` is derived from the non-builtin items in that array.

---

## File to Change

`src/plugins/file-browser/folder-view/parser.ts`

---

## Precise Changes

### 1. Add `BUILTIN_FIELDS` constant

Insert after the `VALID_SORTS` constant (around line 23), before the
`parseAspectRatio` function:

```typescript
/**
 * Set of built-in column identifiers for the folder-table fields: sequence.
 * Any identifier not in this set is treated as a custom frontmatter key.
 * Used by extractFieldsRaw-derived logic in parseFolderMd() (FR-04).
 */
const BUILTIN_FIELDS = new Set(["name", "type", "ext", "modified", "tags", "count"]);
```

Export this constant so `table-renderer.ts` can import it (it needs to
classify field identifiers during column construction). Add `export` to
the declaration:

```typescript
export const BUILTIN_FIELDS = new Set(["name", "type", "ext", "modified", "tags", "count"]);
```

### 2. Add `extractFieldsRaw` private function

Insert immediately after the closing brace of `extractExtraFieldsRaw` (around
line 262). This is a private (non-exported) function:

```typescript
/**
 * Extract raw fields: items from YAML lines at any indentation level.
 *
 * Parallel to extractExtraFieldsRaw() but simpler: fields: items are always
 * plain strings. No structured sub-key (key:/label:) syntax is supported.
 *
 * Algorithm:
 * 1. Find the first line whose trimmed form starts with "fields:" with no
 *    inline value after the colon (same approach as extractExtraFieldsRaw).
 * 2. Collect subsequent more-indented "- item" lines.
 * 3. Strip inline comments (" #...") and surrounding quotes from each item.
 * 4. Skip blank items after stripping.
 * 5. Return the collected string[] (empty array when key is absent or has
 *    no items).
 *
 * @param lines - Raw YAML lines from inside the front-matter block.
 * @returns string[] of plain field identifiers; never null.
 */
function extractFieldsRaw(lines: string[]): string[] {
  // Locate the fields: key at any indentation level.
  let startIdx = -1;
  let blockIndent = -1;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trimStart();
    if (!trimmed.startsWith("fields:")) continue;
    const afterColon = trimmed.slice("fields:".length).trim();
    const commentStripped = afterColon.replace(/ #.*$/, "").trim();
    if (commentStripped !== "") continue; // inline value — not a block key
    startIdx = i;
    blockIndent = raw.length - trimmed.length;
    break;
  }
  if (startIdx === -1) return [];

  const result: string[] = [];

  for (let i = startIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trimEnd().trimStart();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    if (indent <= blockIndent) break; // returned to same or parent indentation

    if (!trimmed.startsWith("- ")) continue; // non-sequence line inside block: skip
    let item = trimmed.slice(2).trim();
    // Strip inline comment: " # ..."
    const commentIdx = item.indexOf(" #");
    if (commentIdx !== -1) item = item.slice(0, commentIdx).trim();
    // Strip surrounding single or double quotes.
    if (
      (item.startsWith('"') && item.endsWith('"')) ||
      (item.startsWith("'") && item.endsWith("'"))
    ) {
      item = item.slice(1, -1);
    }
    item = item.trim();
    if (item) result.push(item); // EC-11: skip blank items
  }
  return result;
}
```

### 3. Update `safeDefaults` in `parseFolderMd`

Add `fields: null` to the `safeDefaults` object (currently around line 316-340):

```typescript
const safeDefaults: FolderViewConfig = {
  // ... existing fields unchanged ...
  extraFields: [],
  fields: null,   // ADD THIS LINE after extraFields
};
```

### 4. Call `extractFieldsRaw` and populate `config.fields`

In the `try` block of `parseFolderMd`, after the existing
`extractExtraFieldsRaw` call (around line 377), add:

```typescript
// Extract fields: sequence (FR-05). Uses same pre-pass approach as
// extractExtraFieldsRaw so it works whether fields: is at top level
// or nested under layout:.
const rawFields = extractFieldsRaw(yamlBlock.split("\n"));
```

### 5. Derive `config.fields` and conditionally override `extraFields`

After the existing `extraFields` construction loop (which ends around line 399),
add:

```typescript
// Populate config.fields and conditionally derive extraFields from it (FR-06).
// When fields: is present and non-empty, config.extraFields is derived from
// the non-builtin items in fields: so the enrichment guard in tab.ts
// (config.extraFields.length > 0) continues to work without modification (RDD-02).
const fields: string[] | null =
  rawFields.length > 0 ? rawFields : null; // EC-01, FR-16: empty = null

let resolvedExtraFields = extraFields; // default: from extra-fields: sequence
if (fields !== null) {
  resolvedExtraFields = fields
    .filter(f => !BUILTIN_FIELDS.has(f))
    .map(f => ({ key: f, label: f.charAt(0).toUpperCase() + f.slice(1) }));
}
```

### 6. Update the return statement

The return at the bottom of `parseFolderMd` currently includes `extraFields`.
Replace it to use `resolvedExtraFields` and add `fields`:

Before (current return, roughly line 475-481):

```typescript
return {
  layout, title, sort, cardWidth, layoutMode, showModified, body,
  aspectRatio, fit, minHeight, maxHeight,
  showName, showPreview, showExtensions, showFolders, showFiles,
  foldersTitle, filesTitle, showTags, showCount, exclude,
  contentAreaOverride, extraFields,
};
```

After:

```typescript
return {
  layout, title, sort, cardWidth, layoutMode, showModified, body,
  aspectRatio, fit, minHeight, maxHeight,
  showName, showPreview, showExtensions, showFolders, showFiles,
  foldersTitle, filesTitle, showTags, showCount, exclude,
  contentAreaOverride, extraFields: resolvedExtraFields, fields,
};
```

---

## Tests to Write

In `tests/folder-view/parser.test.ts`, add a new top-level `describe` block:

```typescript
describe("fields: extraction", () => {
  // T-01
  it("T-01: fields:[name,modified,tags] → config.fields=[name,modified,tags]; extraFields=[]", () => {
    const content = [
      "---", "layout: folder-table",
      "fields:", "  - name", "  - modified", "  - tags",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.fields).toEqual(["name", "modified", "tags"]);
    expect(cfg.extraFields).toEqual([]);
  });

  // T-02
  it("T-02: fields:[name,status,priority] → extraFields=[{key:status,...},{key:priority,...}]", () => {
    const content = [
      "---", "layout: folder-table",
      "fields:", "  - name", "  - status", "  - priority",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.fields).toEqual(["name", "status", "priority"]);
    expect(cfg.extraFields).toEqual([
      { key: "status", label: "Status" },
      { key: "priority", label: "Priority" },
    ]);
  });

  // T-03
  it("T-03: fields: absent → config.fields=null; extraFields from extra-fields: as before", () => {
    const content = [
      "---", "layout: folder-table",
      "extra-fields:", "  - status",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.fields).toBeNull();
    expect(cfg.extraFields).toEqual([{ key: "status", label: "Status" }]);
  });

  // T-04
  it("T-04: fields: at top level (not nested under layout:) → correctly extracted", () => {
    const content = [
      "---", "layout: folder-table",
      "fields:", "  - name", "  - modified",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.fields).toEqual(["name", "modified"]);
  });

  // T-05
  it("T-05: fields: nested under layout: block → correctly extracted", () => {
    const content = [
      "---",
      "layout:",
      "  type: folder-table",
      "  sort: name-asc",
      "fields:",
      "  - name",
      "  - modified",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.fields).toEqual(["name", "modified"]);
    expect(cfg.layout).toBe("folder-table");
  });

  // T-06
  it("T-06: item with inline comment '- modified  # last changed' → parsed as 'modified'", () => {
    const content = [
      "---", "layout: folder-table",
      "fields:", "  - modified  # last changed",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.fields).toEqual(["modified"]);
  });

  // T-07
  it("T-07: fields: [] (empty sequence) → config.fields=null", () => {
    const content = "---\nlayout: folder-table\nfields:\n---\n";
    const cfg = parseFolderMd(content, "F");
    expect(cfg.fields).toBeNull();
  });

  // T-08
  it("T-08: fields: and extra-fields: both present → fields: wins; extra-fields: ignored", () => {
    const content = [
      "---", "layout: folder-table",
      "fields:", "  - name", "  - status",
      "extra-fields:", "  - priority",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.fields).toEqual(["name", "status"]);
    // extraFields derived from fields:, not extra-fields:
    expect(cfg.extraFields).toEqual([{ key: "status", label: "Status" }]);
    // 'priority' from extra-fields: is NOT present
    expect(cfg.extraFields.find(f => f.key === "priority")).toBeUndefined();
  });

  // T-09
  it("T-09: show-modified:false with fields:[modified] → both parsed independently", () => {
    const content = [
      "---", "layout: folder-table",
      "show-modified: false",
      "fields:", "  - modified",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    // Parser stores both; renderer decides which to use.
    expect(cfg.fields).toContain("modified");
    expect(cfg.showModified).toBe(false);
  });

  // EC-01: empty fields
  it("EC-01: fields: key present but no items → config.fields=null (falls through to legacy)", () => {
    const content = "---\nlayout: folder-table\nfields:\n---\n";
    const cfg = parseFolderMd(content, "F");
    expect(cfg.fields).toBeNull();
  });

  // EC-11: blank item after comment-stripping
  it("EC-11: item that becomes blank after comment-strip is silently skipped", () => {
    const content = [
      "---", "layout: folder-table",
      "fields:", "  - # just a comment", "  - name",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    // "# just a comment" — the "- " is followed by nothing after comment-strip
    expect(cfg.fields).toEqual(["name"]);
  });

  // EC-17: quoted item
  it("EC-17: quoted item '- \"modified\"' → parses as 'modified' (no quotes in result)", () => {
    const content = [
      "---", "layout: folder-table",
      'fields:', '  - "modified"',
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "F");
    expect(cfg.fields).toEqual(["modified"]);
  });
});
```

Additionally, update every existing test in `parser.test.ts` that calls
`parseFolderMd` and then asserts on `cfg.fields` to be absent (i.e., tests
that did not previously check the new field). Because `fields` is a new
**required** field on `FolderViewConfig`, the type now compiles correctly
after step_01. No existing test assertions are broken because no existing test
asserts `cfg.fields === undefined` — they simply do not reference `fields`.

---

## Verification

```bash
npm run test:run -- tests/folder-view/parser.test.ts
```

All tests in the file must pass. The new `describe("fields: extraction")` block
must report all 12 tests green (T-01 through T-09 plus EC-01, EC-11, EC-17).

---

## Edge Cases Addressed

- **EC-01** — Empty `fields:` → `config.fields = null` (step 5: `rawFields.length > 0` guard)
- **EC-06** — No child `.md` with custom key: `config.extraFields` is populated from
  `fields:` non-builtins; enrichment guard fires; cells display "—". No code change needed.
- **EC-07** — `fields:` and `extra-fields:` both present: `resolvedExtraFields` is set
  from `fields:` path; `extra-fields:` items are ignored.
- **EC-08** — `show-modified: false` alongside `fields: [modified]`: both stored
  independently; renderer decides in step_03.
- **EC-11** — Blank item after comment-strip is skipped by the `if (item)` guard.
- **EC-16** — `fields:` inside a `layout:` block: `extractFieldsRaw` scans all lines
  and uses indentation comparison — same mechanism as `extractExtraFieldsRaw`.
- **EC-17** — Quoted item: quote-stripping mirrors the pattern in `extractExtraFieldsRaw`.
- **NFR-03** — `parseFolderMd` never throws: `extractFieldsRaw` is called inside the
  existing top-level `try/catch`.

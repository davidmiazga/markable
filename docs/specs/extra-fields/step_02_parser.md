---
title: "Step 02 — Parser Extension"
last-updated: "2026-05-11"
review-cadence-days: 30
status: active
---

# Step 02 — Parser Extension

## Goal

1. Extend `parseYamlLines` to handle structured sequence items
   (`- key: value` followed by indented sub-key lines).
2. Extract the `extra-fields` sequence from the raw front-matter and parse it
   into `ExtraField[]`.
3. Change the sort pass-through: unknown sort values are stored verbatim instead
   of defaulting to `"name-asc"`.
4. Add `extraFields: []` to `safeDefaults`.
5. Write the T-01 through T-08 test group in `tests/folder-view/parser.test.ts`.

TDD order: write tests first (RED), then implement (GREEN).

---

## File to change: `src/plugins/file-browser/folder-view/parser.ts`

### Change 1 — Import `ExtraField` from types

At the top of the file, update the import:

```typescript
import type { FolderViewConfig, FolderSortOrder, FolderLayoutMode, ExtraField } from "./types";
```

### Change 2 — Widen the return type of `parseYamlLines`

The function currently returns:

```typescript
Record<string, string | Record<string, string> | string[]>
```

Change the return type to:

```typescript
Record<string, string | Record<string, string> | (string | Record<string, string>)[]>
```

The body of the function changes as follows.

### Change 3 — Support structured sequence items inside `parseYamlLines`

The current sequence-item handler is inside the `isIndented && currentBlock !== null` branch, under `if (trimmed.startsWith("- "))`:

```typescript
if (trimmed.startsWith("- ")) {
  // Sequence item
  if (blockIsArray === null || blockIsArray === true) {
    if (blockIsArray === null) {
      result[currentBlock] = [];
      blockIsArray = true;
    }
    const item = trimmed.slice(2).trim();
    if (item) (result[currentBlock] as string[]).push(item);
  }
  continue;
}
```

Replace this block with the following. The key insight is: if the text after
`"- "` itself contains a colon (i.e., it is the first sub-key of an inline
mapping), push a new `Record<string,string>` onto the array and remember it as
`currentItem`. Subsequent indented lines (not starting with `"- "`) append their
key-value pairs into `currentItem`.

```typescript
if (trimmed.startsWith("- ")) {
  // Sequence item — may be a plain string or the first key of a mapping.
  if (blockIsArray === null || blockIsArray === true) {
    if (blockIsArray === null) {
      result[currentBlock] = [];
      blockIsArray = true;
    }
    const itemText = trimmed.slice(2).trim();
    const itemColonIdx = itemText.indexOf(":");
    if (itemColonIdx !== -1) {
      // Structured item: "- key: value" → start a new mapping object.
      const itemKey = itemText.slice(0, itemColonIdx).trim();
      let itemValue = itemText.slice(itemColonIdx + 1).trim();
      const itemCommentIdx = itemValue.indexOf(" #");
      if (itemCommentIdx !== -1) itemValue = itemValue.slice(0, itemCommentIdx).trim();
      if ((itemValue.startsWith('"') && itemValue.endsWith('"')) ||
          (itemValue.startsWith("'") && itemValue.endsWith("'"))) {
        itemValue = itemValue.slice(1, -1);
      }
      const obj: Record<string, string> = {};
      if (itemKey) obj[itemKey] = itemValue;
      currentItem = obj;
      (result[currentBlock] as (string | Record<string, string>)[]).push(obj);
    } else {
      // Plain string item.
      if (itemText) {
        (result[currentBlock] as (string | Record<string, string>)[]).push(itemText);
      }
      currentItem = null;
    }
  }
  continue;
}
// Indented non-"- " line: sub-key of the current structured item.
if (currentItem !== null) {
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx === -1) continue;
  const key = trimmed.slice(0, colonIdx).trim();
  let value = trimmed.slice(colonIdx + 1).trim();
  const commentIdx = value.indexOf(" #");
  if (commentIdx !== -1) value = value.slice(0, commentIdx).trim();
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  if (key) currentItem[key] = value;
  continue;
}
```

This means two new variables are needed in the function scope alongside
`currentBlock` and `blockIsArray`:

```typescript
let currentItem: Record<string, string> | null = null;
```

`currentItem` is reset to `null` whenever a new top-level line resets
`currentBlock`, and whenever a plain string sequence item is encountered.
It is reset to `null` at the top of the block handling along with other state:

In the "Top-level line — reset block state" section, add:

```typescript
currentBlock = null;
blockIsArray = null;
currentItem = null;
```

The existing `// Key:value pair in an object block` branch (non-array, non-`"- "` indented line) must be guarded so it only fires when `currentItem === null`. The restructured indentation block now looks like:

```
if (isIndented && currentBlock !== null) {
  if (trimmed.startsWith("- ")) {
    // ... sequence item handling (as above) ...
    continue;
  }
  // Indented non-"- " line: either a sub-key of a structured sequence item,
  // or a key-value pair in an object block.
  if (currentItem !== null) {
    // Sub-key of structured sequence item (handled above inline)
    continue;
  }
  // Key:value pair in an object block (blockIsArray !== true).
  if (blockIsArray !== true) {
    // ... existing object-block handling ...
  }
  continue;
}
```

The full restructured block (to avoid any ambiguity — reproduce exactly):

```typescript
if (isIndented && currentBlock !== null) {
  if (trimmed.startsWith("- ")) {
    if (blockIsArray === null || blockIsArray === true) {
      if (blockIsArray === null) {
        result[currentBlock] = [];
        blockIsArray = true;
      }
      const itemText = trimmed.slice(2).trim();
      const itemColonIdx = itemText.indexOf(":");
      if (itemColonIdx !== -1) {
        const itemKey = itemText.slice(0, itemColonIdx).trim();
        let itemValue = itemText.slice(itemColonIdx + 1).trim();
        const ic = itemValue.indexOf(" #");
        if (ic !== -1) itemValue = itemValue.slice(0, ic).trim();
        if ((itemValue.startsWith('"') && itemValue.endsWith('"')) ||
            (itemValue.startsWith("'") && itemValue.endsWith("'"))) {
          itemValue = itemValue.slice(1, -1);
        }
        const obj: Record<string, string> = {};
        if (itemKey) obj[itemKey] = itemValue;
        currentItem = obj;
        (result[currentBlock] as (string | Record<string, string>)[]).push(obj);
      } else {
        if (itemText) {
          (result[currentBlock] as (string | Record<string, string>)[]).push(itemText);
        }
        currentItem = null;
      }
    }
    continue;
  }
  // Non-"- " indented line: sub-key of structured item, OR object-block key-value.
  if (currentItem !== null) {
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();
    const commentIdx = value.indexOf(" #");
    if (commentIdx !== -1) value = value.slice(0, commentIdx).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) currentItem[key] = value;
    continue;
  }
  if (blockIsArray !== true) {
    if (blockIsArray === null) {
      result[currentBlock] = {};
      blockIsArray = false;
    }
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let value = trimmed.slice(colonIdx + 1).trim();
    const commentIdx = value.indexOf(" #");
    if (commentIdx !== -1) value = value.slice(0, commentIdx).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!key) continue;
    (result[currentBlock] as Record<string, string>)[key] = value;
  }
  continue;
}
// Top-level line — reset block state.
currentBlock = null;
blockIsArray = null;
currentItem = null;
```

### Change 4 — Update `normalizeFm` for widened sequence element type

`normalizeFm` already skips array values entirely. No change needed — the type
annotation of the parameter widens to accept the new return type. Update the
parameter type signature:

```typescript
function normalizeFm(
  raw: Record<string, string | Record<string, string> | (string | Record<string, string>)[]>,
): Record<string, string> {
```

The body is unchanged.

### Change 5 — Add `extraFields: []` to `safeDefaults`

In `parseFolderMd`, after `contentAreaOverride: true` in `safeDefaults`:

```typescript
extraFields: [],
```

### Change 6 — Extract `extra-fields` before `normalizeFm`

After the existing `rawExclude` extraction block:

```typescript
// Extract extra-fields sequence (FR-06).
const rawExtraFields = rawFm["extra-fields"];
const extraFields: ExtraField[] = [];
if (Array.isArray(rawExtraFields)) {
  for (const item of rawExtraFields as (string | Record<string, string>)[]) {
    if (typeof item === "string") {
      const key = item.trim();
      if (!key) continue;
      extraFields.push({ key, label: key.charAt(0).toUpperCase() + key.slice(1) });
    } else if (item && typeof item === "object") {
      const key = (item["key"] ?? "").trim();
      if (!key) continue;  // EC-05 from FR-06: skip items with empty or missing key
      const rawLabel = (item["label"] ?? "").trim();
      const label = rawLabel || key.charAt(0).toUpperCase() + key.slice(1);
      extraFields.push({ key, label });
    }
  }
}
```

### Change 7 — Change sort pass-through

Replace the existing sort assignment:

```typescript
const sortRaw = (fm["sort"] ?? "").trim();
const sort: FolderSortOrder = VALID_SORTS.has(sortRaw)
  ? (sortRaw as FolderSortOrder)
  : "name-asc";
```

With:

```typescript
const sortRaw = (fm["sort"] ?? "").trim();
// If sortRaw is a known builtin, use it. Otherwise pass through verbatim
// (it may be an extra-field key; the renderer handles unknown values).
// An absent sort field (empty string) still defaults to "name-asc".
const sort: FolderSortOrder = sortRaw === ""
  ? "name-asc"
  : VALID_SORTS.has(sortRaw)
    ? (sortRaw as FolderSortOrder)
    : sortRaw;
```

### Change 8 — Add `extraFields` to the return object

In the return statement at the bottom of the `try` block, add `extraFields`:

```typescript
return {
  layout, title, sort, cardWidth, layoutMode, showModified, body,
  aspectRatio, fit, minHeight, maxHeight,
  showName, showPreview, showExtensions, showFolders, showFiles,
  foldersTitle, filesTitle, showTags, showCount, exclude,
  contentAreaOverride, extraFields,
};
```

---

## File to change: `tests/folder-view/parser.test.ts`

Append a new `describe` block at the end of the file (after the last `});`
that closes the outer `describe("parseFolderMd", ...)`):

```typescript
describe("extra-fields parsing", () => {
  // T-01 — Simple list form
  it("T-01: simple list [status, priority] produces two ExtraField entries with capitalised labels", () => {
    const content = [
      "---",
      "layout: folder-table",
      "extra-fields:",
      "  - status",
      "  - priority",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.extraFields).toEqual([
      { key: "status",   label: "Status" },
      { key: "priority", label: "Priority" },
    ]);
  });

  // T-02 — Structured form
  it("T-02: structured form with explicit key/label produces correct ExtraField", () => {
    const content = [
      "---",
      "layout: folder-table",
      "extra-fields:",
      "  - key: status",
      "    label: My Status",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.extraFields).toEqual([{ key: "status", label: "My Status" }]);
  });

  // T-03 — Mixed form (implementation-defined; must not throw)
  it("T-03: mixed list (string and object) does not throw and returns parseable items", () => {
    const content = [
      "---",
      "layout: folder-table",
      "extra-fields:",
      "  - status",
      "  - key: priority",
      "    label: Priority",
      "---",
    ].join("\n");
    expect(() => parseFolderMd(content, "Folder")).not.toThrow();
    const cfg = parseFolderMd(content, "Folder");
    // At minimum: the parseable items are present; no crash.
    expect(cfg.extraFields.length).toBeGreaterThanOrEqual(1);
  });

  // T-04 — Absent extra-fields
  it("T-04: absent extra-fields produces extraFields=[]", () => {
    const content = "---\nlayout: folder-table\n---\n";
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.extraFields).toEqual([]);
  });

  // T-05 — Object item with empty key is silently skipped
  it("T-05: structured item with empty key is silently skipped", () => {
    const content = [
      "---",
      "layout: folder-table",
      "extra-fields:",
      "  - key:",
      "    label: Something",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.extraFields).toEqual([]);
  });

  // T-06 — Object item with valid key but missing label defaults to capitalised key
  it("T-06: structured item with valid key but no label uses capitalised key as label", () => {
    const content = [
      "---",
      "layout: folder-table",
      "extra-fields:",
      "  - key: priority",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.extraFields).toEqual([{ key: "priority", label: "Priority" }]);
  });

  // T-07 — Unknown sort value passes through (extra-field key)
  it("T-07: sort: status (not in VALID_SORTS) → config.sort is \"status\"", () => {
    const content = [
      "---",
      "layout: folder-table",
      "sort: status",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.sort).toBe("status");
  });

  // T-08 — Completely unknown sort value passes through
  it("T-08: sort: unknown-sort passes through unchanged", () => {
    const content = [
      "---",
      "layout: folder-table",
      "sort: unknown-sort",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.sort).toBe("unknown-sort");
  });

  // EC-01 — Empty sequence
  it("EC-01: extra-fields present but empty sequence → extraFields=[]", () => {
    const content = "---\nlayout: folder-table\nextra-fields:\n---\n";
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.extraFields).toEqual([]);
  });

  // EC-15 — Key with leading/trailing whitespace is trimmed
  it("EC-15: key with leading/trailing whitespace in structured form is trimmed", () => {
    const content = [
      "---",
      "layout: folder-table",
      "extra-fields:",
      "  - key:  status ",
      "    label: Status",
      "---",
    ].join("\n");
    const cfg = parseFolderMd(content, "Folder");
    expect(cfg.extraFields[0]?.key).toBe("status");
  });
});
```

---

## Tests to run after this step

```bash
npm run test:run -- tests/folder-view/parser.test.ts
```

All tests — both the existing ones and T-01 through T-08 plus EC-01/EC-15 — must
be green.

---

## Definition of done

- `parseYamlLines` correctly parses structured sequence items.
- `parseFolderMd` populates `config.extraFields` for both simple and structured form.
- `config.sort` passes through unknown values verbatim; absent sort defaults to
  `"name-asc"`; known builtins are preserved.
- All existing `parser.test.ts` tests pass.
- T-01 through T-08, EC-01, EC-15 pass.

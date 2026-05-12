---
title: "step_03 — Renderer"
last-updated: "2026-05-11"
review-cadence-days: 30
status: active
---

# Step 03 — Renderer

## Goal

Extend `table-renderer.ts` to support fields-mode column construction when
`config.fields !== null`. Add two private helpers (`resolveFields`,
`fieldHeaderLabel`), refactor `buildSectionTable` to branch on fields-mode vs
legacy mode, and update `buildFileRow` / `buildFolderRow` to accept a resolved
field list. Update the `makeConfig()` test fixture. The legacy code path
(when `config.fields === null`) must be byte-for-byte identical to today.

---

## File to Change

- `src/plugins/file-browser/folder-view/table-renderer.ts`
- `tests/folder-view/table-renderer.test.ts`

---

## Precise Changes to `table-renderer.ts`

### 1. Update the import line

Add `BUILTIN_FIELDS` to the import from `"./parser"`. Currently the file does
not import from `parser.ts`. Add a new import line near the top of the file,
after the existing imports:

```typescript
import { BUILTIN_FIELDS } from "./parser";
```

### 2. Add `resolveFields` private helper

Insert before `buildFolderRow` (around line 97):

```typescript
/**
 * Return the ordered list of column identifiers to render for a section.
 *
 * Fields mode (config.fields !== null):
 *   - Files section: return config.fields with "count" filtered out (count is
 *     folders-only; no em-dash placeholder is rendered for it in files).
 *   - Folders section: return config.fields unchanged. The caller is responsible
 *     for rendering "name" and "count" cells normally; all other identifiers
 *     produce an em-dash placeholder cell (AD-3, FR-11).
 *
 * Legacy mode (config.fields === null):
 *   - Returns [] as a sentinel; buildSectionTable uses flag-based logic instead.
 *     The legacy code path is never entered when resolveFields returns a list.
 *
 * @param config  - The validated FolderViewConfig.
 * @param isFiles - true for Files section, false for Folders section.
 * @returns Ordered field identifier list (never null — returns [] in legacy mode).
 */
function resolveFields(config: FolderViewConfig, isFiles: boolean): string[] {
  if (config.fields === null) return [];
  if (isFiles) {
    return config.fields.filter(f => f !== "count");
  }
  // Folders section: keep all identifiers; caller handles em-dash for unknowns.
  return config.fields;
}
```

### 3. Add `fieldHeaderLabel` private helper

Insert immediately after `resolveFields`:

```typescript
/**
 * Return the column header label for a field identifier.
 *
 * Built-in identifiers map to hardcoded English strings.
 * Custom identifiers look up config.extraFields first (for any explicit label
 * set by old extra-fields: syntax or derived from fields:), then fall back
 * to capitalising the key.
 *
 * @param field       - A field identifier string.
 * @param extraFields - The config.extraFields array (may be empty).
 * @returns The human-readable column header label.
 */
function fieldHeaderLabel(field: string, extraFields: ExtraField[]): string {
  switch (field) {
    case "name":     return "Name";
    case "type":
    case "ext":      return "Type";
    case "modified": return "Modified";
    case "tags":     return "Tags";
    case "count":    return "Items";
    default: {
      // Look for an explicit label in extraFields (derived from fields: or extra-fields:).
      const ef = extraFields.find(e => e.key === field);
      if (ef) return ef.label;
      // Fallback: capitalise the key (FR-09 / AC-03).
      return field.charAt(0).toUpperCase() + field.slice(1);
    }
  }
}
```

### 4. Update `buildFolderRow` to accept `resolvedFields`

The current signature is:

```typescript
function buildFolderRow(card: FolderCard, config: FolderViewConfig): HTMLTableRowElement {
```

Change to:

```typescript
function buildFolderRow(
  card: FolderCard,
  config: FolderViewConfig,
  resolvedFields: string[] | null,
): HTMLTableRowElement {
```

Where `resolvedFields` is:
- `null` when called in legacy mode (from the legacy code path in `buildSectionTable`)
- the `resolveFields(config, false)` result when called in fields mode

Replace the body of `buildFolderRow` with a version that handles both modes.
The icon cell and click/keyboard handlers are unchanged. The column cells change:

```typescript
function buildFolderRow(
  card: FolderCard,
  config: FolderViewConfig,
  resolvedFields: string[] | null,
): HTMLTableRowElement {
  const tr = document.createElement("tr");
  tr.className = "fv-row";
  tr.setAttribute("role", "row");
  tr.setAttribute("tabindex", "0");
  tr.setAttribute("aria-label", `Open folder ${card.name}`);

  const iconTd = document.createElement("td");
  iconTd.className = "fv-td fv-td-icon";
  iconTd.innerHTML = ICON_FOLDER;
  tr.appendChild(iconTd);

  if (resolvedFields === null) {
    // ── Legacy mode: flag-based columns ──────────────────────────────────
    const nameTd = document.createElement("td");
    nameTd.className = "fv-td fv-td-name";
    nameTd.textContent = card.name;
    nameTd.title = card.path;
    tr.appendChild(nameTd);

    if (config.showCount) {
      const countTd = document.createElement("td");
      countTd.className = "fv-td fv-td-count";
      countTd.textContent = String(card.childCount ?? 0);
      tr.appendChild(countTd);
    }
  } else {
    // ── Fields mode: iterate resolvedFields ───────────────────────────────
    for (const field of resolvedFields) {
      if (field === "name") {
        const nameTd = document.createElement("td");
        nameTd.className = "fv-td fv-td-name";
        nameTd.textContent = card.name;
        nameTd.title = card.path;
        tr.appendChild(nameTd);
      } else if (field === "count") {
        const countTd = document.createElement("td");
        countTd.className = "fv-td fv-td-count";
        countTd.textContent = String(card.childCount ?? 0);
        tr.appendChild(countTd);
      } else {
        // Em-dash placeholder for any other field (modified, tags, custom keys).
        const placeholderTd = document.createElement("td");
        placeholderTd.className = "fv-td fv-td-placeholder";
        placeholderTd.textContent = "—"; // em-dash (U+2014), XSS-safe via textContent
        tr.appendChild(placeholderTd);
      }
    }
  }

  tr.addEventListener("click", () => handleRowClick(card));
  tr.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleRowClick(card); }
  });

  return tr;
}
```

### 5. Update `buildFileRow` to accept `resolvedFields`

Current signature:

```typescript
function buildFileRow(
  card: FolderCard,
  config: FolderViewConfig,
  extraFields: ExtraField[],
): HTMLTableRowElement {
```

Change to:

```typescript
function buildFileRow(
  card: FolderCard,
  config: FolderViewConfig,
  extraFields: ExtraField[],
  resolvedFields: string[] | null,
): HTMLTableRowElement {
```

Replace the column-cell body. The icon cell, `displayName` computation, and
click/keyboard handlers are unchanged. The column cells branch on mode:

```typescript
  // ... icon cell and displayName computation unchanged ...

  if (resolvedFields === null) {
    // ── Legacy mode: flag-based columns ──────────────────────────────────
    const nameTd = document.createElement("td");
    nameTd.className = "fv-td fv-td-name";
    nameTd.textContent = displayName;
    nameTd.title = card.path;
    tr.appendChild(nameTd);

    if (config.showExtensions) {
      const extTd = document.createElement("td");
      extTd.className = "fv-td fv-td-ext";
      extTd.textContent = card.ext;
      tr.appendChild(extTd);
    }

    if (config.showModified) {
      const modTd = document.createElement("td");
      modTd.className = "fv-td fv-td-modified";
      modTd.textContent = card.modified > 0 ? formatModified(card.modified) : "—";
      tr.appendChild(modTd);
    }

    if (config.showTags) {
      const tagsTd = document.createElement("td");
      tagsTd.className = "fv-td fv-td-tags";
      if (card.tags && card.tags.length > 0) {
        for (const tag of card.tags) {
          const chip = document.createElement("span");
          chip.className = "folder-view-tag-chip";
          chip.textContent = tag;
          chip.title = tag;
          tagsTd.appendChild(chip);
        }
      }
      tr.appendChild(tagsTd);
    }

    for (const field of extraFields) {
      const td = document.createElement("td");
      td.className = "fv-td fv-td-extra";
      td.setAttribute("data-extra-key", field.key);
      const value = card.meta?.[field.key] ?? "";
      td.textContent = value === "" ? "—" : value;
      tr.appendChild(td);
    }
  } else {
    // ── Fields mode: iterate resolvedFields ───────────────────────────────
    for (const field of resolvedFields) {
      if (field === "name") {
        const nameTd = document.createElement("td");
        nameTd.className = "fv-td fv-td-name";
        nameTd.textContent = displayName;
        nameTd.title = card.path;
        tr.appendChild(nameTd);
      } else if (field === "type" || field === "ext") {
        const extTd = document.createElement("td");
        extTd.className = "fv-td fv-td-ext";
        extTd.textContent = card.ext;
        tr.appendChild(extTd);
      } else if (field === "modified") {
        const modTd = document.createElement("td");
        modTd.className = "fv-td fv-td-modified";
        modTd.textContent = card.modified > 0 ? formatModified(card.modified) : "—";
        tr.appendChild(modTd);
      } else if (field === "tags") {
        const tagsTd = document.createElement("td");
        tagsTd.className = "fv-td fv-td-tags";
        if (card.tags && card.tags.length > 0) {
          for (const tag of card.tags) {
            const chip = document.createElement("span");
            chip.className = "folder-view-tag-chip";
            chip.textContent = tag;
            chip.title = tag;
            tagsTd.appendChild(chip);
          }
        }
        tr.appendChild(tagsTd);
      } else {
        // Custom frontmatter field — value from card.meta, em-dash fallback.
        const td = document.createElement("td");
        td.className = "fv-td fv-td-extra";
        td.setAttribute("data-extra-key", field);
        const value = card.meta?.[field] ?? "";
        td.textContent = value === "" ? "—" : value; // XSS-safe via textContent (FR-18)
        tr.appendChild(td);
      }
    }
  }
```

### 6. Refactor `buildSectionTable` to support fields mode

The function currently handles the thead, sort logic, and row factory in a
single block. The refactor adds a fields-mode branch for thead construction and
updates the `buildRow` factory calls to pass `resolvedFields`.

Key changes to `buildSectionTable`:

**a. Call `resolveFields` at the top of the function, after `parseSortOrder`:**

```typescript
// Determine fields mode: non-null resolvedFields means fields: was declared.
const resolvedFields: string[] | null =
  config.fields !== null ? resolveFields(config, isFiles) : null;
const isFieldsMode = resolvedFields !== null;
```

**b. thead construction: wrap the existing header-building block in a
`if (!isFieldsMode)` guard, and add a new `else` block for fields mode:**

The existing block (lines roughly 270-333) builds `iconTh`, `nameTh`, and
conditionally `extTh`, `modTh`, tags, count, and extraThs. This must not change.
Wrap it:

```typescript
if (!isFieldsMode) {
  // ── Legacy thead ───────────────────────────────────────────────────────
  // ... existing icon/name/ext/mod/tags/count/extraThs code unchanged ...
} else {
  // ── Fields-mode thead ──────────────────────────────────────────────────
  // Always render the icon th first (NFR-06).
  const iconTh = document.createElement("th");
  iconTh.className = "fv-th fv-th-icon";
  headerRow.appendChild(iconTh);

  for (const field of resolvedFields) {
    const th = document.createElement("th");
    const label = fieldHeaderLabel(field, config.extraFields);
    th.textContent = label; // textContent for XSS-safe header labels (FR-18)

    // Assign CSS class based on field type.
    if (field === "name")              th.className = "fv-th fv-th-name";
    else if (field === "type" || field === "ext") th.className = "fv-th fv-th-ext";
    else if (field === "modified")     th.className = "fv-th fv-th-modified";
    else if (field === "tags")         th.className = "fv-th fv-th-tags";
    else if (field === "count")        th.className = "fv-th fv-th-count";
    else                               th.className = "fv-th fv-th-extra";

    // Pre-select sort indicator (FR-13).
    if (field === "name" && sortCol === "name")           th.classList.add(`fv-sorted-${sortDir}`);
    else if ((field === "type" || field === "ext") && sortCol === "ext")  th.classList.add(`fv-sorted-${sortDir}`);
    else if (field === "modified" && sortCol === "modified") th.classList.add(`fv-sorted-${sortDir}`);
    else if (field !== "tags" && field !== "count" && field !== "name"
             && field !== "type" && field !== "ext" && field !== "modified"
             && config.sort === field) {
      // Custom field pre-selection (FR-13).
      th.classList.add("fv-sorted-asc");
      sortCol = field;
      sortDir = "asc";
    }

    headerRow.appendChild(th);
    // Track all non-icon ths for clearIndicators (EC-14).
    extraThs.push(th);
  }
}
```

Important note on `nameTh` in fields mode: when `name` is absent from
`resolvedFields`, `nameTh` will be `null`. The sort wiring and `clearIndicators`
must only reference `nameTh` when it exists.

To handle this cleanly, use `null`-initialised variables at the function top
that are assigned during header construction:

```typescript
// These are assigned during thead construction for sort wiring.
// They remain null when the corresponding field is absent (fields mode with name/ext/mod omitted).
let nameTh:  HTMLTableCellElement | null = null;
let extTh:   HTMLTableCellElement | null = null;
let modTh:   HTMLTableCellElement | null = null;
```

In fields mode, assign them as the header loop identifies them:

```typescript
    if (field === "name")              { th.className = "fv-th fv-th-name"; nameTh = th; }
    else if (field === "type" || field === "ext") { th.className = "fv-th fv-th-ext"; extTh = th; }
    else if (field === "modified")     { th.className = "fv-th fv-th-modified"; modTh = th; }
    // ... other fields ...
```

`clearIndicators` already uses `if (extTh)` and `if (modTh)` guards, so those
remain safe. Add an `if (nameTh)` guard around the `nameTh` clear call.

**c. Update `buildRow` factory to pass `resolvedFields`:**

Before:
```typescript
const buildRow = isFiles
  ? (card: FolderCard) => buildFileRow(card, config, extraFieldsForRow)
  : (card: FolderCard) => buildFolderRow(card, config);
```

After:
```typescript
const buildRow = isFiles
  ? (card: FolderCard) => buildFileRow(card, config, extraFieldsForRow, resolvedFields)
  : (card: FolderCard) => buildFolderRow(card, config, resolvedFields);
```

**d. Sort wiring in fields mode:**

In fields mode, the sort click handlers are attached to the entries in
`extraThs` (which now holds ALL field headers, including builtin ones). The
sort wiring loops must correctly identify which field each `<th>` corresponds to.

The cleanest approach: in the fields mode thead construction, push `{ th, field }`
pairs into a separate array `fieldThPairs: { th: HTMLTableCellElement; field: string }[]`
instead of just `extraThs`. Then the click-handler loop iterates `fieldThPairs`:

```typescript
const fieldThPairs: { th: HTMLTableCellElement; field: string }[] = [];
```

In the fields-mode thead loop, push each `{ th, field }` to `fieldThPairs` and
also push `th` to `extraThs` for `clearIndicators`.

The click-handler section at the bottom of `buildSectionTable` gains a new
branch for fields mode:

```typescript
if (isFieldsMode) {
  // Fields mode: attach click handlers from fieldThPairs.
  for (const { th, field } of fieldThPairs) {
    if (field === "tags" || field === "count") continue; // not sortable
    const _th = th;
    const _field = field;
    const sortKey =
      field === "type" || field === "ext" ? "ext" :
      field === "name" ? "name" :
      field === "modified" ? "modified" :
      field; // custom fields use the key directly
    _th.addEventListener("click", () => {
      sortDir = sortCol === sortKey ? (sortDir === "asc" ? "desc" : "asc") : "asc";
      sortCol = sortKey;
      clearIndicators();
      _th.classList.add(`fv-sorted-${sortDir}`);
      rebuildTbody();
    });
  }
} else {
  // Legacy mode: existing nameTh / extTh / modTh / extraThs click handlers.
  // ... existing click-handler code unchanged ...
}
```

The existing extra-fields click handler loop at the bottom references
`config.extraFields[i].key` — this must be wrapped inside the `else` block
(legacy only).

**e. Pre-selection dual-indicator fix for fields mode:**

When a custom field is pre-selected in fields mode (the `config.sort === field`
branch), the `nameTh` may already have a sort indicator (if name is in fields
and sort defaults to name). The code must clear `nameTh`'s indicator at the
same time:

```typescript
    else if (/* custom field pre-selection condition */) {
      th.classList.add("fv-sorted-asc");
      sortCol = field;
      sortDir = "asc";
      if (nameTh) nameTh.classList.remove("fv-sorted-asc", "fv-sorted-desc");
    }
```

---

## Precise Changes to `tests/folder-view/table-renderer.test.ts`

### 1. Update `makeConfig()` fixture

Add `fields: null` to the default spread in `makeConfig()`:

```typescript
function makeConfig(overrides: Partial<FolderViewConfig> = {}): FolderViewConfig {
  return {
    // ... all existing fields unchanged ...
    extraFields: [],
    fields: null,  // ADD THIS — keeps all existing tests in legacy mode
    ...overrides,
  };
}
```

This is the only change needed to make all existing tests continue to pass.

### 2. Add `describe("fields-mode rendering")` block

Add a new top-level `describe` block after the existing `describe("extra-fields columns")` block:

```typescript
describe("fields-mode rendering", () => {
  // T-10 — Column order: name then modified
  it("T-10: fields:[name,modified] → files thead: Icon, Name, Modified (in that order)", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["name", "modified"], extraFields: [] }),
      [makeFileCard("note", ".md", 1000000)],
      container,
      "/vault",
    );
    const ths = Array.from(container.querySelectorAll("thead th")).map(th => th.className);
    expect(ths[0]).toContain("fv-th-icon");
    expect(ths[1]).toContain("fv-th-name");
    expect(ths[2]).toContain("fv-th-modified");
    expect(ths.length).toBe(3);
  });

  // T-11 — Column order: modified before name
  it("T-11: fields:[modified,name] → files thead: Icon, Modified, Name (Modified before Name)", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["modified", "name"], extraFields: [] }),
      [makeFileCard("note", ".md", 1000000)],
      container,
      "/vault",
    );
    const ths = Array.from(container.querySelectorAll("thead th")).map(th => th.className);
    expect(ths[1]).toContain("fv-th-modified");
    expect(ths[2]).toContain("fv-th-name");
  });

  // T-12 — Custom field with value
  it("T-12: fields:[name,status] with card.meta.status='draft' → Status th and 'draft' td", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({
        fields: ["name", "status"],
        extraFields: [{ key: "status", label: "Status" }],
      }),
      [makeFileCard("note", ".md", 0, undefined, [], { status: "draft" })],
      container,
      "/vault",
    );
    const ths = Array.from(container.querySelectorAll("thead th")).map(th => th.textContent);
    expect(ths).toContain("Status");
    const extraTd = container.querySelector("td.fv-td-extra");
    expect(extraTd?.textContent).toBe("draft");
  });

  // T-13 — Custom field absent from meta → em-dash
  it("T-13: fields:[name,status] with card.meta={} → Status td shows '—'", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({
        fields: ["name", "status"],
        extraFields: [{ key: "status", label: "Status" }],
      }),
      [makeFileCard("note", ".md", 0, undefined, [], {})],
      container,
      "/vault",
    );
    const extraTd = container.querySelector("td.fv-td-extra");
    expect(extraTd?.textContent).toBe("—");
  });

  // T-14 — Absent columns
  it("T-14: fields:[name,modified] → no Tags or Type column", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["name", "modified"], extraFields: [] }),
      [makeFileCard("note", ".md", 1000000, undefined, ["tag1"])],
      container,
      "/vault",
    );
    expect(container.querySelector("th.fv-th-tags")).toBeNull();
    expect(container.querySelector("th.fv-th-ext")).toBeNull();
    expect(container.querySelector("td.fv-td-tags")).toBeNull();
    expect(container.querySelector("td.fv-td-ext")).toBeNull();
  });

  // T-15 — Name absent
  it("T-15: fields:[modified,tags] (name omitted) → no Name th in files thead", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["modified", "tags"], extraFields: [] }),
      [makeFileCard("note", ".md", 1000000, undefined, ["t1"])],
      container,
      "/vault",
    );
    expect(container.querySelector("th.fv-th-name")).toBeNull();
  });

  // T-16 — count excluded from files; present in folders
  it("T-16: fields:[name,count] → Files thead: Icon+Name only; Folders: Icon+Name+Count", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["name", "count"], extraFields: [] }),
      [makeDirCard("Sub", "/vault/Sub", false, 3), makeFileCard("note")],
      container,
      "/vault",
    );
    // Two tables — one for folders, one for files.
    const tables = container.querySelectorAll("table.fv-table");
    expect(tables.length).toBe(2);

    // Folders table (first): should have Name and Count headers.
    const foldersTheads = tables[0].querySelectorAll("th");
    const folderThTexts = Array.from(foldersTheads).map(th => th.textContent);
    expect(folderThTexts).toContain("Items"); // count → "Items"
    expect(folderThTexts).toContain("Name");

    // Files table (second): should have Name header but no Count header.
    const filesTheads = tables[1].querySelectorAll("th");
    const fileThTexts = Array.from(filesTheads).map(th => th.textContent);
    expect(fileThTexts).toContain("Name");
    expect(fileThTexts).not.toContain("Items");
  });

  // T-17 — Folders section em-dash for modified
  it("T-17: fields:[name,modified] → Folders section: Name td + em-dash td per folder row", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["name", "modified"], extraFields: [] }),
      [makeDirCard("Sub"), makeFileCard("note", ".md", 1000000)],
      container,
      "/vault",
    );
    const placeholders = container.querySelectorAll("td.fv-td-placeholder");
    expect(placeholders.length).toBeGreaterThanOrEqual(1);
    expect(placeholders[0].textContent).toBe("—");
  });

  // T-18 — Legacy mode unchanged (AC-04 / NFR-04)
  it("T-18: config.fields=null (legacy mode) → showModified+showExtensions produce same output as before", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: null, showModified: true, showExtensions: true }),
      [makeFileCard("note", ".md", 1000000, "/vault/note.md")],
      container,
      "/vault",
    );
    // Legacy columns present.
    expect(container.querySelector("th.fv-th-modified")).not.toBeNull();
    expect(container.querySelector("th.fv-th-ext")).not.toBeNull();
    expect(container.querySelector("td.fv-td-modified")).not.toBeNull();
    expect(container.querySelector("td.fv-td-ext")).not.toBeNull();
  });

  // T-19 — Custom field sort pre-selection
  it("T-19: fields:[name,status], sort:status → Status th has fv-sorted-asc; Name th has none", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({
        fields: ["name", "status"],
        sort: "status",
        extraFields: [{ key: "status", label: "Status" }],
      }),
      [makeFileCard("note", ".md", 0, undefined, [], { status: "done" })],
      container,
      "/vault",
    );
    const ths = Array.from(container.querySelectorAll("th"));
    const statusTh = ths.find(th => th.textContent === "Status");
    const nameTh   = ths.find(th => th.className.includes("fv-th-name"));
    expect(statusTh?.classList.contains("fv-sorted-asc")).toBe(true);
    expect(nameTh?.classList.contains("fv-sorted-asc")).toBe(false);
    expect(nameTh?.classList.contains("fv-sorted-desc")).toBe(false);
  });

  // T-20 — Single name column
  it("T-20: fields:[name] → files thead has only Icon + Name", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["name"], extraFields: [] }),
      [makeFileCard("note")],
      container,
      "/vault",
    );
    const ths = container.querySelectorAll("thead th");
    expect(ths.length).toBe(2); // icon + name
    expect(ths[1].textContent).toBe("Name");
  });

  // EC-03 — count in files → excluded, no column
  it("EC-03: count in fields for files section → excluded by resolveFields, no extra column", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["name", "count"], extraFields: [] }),
      [makeFileCard("note")],
      container,
      "/vault",
    );
    // Files section: count is filtered out, so only icon + name
    const ths = container.querySelectorAll("thead th");
    expect(ths.length).toBe(2);
    expect(Array.from(ths).map(th => th.textContent)).not.toContain("Items");
  });

  // EC-04 — type and ext aliases
  it("EC-04: type and ext both produce Type column header", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["name", "type"], extraFields: [] }),
      [makeFileCard("photo", ".png", 0, "/vault/photo.png")],
      container,
      "/vault",
    );
    const ths = Array.from(container.querySelectorAll("thead th")).map(th => th.textContent);
    expect(ths).toContain("Type");
  });

  // EC-10 — no name or count in folders
  it("EC-10: fields:[status,priority] → folders rows render only icon + em-dash cells", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["status", "priority"], extraFields: [{ key: "status", label: "Status" }, { key: "priority", label: "Priority" }] }),
      [makeDirCard("Sub")],
      container,
      "/vault",
    );
    const foldersTable = container.querySelector("table.fv-table");
    const placeholders = foldersTable?.querySelectorAll("td.fv-td-placeholder");
    expect(placeholders?.length).toBe(2); // status + priority em-dashes
    // No name td present in folder rows
    expect(foldersTable?.querySelector("td.fv-td-name")).toBeNull();
  });

  // EC-14 — clearIndicators covers all fields-mode ths
  it("EC-14: clicking a header in fields mode clears sort class from all other headers", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ fields: ["name", "modified", "status"], sort: "name-asc",
                   extraFields: [{ key: "status", label: "Status" }] }),
      [makeFileCard("note", ".md", 1000000, undefined, [], { status: "done" })],
      container,
      "/vault",
    );
    const ths = Array.from(container.querySelectorAll("thead th"));
    const nameTh   = ths.find(th => th.className.includes("fv-th-name"))!;
    const statusTh = ths.find(th => th.textContent === "Status")!;
    // Initial: name has fv-sorted-asc
    expect(nameTh.classList.contains("fv-sorted-asc")).toBe(true);
    // Click status header
    (statusTh as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: false }));
    expect(nameTh.classList.contains("fv-sorted-asc")).toBe(false);
    expect(statusTh.classList.contains("fv-sorted-asc")).toBe(true);
  });
});
```

---

## Verification

```bash
# All tests: must pass with zero failures.
npm run test:run -- tests/folder-view/table-renderer.test.ts

# Full suite: must not regress.
npm run test:run
```

---

## Implementation Notes for Developer

1. The `buildSectionTable` function is long. The refactor adds a fields-mode
   branch in two places (thead construction and click-handler wiring). Keep the
   `// ── Legacy mode ──` and `// ── Fields mode ──` comment markers so the two
   paths remain clearly separated.

2. `extraThs` continues to hold all headers for `clearIndicators`. In fields
   mode, push every field `<th>` (including builtin ones) to `extraThs` so
   `clearIndicators` covers the full row. The existing `clearIndicators` body
   only needs the `if (nameTh)` guard added; the loop over `extraThs` handles
   the rest.

3. The `extraFieldsForRow` capture (currently `const extraFieldsForRow = isFiles ? config.extraFields : []`)
   is still needed for legacy mode row building. In fields mode, the row builders
   get `resolvedFields` instead and derive the column list from it.

4. The `applySort` function does not need to change. In fields mode, custom-field
   sort keys are passed through to the existing extra-field branch (`sortCol` is
   set to the custom key string, which the sort function handles via `card.meta`).

---

## Edge Cases Addressed

- **EC-02** — `name` absent from `fields:`: `nameTh = null`; all `if (nameTh)`
  guards in sort wiring and `clearIndicators` prevent null-reference errors.
- **EC-03** — `count` in files: filtered by `resolveFields(config, true)`.
- **EC-08** — `show-modified: false` with `fields: [modified]`: fields mode
  ignores `config.showModified`; the Modified column IS rendered.
- **EC-09** — `show-count: true` with `fields: [name, modified]`: fields mode
  ignores `config.showCount`; no Count column.
- **EC-10** — Folders section with only custom keys: all produce em-dash `fv-td-placeholder` cells.
- **EC-13** — No stale click handlers: only headers that exist in the DOM receive
  click handlers; absent headers have no handlers.
- **EC-14** — `clearIndicators` covers all dynamically constructed headers via `extraThs`.
- **EC-18** — `makeConfig()` gains `fields: null` as default.
- **NFR-04** — Legacy path is structurally unchanged inside each `if (!isFieldsMode)` branch.
- **NFR-05** — Column order is solely determined by `resolvedFields` iteration order.
- **NFR-06** — Icon column rendered first, outside field list.

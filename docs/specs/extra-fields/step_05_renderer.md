---
title: "Step 05 — Table Renderer Extension"
last-updated: "2026-05-11"
review-cadence-days: 30
status: active
---

# Step 05 — Table Renderer Extension

## Goal

Extend `table-renderer.ts` and `folder-table-css.ts` to:

1. Add extra-field column headers in the files section thead.
2. Add extra-field data cells in each file row (via `buildFileRow`).
3. Extend `clearIndicators()` to include extra-field `<th>` elements.
4. Add extra-field sort logic with empty-last ordering.
5. Pre-select an extra-field column when `config.sort` matches an `ExtraField.key`.
6. Add `.fv-td-extra` CSS rule.
7. Update `makeConfig()` in the test file to include `extraFields: []`.
8. Write T-15 through T-25 in `tests/folder-view/table-renderer.test.ts`.

TDD order: update `makeConfig()` and write tests first (RED), then implement (GREEN).

---

## File to change: `src/plugins/file-browser/folder-view/table-renderer.ts`

### Change 1 — Import `ExtraField`

Update the import at the top of the file:

```typescript
import type { FolderViewConfig, FolderCard, FolderSortOrder, ExtraField } from "./types";
```

### Change 2 — Extend `buildFileRow` signature

`buildFileRow` gains a third parameter:

```typescript
function buildFileRow(
  card: FolderCard,
  config: FolderViewConfig,
  extraFields: ExtraField[],
): HTMLTableRowElement {
```

At the end of `buildFileRow`, before the event listeners, add the extra-field
cells. Insert after the `if (config.showTags)` block:

```typescript
  // Extra-field cells (FR-11, FR-16).
  for (const field of extraFields) {
    const td = document.createElement("td");
    td.className = "fv-td fv-td-extra";
    td.setAttribute("data-extra-key", field.key);
    const value = card.meta?.[field.key] ?? "";
    td.textContent = value === "" ? "—" : value;  // "—" = U+2014
    tr.appendChild(td);
  }
```

### Change 3 — Extend `buildSectionTable` — sort type, extraThs, clearIndicators

#### 3a. Widen `sortCol` type

Change the `sortCol` declaration from:

```typescript
let sortCol = (isFiles ? initCol : "name") as "name" | "modified" | "ext";
```

To:

```typescript
let sortCol: string = isFiles ? initCol : "name";
```

The variable now holds `"name" | "modified" | "ext" | <extra-field key>`.

#### 3b. Introduce `extraThs` array

After the `let modTh: HTMLTableCellElement | null = null;` line, add:

```typescript
const extraThs: HTMLTableCellElement[] = [];
```

#### 3c. Add extra-field `<th>` elements in the `isFiles` thead branch

In the `if (isFiles)` block, after the `if (config.showTags)` block (which appends
`tagsTh`), add:

```typescript
    // Extra-field column headers (FR-11, FR-13).
    for (const field of config.extraFields) {
      const extraTh = document.createElement("th");
      extraTh.className = "fv-th fv-th-extra";
      extraTh.textContent = field.label;
      // Pre-select if config.sort matches this field's key (FR-11 step 6, AC-07).
      if (isFiles && config.sort === field.key) {
        extraTh.classList.add("fv-sorted-asc");
        sortCol = field.key;
        // sortDir is already "asc" from initDir default; reset explicitly.
        sortDir = "asc";
      }
      headerRow.appendChild(extraTh);
      extraThs.push(extraTh);
    }
```

Wait — the `sortCol` initialisation at the top of `buildSectionTable` uses
`initCol` which is `"name"` or `"modified"`. If `config.sort` is an extra-field
key, `parseSortOrder` returns `{ col: "name", dir: "asc" }` (the fallback). The
pre-selection logic in the thead loop overrides `sortCol` and `sortDir` after the
fact. This is acceptable because `applySort()` and `rebuildTbody()` are called
after thead construction.

**However**, the initial `applySort()` call at the bottom of `buildSectionTable`
runs after thead construction, so `sortCol` will already be overridden. This is
correct: the first sort uses the extra-field key.

#### 3d. Extend `clearIndicators`

Replace the existing `clearIndicators` definition:

```typescript
const clearIndicators = (): void => {
  nameTh.classList.remove("fv-sorted-asc", "fv-sorted-desc");
  if (extTh) extTh.classList.remove("fv-sorted-asc", "fv-sorted-desc");
  if (modTh) modTh.classList.remove("fv-sorted-asc", "fv-sorted-desc");
};
```

With:

```typescript
const clearIndicators = (): void => {
  nameTh.classList.remove("fv-sorted-asc", "fv-sorted-desc");
  if (extTh) extTh.classList.remove("fv-sorted-asc", "fv-sorted-desc");
  if (modTh) modTh.classList.remove("fv-sorted-asc", "fv-sorted-desc");
  for (const th of extraThs) th.classList.remove("fv-sorted-asc", "fv-sorted-desc");
};
```

#### 3e. Extend `applySort` for extra-field sort

Replace the existing `applySort` definition:

```typescript
const applySort = (): void => {
  if (sortCol === "ext") {
    const dir = sortDir === "asc" ? 1 : -1;
    workingCards.sort((a, b) => {
      const cmp = dir * a.ext.localeCompare(b.ext);
      return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
    });
  } else {
    sortCards(workingCards, `${sortCol}-${sortDir}` as FolderSortOrder);
  }
};
```

With:

```typescript
const applySort = (): void => {
  if (sortCol === "ext") {
    const dir = sortDir === "asc" ? 1 : -1;
    workingCards.sort((a, b) => {
      const cmp = dir * a.ext.localeCompare(b.ext);
      return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
    });
  } else if (sortCol === "name" || sortCol === "modified") {
    sortCards(workingCards, `${sortCol}-${sortDir}` as FolderSortOrder);
  } else {
    // Extra-field sort (FR-11, FR-12): localeCompare, empty values last.
    const dir = sortDir === "asc" ? 1 : -1;
    workingCards.sort((a, b) => {
      const aVal = a.meta?.[sortCol] ?? "";
      const bVal = b.meta?.[sortCol] ?? "";
      // Empty values always sort last, regardless of direction (FR-12).
      if (aVal === "" && bVal === "") return a.name.localeCompare(b.name);
      if (aVal === "") return 1;
      if (bVal === "") return -1;
      const cmp = dir * aVal.localeCompare(bVal);
      return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
    });
  }
};
```

#### 3f. Update `buildRow` factory to pass `extraFields`

Replace:

```typescript
const buildRow = isFiles
  ? (card: FolderCard) => buildFileRow(card, config)
  : (card: FolderCard) => buildFolderRow(card, config);
```

With:

```typescript
const extraFieldsForRow = isFiles ? config.extraFields : [];
const buildRow = isFiles
  ? (card: FolderCard) => buildFileRow(card, config, extraFieldsForRow)
  : (card: FolderCard) => buildFolderRow(card, config);
```

`extraFieldsForRow` is captured at `buildSectionTable` call time, satisfying
EC-13 (lazily-appended rows use the same field list).

#### 3g. Wire click handlers for extra-field `<th>` elements

After the `if (modTh) { ... }` event-handler block, add:

```typescript
  // Extra-field column sort handlers (FR-11, FR-12, AC-08).
  for (let i = 0; i < extraThs.length; i++) {
    const th = extraThs[i];
    const fieldKey = config.extraFields[i].key;
    th.addEventListener("click", () => {
      sortDir = sortCol === fieldKey ? (sortDir === "asc" ? "desc" : "asc") : "asc";
      sortCol = fieldKey;
      clearIndicators();
      th.classList.add(`fv-sorted-${sortDir}`);
      rebuildTbody();
    });
  }
```

---

## File to change: `src/plugins/file-browser/folder-view/folder-table-css.ts`

Add after the `.fv-td-tags` rule:

```css
.fv-td-extra { color: var(--text-primary); font-size: 12px; }
.fv-th-extra { /* inherits .fv-th styles */ }
```

In the template literal, after the `.fv-td-tags { ... }` block:

```typescript
.fv-td-extra { color: var(--text-primary); font-size: 12px; }
```

---

## File to change: `tests/folder-view/table-renderer.test.ts`

### Update `makeConfig()`

Add `extraFields: []` to the default config object (T-25):

```typescript
function makeConfig(overrides: Partial<FolderViewConfig> = {}): FolderViewConfig {
  return {
    layout: "folder-table",
    title: "Test Folder",
    sort: "name-asc",
    cardWidth: 160,
    layoutMode: "grid",
    showModified: true,
    body: "",
    aspectRatio: "1/1",
    fit: "cover",
    minHeight: 40,
    maxHeight: 200,
    showName: true,
    showPreview: true,
    showExtensions: true,
    showFolders: true,
    showFiles: true,
    foldersTitle: "Folders",
    filesTitle: "",
    showTags: false,
    showCount: false,
    exclude: [],
    contentAreaOverride: true,
    extraFields: [],             // T-25: existing tests unaffected
    ...overrides,
  };
}
```

### Update `makeFileCard()` to accept an optional `meta` parameter

```typescript
function makeFileCard(
  name: string,
  ext = ".md",
  modified = 0,
  path?: string,
  tags?: string[],
  meta?: Record<string, string>,
): FolderCard {
  const fullPath = path ?? `/vault/${name}${ext === ".md" ? "" : ext}`;
  return { path: fullPath, name, kind: "file", ext, modified, tags, meta };
}
```

### Append the new test block

```typescript
import type { ExtraField } from "../../src/plugins/file-browser/folder-view/types";

// ... (add this import alongside the existing imports at the top of the file)

describe("extra-fields columns", () => {
  // Helper: build an ExtraField.
  function ef(key: string, label: string): ExtraField {
    return { key, label };
  }

  // T-15 — Extra field header and cell rendered
  it("T-15: extraFields with one field and card.meta → <th> with label and <td> with value", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ extraFields: [ef("status", "Status")] }),
      [makeFileCard("note", ".md", 0, undefined, [], { status: "done" })],
      container,
      "/vault",
    );
    const th = container.querySelector("th.fv-th-extra");
    expect(th).not.toBeNull();
    expect(th?.textContent).toBe("Status");
    const td = container.querySelector("td.fv-td-extra");
    expect(td).not.toBeNull();
    expect(td?.textContent).toBe("done");
  });

  // T-16 — Empty meta → em-dash
  it("T-16: card with meta={} (field absent) → cell displays '—'", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ extraFields: [ef("status", "Status")] }),
      [makeFileCard("note", ".md", 0, undefined, [], {})],
      container,
      "/vault",
    );
    const td = container.querySelector("td.fv-td-extra");
    expect(td?.textContent).toBe("—");  // em-dash
  });

  // T-17 — extraFields=[] (default) → no extra columns
  it("T-17: extraFields=[] → no extra <th> or <td> rendered", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ extraFields: [] }),
      [makeFileCard("note")],
      container,
      "/vault",
    );
    expect(container.querySelector("th.fv-th-extra")).toBeNull();
    expect(container.querySelector("td.fv-td-extra")).toBeNull();
  });

  // T-18 — sort: "status" pre-selects Status column header
  it("T-18: sort='status' with extraFields including status → Status header has fv-sorted-asc", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ sort: "status", extraFields: [ef("status", "Status")] }),
      [makeFileCard("note", ".md", 0, undefined, [], { status: "done" })],
      container,
      "/vault",
    );
    const extraTh = container.querySelector("th.fv-th-extra");
    expect(extraTh?.classList.contains("fv-sorted-asc")).toBe(true);
    // Name header must NOT be pre-selected.
    const nameTh = container.querySelector("th.fv-th-name");
    expect(nameTh?.classList.contains("fv-sorted-asc")).toBe(false);
    expect(nameTh?.classList.contains("fv-sorted-desc")).toBe(false);
  });

  // T-19 — Clicking Status header sorts rows ascending
  it("T-19: clicking Status header sorts rows by status value ascending (empty last)", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ extraFields: [ef("status", "Status")] }),
      [
        makeFileCard("c", ".md", 0, undefined, [], { status: "done" }),
        makeFileCard("a", ".md", 0, undefined, [], { status: "" }),
        makeFileCard("b", ".md", 0, undefined, [], { status: "in-progress" }),
      ],
      container,
      "/vault",
    );
    const statusTh = container.querySelector<HTMLElement>("th.fv-th-extra")!;
    statusTh.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    const names = Array.from(container.querySelectorAll("td.fv-td-name")).map(n => n.textContent);
    // "done" < "in-progress" alphabetically; empty last.
    expect(names).toEqual(["c", "b", "a"]);
  });

  // T-20 — Clicking Status header twice sorts rows descending
  it("T-20: clicking Status header twice sorts descending (empty still last)", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ extraFields: [ef("status", "Status")] }),
      [
        makeFileCard("c", ".md", 0, undefined, [], { status: "done" }),
        makeFileCard("a", ".md", 0, undefined, [], { status: "" }),
        makeFileCard("b", ".md", 0, undefined, [], { status: "in-progress" }),
      ],
      container,
      "/vault",
    );
    const statusTh = container.querySelector<HTMLElement>("th.fv-th-extra")!;
    statusTh.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    statusTh.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    const names = Array.from(container.querySelectorAll("td.fv-td-name")).map(n => n.textContent);
    // "in-progress" > "done" desc; empty last.
    expect(names).toEqual(["b", "c", "a"]);
    expect(statusTh.classList.contains("fv-sorted-desc")).toBe(true);
  });

  // T-21 — Empty status sorts last in both directions
  it("T-21: empty status value always sorts last regardless of direction", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ extraFields: [ef("status", "Status")] }),
      [
        makeFileCard("empty", ".md", 0, undefined, [], {}),
        makeFileCard("x",     ".md", 0, undefined, [], { status: "z" }),
        makeFileCard("a",     ".md", 0, undefined, [], { status: "a" }),
      ],
      container,
      "/vault",
    );
    const statusTh = container.querySelector<HTMLElement>("th.fv-th-extra")!;

    // Ascending click.
    statusTh.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    let names = Array.from(container.querySelectorAll("td.fv-td-name")).map(n => n.textContent);
    expect(names[names.length - 1]).toBe("empty");

    // Descending click.
    statusTh.dispatchEvent(new MouseEvent("click", { bubbles: false }));
    names = Array.from(container.querySelectorAll("td.fv-td-name")).map(n => n.textContent);
    expect(names[names.length - 1]).toBe("empty");
  });

  // T-22 — Clicking Status header clears fixed column sort indicators
  it("T-22: clicking Status header clears fv-sorted-* from Name, Type, and Modified headers", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ sort: "name-asc", showExtensions: true, showModified: true, extraFields: [ef("status", "Status")] }),
      [makeFileCard("note", ".md", 0, undefined, [], { status: "done" })],
      container,
      "/vault",
    );
    const nameTh  = container.querySelector<HTMLElement>("th.fv-th-name")!;
    const extTh   = container.querySelector<HTMLElement>("th.fv-th-ext")!;
    const modTh   = container.querySelector<HTMLElement>("th.fv-th-modified")!;
    const statusTh = container.querySelector<HTMLElement>("th.fv-th-extra")!;

    expect(nameTh.classList.contains("fv-sorted-asc")).toBe(true);

    statusTh.dispatchEvent(new MouseEvent("click", { bubbles: false }));

    expect(nameTh.classList.contains("fv-sorted-asc")).toBe(false);
    expect(nameTh.classList.contains("fv-sorted-desc")).toBe(false);
    expect(extTh.classList.contains("fv-sorted-asc")).toBe(false);
    expect(modTh.classList.contains("fv-sorted-asc")).toBe(false);
    expect(statusTh.classList.contains("fv-sorted-asc")).toBe(true);
  });

  // T-23 — Extra cell uses fv-td-extra class and data-extra-key attribute
  it("T-23: extra column cells have class fv-td-extra and data-extra-key attribute", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ extraFields: [ef("status", "Status")] }),
      [makeFileCard("note", ".md", 0, undefined, [], { status: "done" })],
      container,
      "/vault",
    );
    const td = container.querySelector("td.fv-td-extra");
    expect(td?.getAttribute("data-extra-key")).toBe("status");
  });

  // T-24 — Extra columns appear after Tags column
  it("T-24: extra columns appear after Tags column in header row", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ showTags: true, extraFields: [ef("status", "Status")] }),
      [makeFileCard("note", ".md", 0, undefined, ["tag1"], { status: "done" })],
      container,
      "/vault",
    );
    const headers = Array.from(container.querySelectorAll("th")).map(th => th.className);
    const tagsIdx  = headers.findIndex(c => c.includes("fv-th-tags"));
    const extraIdx = headers.findIndex(c => c.includes("fv-th-extra"));
    expect(tagsIdx).toBeGreaterThanOrEqual(0);
    expect(extraIdx).toBeGreaterThan(tagsIdx);
  });

  // T-25 is verified implicitly: all existing tests pass after makeConfig() gains extraFields:[].

  // EC-06 — sort key not in extraFields → falls back to name-asc behavior
  it("EC-06: sort='status' with no extraFields → no extra column, no crash, name column sorted asc", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ sort: "status", extraFields: [] }),
      [makeFileCard("z"), makeFileCard("a"), makeFileCard("m")],
      container,
      "/vault",
    );
    // No crash; name header should default because "status" is not a builtin.
    const names = Array.from(container.querySelectorAll("td.fv-td-name")).map(n => n.textContent);
    // parseSortOrder("status") falls back to col:"name", dir:"asc".
    expect(names).toEqual(["a", "m", "z"]);
    expect(container.querySelector("th.fv-th-extra")).toBeNull();
  });

  // EC-11 — HTML in value is inserted via textContent (no injection)
  it("EC-11: HTML in field value is inserted via textContent, not innerHTML", () => {
    const container = makeContainer();
    renderFolderTable(
      makeConfig({ extraFields: [ef("status", "Status")] }),
      [makeFileCard("note", ".md", 0, undefined, [], { status: "<b>done</b>" })],
      container,
      "/vault",
    );
    const td = container.querySelector("td.fv-td-extra");
    // innerHTML should contain the escaped version, not a <b> element.
    expect(td?.querySelector("b")).toBeNull();
    expect(td?.textContent).toBe("<b>done</b>");
  });
});
```

---

## Tests to run after this step

```bash
npm run test:run -- tests/folder-view/table-renderer.test.ts
```

All existing tests must still pass (T-25 guard: `makeConfig()` now includes
`extraFields: []`). T-15 through T-25 plus EC-06 and EC-11 must be green.

Run the full suite to confirm no regression:

```bash
npm run test:run
```

---

## Definition of done

- `table-renderer.ts` renders extra-field `<th>` and `<td>` elements.
- Extra-field `<th>` elements are stored in `extraThs[]` and included in `clearIndicators()`.
- `applySort()` handles extra-field keys with `localeCompare` and empty-last ordering.
- Pre-selection of extra-field column works when `config.sort` matches a field key.
- `buildFileRow` passes `extraFields` to the row factory; lazy rows (EC-13) use the
  same captured field list.
- Values inserted via `.textContent` (FR-16, AC-14, EC-11).
- CSS rule `.fv-td-extra` added to `folder-table-css.ts`.
- T-15 through T-25 pass.
- EC-06 and EC-11 pass.
- All pre-existing tests pass.
- AC-01 through AC-14 verified end-to-end.

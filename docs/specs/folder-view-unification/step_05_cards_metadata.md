---
title: "Step 05 — Metadata Line in Cards Layout + FOLDER_VIEW_STARTER Update"
last-updated: "2026-05-12"
review-cadence-days: 7
status: active
---

# Step 05 — Metadata Line in Cards Layout + `FOLDER_VIEW_STARTER` Update

**Goal**: Render a single `.fv-card-meta` line below the card name. The line
shows field values from `config.fields` (fields: mode) or defaults to
`modified` + `tags` (legacy mode). The existing `.folder-view-card-date`
element must not appear when fields: mode is active. Update the
`FOLDER_VIEW_STARTER` comment to remove the "folder-table only" qualifier
from `fields:` and `extra-fields:` (C-8).

---

## Files Changed

| File | Change |
|---|---|
| `src/plugins/file-browser/folder-view/renderer.ts` | Add `buildCardMeta` function; modify `buildCard` to call it; guard `.folder-view-card-date` |
| `src/plugins/file-browser/file-browser.plugin.ts` | Update `FOLDER_VIEW_STARTER` comments (C-8) |

---

## 1. New Helper: `buildCardMeta`

This function is **module-internal** (not exported). It returns an
`HTMLElement | null` — returning `null` means "no metadata line should be
rendered" (EC-13: fields: name only, or no displayable values).

```typescript
/**
 * Build the `.fv-card-meta` metadata line element for a card.
 *
 * Fields mode (config.fields !== null):
 *   Render values for each field in config.fields, in declaration order,
 *   excluding "name" (already shown as card name) and "icon". Non-empty
 *   values separated by " · " (U+00B7 middle dot, space-padded). Missing or
 *   empty values render as "—" (em-dash, U+2014). If every field produces
 *   an em-dash (or the field list is empty after filtering), return null so
 *   no element is appended (EC-13).
 *
 * Legacy mode (config.fields === null):
 *   Show modified date (if card.modified > 0 and config.showModified is true)
 *   and tags as plain text joined by " · " (if card.tags exists and showTags
 *   is true). If nothing is displayable, return null.
 *
 * All values use .textContent — never .innerHTML (C-4, EC-15).
 *
 * @param card   - The FolderCard to read data from.
 * @param config - The FolderViewConfig.
 * @returns An HTMLDivElement with class "fv-card-meta", or null.
 */
function buildCardMeta(card: FolderCard, config: FolderViewConfig): HTMLElement | null {
  const parts: string[] = [];

  if (config.fields !== null) {
    // ── Fields mode ─────────────────────────────────────────────────────
    for (const field of config.fields) {
      if (field === "name" || field === "icon") continue; // shown elsewhere; skip

      let value = "";

      if (field === "modified") {
        value = card.modified > 0 ? formatModified(card.modified) : "";
      } else if (field === "tags") {
        // Tags: join all tag values with " · " as one segment in the meta line.
        // This differs from the chip display (showTags/legacy mode).
        value = card.tags && card.tags.length > 0
          ? card.tags.join(" · ")
          : "";
      } else if (field === "count") {
        // count: only meaningful for directory cards.
        if (card.kind === "directory") {
          value = String(card.childCount ?? 0);
        }
        // file cards: leave value = "" → em-dash (EC-14)
      } else if (field === "type" || field === "ext") {
        value = card.ext;
      } else {
        // Built-in image fields (width, height, date-taken, camera) and
        // custom frontmatter fields — read from card.meta.
        value = card.meta?.[field] ?? "";
      }

      // Em-dash for missing or empty values (consistent with table renderer).
      parts.push(value === "" ? "—" : value);
    }

    // EC-13: if every field produced only em-dashes (or no fields after
    // filtering), omit the meta line entirely to keep the card clean.
    if (parts.every(p => p === "—")) return null;
    if (parts.length === 0) return null;

  } else {
    // ── Legacy mode ──────────────────────────────────────────────────────
    // Show modified date and/or tags only when the respective boolean is true.
    if (config.showModified && card.kind === "file" && card.modified > 0) {
      parts.push(formatModified(card.modified));
    }
    if (config.showTags && card.tags && card.tags.length > 0) {
      parts.push(card.tags.join(" · "));
    }

    if (parts.length === 0) return null;
  }

  const meta = document.createElement("div");
  meta.className = "fv-card-meta";
  // All values written via textContent — never innerHTML (C-4).
  meta.textContent = parts.join(" · ");
  return meta;
}
```

---

## 2. `buildCard` Modifications

### Guard `.folder-view-card-date` (EC-16)

The existing `showModified` block that creates `.folder-view-card-date` must
be skipped when `config.fields !== null` (fields: mode supersedes the boolean
flags):

```typescript
// Before:
if (config.showModified && card.kind === "file" && card.modified > 0) {
  const dateEl = document.createElement("div");
  dateEl.className = "folder-view-card-date";
  dateEl.textContent = formatModified(card.modified);
  el.appendChild(dateEl);
}

// After:
// .folder-view-card-date only in legacy mode (fields: not declared).
// When fields: is declared, the metadata line (.fv-card-meta) supersedes it.
if (config.fields === null && config.showModified && card.kind === "file" && card.modified > 0) {
  const dateEl = document.createElement("div");
  dateEl.className = "folder-view-card-date";
  dateEl.textContent = formatModified(card.modified);
  el.appendChild(dateEl);
}
```

### Guard `showTags` chip block similarly (EC-16)

The existing tag chips block must also be skipped in fields: mode:

```typescript
// Before:
if (config.showTags && card.tags && card.tags.length > 0) {
  ...tag chips...
}

// After:
// Tag chips only in legacy mode. In fields: mode, tags appear as plain text
// in the .fv-card-meta line (fields: supersedes show-tags).
if (config.fields === null && config.showTags && card.tags && card.tags.length > 0) {
  ...tag chips...
}
```

### Add `fv-card-meta` element

After the (now-guarded) tag chips block and `showModified` block, append the
metadata line:

```typescript
// Metadata line — fields: mode or legacy mode (covers both .fv-card-meta
// and replaces .folder-view-card-date when fields: is declared).
const metaEl = buildCardMeta(card, config);
if (metaEl) el.appendChild(metaEl);
```

**DOM order in `buildCard` after this step**:
1. `folder-view-card-preview` (if `showPreview`)
2. `folder-view-card-name` (if `showName`)
3. `folder-view-card-tags` chips (if `config.fields === null && showTags && tags exist`)
4. `folder-view-card-date` (if `config.fields === null && showModified && file && modified > 0`)
5. `fv-card-meta` (from `buildCardMeta`, if non-null)
6. `fv-card-checkbox-wrap` (from Step 04, if `checkboxCtx`)

---

## 3. `file-browser.plugin.ts` — `FOLDER_VIEW_STARTER` Update (C-8)

Current lines (3016–3024):
```
"# folder-table only: controls which columns appear and in what order",
"# fields:",
"#   - icon",
"#   - name",
"#   - type",
"#   - modified",
"#   - tags",
"#   - status",
"# add any frontmatter key as a custom column",
```

Replace with:
```
"# fields: controls which data appears below each card name (folder-cards)",
"# or which columns appear in the table (folder-table), in declaration order.",
"# fields:",
"#   - name",
"#   - modified",
"#   - tags",
"#   - status",
"# add any frontmatter key as a custom field (e.g. status from YAML front matter)",
"# extra-fields: adds custom frontmatter keys as additional fields.",
"# extra-fields:",
"#   - status",
```

The key changes:
- Remove "folder-table only" from the `fields:` comment.
- Explain what `fields:` does for both layouts.
- Add an `extra-fields:` example with its updated comment.

Note: verify the exact lines by re-reading `FOLDER_VIEW_STARTER` at
implementation time — the line numbers above are from the current snapshot and
may shift if earlier steps added/removed lines in the same file.

---

## 4. Edge Case Handling Reference

| EC | Field/Condition | `parts` result | Meta line |
|---|---|---|---|
| EC-1 | No `fields:`, `showModified: true`, `showTags: false`, file with modified=1000 | `["Jan 1, 1970"]` | `"Jan 1, 1970"` |
| EC-1 | No `fields:`, `showModified: false`, `showTags: false` | `[]` | null (no element) |
| EC-2 | `fields: [modified, tags]`, file with modified=1000, tags=["a","b"] | `["Jan 1, 1970", "a · b"]` | `"Jan 1, 1970 · a · b"` |
| EC-3 | `fields: [name, status]`, file with meta.status="draft" | `["draft"]` | `"draft"` (`name` filtered) |
| EC-3 | `fields: [name, status]`, file with no meta | `["—"]` | null (all em-dashes) |
| EC-4 | `fields: [width, height]`, image with meta.width="800", meta.height="600" | `["800", "600"]` | `"800 · 600"` |
| EC-13 | `fields: [name]` | all filtered → `[]` | null (no element) |
| EC-14 | `fields: [count]`, directory with childCount=5 | `["5"]` | `"5"` |
| EC-14 | `fields: [count]`, file | `["—"]` | null (all em-dashes) |
| EC-15 | `fields: [status]`, meta.status = `<script>alert(1)</script>` | textContent → literal string | displayed as literal text |
| EC-16 | `fields: [modified]` + `show-modified: false` | fields: mode wins; `show-modified` ignored for `.folder-view-card-date` | meta line shows modified |
| EC-17 | `fields: [status]`, enrichment failed → meta = {} | `meta?.["status"] ?? ""` → `""` → `"—"` | `"—"` → null (all em-dashes) |

---

## Tests to Write (TDD — write before implementing)

File: `tests/folder-view/renderer.test.ts` (extend existing)

### Test group: `buildCardMeta / metadata line`

#### EC-1A: legacy mode, modified only

#### EC-1B: legacy mode, neither flag → no meta line

#### EC-2: `fields: [modified, tags]` → correct joined string

#### EC-3: `fields: [name, status]`, file with meta → shows status value only

#### EC-3b: `fields: [name, status]`, file with no meta → no meta element

#### EC-13: `fields: [name]` → no meta element appended

#### EC-14: `fields: [count]`, directory → count value; file → no meta element

#### EC-15: XSS — `status` value with `<script>` tag rendered as literal text

```
Given: config.fields = ["status"]
And:   card.meta["status"] = "<script>alert(1)</script>"
When:  renderFolderCards is called
Then:  the .fv-card-meta element's textContent equals "<script>alert(1)</script>"
       (not executed as HTML)
       document.querySelectorAll("script").length is unchanged
```

#### EC-16: `fields:` declared → `.folder-view-card-date` not appended

```
Given: config.fields = ["modified"], config.showModified = true
And:   a file card with modified > 0
When:  buildCard is called
Then:  the card does NOT contain a .folder-view-card-date element
       the card DOES contain a .fv-card-meta element with the date text
```

#### EC-17: enrichment failure → meta = {} → em-dash for custom field

#### C-8: `FOLDER_VIEW_STARTER` does not contain "folder-table only"

```
Given: the FOLDER_VIEW_STARTER constant
Then:  it does not contain the string "folder-table only"
       it contains the string "fields:" in a comment
       it contains the string "extra-fields:" in a comment
```

---

## Acceptance Criteria

- [ ] `buildCardMeta` function exists in `renderer.ts` (module-internal)
- [ ] Fields mode: values from `config.fields` in declaration order, `name`/`icon` skipped
- [ ] Fields mode: `tags` joined with ` · ` as one segment
- [ ] Fields mode: `count` shows `childCount` for dirs, `"—"` for files
- [ ] Fields mode: custom/image fields read from `card.meta`
- [ ] Fields mode: all-em-dash result → no element returned (EC-13)
- [ ] Legacy mode: `modified` + `tags` respects `showModified`/`showTags` booleans
- [ ] Legacy mode: nothing displayable → no element returned
- [ ] `.folder-view-card-date` guarded by `config.fields === null` (EC-16)
- [ ] Tag chips guarded by `config.fields === null` (EC-16)
- [ ] All values via `.textContent` (C-4, EC-15)
- [ ] `FOLDER_VIEW_STARTER` has no "folder-table only" comment
- [ ] All tests in test group above pass
- [ ] All existing tests pass (`npm run test:run`)

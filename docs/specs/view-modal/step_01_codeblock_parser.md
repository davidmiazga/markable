---
title: "step_01 — Codeblock parser extension"
last-updated: "2026-06-08"
review-cadence-days: 7
status: active
---

# step_01 — Codeblock parser extension

## Goal

Extend `parseFolderMd()` to extract folder-view configuration from a
`select` codeblock in the body. Frontmatter remains a fallback.
Codeblock wins when both are present (AD-2).

## Files touched

- **EDIT** `src/plugins/file-browser/folder-view/parser.ts` — add a
  body-codeblock detector and a config-overlay step after the
  existing frontmatter parse.
- **NEW** `tests/view-modal/read-compat.test.ts` — read-compat tests
  for codeblock-shape and legacy-frontmatter-shape `_folder.md`.

## Function signatures

```typescript
// src/plugins/file-browser/folder-view/parser.ts (additions)

/**
 * Locate the first `select` codeblock in a body string and return its
 * inner YAML lines (between the fences). Returns null when no such
 * codeblock exists.
 *
 * Match rules (locked per AD-2):
 *   - Opening fence: line starts at column 0 with /^```select(\s|$)/.
 *     The `(\s|$)` group allows a width modifier (e.g. "```select wide")
 *     to be tolerated; the modifier is ignored by this extractor.
 *   - Closing fence: line whose full trimmed content is exactly "```".
 *   - The opening fence's line and the closing fence's line are NOT
 *     included in the returned body.
 *   - Only the FIRST `select` codeblock in the body is considered.
 *
 * Never throws.
 *
 * @internal — exported so step_01 tests can pin the boundary parser
 * independently from the projection step.
 */
export function extractSelectCodeblockBody(body: string): string | null;
```

The existing `parseFolderMd(content, folderName)` signature is
unchanged. Its return type `FolderViewConfig` is unchanged.
Implementation adds a new step between "parse YAML frontmatter" and
"apply defaults":

```
Step 1 (existing): split content into frontmatter + body.
Step 2 (existing): parseYamlLines() on the frontmatter.
Step 2.5 (NEW):    if extractSelectCodeblockBody(body) returns a body,
                    call parseSelectBody(body) and overlay its fields
                    onto the frontmatter-derived state.
Step 3 (existing): apply defaults, clamp/validate each field.
```

Overlay rules (locked):

- `parseSelectBody()` returns `{ rawPath, display, config, contentWidth }`.
- For each key the codeblock carries, the codeblock value wins over the
  frontmatter value. Keys NOT in the codeblock fall through to
  frontmatter.
- The codeblock's `display:` value maps to the `layout:` field on the
  returned `FolderViewConfig`. Mapping: `cards` → `cards`,
  `table` → `table`, `timeline` → `timeline`, `kanban` → `kanban`,
  `bookshelf` → `bookshelf`, `collection-home` → `collection-home`.
  Legacy frontmatter shapes `view-cards`/`folder-cards` etc. continue
  to work in the frontmatter fallback path.

## Failing tests FIRST

Path: `tests/view-modal/read-compat.test.ts`. Tests:

1. **"extracts body codeblock — minimal"** — body `"```select\npath: ./\ndisplay: cards\n```"`, expects `parseFolderMd(...)` to return `{ layout: "cards", ... }`. EC-7 inverse.
2. **"prefers codeblock over frontmatter when both present"** — content `"---\nlayout: bookshelf\n---\n\n```select\ndisplay: table\n```"`, expects `layout: "table"`. EC-7 / FR-55 precedence.
3. **"falls back to frontmatter when no codeblock"** — content `"---\nlayout: cards\npath: ./\n---\n"`, expects `layout: "cards"`. EC-7 / FR-55 fallback.
4. **"tolerates width modifier on fence"** — body `"```select wide\ndisplay: kanban\n```"`, expects `layout: "kanban"`. EC-16 inverse.
5. **"only the first codeblock is honoured"** — body with two `select` codeblocks; first has `display: cards`, second has `display: table`. Expects `layout: "cards"`.
6. **"non-select codeblocks are ignored"** — body `"```js\ndisplay: kanban\n```\n\n```select\ndisplay: bookshelf\n```"`. Expects `layout: "bookshelf"`.
7. **"malformed YAML in codeblock body → renderer-friendly fallback"** — body `"```select\ndisplay: : invalid\n```"`. Expects the parser to return safe defaults (`layout: ""` → triggers FR-12 fallback in tab.ts). EC-16.
8. **"collection-home slug carries through"** — body `"```select\ndisplay: collection-home\n```"`, expects `layout: "collection-home"`. EC-2 inverse / FR-80 read side.
9. **"frontmatter `icon:` survives a codeblock overlay"** — content `"---\nicon: book\n---\n\n```select\ndisplay: cards\n```"`. Expects `layout: "cards"`, `icon: "book"`. EC-19 inverse on the read side.
10. **"empty `path:` in codeblock falls through to default"** — body `"```select\nshow-modified: false\n```"`. Expects `parseFolderMd(...)` to not crash; downstream `path:` resolution uses default (renderer concern).
11. **"`extractSelectCodeblockBody` boundary — direct unit"** — unit-test the helper directly on five corner inputs: no body, body with just the opening fence, body with opening + closing fences but empty inner, body with multiple fences, body with the fence indented (not at column 0 → must return null).

EC mapping in this file: EC-7, EC-16.

FR mapping: FR-55, FR-57.

All tests fail initially: `parseFolderMd()` ignores codeblocks today.

## Implementation outline

```typescript
// extractSelectCodeblockBody — new helper near the top of parser.ts.
export function extractSelectCodeblockBody(body: string): string | null {
  if (!body) return null;
  const lines = body.split("\n");
  // Find opening fence — must start at column 0 (no leading whitespace).
  const openRe = /^```select(?:\s|$)/;
  let openIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (openRe.test(lines[i])) { openIdx = i; break; }
  }
  if (openIdx === -1) return null;
  // Find closing fence — line whose full trimmed content is "```".
  for (let i = openIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === "```") {
      return lines.slice(openIdx + 1, i).join("\n");
    }
  }
  return null;  // Unclosed fence — treat as no codeblock.
}
```

Inside `parseFolderMd()`, after computing `rawBody` (line 456):

```typescript
// AD-2 overlay step.
const cbBody = extractSelectCodeblockBody(rawBody);
if (cbBody !== null) {
  // Lazy-import to avoid a hard plugin-IIFE boundary issue. The select
  // parser lives in src/editor/select-widget.ts which is part of the
  // main app bundle, not the plugin IIFE. If this overlay needs to run
  // inside the plugin IIFE context, inline a local mini-parser using
  // parseYamlLines (already in this file). See "Refactor opportunities".
  const parsedCb = parseSelectBody(cbBody);
  // Project parsedCb onto fm (the normalised flat record we're about to
  // hand to "apply defaults"). The display slug becomes layout:.
  fm["layout"] = parsedCb.display;  // overrides legacy `layout:` if present
  if (parsedCb.rawPath != null) fm["path"] = parsedCb.rawPath;
  // ... project sort, show-modified, show-extensions, preview-pane,
  //     content-width, where (rules), order, group-by, kanban-field, etc.
}
```

**Import boundary concern**: `parser.ts` is part of the plugin IIFE
for `file-browser`. `select-widget.ts` is in `src/editor/` — main
bundle. Importing across this boundary inside a plugin IIFE is
problematic at build time (the plugin builder cannot reach into the
main bundle).

**Resolution**: inline the select-codeblock parsing inside `parser.ts`
by calling `parseYamlLines()` (already in this file) on `cbBody`, then
applying the same shape projections `parseSelectBody()` does. The
boundary parser stays in `parser.ts` and the projection is a few lines
of straightforward key remapping (`display` → `layout`, etc.). No
cross-bundle import.

This is the canonical "reuse the YAML parser, not the wrapper"
approach. `parseYamlLines()` is the single YAML parser in the
codebase; `parseSelectBody()` is just `parseYamlLines()` + shape
projection. The projection logic is small and is acceptable to inline
into `parser.ts` because (a) it keeps the plugin IIFE self-contained,
(b) it has explicit test coverage in this step (tests 7–11), and
(c) NFR-10's "reuse the parser" requirement is satisfied — there is
exactly one YAML parser (`parseYamlLines`).

Final projection logic in `parser.ts`:

```typescript
const cbBody = extractSelectCodeblockBody(rawBody);
if (cbBody !== null) {
  const cbParsed = parseYamlLines(cbBody.split("\n"));
  // Codeblock uses `display:`; folder-view uses `layout:`. Map across.
  const cbDisplay = (cbParsed["display"] as string | undefined)?.trim();
  if (cbDisplay) fm["layout"] = cbDisplay;
  // Path / sort / etc. follow their existing fm keys.
  if (typeof cbParsed["path"] === "string") fm["path"] = cbParsed["path"];
  if (typeof cbParsed["sort"] === "string") fm["sort"] = cbParsed["sort"];
  // Toggles — kebab-case keys carry through unchanged.
  if (typeof cbParsed["show-modified"] === "string")   fm["show-modified"]   = cbParsed["show-modified"];
  if (typeof cbParsed["show-extensions"] === "string") fm["show-extensions"] = cbParsed["show-extensions"];
  if (typeof cbParsed["preview-pane"] === "string")    fm["preview-pane"]    = cbParsed["preview-pane"];
  if (typeof cbParsed["content-width"] === "string")   fm["content-width"]   = cbParsed["content-width"];
  // Arrays (Collections + manual sort): rawFm passthrough since
  // parseYamlLines preserves the array shape on the same key.
  // The existing extractor logic for `exclude`, `order`, `kanban-order`
  // already consumes from rawFm, so we need to merge cbParsed's array
  // keys back INTO rawFm before that step. Code arrangement detail —
  // see implementation diff in the PR.
}
```

`parseSelectBody()` and `parseSelectBodyForBuilder()` continue to live
in `select-widget.ts` and are reused unchanged by the in-doc codefence
widget AND by the modal's edit-mode prefill (step_05). The `_folder.md`
read path uses its own inlined projection (above) to avoid the
cross-bundle import. This is the locked decision; do not change it.

## Refactor opportunities

- Once step_03 lands, audit `parseSelectBody()` and the inlined
  projection in `parser.ts` for drift. If they diverge in a new key,
  add a regression test in `read-compat.test.ts`. Phase 2 may extract
  a shared `select-codeblock-projection.ts` if the duplication exceeds
  ~30 lines.
- `extractSelectCodeblockBody()` could move to a shared utility module
  if the in-doc widget or the modal's edit-mode prefill needs a
  pre-parsed body slice. Phase 1 keeps it co-located with `parser.ts`.

## Definition of Done

- All 11 tests in `tests/view-modal/read-compat.test.ts` pass.
- All existing tests in `tests/folder-view/parser.test.ts` continue to
  pass (the frontmatter-only path is untouched).
- `npm run test:run -- tests/folder-view/ tests/view-modal/read-compat.test.ts` is green.
- `npm run build:plugins && npm run sync:plugins` runs clean.
- No TypeScript errors.
- `parseFolderMd()` is the only entry point used by the renderer; no
  call sites are added to it in this step.

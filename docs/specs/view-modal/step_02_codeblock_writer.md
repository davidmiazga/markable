---
title: "step_02 — Codeblock writer + migration-on-write"
last-updated: "2026-06-08"
review-cadence-days: 7
status: active
---

# step_02 — Codeblock writer + migration-on-write

## Goal

Add an atomic writer that produces the codeblock-shape `_folder.md`.
Strip-on-write removes legacy folder-view-config keys from any
existing frontmatter; non-folder-view keys (e.g. `icon:`) survive.
Single temp-file-swap, no separate migration write (FR-60, FR-61,
AD-4, AD-5).

## Files touched

- **NEW** `src/plugins/file-browser/folder-view/codeblock-writer.ts` —
  new helper module.
- **NEW** `tests/view-modal/migration-on-write.test.ts` — migration
  and atomicity tests.

## Function signatures

```typescript
// src/plugins/file-browser/folder-view/codeblock-writer.ts (NEW)

import type { SelectFormState } from "../../../lib/select-builder";

/**
 * Compose the codeblock-shape `_folder.md` content from a SelectFormState.
 *
 * Pure function — no I/O. Returns the file content string.
 *
 * Shape (no existing frontmatter):
 *
 *   ```select
 *   path: ./
 *   display: cards
 *   ...
 *   ```
 *
 * Shape (existing frontmatter with non-folder-view keys preserved):
 *
 *   ---
 *   icon: book
 *   ---
 *
 *   ```select
 *   display: cards
 *   ...
 *   ```
 *
 * The exact list of folder-view-config keys stripped from frontmatter
 * is the FOLDER_VIEW_CONFIG_KEYS constant (locked per AD-5).
 */
export function composeFolderMdCodeblockContent(
  existingContent: string | null,
  state: SelectFormState,
): string;

/**
 * The list of frontmatter keys this feature owns. Stripped on
 * migration-on-write. Other keys (e.g. `icon:`, `displayName:`) are
 * preserved verbatim.
 */
export const FOLDER_VIEW_CONFIG_KEYS: readonly string[] = [
  "layout", "sort", "show-modified", "show-extensions", "show-tags",
  "show-count", "preview-pane", "preview-height", "content-width",
  "card-width", "layout-mode", "aspect-ratio", "fit", "min-height",
  "max-height", "show-name", "show-folders", "show-files",
  "folders-title", "files-title", "content-area-override",
  "extra-fields", "fields", "exclude", "kanban-field", "kanban-order",
  "order", "group-by", "where", "cover", "type",
];

/**
 * Atomic write of a `_folder.md` in codeblock shape. Reads the existing
 * file (if any), composes the new content, writes via the bridge's
 * atomic temp-file-swap. EC-8 / EC-19 / EC-20 / FR-51.
 *
 * Returns FileResult<void>.
 */
export async function writeFolderMdCodeblock(
  folderPath: string,
  state: SelectFormState,
): Promise<FileResult<void>>;
```

## Failing tests FIRST

Path: `tests/view-modal/migration-on-write.test.ts`. Tests:

1. **"composes minimal codeblock when no existing file"** — `composeFolderMdCodeblockContent(null, ...)` with default state produces `"```select\npath: ./\ndisplay: cards\nsort: name-asc\nshow-modified: true\nshow-extensions: true\npreview-pane: true\n```\n"`. EC-17 inverse.
2. **"strips legacy `layout:` from frontmatter"** — existing content `"---\nlayout: cards\n---\n"`, output has no frontmatter block. EC-8.
3. **"preserves non-folder-view frontmatter keys"** — existing content `"---\nlayout: cards\nicon: book\n---\n"`, output is `"---\nicon: book\n---\n\n```select\n...\n```\n"`. EC-19.
4. **"strips legacy `type: collection`"** — existing content `"---\ntype: collection\n---\n"`, output has no `type:` key. EC-20.
5. **"strips ALL folder-view-config keys at once"** — existing content carries `layout: cards`, `sort: modified-desc`, `show-tags: true`, `card-width: 240`, plus `icon: book`. Output preserves only `icon: book`. AD-5 exhaustive-list pin.
6. **"emits `content-width:` only when non-default"** — state with `contentWidth: "normal"` does NOT emit a `content-width:` line; state with `"wide"` or `"full"` does. Mirrors `buildSelectFenceFromState()` behaviour for round-trip stability.
7. **"emits `where:` rules in the existing select-fence shape"** — state with two rules emits them under `where:` as YAML sequence of `{type, operator, value}` mappings.
8. **"atomic write — `writeFolderMdCodeblock` calls bridge.writeFile exactly once"** — spy on `bridge.writeFile`, assert single invocation regardless of whether migration is required. EC-8 / FR-61.
9. **"empty frontmatter after stripping → frontmatter block removed entirely"** — existing content `"---\nlayout: cards\n---\n"` (only one key, the one being stripped) → output starts with the codeblock, no `---` block above. Matches `reconstructFile()` behaviour for an empty frontmatter array.
10. **"existing file body content after frontmatter is preserved verbatim BEFORE the codeblock is inserted"** — existing content `"---\nlayout: cards\n---\n# My Notes\n\nSome text.\n"`. Output: `"# My Notes\n\nSome text.\n\n```select\n...\n```\n"` (frontmatter stripped; body retained; codeblock appended). NOTE: the canonical create-mode shape (test 1) has the codeblock at the top of the body because there is no existing body content; the migration case retains existing body. **Architect decision: in the migration path, the codeblock is inserted AT THE TOP of the body (before any retained body content) so a re-read does not have to scan past unrelated markdown.** Test 10 is amended accordingly: output is `"\n```select\n...\n```\n\n# My Notes\n\nSome text.\n"`. The retained body content moves below the codeblock.
11. **"existing codeblock in body is replaced, not duplicated"** — existing content `"---\nlayout: cards\n---\n\n```select\ndisplay: kanban\n```\n"`. Output has exactly one `select` codeblock; the old one is removed. (Same as test 1 but with a pre-existing legacy codeblock that we are overwriting.)

EC mapping in this file: EC-8, EC-17, EC-19, EC-20.

FR mapping: FR-50, FR-51, FR-52, FR-60, FR-61, FR-63.

All tests fail initially: the writer module does not exist.

## Implementation outline

```typescript
// src/plugins/file-browser/folder-view/codeblock-writer.ts

import { readFile, writeFile } from "../../../lib/bridge";
import {
  parseYamlFrontmatter,
  removeYamlKey,
  reconstructFile,
} from "./yaml-frontmatter";
import { buildSelectFenceFromState } from "../../../lib/select-builder";
import { extractSelectCodeblockBody } from "./parser";

const FOLDER_MD_NAME = "_folder.md";
const FOLDER_VIEW_CONFIG_KEYS = [ /* ... locked list ... */ ] as const;

function folderMdPath(folderPath: string): string {
  return folderPath.replace(/\/+$/, "") + "/" + FOLDER_MD_NAME;
}

/**
 * Strip the first `select` codeblock from a body string. Returns the
 * body with that codeblock removed (and one trailing blank line
 * collapsed). Used by the migration path so we replace the legacy
 * codeblock rather than duplicating it.
 */
function stripFirstSelectCodeblock(body: string): string {
  const lines = body.split("\n");
  let openIdx = -1, closeIdx = -1;
  const openRe = /^```select(?:\s|$)/;
  for (let i = 0; i < lines.length; i++) {
    if (openRe.test(lines[i])) { openIdx = i; break; }
  }
  if (openIdx === -1) return body;
  for (let i = openIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === "```") { closeIdx = i; break; }
  }
  if (closeIdx === -1) return body;
  // Remove lines [openIdx, closeIdx] inclusive.
  const before = lines.slice(0, openIdx);
  const after  = lines.slice(closeIdx + 1);
  // Collapse a single leading blank line in `after` if `before` ends
  // with a blank (avoids a double-blank seam).
  if (after[0] === "" && (before.length === 0 || before[before.length - 1] === "")) {
    after.shift();
  }
  return [...before, ...after].join("\n");
}

export function composeFolderMdCodeblockContent(
  existingContent: string | null,
  state: SelectFormState,
): string {
  const fence = buildSelectFenceFromState(state);  // includes the ``` lines

  if (existingContent == null) {
    return fence + "\n";
  }

  const parsed = parseYamlFrontmatter(existingContent);
  // Strip folder-view-config keys from frontmatter.
  let fmLines = parsed.frontmatterLines;
  for (const key of FOLDER_VIEW_CONFIG_KEYS) {
    fmLines = removeYamlKey(fmLines, key);
  }

  // Strip any existing select codeblock from the body (avoid duplicates).
  const bodyText = parsed.bodyLines.join("\n");
  const strippedBody = stripFirstSelectCodeblock(bodyText);

  // Compose: optional frontmatter (only if non-empty), blank line, fence,
  // blank line, remaining body. The reconstructor handles the
  // "empty frontmatter → strip block" case (yaml-frontmatter.ts EC-23).
  const reconstructed = reconstructFile({
    hasFrontmatter: parsed.hasFrontmatter,
    frontmatterLines: fmLines,
    // Body becomes: [blank, fence, blank, ...strippedBodyLines] when
    // the frontmatter is preserved (separator); otherwise just the
    // fence at the top of the body.
    bodyLines: fmLines.length > 0
      ? ["", ...fence.split("\n"), "", ...strippedBody.split("\n")]
      : [...fence.split("\n"), "", ...strippedBody.split("\n")],
  });

  return reconstructed;
}

export async function writeFolderMdCodeblock(
  folderPath: string,
  state: SelectFormState,
): Promise<FileResult<void>> {
  const absPath = folderMdPath(folderPath);
  const readRes = await readFile(absPath);
  const existing = readRes.ok ? readRes.value : null;
  const newContent = composeFolderMdCodeblockContent(existing, state);
  return writeFile(absPath, newContent);
}
```

Edge-case nuances locked at implementation time:

- The blank-line separator between `---` and the codeblock is required
  (AD-5). The `bodyLines: ["", ...fence...]` shape ensures it.
- `reconstructFile()` handles the empty-frontmatter case by emitting
  body-only (already covered by `yaml-frontmatter.ts` EC-23). When all
  folder-view-config keys are stripped and no other keys remain, the
  output has no frontmatter block — matching test 9.
- Existing body content (test 10) is preserved BELOW the new codeblock
  via the trailing `...strippedBody.split("\n")`. The codeblock
  always sits at the top of the body for easy re-read.

## Refactor opportunities

- The `stripFirstSelectCodeblock` helper duplicates the boundary logic
  of `extractSelectCodeblockBody` (step_01). If the two diverge, a
  shared "find-fence-range" utility may emerge in Phase 2. For Phase 1
  they live in their respective modules with explicit tests.
- `composeFolderMdCodeblockContent` could accept an `existingFrontmatterKeys`
  hint to skip the read when the caller already knows the file does
  not exist (modal create mode). Defer until profiling shows the read
  is a bottleneck (FR-51 atomicity is the priority, not throughput).

## Definition of Done

- All 11 tests in `tests/view-modal/migration-on-write.test.ts` pass.
- `npm run test:run -- tests/view-modal/migration-on-write.test.ts` is green.
- `npm run test:run -- tests/folder-view/yaml-frontmatter.test.ts` continues to pass (composed primitive is untouched).
- `npm run build:plugins && npm run sync:plugins` runs clean.
- No TypeScript errors.
- `writeFolderMdCodeblock()` is exported but NOT yet called from any
  feature code; step_05 wires it to the modal.

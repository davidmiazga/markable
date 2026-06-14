---
title: "step_03 — Collections writes codeblock shape"
last-updated: "2026-06-08"
review-cadence-days: 7
status: active
---

# step_03 — Collections writes codeblock shape

## Goal

Refactor `writeCollectionMeta()` and `writeStackMeta()` in
`src/plugins/file-browser/collections/store.ts` to emit the codeblock
shape rather than frontmatter. Read-compat for both legacy
`type: collection` AND legacy frontmatter `layout: collection-home`.
Migration-on-write strips both legacy markers when rewriting. The
reverse-index (`reference-integrity-wiring.ts`) keeps working because
it consumes the typed `CollectionMeta` / `StackMeta` shape via
`readCollection()` / `readStack()` — those readers are extended in
this step.

## Files touched

- **EDIT** `src/plugins/file-browser/collections/store.ts` — write
  paths emit codeblock; read paths add codeblock-first precedence.
- **NEW** `tests/collections/migration-codeblock.test.ts` — Collections-
  specific migration tests.
- **EDIT** existing tests in `tests/collections/store.test.ts` — many
  tests assert frontmatter shape today; they update to expect
  codeblock shape on write and accept both shapes on read.

## Function signatures

No signature changes. `writeCollectionMeta()`, `writeStackMeta()`,
`readCollection()`, `readStack()` all retain their existing
signatures and FileResult<T> return shape.

What changes is the on-disk format produced by the writers and the
parse order in the readers:

### Read order (locked)

1. **Body codeblock first.** Call `extractSelectCodeblockBody()`
   (step_01) on the body. If found, parse via `parseYamlLines()` and
   pull `displayName:`, `stackOrder:` (collection) or `displayName:`,
   `icon:`, `order:`, `references:` (stack) out of the parsed map.
2. **Legacy frontmatter fallback.** If no codeblock, parse the
   frontmatter as today. Legacy `type: collection` still maps to
   `layout: collection-home` per the existing R04 read-compat shim.
3. **Schema-too-new gate** (EC-13 in the Collections spec) applies to
   both shapes uniformly — the `schemaVersion:` key is read from
   whichever shape wins.

### Write shape (locked)

Collection root `_folder.md`:

```markdown
```select
schemaVersion: 1
layout: collection-home
displayName: "MyCollection"
stackOrder:
  - "Stack 01"
  - "Stack 02"
icon: bookshelf
```
```

Stack `_folder.md`:

```markdown
```select
schemaVersion: 1
displayName: "Stack 01"
icon: notebook
order:
  - "MyNotecard.md"
references:
  - "Projects/Stack 02/Referenced Note.md"
```
```

Notes:
- `schemaVersion` and `layout` (collection root only) are written
  unconditionally so the file is self-describing.
- All array keys are emitted with the existing per-item double-quoted
  YAML scalar shape (see `escapeYamlString` in `store.ts:111`).
- The Collection root's `layout: collection-home` value is the
  canonical marker; the legacy `type: collection` field is stripped on
  the same atomic write.

## Failing tests FIRST

Path: `tests/collections/migration-codeblock.test.ts`. Tests:

1. **"writeCollectionMeta on new file emits codeblock shape"** — empty file → output starts with ```` ```select ```` and contains `layout: collection-home`.
2. **"writeCollectionMeta on legacy `type: collection` strips type and writes codeblock"** — input `"---\ntype: collection\ndisplayName: Old\nstackOrder:\n  - \"S\"\n---\n"` → output has no frontmatter `type:` and a codeblock with `layout: collection-home` + `displayName: "Old"` + `stackOrder: ["S"]`. EC-20.
3. **"writeCollectionMeta on legacy `layout: collection-home` frontmatter strips frontmatter and writes codeblock"** — similar to #2 but the legacy shape is `layout:`, not `type:`. Same outcome.
4. **"writeStackMeta emits codeblock with references array"** — patch with `references: ["a/b/c.md"]`, output has `references:\n  - "a/b/c.md"` inside the codeblock.
5. **"readCollection reads codeblock shape — codeblock wins over frontmatter"** — file with BOTH frontmatter `layout: cards` AND codeblock `layout: collection-home`. Expected: `meta.layout === "collection-home"`. (Tests precedence order.)
6. **"readCollection falls back to legacy frontmatter when no codeblock"** — file with only frontmatter `layout: collection-home`. Expected: same meta shape. EC-7 equivalent for Collections.
7. **"readCollection falls back to legacy `type: collection` when no codeblock and no layout: in frontmatter"** — file with only `type: collection`. Expected: same meta shape with `layout: "collection-home"`. R04 read-compat preserved.
8. **"reference-index round-trip — Stack with codeblock shape is discoverable"** — write a Stack with one reference via `writeStackMeta()`, run `referenceIndex.rebuild()`, assert `lookup()` returns the Stack's `_folder.md` path. EC-7 / FR-20…FR-26 round-trip.
9. **"reverse-index — onCanonicalRenamed rewrites the references array inside the codeblock"** — set up a Stack with `references: ["old/path.md"]`, call `onCanonicalRenamed("old/path.md", "new/path.md")`, read the file, assert the codeblock body now carries `"new/path.md"`. FR-25 / EC-20 (Collections spec).
10. **"schema-too-new gate fires for codeblock shape"** — write a file with `schemaVersion: 99` inside the codeblock; subsequent `writeCollectionMeta()` rejects with `schema-too-new`. EC-13 (Collections spec) carryover.
11. **"two atomic writes — first creates, second updates — both produce codeblock shape"** — verify the writer is idempotent on its own output.

EC mapping in this file: EC-7 (Collections side), EC-20.

FR mapping: FR-50, FR-60, FR-63, FR-81.

All tests fail initially: `writeCollectionMeta` / `writeStackMeta`
emit frontmatter today.

## Existing test churn

The following existing tests in `tests/collections/store.test.ts`
assert frontmatter output shape. They MUST be updated to expect
codeblock shape on write while still accepting both shapes on read.
Listed by test name; the Lead Developer applies the changes during
step_03 (no separate step):

- `"EC-7 — type: collection read-compat ..."` — already a read test;
  add a parallel test that uses codeblock shape.
- `"writeCollectionMeta sets displayName and stackOrder ..."` —
  changes from "assert frontmatter contains displayName:" to "assert
  codeblock body contains displayName:".
- `"writeStackMeta with order array ..."` — same change.
- `"writeStackMeta with references ..."` — same change.
- Any test that does a raw string comparison on the full file content
  needs the expectation rewritten to the codeblock shape.

The Lead Developer's responsibility in step_03 is to (a) update the
existing test expectations to codeblock shape, (b) add the 11 new
migration tests above, (c) verify all 173 existing Collections tests
either pass on the new shape OR are explicitly noted in the spec as
"intentional shape update". No silently-skipped tests.

## Implementation outline

```typescript
// store.ts changes

// writeCollectionMeta — new shape composition.
export async function writeCollectionMeta(
  folderPath: string,
  patch: Partial<CollectionMeta>,
): Promise<FileResult<void>> {
  const absPath = folderMdPath(folderPath);
  return withFileQueue(absPath, async () => {
    // Read current state.
    const readRes = await readFile(absPath);
    const existing = readRes.ok ? readRes.value : null;

    // Read current meta (codeblock-first per the read order locked above).
    const current = await readCollectionInternal(existing);

    // Schema gate.
    if (current.schemaVersion > COLLECTIONS_SCHEMA_VERSION) {
      return { ok: false as const, error: { message: "schema-too-new", ... } };
    }

    // Apply patch on top of current.
    const next: CollectionMeta = {
      schemaVersion: COLLECTIONS_SCHEMA_VERSION,
      layout: COLLECTION_LAYOUT_KEY,
      displayName: patch.displayName ?? current.displayName,
      stackOrder: patch.stackOrder ?? current.stackOrder,
      icon: patch.icon ?? current.icon,
    };

    // Compose: legacy frontmatter (with folder-view + Collections keys
    // stripped) + new codeblock body that carries the Collections shape.
    // Reuse composeFolderMdCodeblockContent from step_02 but supply a
    // custom fence-builder that emits the Collection-specific keys.
    const fence = buildCollectionFence(next);
    const newContent = composeFolderMdShellWithFence(existing, fence, COLLECTION_STRIP_KEYS);

    return writeFile(absPath, newContent);
  });
}

function buildCollectionFence(meta: CollectionMeta): string {
  const lines: string[] = ["```select"];
  lines.push(`schemaVersion: ${meta.schemaVersion}`);
  if (meta.layout) lines.push(`layout: ${meta.layout}`);
  lines.push(`displayName: ${escapeYamlString(meta.displayName)}`);
  if (meta.stackOrder.length > 0) {
    lines.push("stackOrder:");
    for (const s of meta.stackOrder) lines.push(`  - ${escapeYamlString(s)}`);
  }
  if (meta.icon) lines.push(`icon: ${escapeYamlString(meta.icon)}`);
  lines.push("```");
  return lines.join("\n");
}

// The strip-keys list for Collections is the union of:
//   FOLDER_VIEW_CONFIG_KEYS (step_02)
//   Collections-specific keys: schemaVersion, displayName, stackOrder,
//                              order, references, icon (when in codeblock)
// Reuses composeFolderMdShellWithFence which is a small generalisation
// of composeFolderMdCodeblockContent: takes a fence string + a list of
// keys to strip, instead of building the fence itself.
```

The `composeFolderMdShellWithFence(existing, fence, stripKeys)` helper
generalises the step_02 logic. Both call sites (step_02 view modal,
step_03 Collections) compose it with their own fence builder. **Action
for Lead Developer**: during step_03 implementation, extract this
helper from step_02's `composeFolderMdCodeblockContent` so both step_02
and step_03 share it. The extraction is a refactor of step_02's
implementation — no behaviour change in step_02's tests.

`readCollection()` / `readStack()` add a codeblock-first read path:

```typescript
async function readCollectionInternal(content: string | null): Promise<CollectionMeta> {
  const meta = defaultCollectionMeta(displayNameFromPath);
  if (content == null) return meta;

  // Codeblock-first.
  const cbBody = extractSelectCodeblockBody(parseYamlFrontmatter(content).bodyLines.join("\n"));
  if (cbBody !== null) {
    const cbParsed = parseYamlLines(cbBody.split("\n"));
    return {
      schemaVersion: parseSchemaVersion(cbParsed.schemaVersion),
      layout: asString(cbParsed.layout) === COLLECTION_LAYOUT_KEY ? COLLECTION_LAYOUT_KEY : undefined,
      displayName: asString(cbParsed.displayName) ?? meta.displayName,
      stackOrder: asStringArray(cbParsed.stackOrder) ?? [],
      icon: asString(cbParsed.icon),
    };
  }

  // Frontmatter fallback (existing R04 logic; unchanged).
  const parsed = parseYamlFrontmatter(content);
  // ... existing layout/type read-compat shim ...
}
```

`reference-integrity-wiring.ts` does not change: it calls
`readStack()` / `writeStackMeta()` which now route through the
codeblock shape transparently.

## Refactor opportunities

- Extract `composeFolderMdShellWithFence(existing, fence, stripKeys)`
  into a shared module (e.g. `src/plugins/file-browser/folder-view/folder-md-shell.ts`)
  consumed by both step_02 and step_03.
- The Collections-specific fence-builder (`buildCollectionFence`) and
  the view-modal's `buildSelectFenceFromState` are conceptually
  parallel. Phase 2 may unify them; Phase 1 keeps them separate for
  test clarity.
- `readCollectionInternal` and `readStackInternal` duplicate the
  "codeblock-first, frontmatter-fallback" boilerplate. A small generic
  `readMetaFromFolderMd(content, cbToMeta, fmToMeta)` helper would DRY
  them. Defer to Phase 2 unless the duplication exceeds ~40 lines.

## Definition of Done

- All 11 new tests in `tests/collections/migration-codeblock.test.ts` pass.
- All 173 existing tests in `tests/collections/` pass (some with updated expectations per the "Existing test churn" section).
- `tests/collections/reference-integrity.test.ts` passes — the reverse-index round-trip works through the codeblock shape.
- `tests/collections/store.test.ts` passes with the shape-update edits.
- `npm run test:run -- tests/collections/ tests/view-modal/` is green.
- `npm run build:plugins && npm run sync:plugins` runs clean.
- No TypeScript errors.
- Manual smoke: open the Collections home of a vault that was created
  pre-refactor. Verify it renders identically (read-compat). Trigger a
  Stack rename. Verify the resulting file uses the codeblock shape.

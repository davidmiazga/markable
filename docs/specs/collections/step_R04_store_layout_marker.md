---
title: "Step R04 — Store: layout: collection-home as Discovery Marker"
last-updated: "2026-06-06"
review-cadence-days: 7
status: active
---

# Step R04 — Store Refactor: `layout:` as Marker, with Read-Compat + Migration-on-Write

## Goal

Switch the on-disk Collections marker from `type: collection` to
`layout: collection-home`. Three coordinated changes:

1. **Reads**: `readCollection()` returns a populated CollectionMeta
   when either `layout: collection-home` OR legacy `type: collection`
   is present. When BOTH are present, the new marker wins; the legacy
   field is ignored on the read path. **No write happens on read.**
2. **Writes**: `writeCollectionMeta()` and `writeStackMeta()` no
   longer emit `type: collection` / `type: stack`. They DO emit
   `layout: collection-home` on the Collection root. If the on-disk
   file carries a legacy `type:` field, that field is stripped in
   the same atomic write that performs the user's mutation
   (migration-on-write).
3. **Types**: `CollectionMeta.type` and `StackMeta.type` become
   optional so the legacy field is representable for tests; add
   `layout?: "collection-home"` to `CollectionMeta` (the canonical
   marker).

This step is the read-compat half of FR-4 / FR-5 / EC-7 / EC-8 and
the write-side of FR-1 / FR-2 / FR-3.

## Files touched

- **Edit** `src/plugins/file-browser/collections/store.ts`
- **Edit** `src/plugins/file-browser/collections/types.ts`
- **Edit** `src/plugins/file-browser/collections/schema.ts` (add a
  layout-key constant; optional)
- **Edit** `tests/collections/store.test.ts` (fixtures + new cases)
- **Edit** `tests/collections/types.test.ts` (optional `type:` field)

## Function signatures to add / edit / delete

### Edit `types.ts`

```typescript
export interface CollectionMeta {
  readonly schemaVersion: number;
  // Legacy marker; optional after the refactor. New writes do NOT emit
  // this field. Reads tolerate it as an alias for layout: collection-home.
  readonly type?: "collection";
  // New canonical marker; the picker writes this via the codeblock fence's
  // `display:` field, which `parseFolderMd` maps to frontmatter `layout:`.
  readonly layout?: "collection-home";
  readonly displayName: string;
  readonly stackOrder: readonly string[];
  readonly icon?: string;
}

export interface StackMeta {
  readonly schemaVersion: number;
  // Legacy marker; optional after the refactor. Stacks no longer need
  // a marker — they're identified by being a subfolder of a layout:
  // collection-home folder.
  readonly type?: "stack";
  readonly displayName: string;
  readonly icon: string;
  readonly order: readonly string[];
  readonly references: readonly string[];
}
```

### Edit `schema.ts`

```typescript
// Add a constant for the layout-key string so it's centralised:
export const COLLECTION_LAYOUT_KEY = "collection-home";

// Existing COLLECTION_YAML_KEYS gets a new entry:
export const COLLECTION_YAML_KEYS = {
  schemaVersion: "schemaVersion",
  type:          "type",         // legacy; read-compat only
  layout:        "layout",       // NEW canonical marker
  displayName:   "displayName",
  stackOrder:    "stackOrder",
  order:         "order",
  references:    "references",
  icon:          "icon",
} as const;
```

### Edit `store.ts` — `readCollection`

```typescript
export async function readCollection(
  folderPath: string,
): Promise<FileResult<CollectionMeta>> {
  const absPath = folderMdPath(folderPath);
  const r = await readFolderMdInternal(absPath);
  const displayName = folderBasename(folderPath);
  if (r.state !== "ok") {
    return { ok: true, value: defaultCollectionMeta(displayName) };
  }

  // Determine marker presence. The new layout: collection-home wins
  // when both are present (RQ-4 precedence).
  const layoutValue = readYamlScalar(r.frontmatterLines, COLLECTION_YAML_KEYS.layout);
  const typeValue   = readYamlScalar(r.frontmatterLines, COLLECTION_YAML_KEYS.type);
  const isCollection =
    layoutValue === COLLECTION_LAYOUT_KEY ||
    (layoutValue == null && typeValue === "collection");

  // Even when neither marker is present, return the meta. The renderer's
  // dispatch already gates on layout: collection-home — readCollection's
  // job is to extract a CollectionMeta-shaped object, not to gate.
  const meta: CollectionMeta = {
    schemaVersion: /* unchanged */,
    // Surface the canonical marker so downstream code can branch on it.
    layout: isCollection ? COLLECTION_LAYOUT_KEY : undefined,
    // type: stays absent on the returned object. Don't surface the legacy field.
    displayName: /* unchanged */,
    stackOrder:  /* unchanged */,
    icon:        /* unchanged */,
  };
  return { ok: true, value: meta };
}
```

### Edit `store.ts` — `writeCollectionMeta`

```typescript
export async function writeCollectionMeta(
  folderPath: string,
  patch: Partial<CollectionMeta>,
): Promise<FileResult<void>> {
  /* ... open queue + schemaVersion guard (unchanged) ... */

  // Always set schemaVersion + the canonical layout: marker.
  frontmatter = applyYamlKey(
    frontmatter,
    COLLECTION_YAML_KEYS.schemaVersion,
    String(patch.schemaVersion ?? COLLECTIONS_SCHEMA_VERSION),
  );
  frontmatter = applyYamlKey(
    frontmatter,
    COLLECTION_YAML_KEYS.layout,
    COLLECTION_LAYOUT_KEY,
  );

  // MIGRATION: if the on-disk frontmatter carried `type: collection`,
  // strip it in the same atomic write. removeYamlKey is a no-op when
  // the key is absent, so this is safe on already-migrated files.
  frontmatter = removeYamlKey(frontmatter, COLLECTION_YAML_KEYS.type);

  if (patch.displayName !== undefined) { /* unchanged */ }
  if (patch.stackOrder  !== undefined) { /* unchanged */ }
  if (patch.icon        !== undefined) { /* unchanged */ }

  /* ... reconstructFile + writeFile (unchanged) ... */
}
```

### Edit `store.ts` — `writeStackMeta`

```typescript
export async function writeStackMeta(
  stackPath: string,
  patch: Partial<StackMeta>,
): Promise<FileResult<void>> {
  /* ... open queue + schemaVersion guard (unchanged) ... */

  // Stacks do NOT emit a marker. They're identified by being a
  // subfolder of a layout: collection-home folder.

  frontmatter = applyYamlKey(
    frontmatter,
    COLLECTION_YAML_KEYS.schemaVersion,
    String(patch.schemaVersion ?? COLLECTIONS_SCHEMA_VERSION),
  );
  // DROPPED: the `applyYamlKey(frontmatter, "type", "stack")` call.

  // MIGRATION: strip any legacy `type: stack` field.
  frontmatter = removeYamlKey(frontmatter, COLLECTION_YAML_KEYS.type);

  if (patch.displayName !== undefined) { /* unchanged */ }
  if (patch.icon        !== undefined) { /* unchanged */ }
  if (patch.order       !== undefined) { /* unchanged */ }
  if (patch.references  !== undefined) { /* unchanged */ }

  /* ... reconstructFile + writeFile (unchanged) ... */
}
```

The block-sequence array writers (`writeWithStackOrder`,
`writeStackArrayKey`) ALSO need migration-on-write. They preserve
unrelated keys — so legacy `type:` lines pass through unchanged.
Add a single `removeYamlKey(frontmatter, "type")` call to each, in
the same temp-file-swap, BEFORE the `writeYamlArray` call. This
ensures every mutation path migrates the file.

### `readStack` already tolerates absent `type:` (it reads
`displayName`, `icon`, `order`, `references` directly — no marker
check). No edit needed beyond the type relaxation.

## Failing tests to write FIRST

### Add to `tests/collections/store.test.ts`

| Test name | EC / FR | Asserts |
|---|---|---|
| `"FR-1 — writeCollectionMeta emits layout: collection-home, NOT type: collection"` | FR-1 | Call `writeCollectionMeta(path, { displayName: "X" })` on an empty folder; read back the resulting `_folder.md`; assert content contains `layout: collection-home`; assert content does NOT contain `type: collection`. |
| `"FR-1 — writeStackMeta does NOT emit type: stack"` | FR-1 | Call `writeStackMeta(path, { displayName: "Y" })`; assert resulting content does NOT contain `type: stack`. |
| `"EC-7 — readCollection accepts legacy type: collection (no layout:) and returns layout: collection-home in meta"` | EC-7 | Pre-write `_folder.md` literally containing `type: collection` only; call `readCollection`; assert returned `meta.layout === "collection-home"`. Assert NO write occurred (mock the `writeFile` spy; assert it was not called). |
| `"EC-7 — readCollection: when both layout: and type: are on disk, layout: wins"` | EC-7 | Pre-write a file with BOTH `layout: collection-home` and `type: collection`; `readCollection` returns `meta.layout === "collection-home"`; meta has no `type` field surfaced. |
| `"EC-8 — writeCollectionMeta strips legacy type: collection in the same atomic write"` | EC-8 | Pre-write a file with `type: collection` only; call `writeCollectionMeta` with any mutation; read back; assert content has `layout: collection-home`, no `type: collection`. Assert exactly ONE writeFile call (i.e. no separate migration write). |
| `"EC-8 — appendStackToCollection on a legacy `type: collection` folder strips the legacy marker"` | EC-8 | Same as above but using a different mutator. Migration applies to every write path. |
| `"EC-8 — reorderNote on a legacy `type: stack` Stack strips the legacy marker"` | EC-8 | Same shape; per-Stack `_folder.md` migration. |
| `"readCollection on a folder with neither marker returns meta.layout === undefined"` | (sanity) | Reading a plain folder with `_folder.md: schemaVersion: 1` only returns meta with `layout: undefined`; the dispatch path correctly does not render Collections. |

### Edit existing cases in `store.test.ts`

Every existing test that asserted `frontmatter.includes("type: collection")`
or `type: stack` must be updated:
- Replace the assertion with `frontmatter.includes("layout: collection-home")`
  (for Collection roots) or `!frontmatter.includes("type:")` (for Stacks).
- Where the test PRE-populates a fixture with `type: collection`, leave
  it — those become the legacy-fixture tests (now exercising read-compat).

### `tests/collections/types.test.ts`

Add a test asserting that `CollectionMeta` and `StackMeta` accept `type:
undefined` and `type` absent.

## Implementation outline

1. **Write the new EC-7 / EC-8 tests.** They fail because reads do not
   alias legacy `type:` and writes still emit `type:`.
2. **Edit `types.ts`** to relax `.type` to optional and add `.layout?`.
3. **Edit `schema.ts`** to add `COLLECTION_LAYOUT_KEY` and the `layout`
   entry in `COLLECTION_YAML_KEYS`.
4. **Edit `readCollection`** to read both fields and decide presence.
5. **Edit `writeCollectionMeta`** to emit `layout:` and strip legacy
   `type:` in the same write.
6. **Edit `writeStackMeta`** to drop the `type: stack` emission and
   strip legacy `type:` in the same write.
7. **Edit `writeWithStackOrder`** and `writeStackArrayKey`** to also
   strip legacy `type:` (every mutation path migrates).
8. **Edit existing tests** to use the new fixtures.
9. **Verify**:
   - `npm run test:run -- tests/collections/store.test.ts` green.
   - `npm run test:run -- tests/collections/types.test.ts` green.
   - Combined with R03 in the same commit chain: open a legacy folder
     created via the shipped Make Collection — it renders correctly.
     Trigger any mutation — the `type: collection` line is gone from
     disk; `layout: collection-home` is present.
10. **Plugin rebuild**: `npm run build:plugins && npm run sync:plugins`.

## Refactor opportunities

- The `applyYamlKey` + `removeYamlKey` pair is now repeated in several
  writers. A helper `applyCollectionMarker(frontmatter): string[]`
  that does both could DRY up the writers — opportunistic.
- `parseFolderMd` (in `folder-view/parser.ts`) reads `layout:` and
  returns it via `config.layout`. The dispatch path uses
  `config.layout.toLowerCase()`. After R04, a legacy `type: collection`
  folder still has empty `config.layout` (because `parseFolderMd`
  doesn't know about the legacy field). The aliasing happens INSIDE
  `readCollection`, not in `parseFolderMd`. This means the dispatch
  path in `tab.ts` does NOT pick up legacy folders automatically — but
  the Collections renderer reads via `store.readCollection` and gets
  the alias.

  **Critical clarification:** for `tab.ts` to dispatch a legacy folder
  to the Collections renderer, the `config.layout` it reads must be
  `"collection-home"`. Since `parseFolderMd` doesn't know about the
  legacy alias, the alias has to happen somewhere earlier in the
  dispatch chain. Options:

  (a) **Alias in `parseFolderMd`** — synthesise `config.layout =
      "collection-home"` when `type: collection` is present. Smallest
      surface area but pollutes the generic parser with Collections
      knowledge.

  (b) **Alias in `tab.ts`'s render-tab function** — after the parse,
      check the raw frontmatter for legacy `type: collection` and
      overwrite `layoutKey`. Smaller scope but adds a tiny one-off
      branch.

  (c) **Reintroduce a thin `detectCollectionLayout` helper** — pure
      readonly check (no short-circuit semantics, just a read-compat
      shim). The R03 deletion is then partial — keep
      `detection-glue.ts` for this single purpose.

  **Architect's choice: option (b).** It's the smallest change, lives
  inside the dispatch flow that already does the parse, and has no
  cross-module fanout. The implementation: after `parseFolderMd`
  returns, if `config.layout === ""` (empty), peek the
  `extractFrontmatterKeys(content, ["type"])` result; if it equals
  `"collection"`, set `layoutKey = "collection-home"`. The
  re-introduced branch is THREE LINES and lives inline; no separate
  module. **This re-introduces a small short-circuit but ONLY for
  the legacy alias — it's a one-line `if` that has no semantic
  baggage like the deleted detection-glue had.**

  Update step_R03's DELETE list: keep `tab.ts:339–355` deletion, but
  add back a THREE-LINE block reading the legacy field. The block
  belongs in this step (R04) since it's part of the read-compat
  contract.

  Add to `tab.ts` (after parsing `config`):

  ```typescript
  let layoutKey = config.layout.toLowerCase();
  // Read-compat alias: a folder created by the pre-refactor Make Collection
  // gesture has `type: collection` but no `layout:` field. Treat that
  // case as `layout: collection-home`. The migration to the new key
  // happens on the next user-initiated write to _folder.md (see
  // store.writeCollectionMeta). This is the ONLY Collections-specific
  // line in tab.ts post-refactor.
  if (!layoutKey) {
    const probe = extractFrontmatterKeys(content, ["type"]);
    if (probe.type === "collection") layoutKey = "collection-home";
  }
  ```

  `extractFrontmatterKeys` is already imported. `content` is the raw
  string read at line 324.

## Definition of Done

```bash
npm run test:run -- tests/collections/store.test.ts
npm run test:run -- tests/collections/types.test.ts
npm run test:run -- tests/collections/dispatch.test.ts
npm run test:run -- tests/collections/
```

Expected: every store test green; the new EC-7 / EC-8 cases green;
dispatch tests still green (the three-line legacy alias does NOT
re-introduce the deleted `detectCollectionLayout` symbol — only an
inline `extractFrontmatterKeys` call).

Manual smoke check:
- Pre-populate a `_folder.md` with literally:
  ```yaml
  ---
  schemaVersion: 1
  type: collection
  displayName: Legacy
  stackOrder: []
  ---
  ```
  Open the folder → renders as Collections. File on disk unchanged.
- Trigger any mutation (create a Stack, drag a note, rename a Stack).
  Re-read the file → `type: collection` is gone; `layout: collection-home`
  is present. The `displayName: Legacy` line is preserved.

Plugin rebuild required.

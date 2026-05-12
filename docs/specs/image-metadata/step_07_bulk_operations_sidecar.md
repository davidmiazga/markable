---
title: "Step 07 — bulk-operations.ts: Sidecar Write Extension"
last-updated: "2026-05-12"
review-cadence-days: 7
status: active
---

# Step 07 — bulk-operations.ts: Sidecar Write Extension

## Goal

Extend `executeBulkYaml` in `bulk-operations.ts` to write to sidecar files for non-`.md`
image (and other) files instead of skipping them (FR-5). Update `formatOperationResult`
to reflect that "skipped" now means directories only, not non-`.md` files.

## Prerequisites

- Step 04: `IMAGE_EXTENSIONS` defined in `tab.ts`. However, `bulk-operations.ts` does NOT
  import from `tab.ts` (it is a separate IIFE module file). The image extension knowledge
  is NOT needed in bulk-operations — the sidecar write applies to ALL non-`.md` files, not
  just image files. Any non-`.md`, non-directory file gets sidecar treatment.

---

## Files Modified

| File | Change |
|------|--------|
| `src/plugins/file-browser/folder-view/bulk-operations.ts` | Modify `executeBulkYaml` sidecar write path; update `formatOperationResult` |

---

## TDD Sequence

Add tests to the existing `tests/folder-view/bulk-operations.test.ts`.

### New tests

```
BY-01  Selection contains photo.jpg → sidecarPath = "/vault/photo.jpg.md";
       invoke("read_file", { path: sidecarPath }) is called;
       invoke("write_file", { path: sidecarPath, content: updatedContent }) is called;
       result.succeeded = 1, result.skippedCount = 0

BY-02  Selection contains photo.jpg and sidecar does not exist (read_file throws "File not found") →
       op="add": write_file called with minimal frontmatter;
       result.succeeded = 1, result.skippedCount = 0  (EC-8: write_file creates the file)

BY-03  Selection contains a directory → result.skippedCount = 1 (directories still skipped)

BY-04  Selection contains photo.jpg AND notes.md (mixed) →
       photo.jpg: write to photo.jpg.md (sidecar write)
       notes.md: write directly
       result.succeeded = 2, result.skippedCount = 0  (EC-21)

BY-05  Selection contains photo.jpg, sidecar exists, has frontmatter, op="add" key="rating" value="5" →
       sidecar content updated, rating key set to "5"  (EC-9)

BY-06  Selection contains photo.jpg, sidecar does not exist, op="remove" →
       read_file throws "File not found"; result.failed has one entry with "File not found: ...";
       result.succeeded = 0  (EC-10)

BY-07  Selection contains photo.jpg, sidecar has malformed frontmatter, op="add" →
       parsed.malformed = true; result.failed has one entry with "Could not parse frontmatter in: ..."
       (EC-11)

BY-08  Selection contains photo.jpg, sidecar does not exist, op="add" key="rating" value="5" →
       write_file called with content "---\nrating: 5\n---\n"; result.succeeded = 1
       (new sidecar created with minimal frontmatter)

BY-09  formatOperationResult: skippedCount=1 (directory), succeeded=2 → summary includes
       "2 of 2 files" and "(1 item(s) skipped — directory)" — see updated message format below

BY-10  formatOperationResult: all image files processed (skippedCount=0) →
       no skip annotation in summary

BY-11  op="remove" on existing sidecar that does not have the key → write_file still called
       (idempotent, per existing EC-09 behaviour)
```

---

## Implementation

### Updated skip logic in `executeBulkYaml`

Current skip logic (lines 224-227):

```typescript
if (kind === "directory" || !itemPath.endsWith(".md")) {
  result.skippedCount += 1;
  continue;
}
```

Replace with sidecar write path for non-`.md` files:

```typescript
// Directories are always skipped — they have no sidecar.
if (kind === "directory") {
  result.skippedCount += 1;
  continue;
}

// For non-.md files: operate on the sidecar path (path + ".md") instead of the source.
// write_file creates the sidecar if it does not exist (NFR-7, EC-8).
// We do NOT call sidecar_exists before writing (NFR-7).
const targetPath = itemPath.endsWith(".md") ? itemPath : itemPath + ".md";
const isNewSidecar = !itemPath.endsWith(".md");
```

Then replace `itemPath` with `targetPath` in the subsequent read/write operations:

```typescript
try {
  let content: string;

  if (isNewSidecar && op === "add") {
    // EC-8: sidecar may not exist. Try to read it; if missing, start with empty content.
    // This avoids a pre-flight sidecar_exists call (NFR-7).
    try {
      const raw = await invokeTauri("read_file", { path: targetPath }) as string;
      content = typeof raw === "string" ? raw : "";
    } catch {
      // File not found → start with empty string (write_file will create it).
      content = "";
    }
  } else if (isNewSidecar && op === "remove") {
    // EC-10: removing a key from a non-existent sidecar → read will throw.
    // Let the read throw so it falls into the catch below and adds to failed.
    content = await invokeTauri("read_file", { path: targetPath }) as string;
  } else {
    // Direct .md file path (unchanged path).
    content = await invokeTauri("read_file", { path: targetPath }) as string;
  }

  // Parse frontmatter.
  const parsed = parseYamlFrontmatter(content);

  // EC-11: malformed frontmatter in sidecar.
  if (parsed.malformed) {
    result.failed.push({
      path: targetPath,
      error: `Could not parse frontmatter in: ${targetPath}`,
    });
    continue;
  }

  // Apply or remove the key.
  let newFrontmatterLines: string[];
  if (op === "add") {
    newFrontmatterLines = applyYamlKey(parsed.frontmatterLines, key, value);
  } else {
    newFrontmatterLines = removeYamlKey(parsed.frontmatterLines, key);
  }

  const updatedParsed = {
    hasFrontmatter: parsed.hasFrontmatter || (op === "add" && newFrontmatterLines.length > 0),
    frontmatterLines: newFrontmatterLines,
    bodyLines: parsed.bodyLines,
  };

  const newContent = reconstructFile(updatedParsed);

  // Write back (to targetPath — may be the sidecar path).
  await invokeTauri("write_file", { path: targetPath, content: newContent });
  result.succeeded += 1;
} catch (err) {
  const errorStr = typeof err === "string" ? err : String(err);
  result.failed.push({ path: targetPath, error: errorStr });
}
```

### Simplified version (recommended)

The above splits `op === "add"` and `op === "remove"` for new sidecars. A cleaner approach:
always attempt to read `targetPath`. If read fails and `op === "add"`, use empty content
and continue. If read fails and `op === "remove"`, fall to catch (adds to failed — EC-10).

```typescript
// Non-directory items: compute the target path.
// For .md files: write to the file directly.
// For non-.md files: write to the sidecar path (path + ".md").
const targetPath = itemPath.endsWith(".md") ? itemPath : itemPath + ".md";

try {
  // Step 1: read target content.
  let content = "";
  try {
    const raw = await invokeTauri("read_file", { path: targetPath }) as string;
    content = typeof raw === "string" ? raw : "";
  } catch (readErr) {
    if (op === "remove") {
      // EC-10: can't remove from a file that doesn't exist.
      throw readErr; // propagate to outer catch → adds to failed
    }
    // op === "add": sidecar does not exist yet — start with empty content.
    // write_file will create it (NFR-7, EC-8).
    content = "";
  }

  // Step 2: parse frontmatter.
  const parsed = parseYamlFrontmatter(content);

  // Step 3: reject malformed frontmatter (EC-11).
  if (parsed.malformed) {
    result.failed.push({
      path: targetPath,
      error: `Could not parse frontmatter in: ${targetPath}`,
    });
    continue;
  }

  // Steps 4-5: apply / remove key, reconstruct.
  let newFrontmatterLines: string[];
  if (op === "add") {
    newFrontmatterLines = applyYamlKey(parsed.frontmatterLines, key, value);
  } else {
    newFrontmatterLines = removeYamlKey(parsed.frontmatterLines, key);
  }

  const updatedParsed = {
    hasFrontmatter: parsed.hasFrontmatter || (op === "add" && newFrontmatterLines.length > 0),
    frontmatterLines: newFrontmatterLines,
    bodyLines: parsed.bodyLines,
  };

  const newContent = reconstructFile(updatedParsed);

  // Step 6: write to targetPath.
  await invokeTauri("write_file", { path: targetPath, content: newContent });
  result.succeeded += 1;
} catch (err) {
  const errorStr = typeof err === "string" ? err : String(err);
  result.failed.push({ path: targetPath, error: errorStr });
}
```

This is structurally identical to the original `.md`-only loop, with two additions:
1. `targetPath` instead of `itemPath`
2. The inner try/catch around `read_file` for the "new sidecar" case

### Updated `formatOperationResult`

The `skippedCount` annotation now says "directory" instead of "not .md":

```typescript
// EC-22 old annotation: "(K item(s) skipped — not .md)"
// Updated annotation: "(K item(s) skipped — director(y/ies))"
if (skippedCount > 0) {
  const noun = skippedCount === 1 ? "directory" : "directories";
  summary += ` (${skippedCount} ${noun} skipped)`;
}
```

Also update the "no eligible files" message path. The old text "No eligible .md files in
selection." is no longer accurate when image files are also processed. Updated:

```typescript
if (skippedCount > 0 && result.succeeded === 0 && result.failed.length === 0) {
  return "No eligible files in selection.";
}
```

And the main summary line changes from "eligible .md files" to "eligible files":

```typescript
let summary = `Processed ${result.succeeded} of ${eligible} eligible files.`;
```

The `verb` parameter is still `"Processed"` for YAML operations; the callers pass it
unchanged. The change is purely to the string text.

---

## Edge Case Reference

| EC | Handling |
|----|---------|
| EC-8 | Sidecar deleted externally: read throws → `content = ""` (add path) or caught (remove path) |
| EC-9 | Sidecar exists, key already present: `applyYamlKey` overwrites (unchanged behaviour) |
| EC-10 | op=remove, sidecar absent: read throws → inner catch re-throws → outer catch → failed |
| EC-11 | Malformed sidecar frontmatter: `parsed.malformed = true` → added to failed |
| EC-21 | Mixed .md + image selection: both written; `skippedCount` = 0 |

---

## Acceptance Criteria

- [ ] `npm run test:run -- tests/folder-view/bulk-operations.test.ts` passes (no regressions)
- [ ] New tests BY-01 through BY-11 pass
- [ ] `executeBulkYaml` writes to `photo.jpg.md` when `photo.jpg` is in selection
- [ ] Directories still increment `skippedCount`
- [ ] Non-`.md` files (photo.jpg) increment `succeeded` after sidecar write
- [ ] `formatOperationResult` summary says "eligible files" not "eligible .md files"
- [ ] The skip annotation says "directory/directories" not "not .md"
- [ ] `sidecar_exists` is NOT called anywhere in `executeBulkYaml` (NFR-7)

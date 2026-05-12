---
title: "Image Metadata as First-Class Columns in Folder-Table"
last-updated: "2026-05-12"
review-cadence-days: 7
status: active
---

# Feature: Image Metadata as First-Class Columns in Folder-Table

## Summary

As a visual user browsing image-heavy folders in folder-table view, I want image dimensions, EXIF metadata (date taken, camera), and custom sidecar tags to appear as sortable columns alongside `.md` file metadata, so that images feel like first-class citizens in my vault without requiring a separate digital asset manager.

---

## Knowns

### Scope

All three capabilities apply exclusively to the `folder-table` layout. The `folder-cards` layout is unchanged. All changes are confined to the file-browser plugin and the Rust backend; no changes to any other plugin or to the main application shell are required.

The three capabilities are:

1. **Image dimensions** — `width` and `height` as built-in sortable columns for image files. Read-only; read from image binary headers at enrichment time.
2. **EXIF metadata** — `date-taken` and `camera` as built-in sortable columns for JPEG/HEIC files that carry Exif segments. Read-only. No write-back to image files ever.
3. **Custom sidecar tagging** — `photo.jpg` gets a companion `photo.jpg.md` with YAML frontmatter (`tags`, `rating`, `notes`, or any custom key). The existing "Apply YAML" bulk action in the toolbar is extended to write to sidecar files instead of skipping non-`.md` files. `extractFrontmatterKeys` in `frontmatter-reader.ts` already reads sidecars transparently because it receives an absolute path and does not care about the naming pattern — it just reads a `.md` file.

### What Is Explicitly Out of Scope

- Writing EXIF or XMP metadata back to any image file.
- XMP sidecar files (`.xmp`). Only the `.jpg.md` / `.<ext>.md` pattern is supported.
- Image thumbnails or preview tiles in the table rows.
- Support for embedded ICC profiles, GPS coordinates, or any EXIF field beyond date-taken and camera make/model.
- Any digital asset manager features: collections, albums, keyword hierarchies, face recognition, smart albums.
- The `folder-cards` layout (card grid). Zero changes there.
- Generating or managing sidecars from the UI beyond the existing "Apply YAML" bulk action.
- Animated GIF or video file metadata.

### Existing Infrastructure

**Plugin architecture constraint**: The file-browser plugin is an IIFE bundle. It may not import from `src/lib/bridge.ts`. All Tauri calls inside the plugin use `window.__TAURI_INTERNALS__?.invoke?.(...)` directly. All new Rust commands must also be callable via this pattern.

**`FolderCard.meta`**: The `meta?: Record<string, string>` field on `FolderCard` (defined in `types.ts`) is already the carrier for enriched column data. The enrichment phase in `tab.ts` (`renderFolderViewTabAsync`) populates `card.meta` by reading `.md` file frontmatter. The new image enrichment follows the same pattern: populate `card.meta` with image-derived values so `table-renderer.ts` can display them without any changes to the renderer's per-cell logic.

**`BUILTIN_FIELDS` set** (in `parser.ts`): Currently `{ "name", "type", "ext", "modified", "tags", "count", "icon" }`. The new built-in image column identifiers (`width`, `height`, `date-taken`, `camera`) must be added to this set so they are not misclassified as custom frontmatter keys by `parseFolderMd` and `resolveFields`.

**`fieldHeaderLabel`** (in `table-renderer.ts`): Maps built-in field identifiers to English column header labels. Needs cases for `width`, `height`, `date-taken`, `camera`.

**Sidecar resolution in enrichment**: When a non-`.md` card is encountered and sidecar enrichment is enabled, the sidecar path is `card.path + ".md"` (e.g. `/vault/photos/sunset.jpg.md`). The existing `extractFrontmatterKeys` function already works on any `.md` file, so no change to that function is needed.

**`executeBulkYaml`** in `bulk-operations.ts`: Currently skips all non-`.md` files with `result.skippedCount += 1`. This must be extended: when a non-`.md` file has a sidecar (`<path>.md` exists or can be created), "Apply YAML" operates on the sidecar instead of skipping the source file.

### New Rust Commands Required

Two new Rust commands are needed. Neither exists today. Both must be added to `src-tauri/src/commands/` and registered in `src-tauri/src/lib.rs`.

**`get_image_dimensions(path: String) -> Result<(u32, u32), String>`**

Returns `(width, height)` in pixels by reading the minimum necessary bytes from the image header — no full decode. Must support JPEG (SOF0/SOF2 markers), PNG (IHDR chunk), GIF (logical screen descriptor), WebP (VP8/VP8L/VP8X chunks), and HEIC/HEIF (ISO BMFF `ispe` box). Returns `Err` for unsupported formats and unreadable files. No new Cargo dependency required — all of these formats have fixed-position header bytes parseable with `std::io::Read`.

**`get_exif_data(path: String) -> Result<ExifData, String>`**

Returns a small struct `ExifData { date_taken: Option<String>, camera: Option<String> }`. `date_taken` is the Exif `DateTimeOriginal` (tag 0x9003) formatted as `YYYY-MM-DD`. `camera` is `Make` (tag 0x010F) + `" "` + `Model` (tag 0x0110), trimmed. Returns `Err` if the file has no Exif segment or cannot be read. JPEG only for v1 (HEIC/HEIF Exif parsing is not required). A minimal Exif parser that locates the APP1 marker, reads the TIFF header, and walks the IFD0 directory is sufficient. No new Cargo dependency required.

**`sidecar_exists(path: String) -> Result<bool, String>`**

Returns `true` if `path + ".md"` exists on disk as a regular file. Used by the bulk-YAML extension to decide whether to create or update a sidecar. Simple `std::path::Path::exists()` check. Returns `Err` only on OS-level failures.

All three new commands must have typed wrappers added to `src/lib/bridge.ts` per project convention, even though the plugin calls them via `__TAURI_INTERNALS__` directly.

### Enrichment Phase Extension (in `tab.ts`)

The current enrichment guard:

```
if (layoutKey === "folder-table" && config.extraFields.length > 0)
```

Must be extended to also run when image built-in columns are requested. The condition becomes:

```
if (layoutKey === "folder-table" && (config.extraFields.length > 0 || imageColumnsRequested))
```

where `imageColumnsRequested` is true when any of `["width", "height", "date-taken", "camera"]` appears in `config.fields` (fields mode) or is declared in `config.extraFields` (legacy extra-fields mode).

Within the enrichment loop, per-card logic:

- If the card is a `.md` file: existing path (read frontmatter, call `extractFrontmatterKeys`). Unchanged.
- If the card is an image file (ext in `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.heic`, `.heif`):
  - If `width` or `height` is requested: call `get_image_dimensions(card.path)`. On success, store `"width"` and `"height"` as string values in `card.meta`. On error, store `""` (em-dash fallback in renderer).
  - If `date-taken` or `camera` is requested AND the file is `.jpg`/`.jpeg`/`.heic`/`.heif`: call `get_exif_data(card.path)`. On success, store `"date-taken"` and/or `"camera"` as string values. On error, store `""`.
  - If sidecar fields are requested (any key that is not a built-in image key): attempt to read `card.path + ".md"` via `read_file`. If it exists, call `extractFrontmatterKeys` on it for the requested keys. If it does not exist or read fails, store `""` for each requested key.
- If the card is a non-image, non-`.md` file: `card.meta = {}`.
- If the card is a directory: `card.meta = {}`. (Unchanged.)

All image metadata reads are performed concurrently (same `Promise.all` pattern as the existing `.md` enrichment). Individual failures are caught per-card — one failure must not abort the render.

### `_folder.md` Syntax (User-Facing)

The four new built-in column identifiers are used in the `fields:` sequence like any other column:

```yaml
layout: folder-table
fields:
  - name
  - ext
  - width
  - height
  - date-taken
  - camera
  - tags
  - rating        # reads from photo.jpg.md sidecar
```

No new YAML keys are introduced in `_folder.md`. The `fields:` mechanism already handles the ordering and visibility of any identifier. `width`, `height`, `date-taken`, and `camera` work identically to any other built-in identifier — they are added to `BUILTIN_FIELDS` so the parser classifies them correctly.

### Sidecar Bulk-YAML Extension

`executeBulkYaml` in `bulk-operations.ts` currently skips any non-`.md` file:

```typescript
if (kind === "directory" || !itemPath.endsWith(".md")) {
  result.skippedCount += 1;
  continue;
}
```

The extension replaces this skip with a sidecar-write path for non-`.md` files:

- If `kind === "directory"`: still skip. Directories have no sidecar.
- If `kind === "file"` and path does not end in `.md`: compute `sidecarPath = itemPath + ".md"`. Operate on `sidecarPath` instead of `itemPath`. The sidecar may not yet exist; `write_file` creates it if absent (Rust `fs::write` creates the file). A sidecar created for the first time gets a minimal frontmatter block wrapping the key-value pair.
- The result summary for a YAML operation that mixed `.md` and non-`.md` files should report total files processed (both direct `.md` and sidecar writes) without distinguishing them. "Skipped" is reserved for directories only.

---

## Functional Requirements

### FR-1 — New Built-in Column Identifiers

`width`, `height`, `date-taken`, and `camera` are added to `BUILTIN_FIELDS` in `parser.ts`. They may be used in the `fields:` sequence in `_folder.md`. When declared, they appear as sortable columns in the folder-table. When absent from `fields:`, they do not appear (same behaviour as any other column).

### FR-2 — Image Dimensions Columns

When `width` or `height` appears in `config.fields` (or `config.extraFields`), the enrichment phase calls `get_image_dimensions` for each image card. Results are stored as string values in `card.meta` (e.g. `"1920"`, `"1080"`). The renderer displays the value as-is; the cell shows an em-dash (`—`) when the value is absent or empty. These columns are sortable via locale-aware string comparison (which is numerically correct for same-length strings; sufficiently accurate for v1).

Supported formats for dimension reading: JPEG, PNG, GIF, WebP, HEIC/HEIF.

### FR-3 — EXIF Columns

When `date-taken` or `camera` appears in `config.fields` (or `config.extraFields`), the enrichment phase calls `get_exif_data` for each `.jpg`/`.jpeg`/`.heic`/`.heif` card. Results are stored as string values in `card.meta`. PNG, GIF, and WebP cards always get `""` for these keys (EXIF not supported). The em-dash fallback applies as with FR-2.

`date-taken` displays in the format `YYYY-MM-DD` as extracted from Exif `DateTimeOriginal`. The column header label is `"Date Taken"`.
`camera` displays as `"Make Model"` (trimmed, null bytes stripped). The column header label is `"Camera"`.

Both columns are sortable.

### FR-4 — Sidecar Read in Enrichment

When a non-`.md` file card has sidecar fields requested (any `config.fields` or `config.extraFields` entry that is not one of the four built-in image keys and not in the standard `BUILTIN_FIELDS` set), the enrichment phase reads `card.path + ".md"` and calls `extractFrontmatterKeys` on it. If the sidecar does not exist or cannot be read, the keys are absent from `card.meta` (em-dash fallback in renderer). Sidecar read failures must not cause an error or break the render.

### FR-5 — Sidecar Write via Bulk-YAML

When the user applies a YAML key-value via the bulk toolbar and the selection includes non-`.md` image files, the operation writes to the corresponding `<imagepath>.md` sidecar file instead of skipping. If the sidecar does not exist, it is created with a minimal frontmatter block. The operation result summary counts sidecar writes in `succeeded` alongside direct `.md` file writes. Directories remain skipped.

### FR-6 — Column Header Labels

`fieldHeaderLabel` in `table-renderer.ts` must return the following for the new built-in identifiers:

| Identifier | Header label |
|---|---|
| `width` | `"Width"` |
| `height` | `"Height"` |
| `date-taken` | `"Date Taken"` |
| `camera` | `"Camera"` |

### FR-7 — Non-Image Files Receive Empty Meta for Image Keys

For non-image files (e.g. `.pdf`, `.zip`, `.txt`) that appear in a folder where image columns are declared, `card.meta` is set to `{}` for those keys (same as the current behaviour for non-`.md`, non-image files). Em-dash renders in those cells.

### FR-8 — Lazy Enrichment (No Blocking)

Image dimension and EXIF reads are performed in the same concurrent `Promise.all` enrichment loop as `.md` frontmatter reads. The initial `folder-view-loading` placeholder is shown while enrichment runs. Enrichment does not block tab opening or any other UI. This matches NFR-03 in the existing architecture (uncapped `Promise.all`).

### FR-9 — Sidecar Isolation from Vault Index Display

A sidecar file (`photo.jpg.md`) is a companion to its image and must not appear as a standalone row in the folder-table. The vault index already surfaces `.md` files through `vaultIndex.entries`; `collectChildren` in `tab.ts` must exclude any `.md` file whose stem ends in an image extension (e.g. `photo.jpg.md`, `banner.png.md`). The exclusion pattern is: if `entry.name` (the stem without `.md`) contains a dot and the portion after the last dot is a known image extension (`jpg`, `jpeg`, `png`, `gif`, `webp`, `heic`, `heif`), exclude it from the file cards array.

### FR-10 — New bridge.ts Wrappers

Three new typed wrappers are added to `src/lib/bridge.ts`:

- `getImageDimensions(path: string): Promise<FileResult<{ width: number; height: number }>>` — wraps `get_image_dimensions`
- `getExifData(path: string): Promise<FileResult<{ dateTaken: string | null; camera: string | null }>>` — wraps `get_exif_data`
- `sidecarExists(path: string): Promise<FileResult<boolean>>` — wraps `sidecar_exists`

---

## Non-Functional Requirements

- **NFR-1** — No EXIF data is ever written to any image file. The EXIF command is read-only.
- **NFR-2** — `get_image_dimensions` reads only the minimum bytes required to locate the dimension fields in each format's header (e.g. first ~26 bytes for PNG, first SOFn marker for JPEG). It does not decode the full image.
- **NFR-3** — No new Cargo crates for EXIF or image parsing. Both parsers are implemented with standard library I/O (`std::io::Read`, `std::io::Seek`).
- **NFR-4** — Sidecar files are invisible in the folder-table view (FR-9). A user browsing a photo folder sees only image rows, not companion `.jpg.md` rows.
- **NFR-5** — Image enrichment is gated the same way existing enrichment is gated: only runs for `folder-table` and only when at least one image column or sidecar field is declared. Folders with no image columns declared are unaffected and pay no performance cost.
- **NFR-6** — All new built-in identifiers follow the existing hyphenated-lowercase key convention (`date-taken`, not `dateTaken`). Column header labels use Title Case.
- **NFR-7** — `executeBulkYaml` never calls `sidecar_exists` over the network before the operation; instead it calls `write_file` on the sidecar path directly. If the file does not exist, Rust `write_file` creates it. This avoids a round-trip check before every write.
- **NFR-8** — All user-controlled text (filenames, EXIF strings) inserted into the DOM uses `.textContent`. No `.innerHTML` interpolation of image metadata strings.

---

## Files to Create or Modify

| File | Nature of change |
|---|---|
| `src-tauri/src/commands/io.rs` | Add `get_image_dimensions`, `get_exif_data`, `sidecar_exists` commands |
| `src-tauri/src/lib.rs` | Register the three new commands in the invoke handler |
| `src/lib/bridge.ts` | Add `getImageDimensions`, `getExifData`, `sidecarExists` typed wrappers |
| `src/plugins/file-browser/folder-view/parser.ts` | Add `width`, `height`, `date-taken`, `camera` to `BUILTIN_FIELDS` |
| `src/plugins/file-browser/folder-view/tab.ts` | Extend enrichment phase: image dimension + EXIF reads, sidecar reads, update enrichment guard, add sidecar exclusion to `collectChildren` |
| `src/plugins/file-browser/folder-view/table-renderer.ts` | Add `fieldHeaderLabel` cases for four new built-in identifiers |
| `src/plugins/file-browser/folder-view/bulk-operations.ts` | Extend `executeBulkYaml` to write sidecars for non-`.md` files |

No new TypeScript files. No new Rust files (new commands go in existing `io.rs`).

---

## Edge Case Inventory

**EC-1** — Image file has no readable header (truncated file, zero-byte file): `get_image_dimensions` returns `Err`. Enrichment stores `""` for `width` and `height`. Em-dash renders in those cells.

**EC-2** — JPEG file has no APP1/Exif segment (e.g. stripped JPEG): `get_exif_data` returns `Err`. Enrichment stores `""` for `date-taken` and `camera`. Em-dash in cells.

**EC-3** — Exif `DateTimeOriginal` is absent but `DateTime` (tag 0x0132) is present: `get_exif_data` returns `None` for `date_taken` (only `DateTimeOriginal` is read in v1). Em-dash in cell.

**EC-4** — Exif `Make` is present but `Model` is absent (or vice versa): `camera` string uses whichever field is present, trimmed. If both are absent, `camera` is `None` → em-dash.

**EC-5** — Image dimensions are zero (malformed header with 0×0 stored): `get_image_dimensions` returns `Ok((0, 0))`. Enrichment stores `"0"`. Table displays `"0"`. This is the file's own malformed data; no special treatment.

**EC-6** — Non-image file (e.g. `.pdf`) in a folder with `width` column declared: enrichment skips dimension read; `card.meta` for that card has no `width` entry. Em-dash in cell.

**EC-7** — Sidecar file `photo.jpg.md` is created by the user and placed in the vault before this feature is used: `collectChildren` must exclude it from standalone rows (FR-9). It will not appear as a row; its contents will be read during enrichment for the parent `photo.jpg` card.

**EC-8** — Sidecar `photo.jpg.md` is deleted externally between the folder-table render and a subsequent "Apply YAML" operation: `write_file` on the sidecar path creates a new file (Rust creates the file if absent). The write succeeds and counts toward `succeeded`. No error.

**EC-9** — Sidecar already exists and "Apply YAML" is used to add a key that the sidecar already has: existing behaviour of `applyYamlKey` — the key value is overwritten. No error.

**EC-10** — "Apply YAML" with `op = "remove"` on an image card whose sidecar does not exist: `read_file` on the sidecar path returns a "File not found" error. This is caught per-item and added to `failed`. The error message is "File not found: <sidecarPath>". This is the correct behaviour because there is nothing to remove.

**EC-11** — Sidecar file has malformed frontmatter (opening `---` with no closing `---`): `executeBulkYaml` detects `parsed.malformed === true` and adds the sidecar path to `failed` with "Could not parse frontmatter in: <sidecarPath>". The sidecar is not written. Identical to the existing behaviour for malformed `.md` files.

**EC-12** — Folder contains a file named `photo.jpg.md` that is not a sidecar (e.g. it is a standalone note about photography named with a `.jpg.md` double extension by the user): FR-9 exclusion hides this file from the table. This is an accepted trade-off; the file must be renamed or placed in a different folder to appear as a row.

**EC-13** — HEIC/HEIF dimension read: `get_image_dimensions` reads the ISO BMFF `ispe` box to extract width and height. If the box is absent or the file is corrupted, returns `Err`. Em-dash fallback.

**EC-14** — WebP with VP8X container (extended WebP): `get_image_dimensions` reads the `VP8X` chunk canvas width and height. If the chunk is missing (plain VP8 or VP8L without a container), falls back to reading the VP8 or VP8L bitstream dimensions directly.

**EC-15** — PNG with non-standard IHDR position (IHDR not the first chunk after signature): `get_image_dimensions` reads only the first chunk after the 8-byte PNG signature. If it is not `IHDR`, returns `Err`. Standard-compliant PNG files always have `IHDR` first.

**EC-16** — Concurrent enrichment for a folder with 500+ images: `Promise.all` is uncapped. Each call is an async Tauri invoke. At 500 concurrent invokes, the Rust side processes them on the async runtime. Performance must be acceptable (sub-3s for 500 images) because only header bytes are read, not full image decode. No batching is required for v1.

**EC-17** — `date-taken` Exif value is in a non-standard format (e.g. `2024:13:45 99:99:99`): `get_exif_data` returns the raw string as-is. No validation or reformatting. The caller receives whatever bytes are in the Exif tag.

**EC-18** — Image file is a symlink: `std::fs::File::open` follows symlinks by default on macOS. Dimension and EXIF reads succeed if the target is a readable image. If the target is missing, `get_image_dimensions` returns `Err`.

**EC-19** — `width`/`height` column declared but the folder contains no image files: enrichment skips all non-image cards (stores `{}`). All rows display em-dash in width/height cells. No error.

**EC-20** — Sidecar exclusion in `collectChildren` for a `.md` file whose stem is ambiguous (e.g. `my.project.jpg.md`): The exclusion check uses only the last dot segment of `entry.name` (the stem without `.md`). `entry.name` for `my.project.jpg.md` is `my.project.jpg`. The last segment after the last dot is `jpg`, which is a known image extension. The file is excluded. This is the correct behaviour.

**EC-21** — "Apply YAML" on a selection of mixed `.md` files and image files: `.md` files are written directly; image files get their sidecar written. The result summary counts all writes together in `succeeded`. The text "N of M files processed" does not distinguish direct vs sidecar writes.

**EC-22** — `camera` Exif string contains null bytes (`\0`) from null-padded fixed-width Exif ASCII fields: Rust must strip null bytes before returning the string. The trimmed result (e.g. `"Canon EOS R5"` not `"Canon EOS R5\0\0\0"`) is stored in `card.meta`.

---

## Handoff Summary

- Artifact: `docs/requirements/active_task.md`
- Status: Requirements Validated
- Edge cases to verify in tests: 22 items in Edge Case Inventory (EC-1 through EC-22)

Next step: Activate @software-architect and provide `docs/requirements/active_task.md` as context.

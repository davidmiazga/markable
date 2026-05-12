---
title: "Step 01 — Rust Commands: get_image_dimensions, get_exif_data, sidecar_exists"
last-updated: "2026-05-12"
review-cadence-days: 7
status: active
---

# Step 01 — Rust Commands

## Goal

Add three new Tauri commands to `src-tauri/src/commands/io.rs`:
- `get_image_dimensions` — reads minimum header bytes to return (width, height)
- `get_exif_data` — minimal Exif IFD parser for DateTimeOriginal + Make/Model
- `sidecar_exists` — cheap `Path::exists()` check for `path + ".md"`

Register all three in `mod.rs` and `lib.rs`.

No new Cargo dependencies. All parsing uses `std::io::{Read, Seek}`.

---

## Files Modified

| File | Change |
|------|--------|
| `src-tauri/src/commands/io.rs` | Add three commands + `#[cfg(test)]` blocks |
| `src-tauri/src/commands/mod.rs` | `pub use io::{..., get_image_dimensions, get_exif_data, sidecar_exists}` |
| `src-tauri/src/lib.rs` | Add to `pub use commands::{...}` and `invoke_handler![]` |

---

## TDD Sequence

Write failing tests first, then implement, then verify green.

### Test file: `src-tauri/src/commands/io.rs` — `#[cfg(test)] mod tests` (extend existing)

All tests use `std::env::temp_dir()` and thread-ID-qualified filenames (matching the
existing `write_binary_file` test pattern to avoid parallel-test collisions).

---

## `get_image_dimensions` Specification

### Signature

```rust
#[tauri::command]
pub fn get_image_dimensions(path: String) -> Result<(u32, u32), String>
```

### Return values

- `Ok((width, height))` — pixel dimensions from the image header
- `Err(message)` — unreadable file, unsupported format, or truncated header

### Format detection and parsing

Detection is by reading the first few bytes (magic bytes), not by file extension.
The command opens the file with `std::fs::File::open` (follows symlinks on macOS — EC-18).

#### JPEG (SOF0, SOF1, SOF2 markers)

JPEG dimension parsing algorithm:
1. Read 2 bytes: verify `0xFF 0xD8` (SOI marker). Return Err if mismatch.
2. Loop over markers:
   a. Read 2 bytes: must be `0xFF` + marker byte. If not, return Err.
   b. Skip padding `0xFF` bytes (valid in JPEG streams).
   c. Read 2-byte big-endian segment length (includes the 2 length bytes themselves).
   d. If marker is `0xC0` (SOF0), `0xC1` (SOF1), or `0xC2` (SOF2):
      - Read 1 byte (precision, ignore).
      - Read 2 bytes big-endian: height.
      - Read 2 bytes big-endian: width.
      - Return `Ok((width, height))`.
   e. Otherwise: seek past `length - 2` bytes to skip this segment.
   f. If marker is `0xD9` (EOI) or file ends: return Err("No SOF marker found in JPEG").
- Max iterations: 64 segments (guard against malformed infinite loops).

#### PNG

PNG dimension parsing algorithm:
1. Read 8 bytes: verify PNG signature `[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]`.
   Return Err if mismatch.
2. Read first chunk: 4-byte big-endian length + 4-byte ASCII type.
3. If type is not `IHDR`, return Err("PNG IHDR not first chunk") — EC-15.
4. Read 4-byte big-endian width, 4-byte big-endian height.
5. Return `Ok((width, height))`.

Total bytes read: 8 (sig) + 4 (len) + 4 (type) + 4 (w) + 4 (h) = 24 bytes — NFR-2.

#### GIF

GIF dimension parsing algorithm:
1. Read 6 bytes: verify header is `GIF87a` or `GIF89a`. Return Err if mismatch.
2. Read 2-byte little-endian logical screen width.
3. Read 2-byte little-endian logical screen height.
4. Return `Ok((width as u32, height as u32))`.

Total bytes read: 10 bytes.

#### WebP

WebP dimension parsing algorithm:
1. Read 12 bytes: verify `RIFF` (bytes 0-3), skip 4-byte file size (bytes 4-7),
   verify `WEBP` (bytes 8-11). Return Err if either check fails.
2. Read the first chunk: 4-byte ASCII type + 4-byte little-endian chunk size.
3. If type is `VP8 ` (VP8 lossy, note trailing space):
   - Read 10 bytes. Bytes 6-9 (little-endian 16-bit pairs) contain width-1 and height-1
     in bits 13:0. Specifically: `width = (buf[7] << 8 | buf[6]) & 0x3FFF` (little-endian
     14-bit field), `height = (buf[9] << 8 | buf[8]) & 0x3FFF`. Add 1 to each. Return Ok.
   - Actually: the VP8 bitstream key frame header is at byte offset 3 from chunk data start.
     Bytes 0-2: frame tag (3 bytes). Bytes 3-9: start code + dimensions.
     Start code: `0x9D 0x01 0x2A`. After start code: 2-byte LE `(width_minus1 << 2 | horiz_scale)`,
     2-byte LE `(height_minus1 << 2 | vert_scale)`. Extract bits [13:0] and add 1.
4. If type is `VP8L` (VP8 lossless):
   - Read 5 bytes. Byte 0 must be `0x2F` (signature). Bytes 1-4 encode width-1 (14 bits)
     and height-1 (14 bits) in little-endian bit order:
     `let bits = u32::from_le_bytes([b[1],b[2],b[3],b[4]]);`
     `width = (bits & 0x3FFF) + 1;`
     `height = ((bits >> 14) & 0x3FFF) + 1;`
   - Return `Ok((width, height))`.
5. If type is `VP8X` (extended WebP — EC-14):
   - Read 10 bytes chunk data. Canvas width minus 1 is stored as little-endian 24-bit at
     bytes 4-6; canvas height minus 1 at bytes 7-9.
     `width = u32::from_le_bytes([b[4], b[5], b[6], 0]) + 1;`
     `height = u32::from_le_bytes([b[7], b[8], b[9], 0]) + 1;`
   - Return `Ok((width, height))`.
6. Unknown chunk type: return Err("Unsupported WebP chunk type").

#### HEIC/HEIF (ISO BMFF `ispe` box — EC-13)

HEIC/HEIF dimension parsing algorithm:
1. Read 12 bytes: skip 4-byte box size (bytes 0-3), read 4-byte type (bytes 4-7), skip
   4 bytes. Verify that ftyp box is present: type must be `ftyp`. Return Err if not.
   Note: HEIC files begin with an `ftyp` box as per ISO BMFF spec.
2. Read ftyp box data to skip it: re-read box size (from bytes 0-3), seek to `size` offset.
   Handle `size=0` (box extends to EOF) and `size=1` (64-bit extended size) as Err (too
   complex for v1 — all real HEIC files use 32-bit sizes for the ftyp box).
3. Walk remaining boxes looking for `moov` → `trak` → `mdia` → `minf` → `stbl` is NOT the
   path for image dimensions. The correct path for HEIC spatial dimensions is:
   - Find `meta` box (must be a full box with 4-byte version+flags after the type).
   - Inside `meta`, find `iprp` box.
   - Inside `iprp`, find `ipco` box.
   - Inside `ipco`, scan child boxes for type `ispe`.
   - `ispe` structure: 4-byte version+flags (all zero for v1), 4-byte BE width, 4-byte BE height.
   - Return `Ok((width, height))`.

   Implementation note: this requires a recursive box walker. To avoid complexity, use a
   depth-limited iterative walker (max depth 6) that scans each box's children by reading
   the box size and type, seeking into children when the type matches the search path.

   If any step of the walk fails or `ispe` is not found, return
   Err("Could not find ispe box in HEIC/HEIF file").

**Simplified HEIC implementation for v1**: Given the complexity above, the v1 implementation
reads the BMFF box structure iteratively:
1. Read boxes at the top level until `meta` is found (or file ends — return Err).
2. `meta` is a FullBox: after the 8-byte header, skip 4 bytes (version+flags), then parse
   child boxes.
3. Inside `meta`, scan for `iprp`. Inside `iprp`, scan for `ipco`. Inside `ipco`, scan for
   `ispe`. Return `Ok((width, height))` when found.
4. Box size of 0 means "extends to EOF" — treat as Err. Box size of 1 means 64-bit — treat
   as Err (not needed for real HEIC files).

#### Unsupported formats

Any file whose magic bytes do not match the four supported signatures returns:
`Err("Unsupported image format or unreadable file")`

### Tests (Rust, in `#[cfg(test)]` block)

Write PNG, GIF, JPEG, and WebP minimal header bytes to temp files and assert correct
dimension extraction. Also test:

- `TD-01` JPEG SOF0 returns correct (width, height)
- `TD-02` PNG 1×1 returns (1, 1)
- `TD-03` GIF 320×240 returns (320, 240)
- `TD-04` WebP VP8L returns correct dimensions
- `TD-05` Truncated PNG (only 4 bytes) returns Err
- `TD-06` Zero-byte file returns Err
- `TD-07` Non-image file (plain text) returns Err (bad magic)
- `TD-08` WebP VP8X canvas width/height correct (EC-14)
- `TD-09` EC-5: malformed PNG with 0-width IHDR returns Ok((0, height)) — stored as "0"
- `TD-10` EC-15: PNG with non-IHDR first chunk returns Err

HEIC tests: write a minimal synthetic HEIC-like BMFF structure and verify ispe extraction.
If constructing a valid BMFF buffer is too complex for a unit test, document as
"integration test only — requires real HEIC file fixture" and skip in CI.

---

## `get_exif_data` Specification

### Signature

```rust
#[derive(serde::Serialize)]
pub struct ExifData {
    pub date_taken: Option<String>,
    pub camera: Option<String>,
}

#[tauri::command]
pub fn get_exif_data(path: String) -> Result<ExifData, String>
```

`serde::Serialize` is already available in the project (used by vault.rs). No new derive
macros needed.

### Return values

- `Ok(ExifData { date_taken, camera })` — values are `None` when the field is absent
- `Err(message)` — no Exif segment, unreadable file, or non-JPEG format (v1: JPEG only)

### Algorithm

JPEG EXIF parsing for v1 (JPEG only):

1. Open file. Read 2 bytes: verify `0xFF 0xD8`. Return Err if not JPEG.
2. Scan markers to find APP1 (`0xFF 0xE1`):
   - Read marker byte pair `0xFF` + type.
   - Read 2-byte big-endian segment length.
   - If type is `0xE1`: check first 6 bytes of segment data for `Exif\0\0`.
     If present, this is the Exif APP1. Break. Otherwise skip segment.
   - If type is `0xD9` (EOI) or file ends: return Err("No Exif segment found").
   - Otherwise: seek past `length - 2` bytes to skip this segment.
   - Max iterations: 32 (guard against malformed files).

3. Parse TIFF header starting at the byte after `Exif\0\0`:
   - Read 2 bytes: byte order mark. `II` (0x4949) = little-endian, `MM` (0x4D4D) = big-endian.
     Store as a boolean `is_le: bool`. Return Err if neither.
   - Read 2-byte magic (must be 42 in the detected byte order). Return Err if not 42.
   - Read 4-byte IFD0 offset (in the detected byte order).

4. Seek to the Exif segment base + 6 (skip `Exif\0\0`) + IFD0 offset.
5. Read 2-byte entry count.
6. Walk IFD0 entries (each is 12 bytes):
   - Read 2-byte tag, 2-byte type, 4-byte count, 4-byte value-or-offset.
   - If tag == 0x010F (Make): read ASCII value (value field if count <= 4, else seek to
     offset from TIFF base + 6). Strip null bytes. Trim. Store as `make`.
   - If tag == 0x0110 (Model): same. Store as `model`.
   - If tag == 0x9003 (DateTimeOriginal): read ASCII value. Strip null bytes. Trim.
     Take only the date portion: first 10 characters (format `YYYY:MM:DD`). Replace colons
     in the date portion with hyphens → `YYYY-MM-DD`. Store as `date_taken`.
   - Ignore all other tags.
   - After reading all entries (stop at count): if neither date nor camera found yet,
     optionally follow the IFD0 next-IFD pointer to ExifIFD (tag 0x8769) for
     DateTimeOriginal — but for v1, only IFD0 and the linked ExifIFD are read.

   **ExifIFD follow** (required for DateTimeOriginal — it is stored in SubIFD, not IFD0):
   - After walking IFD0, if `date_taken` is still None:
     - Look for tag `0x8769` (ExifIFD offset) in the already-walked IFD0 entries.
       Since we are walking sequentially, re-walk after collecting the ExifIFD offset.
   - Simpler approach: do two passes over IFD0 — first pass collects Make, Model, and
     ExifIFD offset; second pass (if ExifIFD offset found) seeks to ExifIFD and reads
     DateTimeOriginal. This avoids storing all IFD entries in memory.

   **Practical v1 simplification**: Walk IFD0 once. Collect:
   - `make_raw: Option<String>`
   - `model_raw: Option<String>`
   - `date_raw: Option<String>` (from tag 0x9003 if it appears in IFD0 — rarely the case)
   - `exif_ifd_offset: Option<u32>` (from tag 0x8769)

   After IFD0 walk, if `date_raw` is None and `exif_ifd_offset` is Some, seek to
   `tiff_base + exif_ifd_offset` and walk that IFD looking only for tag 0x9003.

7. Build result:
   - `date_taken = date_raw.map(|s| reformat_exif_date(&s))`
   - `camera`: if both make and model are Some and non-empty, join with space.
     If only one is Some and non-empty, use that. If both None or empty → None.
   - EC-4: one field absent → use the present field.
   - EC-22: null bytes already stripped during ASCII read.
   - EC-17: `reformat_exif_date` takes first 10 chars of raw string, replaces `:` with `-`
     in positions 4 and 7. If string is shorter than 10, returns it as-is (no panic).

### Helper: ASCII field reader

```
fn read_ascii_field(file: &mut File, tiff_base: u64, count: u32, value_or_offset: u32, is_le: bool) -> Option<String>
```

- If `count <= 4`: read `count` bytes directly from `value_or_offset` as a 4-byte little-
  endian or big-endian integer embedded in the field. For ASCII fields, the bytes are stored
  directly in the 4-byte value field when count <= 4.
- If `count > 4`: seek to `tiff_base + value_or_offset`, read `count` bytes.
- Convert bytes to UTF-8 (lossy). Strip `\0`. Trim. Return None if empty.

### Tests (Rust, in `#[cfg(test)]` block)

Constructing a minimal valid JPEG + Exif segment in a test is the most reliable approach.
Build a byte vector: SOI + APP1 with Exif header + minimal TIFF + IFD0 with Make/Model/
DateTimeOriginal + ExifIFD with DateTimeOriginal.

- `TE-01` JPEG with Make="Canon", Model="EOS R5", DateTimeOriginal="2024:03:15 14:22:10"
  → `ExifData { date_taken: Some("2024-03-15"), camera: Some("Canon EOS R5") }`
- `TE-02` JPEG with no APP1 → Err("No Exif segment found")
- `TE-03` Non-JPEG file (PNG magic bytes) → Err (step 1 fails)
- `TE-04` EC-4: Make present, Model absent → camera = Some("Canon")
- `TE-05` EC-4: Make absent, Model="EOS R5" → camera = Some("EOS R5")
- `TE-06` EC-22: Model="Canon EOS R5\0\0\0" → camera trimmed, no null bytes
- `TE-07` EC-17: DateTimeOriginal="2024:13:45 99:99:99" → date_taken = Some("2024-13-45")
  (returned as-is after colon→hyphen conversion, no validation)
- `TE-08` JPEG with DateTimeOriginal in ExifIFD (not in IFD0) → date_taken populated
- `TE-09` Zero-byte file → Err

---

## `sidecar_exists` Specification

### Signature

```rust
#[tauri::command]
pub fn sidecar_exists(path: String) -> Result<bool, String>
```

### Algorithm

```rust
let sidecar = PathBuf::from(&path).with_extension(
    format!("{}.md", PathBuf::from(&path).extension().unwrap_or_default().to_string_lossy())
);
```

Wait — the sidecar path is `path + ".md"`, not a proper extension replacement.
`photo.jpg.md` is `photo.jpg` + `.md` appended. `PathBuf::with_extension` would produce
`photo.md` which is wrong.

Correct implementation:

```rust
let sidecar_path = format!("{}.md", &path);
let exists = std::path::Path::new(&sidecar_path)
    .metadata()
    .map(|m| m.is_file())
    .unwrap_or(false);
Ok(exists)
```

`metadata()` follows symlinks (correct — a symlink to a real file should return true).
`is_file()` guards against a path that exists but is a directory (edge case: user has
a directory named `photo.jpg.md` — return false for such a case).

Return Err only on OS-level errors beyond "not found" (e.g. permission denied on parent
directory). Use `metadata().map_err(...)` pattern, but note that "not found" errors should
return `Ok(false)` not `Err`.

Refined:

```rust
match std::path::Path::new(&sidecar_path).metadata() {
    Ok(m) => Ok(m.is_file()),
    Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
    Err(e) => Err(format!("Failed to check sidecar: {}", e)),
}
```

### Tests (Rust)

- `TS-01` File exists → returns Ok(true)
- `TS-02` File does not exist → returns Ok(false)
- `TS-03` Path is a directory (create a dir named `foo.jpg.md`) → returns Ok(false)

---

## mod.rs changes

In `src-tauri/src/commands/mod.rs`, update the `pub use io::` line:

```rust
// Before:
pub use io::{read_file, write_file, write_binary_file};

// After:
pub use io::{read_file, write_file, write_binary_file, get_image_dimensions, get_exif_data, sidecar_exists};
```

---

## lib.rs changes

### pub use commands section

```rust
// Add to the existing pub use commands::{...} block:
get_image_dimensions, get_exif_data, sidecar_exists,
```

### invoke_handler! addition

Add after `search_vault_content`:

```rust
get_image_dimensions,
get_exif_data,
sidecar_exists,
```

---

## Acceptance Criteria

- [ ] `cargo test` passes with all new tests green
- [ ] `get_image_dimensions("path/to/real.png")` returns correct dimensions when called via Tauri IPC
- [ ] `get_exif_data("path/to/jpeg_with_exif.jpg")` returns correct date and camera
- [ ] `sidecar_exists("path/to/photo.jpg")` returns true when `photo.jpg.md` exists, false when not
- [ ] No new entries in `Cargo.toml`
- [ ] All three commands appear in `invoke_handler![]` in lib.rs

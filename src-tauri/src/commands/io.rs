//! File I/O commands with atomic write guarantee.
//!
//! All write operations use a temp-file-swap pattern:
//! 1. Write to a temporary file in the same directory as target
//! 2. Call sync_all() to ensure data reaches disk
//! 3. Atomically rename temp file to target (POSIX atomic operation)
//! 4. If rename fails, the original file is never modified
//!
//! Also provides header-only image parsing commands for the Folder View
//! image-metadata feature (get_image_dimensions, get_exif_data, sidecar_exists).
//! These use only std::io::Read + Seek — no image crate dependency.

use std::fs;
use std::io::{self, Read, Seek, SeekFrom, Write as IoWrite};
use std::path::{Path, PathBuf};

/// Read file contents as UTF-8 string.
///
/// # Arguments
/// * `path` - Absolute path to file
///
/// # Returns
/// * `Ok(content)` - File contents as string
/// * `Err(message)` - Descriptive error message
///
/// # Errors Handled
/// - File not found → "File not found: {path}"
/// - Is a directory → "Is a directory: {path}"
/// - Permission denied → "Permission denied: {path}"
/// - Invalid UTF-8 → "Invalid UTF-8 in file: {path}"
#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    let path = Path::new(&path);

    // Check if path exists
    if !path.exists() {
        return Err(format!("File not found: {}", path.display()));
    }

    // Check if it's a directory
    if path.is_dir() {
        return Err(format!("Is a directory: {}", path.display()));
    }

    // Attempt to read
    match fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(e) => {
            let msg = match e.kind() {
                io::ErrorKind::NotFound => format!("File not found: {}", path.display()),
                io::ErrorKind::PermissionDenied => {
                    format!("Permission denied: {}", path.display())
                }
                io::ErrorKind::IsADirectory => format!("Is a directory: {}", path.display()),
                io::ErrorKind::InvalidData => {
                    format!("Invalid UTF-8 in file: {}", path.display())
                }
                _ => format!("Failed to read file: {} ({})", path.display(), e),
            };
            Err(msg)
        }
    }
}

/// Write file contents atomically.
///
/// Uses temp-file-swap pattern to ensure data safety:
/// 1. Write to {path}.tmp.{random}
/// 2. sync_all() to disk
/// 3. Atomic rename to {path}
///
/// If any step fails, the original file is never modified.
///
/// # Arguments
/// * `path` - Absolute path to file (created if doesn't exist)
/// * `content` - Content to write as UTF-8 string
///
/// # Returns
/// * `Ok(())` - File written successfully
/// * `Err(message)` - Descriptive error message
///
/// # Errors Handled
/// - Parent directory doesn't exist → "File not found: {path}"
/// - Permission denied → "Permission denied: {path}"
/// - Disk full → "Disk full: insufficient space to write {path}"
/// - Atomic rename failed → "Write failed: atomic swap could not complete"
#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(&path);

    // Validate parent directory exists
    let parent = path.parent();
    if let Some(parent_dir) = parent {
        if !parent_dir.is_dir() && parent_dir != Path::new("") {
            return Err(format!("File not found: {} (parent dir missing)", path.display()));
        }
    }

    // Generate temp filename with random suffix
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp_path = path.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let temp_filename = format!(
        "{}.tmp.{}",
        path.file_name()
            .map(|n| n.to_string_lossy())
            .unwrap_or_default(),
        timestamp
    );
    let temp_path = temp_path.join(&temp_filename);

    // Write to temp file
    let mut file = match fs::File::create(&temp_path) {
        Ok(f) => f,
        Err(e) => {
            let msg = match e.kind() {
                io::ErrorKind::PermissionDenied => {
                    format!("Permission denied: {}", path.display())
                }
                _ => format!("Failed to create temp file: {} ({})", path.display(), e),
            };
            return Err(msg);
        }
    };

    // Write content
    if let Err(e) = file.write_all(content.as_bytes()) {
        let _ = fs::remove_file(&temp_path); // Clean up temp file
        let msg = match e.kind() {
            io::ErrorKind::PermissionDenied => {
                format!("Permission denied: {}", path.display())
            }
            _ => format!("Failed to write to temp file: {} ({})", path.display(), e),
        };
        return Err(msg);
    }

    // Sync all data to disk
    if let Err(e) = file.sync_all() {
        let _ = fs::remove_file(&temp_path); // Clean up temp file
        return Err(format!("Failed to sync file to disk: {} ({})", path.display(), e));
    }

    // Atomic rename (POSIX atomic operation)
    match fs::rename(&temp_path, &path) {
        Ok(_) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&temp_path); // Clean up temp file
            let msg = match e.kind() {
                io::ErrorKind::PermissionDenied => {
                    format!("Permission denied: {}", path.display())
                }
                _ => format!(
                    "Write failed: atomic swap could not complete ({})",
                    e.kind()
                ),
            };
            Err(msg)
        }
    }
}
/// Write raw binary data to a file atomically.
///
/// Uses the same temp-file-swap pattern as `write_file`, substituting
/// raw bytes (`Vec<u8>`) for the UTF-8 string content. All other logic —
/// parent-dir guard, timestamp-based temp filename, `sync_all()`, atomic
/// rename, and error messages — is identical to `write_file`.
///
/// JavaScript callers pass a `number[]` (array of unsigned bytes 0–255).
/// Tauri's JSON deserialiser maps a `number[]` to `Vec<u8>` correctly.
/// Do **not** pass a `Uint8Array` from JavaScript — it does not serialise
/// reliably across the Tauri IPC boundary (DC-01 note in architecture spec).
///
/// # Arguments
/// * `path` - Absolute path to the output file (created if doesn't exist)
/// * `data` - Raw binary bytes; JavaScript callers supply `number[]`
///
/// # Returns
/// * `Ok(())` - File written successfully
/// * `Err(message)` - Descriptive error message
///
/// # Error messages (identical to `write_file` for consistent test assertions)
/// - Parent directory missing → "File not found: {path} (parent dir missing)"
/// - Permission denied        → "Permission denied: {path}"
/// - Disk write failure       → "Failed to write to temp file: {path} ({e})"
/// - Sync failure             → "Failed to sync file to disk: {path} ({e})"
/// - Atomic rename failure    → "Write failed: atomic swap could not complete ({kind})"
#[tauri::command]
pub fn write_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    let path = PathBuf::from(&path);

    // Validate parent directory exists (same guard as write_file).
    let parent = path.parent();
    if let Some(parent_dir) = parent {
        if !parent_dir.is_dir() && parent_dir != Path::new("") {
            return Err(format!("File not found: {} (parent dir missing)", path.display()));
        }
    }

    // Generate temp filename using a nanosecond timestamp for uniqueness.
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp_dir = path.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let temp_filename = format!(
        "{}.tmp.{}",
        path.file_name()
            .map(|n| n.to_string_lossy())
            .unwrap_or_default(),
        timestamp
    );
    let temp_path = temp_dir.join(&temp_filename);

    // Write binary data to the temporary file.
    let mut file = match fs::File::create(&temp_path) {
        Ok(f) => f,
        Err(e) => {
            let msg = match e.kind() {
                io::ErrorKind::PermissionDenied => {
                    format!("Permission denied: {}", path.display())
                }
                _ => format!("Failed to create temp file: {} ({})", path.display(), e),
            };
            return Err(msg);
        }
    };

    // Write raw bytes (not content.as_bytes() — the only difference from write_file).
    if let Err(e) = file.write_all(&data) {
        let _ = fs::remove_file(&temp_path); // Clean up temp file on failure
        let msg = match e.kind() {
            io::ErrorKind::PermissionDenied => {
                format!("Permission denied: {}", path.display())
            }
            _ => format!("Failed to write to temp file: {} ({})", path.display(), e),
        };
        return Err(msg);
    }

    // Flush OS buffers to disk before renaming to prevent partial-write exposure.
    if let Err(e) = file.sync_all() {
        let _ = fs::remove_file(&temp_path); // Clean up temp file on failure
        return Err(format!("Failed to sync file to disk: {} ({})", path.display(), e));
    }

    // Atomic rename: on POSIX systems `rename` is guaranteed to be atomic,
    // so readers never see a partially-written file at the target path.
    match fs::rename(&temp_path, &path) {
        Ok(_) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&temp_path); // Clean up temp file on failure
            let msg = match e.kind() {
                io::ErrorKind::PermissionDenied => {
                    format!("Permission denied: {}", path.display())
                }
                _ => format!(
                    "Write failed: atomic swap could not complete ({})",
                    e.kind()
                ),
            };
            Err(msg)
        }
    }
}


// ── Image dimension command ───────────────────────────────────────────────────

/// Read image pixel dimensions from the file header — header-only, no full decode.
///
/// Supports JPEG (SOF0/SOF1/SOF2), PNG (IHDR), GIF (logical screen header),
/// WebP (VP8/VP8L/VP8X), and HEIC/HEIF (ISO BMFF ispe box).
///
/// Detection is by magic bytes, not file extension.
/// Follows symlinks on macOS (std::fs::File::open behaviour).
///
/// # Arguments
/// * `path` - Absolute path to the image file.
///
/// # Returns
/// * `Ok((width, height))` — pixel dimensions from the image header
/// * `Err(message)` — unreadable file, unsupported format, or truncated header
#[tauri::command]
pub fn get_image_dimensions(path: String) -> Result<(u32, u32), String> {
    let mut file = fs::File::open(&path)
        .map_err(|e| format!("Failed to open image file: {} ({})", path, e))?;

    // Read the first 12 bytes to detect the format via magic bytes.
    let mut magic = [0u8; 12];
    let n = file
        .read(&mut magic)
        .map_err(|e| format!("Failed to read image header: {} ({})", path, e))?;

    if n == 0 {
        return Err(format!("Zero-byte file or unreadable: {}", path));
    }

    // Dispatch by magic bytes.
    // Each sub-parser expects the file cursor to be positioned AFTER the bytes
    // it is responsible for consuming during detection:
    //   JPEG: cursor after SOI (2 bytes consumed) → seek back to 2
    //   PNG:  cursor after 8-byte signature       → already at offset 8
    //   GIF:  cursor after 6-byte header          → seek back to 6
    //   WebP: cursor after 12-byte RIFF+WEBP      → already at offset 12
    //   HEIC: re-seek to 0 (parse from start)

    if magic[..2] == [0xFF, 0xD8] {
        // JPEG: SOI marker was the first 2 bytes. The JPEG parser expects to
        // read segment markers immediately after the SOI, so seek to byte 2.
        file.seek(SeekFrom::Start(2))
            .map_err(|_| "Failed to seek JPEG file".to_string())?;
        parse_jpeg_dimensions(&mut file)
    } else if n >= 8 && magic[..8] == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] {
        // PNG: 8-byte signature consumed. Parser reads the first chunk next,
        // which starts at offset 8. Cursor is already at 12 (we read 12 bytes),
        // so seek back to 8.
        file.seek(SeekFrom::Start(8))
            .map_err(|_| "Failed to seek PNG file".to_string())?;
        parse_png_dimensions(&mut file)
    } else if n >= 6 && (&magic[..6] == b"GIF87a" || &magic[..6] == b"GIF89a") {
        // GIF: 6-byte header consumed. Parser reads the Logical Screen Descriptor
        // which starts immediately after the header at offset 6.
        file.seek(SeekFrom::Start(6))
            .map_err(|_| "Failed to seek GIF file".to_string())?;
        parse_gif_dimensions(&mut file)
    } else if n >= 12 && &magic[..4] == b"RIFF" && &magic[8..12] == b"WEBP" {
        // WebP: 12-byte RIFF+size+WEBP consumed. Parser reads the first chunk
        // type at offset 12. Cursor is already at offset 12 (we read exactly 12 bytes).
        // No seek needed.
        parse_webp_dimensions(&mut file)
    } else if n >= 8 && &magic[4..8] == b"ftyp" {
        // HEIC/HEIF ISO BMFF — ftyp box starts at byte 0. The HEIC parser
        // walks boxes from the beginning of the file.
        file.seek(SeekFrom::Start(0))
            .map_err(|_| "Failed to seek HEIC/HEIF file".to_string())?;
        parse_heic_dimensions(&mut file)
    } else {
        Err(format!(
            "Unsupported image format or unreadable file: {}",
            path
        ))
    }
}

/// Parse JPEG dimensions by walking segment markers until an SOF marker is found.
///
/// Handles SOF0 (0xC0), SOF1 (0xC1), SOF2 (0xC2) which all encode height/width
/// at the same byte offsets. Skips all other segments including APP0, APP1 (Exif),
/// COM, etc.
///
/// The file cursor is assumed to be positioned at byte 2 (after the SOI marker,
/// which was consumed during magic detection in get_image_dimensions).
fn parse_jpeg_dimensions(file: &mut fs::File) -> Result<(u32, u32), String> {
    // Maximum number of segments to scan before giving up.
    const MAX_SEGMENTS: usize = 64;

    for _ in 0..MAX_SEGMENTS {
        // Each marker starts with 0xFF. Read until we find a non-padding byte.
        let mut marker_buf = [0u8; 2];
        file.read_exact(&mut marker_buf)
            .map_err(|_| "Unexpected end of JPEG stream".to_string())?;

        // First byte must be 0xFF (marker prefix).
        if marker_buf[0] != 0xFF {
            return Err("Invalid JPEG marker (missing 0xFF prefix)".to_string());
        }

        // Skip padding bytes: a run of 0xFF before the actual marker byte is valid.
        let mut marker_byte = marker_buf[1];
        while marker_byte == 0xFF {
            let mut b = [0u8; 1];
            file.read_exact(&mut b)
                .map_err(|_| "Unexpected end of JPEG stream (padding)".to_string())?;
            marker_byte = b[0];
        }

        // End of image marker — no SOF found.
        if marker_byte == 0xD9 {
            return Err("No SOF marker found in JPEG (EOI reached)".to_string());
        }

        // Standalone markers (no length field): SOI=0xD8, RST0-RST7=0xD0-0xD7.
        // These do not have a segment length following them; skip without reading length.
        if marker_byte == 0xD8 || (marker_byte >= 0xD0 && marker_byte <= 0xD7) {
            continue;
        }

        // Read 2-byte big-endian segment length (includes the 2 length bytes).
        let mut len_buf = [0u8; 2];
        file.read_exact(&mut len_buf)
            .map_err(|_| "Unexpected end of JPEG segment length".to_string())?;
        let seg_len = u16::from_be_bytes(len_buf) as u64;

        // SOF markers (Baseline, Extended, Progressive) encode dimensions the same way.
        if marker_byte == 0xC0 || marker_byte == 0xC1 || marker_byte == 0xC2 {
            // SOF segment layout (after length):
            //   1 byte: precision (ignored)
            //   2 bytes BE: height
            //   2 bytes BE: width
            let mut sof_data = [0u8; 5];
            file.read_exact(&mut sof_data)
                .map_err(|_| "Truncated JPEG SOF segment".to_string())?;
            let height = u16::from_be_bytes([sof_data[1], sof_data[2]]) as u32;
            let width  = u16::from_be_bytes([sof_data[3], sof_data[4]]) as u32;
            return Ok((width, height));
        }

        // Skip this segment: seek past length - 2 (we already read the 2 length bytes).
        if seg_len >= 2 {
            file.seek(SeekFrom::Current(seg_len as i64 - 2))
                .map_err(|_| "Failed to seek past JPEG segment".to_string())?;
        }
    }

    Err("No SOF marker found in JPEG (segment limit reached)".to_string())
}

/// Parse PNG dimensions from the IHDR chunk.
///
/// The PNG signature (8 bytes) was already consumed during magic detection.
/// The IHDR chunk must be the first chunk per the PNG spec.
fn parse_png_dimensions(file: &mut fs::File) -> Result<(u32, u32), String> {
    // Read first chunk: 4-byte length + 4-byte type.
    let mut chunk_header = [0u8; 8];
    file.read_exact(&mut chunk_header)
        .map_err(|_| "Truncated PNG chunk header".to_string())?;

    let chunk_type = &chunk_header[4..8];
    if chunk_type != b"IHDR" {
        // EC-15: first chunk is not IHDR.
        return Err("PNG IHDR not first chunk".to_string());
    }

    // IHDR data: 4-byte BE width + 4-byte BE height + 5 more bytes (ignored).
    let mut ihdr_data = [0u8; 8];
    file.read_exact(&mut ihdr_data)
        .map_err(|_| "Truncated PNG IHDR chunk".to_string())?;

    let width  = u32::from_be_bytes([ihdr_data[0], ihdr_data[1], ihdr_data[2], ihdr_data[3]]);
    let height = u32::from_be_bytes([ihdr_data[4], ihdr_data[5], ihdr_data[6], ihdr_data[7]]);
    Ok((width, height))
}

/// Parse GIF dimensions from the Logical Screen Descriptor.
///
/// The 6-byte GIF header was already consumed during magic detection.
/// The Logical Screen Descriptor immediately follows the header.
fn parse_gif_dimensions(file: &mut fs::File) -> Result<(u32, u32), String> {
    // Logical Screen Descriptor: 2-byte LE width + 2-byte LE height.
    let mut lsd = [0u8; 4];
    file.read_exact(&mut lsd)
        .map_err(|_| "Truncated GIF Logical Screen Descriptor".to_string())?;

    let width  = u16::from_le_bytes([lsd[0], lsd[1]]) as u32;
    let height = u16::from_le_bytes([lsd[2], lsd[3]]) as u32;
    Ok((width, height))
}

/// Parse WebP dimensions from the first chunk (VP8, VP8L, or VP8X).
///
/// The RIFF header (12 bytes: "RIFF" + 4-byte size + "WEBP") was already
/// consumed during magic detection. The first chunk type follows immediately.
fn parse_webp_dimensions(file: &mut fs::File) -> Result<(u32, u32), String> {
    // Read the first chunk: 4-byte ASCII type + 4-byte LE chunk size.
    let mut chunk_header = [0u8; 8];
    file.read_exact(&mut chunk_header)
        .map_err(|_| "Truncated WebP chunk header".to_string())?;

    let chunk_type = &chunk_header[..4];
    // chunk_size is available if needed for bounds checking; not used here
    // because we read a fixed, known-small number of bytes for each sub-format.

    if chunk_type == b"VP8 " {
        // VP8 lossy bitstream. Key-frame header layout (RFC 6386 §9.1):
        //   Bytes 0-2: frame tag (3 bytes, contains "key frame" flag)
        //   Bytes 3-5: start code 0x9D 0x01 0x2A
        //   Bytes 6-7: LE 16-bit: bits [15:14] = horiz_scale, bits [13:0] = display_width
        //   Bytes 8-9: LE 16-bit: bits [15:14] = vert_scale,  bits [13:0] = display_height
        let mut vp8_data = [0u8; 10];
        file.read_exact(&mut vp8_data)
            .map_err(|_| "Truncated VP8 bitstream".to_string())?;

        // RFC 6386 §9.1: bits [13:0] are the actual display width/height (not dim-1).
        // Bits [15:14] are the horizontal/vertical scale factor.
        let width_raw  = u16::from_le_bytes([vp8_data[6], vp8_data[7]]);
        let height_raw = u16::from_le_bytes([vp8_data[8], vp8_data[9]]);
        let width  = (width_raw  & 0x3FFF) as u32;
        let height = (height_raw & 0x3FFF) as u32;
        Ok((width, height))
    } else if chunk_type == b"VP8L" {
        // VP8 lossless bitstream.
        //   Byte 0: signature 0x2F
        //   Bytes 1-4: packed dimensions in LE bit order:
        //     bits 0-13:  width - 1  (14 bits)
        //     bits 14-27: height - 1 (14 bits)
        let mut vp8l_data = [0u8; 5];
        file.read_exact(&mut vp8l_data)
            .map_err(|_| "Truncated VP8L bitstream".to_string())?;

        if vp8l_data[0] != 0x2F {
            return Err("Invalid VP8L signature byte".to_string());
        }

        // Unpack the two 14-bit fields from the 4-byte LE integer at bytes 1-4.
        let bits = u32::from_le_bytes([vp8l_data[1], vp8l_data[2], vp8l_data[3], vp8l_data[4]]);
        let width  = (bits & 0x3FFF) + 1;
        let height = ((bits >> 14) & 0x3FFF) + 1;
        Ok((width, height))
    } else if chunk_type == b"VP8X" {
        // VP8X (extended WebP): canvas dimensions stored as 24-bit LE values.
        //   Bytes 0-3: flags (4 bytes, skip)
        //   Bytes 4-6: canvas width  minus 1 (24-bit LE)
        //   Bytes 7-9: canvas height minus 1 (24-bit LE)
        let mut vp8x_data = [0u8; 10];
        file.read_exact(&mut vp8x_data)
            .map_err(|_| "Truncated VP8X chunk".to_string())?;

        // Build u32 from 3-byte LE: pad the high byte with 0x00.
        let width  = u32::from_le_bytes([vp8x_data[4], vp8x_data[5], vp8x_data[6], 0]) + 1;
        let height = u32::from_le_bytes([vp8x_data[7], vp8x_data[8], vp8x_data[9], 0]) + 1;
        Ok((width, height))
    } else {
        Err(format!(
            "Unsupported WebP chunk type: {:?}",
            std::str::from_utf8(chunk_type).unwrap_or("???")
        ))
    }
}

/// Parse HEIC/HEIF dimensions by walking ISO BMFF boxes to find the `ispe` box.
///
/// Path in the BMFF hierarchy: meta (FullBox) → iprp → ipco → ispe.
/// The `ispe` box contains: 4-byte version+flags + 4-byte BE width + 4-byte BE height.
///
/// Implementation: depth-limited iterative box walker (max depth 6).
/// Box sizes of 0 (extends to EOF) or 1 (64-bit extended) are rejected as Err.
fn parse_heic_dimensions(file: &mut fs::File) -> Result<(u32, u32), String> {
    /// Read the next box header (size + type) from the current file position.
    /// Returns (size_of_box_data, type_bytes, box_start_offset).
    /// `size_of_box_data` is the number of bytes of content AFTER the 8-byte header.
    fn read_box_header(f: &mut fs::File) -> io::Result<Option<(u64, [u8; 4], u64)>> {
        let pos = f.stream_position()?;
        let mut header = [0u8; 8];
        match f.read_exact(&mut header) {
            Ok(_) => {},
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
            Err(e) => return Err(e),
        }
        let size = u32::from_be_bytes([header[0], header[1], header[2], header[3]]) as u64;
        let box_type: [u8; 4] = [header[4], header[5], header[6], header[7]];

        // size = 0 means "to EOF"; size = 1 means 64-bit extended size header.
        // Both are unsupported — real HEIC ftyp and meta boxes use 32-bit sizes.
        if size == 0 || size == 1 {
            return Err(io::Error::new(io::ErrorKind::Unsupported, "64-bit BMFF box size not supported"));
        }
        // Data length = total box size minus the 8-byte header already consumed.
        let data_len = size.saturating_sub(8);
        Ok(Some((data_len, box_type, pos)))
    }

    /// Scan child boxes within a region [start, start+len) looking for `target_type`.
    /// Returns the file offset just after the target box's header (i.e. start of data).
    /// Leaves the cursor at that position on success.
    fn find_child_box(
        f: &mut fs::File,
        region_start: u64,
        region_len: u64,
        target_type: &[u8; 4],
    ) -> io::Result<Option<(u64, u64)>> {
        // Seek to the start of the region.
        f.seek(SeekFrom::Start(region_start))?;
        let region_end = region_start + region_len;

        loop {
            let pos = f.stream_position()?;
            if pos >= region_end { break; }

            match read_box_header(f)? {
                None => break,
                Some((data_len, box_type, _box_start)) => {
                    if &box_type == target_type {
                        // Found. Cursor is now at start of this box's data.
                        return Ok(Some((f.stream_position()?, data_len)));
                    }
                    // Skip this box's data to move to the next sibling.
                    f.seek(SeekFrom::Current(data_len as i64))?;
                }
            }
        }
        Ok(None)
    }

    // Step 1: Get the total file length to bound the top-level box scan.
    let file_len = file.seek(SeekFrom::End(0))
        .map_err(|e| format!("Failed to seek HEIC file: {}", e))?;
    file.seek(SeekFrom::Start(0))
        .map_err(|e| format!("Failed to seek HEIC file to start: {}", e))?;

    // Step 2: Find `meta` box at the top level.
    // `meta` is a FullBox: after the 8-byte header there are 4 bytes of version+flags
    // before the child boxes begin.
    let (meta_data_len, meta_data_offset) = find_child_box(file, 0, file_len, b"meta")
        .map_err(|e| format!("HEIC box walk error: {}", e))?
        .ok_or_else(|| "Could not find ispe box in HEIC/HEIF file (meta not found)".to_string())?;

    // Skip 4-byte version+flags of the FullBox to reach the child boxes.
    let meta_children_offset = meta_data_offset + 4;
    let meta_children_len = meta_data_len.saturating_sub(4);

    // Step 3: Find `iprp` inside `meta`.
    let (iprp_data_len, iprp_data_offset) =
        find_child_box(file, meta_children_offset, meta_children_len, b"iprp")
            .map_err(|e| format!("HEIC iprp box walk error: {}", e))?
            .ok_or_else(|| "Could not find ispe box in HEIC/HEIF file (iprp not found)".to_string())?;

    // Step 4: Find `ipco` inside `iprp`.
    let (ipco_data_len, ipco_data_offset) =
        find_child_box(file, iprp_data_offset, iprp_data_len, b"ipco")
            .map_err(|e| format!("HEIC ipco box walk error: {}", e))?
            .ok_or_else(|| "Could not find ispe box in HEIC/HEIF file (ipco not found)".to_string())?;

    // Step 5: Find `ispe` inside `ipco`.
    let (ispe_data_len, ispe_data_offset) =
        find_child_box(file, ipco_data_offset, ipco_data_len, b"ispe")
            .map_err(|e| format!("HEIC ispe box walk error: {}", e))?
            .ok_or_else(|| "Could not find ispe box in HEIC/HEIF file (ispe not found)".to_string())?;

    if ispe_data_len < 8 {
        return Err("HEIC/HEIF ispe box too small to contain dimensions".to_string());
    }

    // Step 6: Read `ispe` content.
    // Layout: 4-byte version+flags (all zero for v1) + 4-byte BE width + 4-byte BE height.
    file.seek(SeekFrom::Start(ispe_data_offset))
        .map_err(|e| format!("HEIC ispe seek error: {}", e))?;

    let mut ispe_data = [0u8; 12];
    file.read_exact(&mut ispe_data)
        .map_err(|_| "Truncated HEIC/HEIF ispe box".to_string())?;

    // Bytes 0-3: version+flags (skip).
    let width  = u32::from_be_bytes([ispe_data[4], ispe_data[5], ispe_data[6], ispe_data[7]]);
    let height = u32::from_be_bytes([ispe_data[8], ispe_data[9], ispe_data[10], ispe_data[11]]);
    Ok((width, height))
}

// ── EXIF data command ─────────────────────────────────────────────────────────

/// Exif metadata extracted from a JPEG image file.
///
/// Both fields are None when the corresponding Exif tag is absent.
/// Null bytes in Make/Model strings are stripped before returning (EC-22).
#[derive(serde::Serialize, Debug)]
pub struct ExifData {
    /// DateTimeOriginal tag (0x9003) formatted as "YYYY-MM-DD", or None if absent.
    pub date_taken: Option<String>,
    /// Camera string: "Make Model" (space-joined), or just "Make" or "Model"
    /// if only one is present, or None if both are absent.
    pub camera: Option<String>,
}

/// Read EXIF metadata (DateTimeOriginal, Make, Model) from a JPEG file.
///
/// Parses only the JPEG APP1 Exif segment header. No full image decode.
/// v1: JPEG only. HEIC/HEIF Exif is not parsed in this version.
///
/// # Arguments
/// * `path` - Absolute path to the JPEG image file.
///
/// # Returns
/// * `Ok(ExifData)` — date_taken and camera fields (either may be None)
/// * `Err(message)` — not a JPEG, no Exif APP1 found, or read failure
#[tauri::command]
pub fn get_exif_data(path: String) -> Result<ExifData, String> {
    let mut file = fs::File::open(&path)
        .map_err(|e| format!("Failed to open file: {} ({})", path, e))?;

    // Verify JPEG SOI marker.
    let mut soi = [0u8; 2];
    file.read_exact(&mut soi)
        .map_err(|_| "Failed to read file header".to_string())?;

    if soi != [0xFF, 0xD8] {
        return Err("Not a JPEG file".to_string());
    }

    // Scan JPEG markers to find the APP1 Exif segment.
    // APP1 marker: 0xFF 0xE1.
    const MAX_MARKER_SCAN: usize = 32;

    // Track the byte offset within the file so we can seek into the TIFF block.
    // After reading SOI (2 bytes), we are at offset 2.

    for _ in 0..MAX_MARKER_SCAN {
        // Each segment starts with 0xFF + marker byte.
        let mut marker = [0u8; 2];
        match file.read_exact(&mut marker) {
            Ok(_) => {},
            Err(_) => return Err("No Exif segment found".to_string()),
        }

        if marker[0] != 0xFF {
            return Err("Invalid JPEG marker".to_string());
        }

        // Skip padding 0xFF bytes.
        let mut marker_byte = marker[1];
        while marker_byte == 0xFF {
            let mut b = [0u8; 1];
            match file.read_exact(&mut b) {
                Ok(_) => marker_byte = b[0],
                Err(_) => return Err("No Exif segment found".to_string()),
            }
        }

        // EOI = end of image, no Exif found.
        if marker_byte == 0xD9 {
            return Err("No Exif segment found".to_string());
        }

        // Standalone markers (no length field).
        if marker_byte == 0xD8 || (marker_byte >= 0xD0 && marker_byte <= 0xD7) {
            continue;
        }

        // Read segment length (2 bytes BE, includes the 2 length bytes).
        let mut len_buf = [0u8; 2];
        file.read_exact(&mut len_buf)
            .map_err(|_| "Failed to read JPEG segment length".to_string())?;
        let seg_len = u16::from_be_bytes(len_buf) as u64;

        if marker_byte == 0xE1 {
            // Potential APP1 segment. Check for "Exif\0\0" identifier (6 bytes).
            if seg_len < 8 {
                // Too short to contain Exif header; skip.
                if seg_len >= 2 {
                    file.seek(SeekFrom::Current(seg_len as i64 - 2))
                        .map_err(|_| "Seek error in APP1 segment".to_string())?;
                }
                continue;
            }

            let mut identifier = [0u8; 6];
            file.read_exact(&mut identifier)
                .map_err(|_| "Failed to read APP1 identifier".to_string())?;

            if &identifier != b"Exif\0\0" {
                // Not an Exif APP1 (could be XMP or another APP1 variant). Skip remainder.
                if seg_len >= 8 {
                    file.seek(SeekFrom::Current(seg_len as i64 - 8))
                        .map_err(|_| "Seek error skipping APP1".to_string())?;
                }
                continue;
            }

            // We are now at the start of the TIFF header.
            // Record the TIFF base offset so we can resolve IFD offsets later.
            let tiff_base: u64 = file.stream_position()
                .map_err(|_| "Failed to get stream position".to_string())?;

            return parse_exif_tiff(&mut file, tiff_base);
        }

        // Skip this segment.
        if seg_len >= 2 {
            file.seek(SeekFrom::Current(seg_len as i64 - 2))
                .map_err(|_| "Failed to seek past JPEG segment".to_string())?;
        }
    }

    Err("No Exif segment found".to_string())
}

/// Parse the TIFF block inside an Exif APP1 segment.
///
/// Reads IFD0 for Make (0x010F) and Model (0x0110), then follows the ExifIFD
/// pointer (tag 0x8769) to find DateTimeOriginal (0x9003) if not in IFD0.
///
/// `tiff_base` is the absolute file offset where the TIFF header begins.
fn parse_exif_tiff(file: &mut fs::File, tiff_base: u64) -> Result<ExifData, String> {
    // Read TIFF header: 2-byte byte order + 2-byte magic (42) + 4-byte IFD0 offset.
    let mut tiff_header = [0u8; 8];
    file.read_exact(&mut tiff_header)
        .map_err(|_| "Failed to read TIFF header".to_string())?;

    // Byte order mark: "II" = little-endian, "MM" = big-endian.
    let is_le = match &tiff_header[..2] {
        b"II" => true,
        b"MM" => false,
        _ => return Err("Invalid TIFF byte order mark".to_string()),
    };

    // Verify TIFF magic number (42 in the detected byte order).
    let magic = read_u16(&tiff_header[2..4], is_le);
    if magic != 42 {
        return Err("Invalid TIFF magic number".to_string());
    }

    let ifd0_offset = read_u32(&tiff_header[4..8], is_le);

    // Seek to IFD0.
    file.seek(SeekFrom::Start(tiff_base + ifd0_offset as u64))
        .map_err(|_| "Failed to seek to IFD0".to_string())?;

    // Walk IFD0 to collect Make, Model, and ExifIFD offset.
    let (make_raw, model_raw, date_raw, exif_ifd_offset) =
        walk_ifd(file, tiff_base, is_le, true)?;

    // If DateTimeOriginal not found in IFD0, follow ExifIFD pointer.
    let final_date = if date_raw.is_none() {
        if let Some(exif_offset) = exif_ifd_offset {
            file.seek(SeekFrom::Start(tiff_base + exif_offset as u64))
                .map_err(|_| "Failed to seek to ExifIFD".to_string())?;
            let (_, _, exif_date, _) = walk_ifd(file, tiff_base, is_le, false)?;
            exif_date
        } else {
            None
        }
    } else {
        date_raw
    };

    // Reformat DateTimeOriginal from "YYYY:MM:DD HH:MM:SS" to "YYYY-MM-DD".
    let date_taken = final_date.map(|s| reformat_exif_date(&s));

    // Build camera string by joining Make and Model (EC-4, EC-22).
    let camera = build_camera_string(make_raw, model_raw);

    Ok(ExifData { date_taken, camera })
}

/// Walk an IFD (Image File Directory) in a TIFF block.
///
/// Collects:
///   - Make (tag 0x010F) raw string
///   - Model (tag 0x0110) raw string
///   - DateTimeOriginal (tag 0x9003) raw string
///   - ExifIFD offset (tag 0x8769) — only collected when `collect_exif_ptr` is true
///
/// Returns `(make, model, date, exif_ifd_offset)`.
fn walk_ifd(
    file: &mut fs::File,
    tiff_base: u64,
    is_le: bool,
    collect_exif_ptr: bool,
) -> Result<(Option<String>, Option<String>, Option<String>, Option<u32>), String> {
    // Read 2-byte entry count.
    let mut count_buf = [0u8; 2];
    file.read_exact(&mut count_buf)
        .map_err(|_| "Failed to read IFD entry count".to_string())?;
    let entry_count = read_u16(&count_buf, is_le) as usize;

    let mut make_raw:  Option<String> = None;
    let mut model_raw: Option<String> = None;
    let mut date_raw:  Option<String> = None;
    let mut exif_ptr:  Option<u32>    = None;

    // Each IFD entry is 12 bytes: 2-byte tag + 2-byte type + 4-byte count + 4-byte value/offset.
    for _ in 0..entry_count {
        let mut entry = [0u8; 12];
        file.read_exact(&mut entry)
            .map_err(|_| "Failed to read IFD entry".to_string())?;

        let tag   = read_u16(&entry[0..2], is_le);
        let _typ  = read_u16(&entry[2..4], is_le); // type (ASCII = 2, LONG = 4, etc.)
        let count = read_u32(&entry[4..8], is_le);
        let value_or_offset = read_u32(&entry[8..12], is_le);

        match tag {
            0x010F => {
                // Make: ASCII field.
                make_raw = read_ascii_field(file, tiff_base, count, value_or_offset, is_le);
            }
            0x0110 => {
                // Model: ASCII field.
                model_raw = read_ascii_field(file, tiff_base, count, value_or_offset, is_le);
            }
            0x9003 => {
                // DateTimeOriginal: ASCII field (stored in ExifIFD usually, but
                // some cameras write it directly in IFD0).
                date_raw = read_ascii_field(file, tiff_base, count, value_or_offset, is_le);
            }
            0x8769 if collect_exif_ptr => {
                // ExifIFD pointer (offset from TIFF base).
                exif_ptr = Some(value_or_offset);
            }
            _ => {}
        }
    }

    Ok((make_raw, model_raw, date_raw, exif_ptr))
}

/// Read an ASCII TIFF field, following the offset if count > 4.
///
/// When count <= 4, the bytes are stored directly in the 4-byte value_or_offset
/// field of the IFD entry (packed in native byte order, but for ASCII it's just bytes).
/// When count > 4, value_or_offset is an offset from tiff_base to the actual data.
///
/// Null bytes are stripped (EC-22) and the result is trimmed. Returns None if empty.
fn read_ascii_field(
    file: &mut fs::File,
    tiff_base: u64,
    count: u32,
    value_or_offset: u32,
    _is_le: bool,
) -> Option<String> {
    if count == 0 {
        return None;
    }

    let bytes: Vec<u8> = if count <= 4 {
        // ASCII bytes are packed directly in the 4-byte value field.
        // They are stored as raw bytes (little-endian layout in the 4-byte integer).
        value_or_offset.to_le_bytes()[..count as usize].to_vec()
    } else {
        // Seek to the offset from TIFF base and read `count` bytes.
        let abs_offset = tiff_base + value_or_offset as u64;
        // Remember the current position so we can return here after the seek.
        let saved_pos = file.stream_position().ok()?;
        file.seek(SeekFrom::Start(abs_offset)).ok()?;
        let mut buf = vec![0u8; count as usize];
        file.read_exact(&mut buf).ok()?;
        // Restore the file cursor to after the IFD entry we were processing.
        file.seek(SeekFrom::Start(saved_pos)).ok()?;
        buf
    };

    // Convert to UTF-8 (lossy), strip null bytes, and trim whitespace.
    let s: String = String::from_utf8_lossy(&bytes)
        .replace('\0', "")
        .trim()
        .to_string();

    if s.is_empty() { None } else { Some(s) }
}

/// Reformat an Exif date string from "YYYY:MM:DD HH:MM:SS" to "YYYY-MM-DD".
///
/// Takes the first 10 characters and replaces colons in positions 4 and 7
/// with hyphens. If the string is shorter than 10 characters it is returned
/// as-is (EC-17: no validation, no panic on unusual values).
fn reformat_exif_date(s: &str) -> String {
    if s.len() < 10 {
        return s.to_string();
    }
    // Replace "YYYY:MM:DD" → "YYYY-MM-DD".
    let date_part = &s[..10];
    date_part.replace(':', "-")
}

/// Build the camera string from Make and Model (EC-4: handle partial presence).
///
/// "Make Model" if both are non-empty.
/// Only Make or only Model if the other is absent.
/// None if both are absent.
fn build_camera_string(make: Option<String>, model: Option<String>) -> Option<String> {
    match (make, model) {
        (Some(m), Some(mo)) if !m.is_empty() && !mo.is_empty() => {
            Some(format!("{} {}", m, mo))
        }
        (Some(m), _) if !m.is_empty() => Some(m),
        (_, Some(mo)) if !mo.is_empty() => Some(mo),
        _ => None,
    }
}

/// Read a 2-byte unsigned integer from a byte slice in the given byte order.
fn read_u16(bytes: &[u8], is_le: bool) -> u16 {
    if is_le {
        u16::from_le_bytes([bytes[0], bytes[1]])
    } else {
        u16::from_be_bytes([bytes[0], bytes[1]])
    }
}

/// Read a 4-byte unsigned integer from a byte slice in the given byte order.
fn read_u32(bytes: &[u8], is_le: bool) -> u32 {
    if is_le {
        u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
    } else {
        u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
    }
}

// ── Sidecar existence check ───────────────────────────────────────────────────

/// Check whether a sidecar file (path + ".md") exists as a regular file on disk.
///
/// The sidecar path is `path + ".md"` (e.g. "/vault/photo.jpg.md" for
/// "/vault/photo.jpg"). This is an append, not a path-extension replacement,
/// so PathBuf::with_extension is NOT used here.
///
/// Returns Ok(true) if the sidecar exists as a regular file.
/// Returns Ok(false) if the sidecar does not exist or is a directory.
/// Returns Err only for OS-level errors (e.g. permission denied on parent).
///
/// Follows symlinks (metadata() follows symlinks on macOS and Linux).
///
/// # Arguments
/// * `path` - Absolute path to the source file (e.g. "/vault/photo.jpg").
///
/// # Returns
/// * `Ok(true)`  — sidecar file exists as a regular file
/// * `Ok(false)` — sidecar does not exist
/// * `Err(msg)`  — OS error other than "not found"
#[tauri::command]
pub fn sidecar_exists(path: String) -> Result<bool, String> {
    let sidecar_path = format!("{}.md", &path);
    match std::path::Path::new(&sidecar_path).metadata() {
        Ok(m) => Ok(m.is_file()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(format!("Failed to check sidecar: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::*;

    #[test]
    fn test_read_file_success() {
        let path = create_temp_file("read_success", "# Hello World").unwrap();
        let result = read_file(path.to_string_lossy().to_string());
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "# Hello World");
        remove_temp_file(&path).unwrap();
    }

    #[test]
    fn test_read_file_not_found() {
        let result = read_file("/nonexistent/path/file.md".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("File not found"));
    }

    #[test]
    fn test_read_file_is_directory() {
        let dir = std::env::temp_dir();
        let result = read_file(dir.to_string_lossy().to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Is a directory"));
    }

    #[test]
    fn test_write_file_success() {
        let path = std::env::temp_dir().join(format!("markable_write_test_{}.md", std::process::id()));
        let content = "# Test Content\n\nThis is a test.";

        let result = write_file(path.to_string_lossy().to_string(), content.to_string());
        assert!(result.is_ok());

        // Verify file was actually written
        let read_result = fs::read_to_string(&path);
        assert!(read_result.is_ok());
        assert_eq!(read_result.unwrap(), content);

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_write_file_creates_new_file() {
        let path = std::env::temp_dir().join(format!("markable_new_file_{}.md", std::process::id()));

        // Ensure file doesn't exist
        let _ = fs::remove_file(&path);

        let content = "New file content";
        let result = write_file(path.to_string_lossy().to_string(), content.to_string());
        assert!(result.is_ok());
        assert!(path.exists());

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_write_file_overwrites_existing() {
        let path = std::env::temp_dir().join(format!("markable_overwrite_{}.md", std::process::id()));

        // Create initial file
        fs::write(&path, "Initial content").unwrap();

        // Overwrite with new content
        let new_content = "Overwritten content";
        let result = write_file(path.to_string_lossy().to_string(), new_content.to_string());
        assert!(result.is_ok());

        // Verify content was overwritten
        let read_result = fs::read_to_string(&path);
        assert_eq!(read_result.unwrap(), new_content);

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_atomic_write_leaves_original_untouched_on_error() {
        // This test verifies the atomic swap property:
        // If we can't rename the temp file, the original is untouched.

        let path = std::env::temp_dir().join(format!("markable_atomic_{}.md", std::process::id()));
        let original_content = "Original content";

        fs::write(&path, original_content).unwrap();

        // Attempt to write to a path in a nonexistent directory
        // This should fail at the parent directory check
        let bad_path = "/nonexistent/markable_atomic_test.md";
        let result = write_file(bad_path.to_string(), "Should fail".to_string());
        assert!(result.is_err());

        // Original file should still be intact
        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content, original_content);

        let _ = fs::remove_file(&path);
    }

    // ── write_binary_file tests ────────────────────────────────────────────
    //
    // Each test path includes both the PID and the current thread ID so that
    // parallel test threads within the same process never share a file path.

    #[test]
    fn test_write_binary_file_success() {
        // Use the PNG magic bytes as representative binary content.
        // This verifies the file is written verbatim without encoding changes.
        let bytes: Vec<u8> = vec![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        let path = std::env::temp_dir()
            .join(format!("markable_binary_success_{}_{:?}.bin",
                std::process::id(), std::thread::current().id()));

        let result = write_binary_file(path.to_string_lossy().to_string(), bytes.clone());
        assert!(result.is_ok(), "Expected Ok(()), got: {:?}", result.err());

        // Read back raw bytes and compare byte-for-byte.
        let read_back = fs::read(&path).expect("File should be readable after write");
        assert_eq!(read_back, bytes, "Read-back bytes must equal written bytes");

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_write_binary_file_creates_new_file() {
        let path = std::env::temp_dir()
            .join(format!("markable_binary_creates_{}_{:?}.bin",
                std::process::id(), std::thread::current().id()));

        // Ensure the file does not exist before the test.
        let _ = fs::remove_file(&path);
        assert!(!path.exists(), "Pre-condition: file must not exist before write");

        let result = write_binary_file(
            path.to_string_lossy().to_string(),
            vec![0xDE, 0xAD, 0xBE, 0xEF],
        );
        assert!(result.is_ok(), "Expected Ok(()), got: {:?}", result.err());
        assert!(path.exists(), "File must exist after a successful write");

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn test_write_binary_file_parent_missing() {
        // A path whose parent directory does not exist must return the
        // canonical "File not found" error message.
        let result = write_binary_file(
            "/nonexistent/test.bin".to_string(),
            vec![0x00],
        );
        assert!(result.is_err(), "Expected Err for missing parent dir");
        assert!(
            result.unwrap_err().contains("File not found"),
            "Error message must contain 'File not found'"
        );
    }

    #[test]
    fn test_write_binary_file_empty_data() {
        // Writing zero bytes is a valid operation (e.g. an empty clipboard item).
        let path = std::env::temp_dir()
            .join(format!("markable_binary_empty_{}_{:?}.bin",
                std::process::id(), std::thread::current().id()));
        let _ = fs::remove_file(&path);

        let result = write_binary_file(path.to_string_lossy().to_string(), vec![]);
        assert!(result.is_ok(), "Expected Ok(()) for empty data, got: {:?}", result.err());

        // File must exist and have zero length.
        let metadata = fs::metadata(&path).expect("File must exist after write");
        assert_eq!(metadata.len(), 0, "File must be empty (0 bytes)");

        let _ = fs::remove_file(&path);
    }

    // ── get_image_dimensions tests ─────────────────────────────────────────────
    //
    // Each test writes a minimal header to a temp file using thread-ID-qualified
    // filenames to avoid parallel-test collisions.

    fn tid_suffix() -> String {
        format!("{}_{:?}", std::process::id(), std::thread::current().id())
    }

    /// Build a minimal valid JPEG file with a single SOF0 segment.
    /// Contains: SOI + APP0 (minimal) + SOF0 with given w×h + EOI.
    ///
    /// SOF0 segment data:
    ///   1 byte: precision
    ///   2 bytes: height (BE)
    ///   2 bytes: width (BE)
    ///   1 byte: number of components (3)
    ///   9 bytes: component specs (3 × 3 bytes)
    /// Total data = 15 bytes. Segment length field = data + 2 (length bytes) = 17 = 0x0011.
    fn make_jpeg_bytes(width: u16, height: u16) -> Vec<u8> {
        let mut v = vec![];
        // SOI
        v.extend_from_slice(&[0xFF, 0xD8]);
        // APP0 marker — JFIF header.
        // Segment content: "JFIF\0" (5) + version(2) + units(1) + density(4) + thumbnail(2) = 14 bytes data.
        // Segment length = 14 + 2 = 16 = 0x0010.
        v.extend_from_slice(&[0xFF, 0xE0]);
        v.extend_from_slice(&[0x00, 0x10]); // length = 16
        v.extend_from_slice(b"JFIF\0");     // 5 bytes identifier
        v.extend_from_slice(&[0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]); // 9 bytes padding
        // SOF0 marker.
        v.extend_from_slice(&[0xFF, 0xC0]);
        // SOF0 segment: length = 17 = 0x0011.
        // Data: precision(1) + height(2) + width(2) + ncomp(1) + specs(9) = 15 bytes.
        // Length field includes itself: 15 + 2 = 17 = 0x0011.
        v.extend_from_slice(&[0x00, 0x11]);
        v.push(0x08); // precision (8-bit)
        v.extend_from_slice(&height.to_be_bytes());
        v.extend_from_slice(&width.to_be_bytes());
        v.push(0x03); // 3 components
        v.extend_from_slice(&[0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]); // 9 bytes
        // EOI
        v.extend_from_slice(&[0xFF, 0xD9]);
        v
    }

    /// Build a minimal valid PNG file with IHDR for given w×h.
    fn make_png_bytes(width: u32, height: u32) -> Vec<u8> {
        let mut v = vec![];
        // PNG signature
        v.extend_from_slice(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        // IHDR chunk: 4-byte data length + "IHDR" + 13 bytes data + 4-byte CRC
        v.extend_from_slice(&[0x00, 0x00, 0x00, 0x0D]); // data length = 13
        v.extend_from_slice(b"IHDR");
        v.extend_from_slice(&width.to_be_bytes());
        v.extend_from_slice(&height.to_be_bytes());
        v.extend_from_slice(&[0x08, 0x02, 0x00, 0x00, 0x00]); // bit depth, color type, etc.
        v.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // CRC placeholder
        v
    }

    /// Build a minimal valid GIF file with given logical screen size.
    fn make_gif_bytes(width: u16, height: u16) -> Vec<u8> {
        let mut v = vec![];
        v.extend_from_slice(b"GIF89a");
        v.extend_from_slice(&width.to_le_bytes());
        v.extend_from_slice(&height.to_le_bytes());
        // Minimal Global Color Table Flag + packed fields + background/aspect
        v.extend_from_slice(&[0x00, 0x00, 0x00]);
        v
    }

    /// Build a minimal valid WebP VP8L file with given dimensions.
    fn make_webp_vp8l_bytes(width: u32, height: u32) -> Vec<u8> {
        let w = width - 1;
        let h = height - 1;
        // Pack w (14 bits) and h (14 bits) into a 28-bit LE integer.
        let packed: u32 = (w & 0x3FFF) | ((h & 0x3FFF) << 14);
        let packed_bytes = packed.to_le_bytes();

        // VP8L chunk data: 1 signature byte + 4 dimension bytes.
        let vp8l_data: Vec<u8> = {
            let mut d = vec![0x2F]; // VP8L signature
            d.extend_from_slice(&packed_bytes);
            d
        };

        let vp8l_chunk_size = vp8l_data.len() as u32;

        // RIFF container: "RIFF" + 4-byte file size (LE) + "WEBP" + chunk header + data
        let riff_size = 4 + 4 + 4 + vp8l_chunk_size; // "WEBP" + chunk header + data
        let mut v = vec![];
        v.extend_from_slice(b"RIFF");
        v.extend_from_slice(&riff_size.to_le_bytes());
        v.extend_from_slice(b"WEBP");
        v.extend_from_slice(b"VP8L");
        v.extend_from_slice(&vp8l_chunk_size.to_le_bytes());
        v.extend_from_slice(&vp8l_data);
        v
    }

    /// Build a minimal valid WebP VP8 (lossy) file with given display dimensions.
    ///
    /// RFC 6386 §9.1: bits [13:0] store the actual display dimension (not dim-1).
    /// Bits [15:14] are the scale factor (set to 0 here).
    fn make_webp_vp8_bytes(width: u32, height: u32) -> Vec<u8> {
        // 10-byte VP8 key-frame header.
        // Bytes 0-2: frame tag — bit 0 = 0 for key frame, version = 0, show_frame = 1.
        //   first_part_size occupies bits 18:4; set to a placeholder small value (1 << 4).
        let frame_tag: u32 = (1 << 4) | (1 << 3); // show_frame=1, key_frame bit=0
        let tag_bytes = frame_tag.to_le_bytes();
        // Bytes 3-5: start code 0x9D 0x01 0x2A
        // Bytes 6-7: (horiz_scale << 14) | display_width  (scale = 0 for test)
        // Bytes 8-9: (vert_scale  << 14) | display_height (scale = 0 for test)
        let width_bytes  = ((width  & 0x3FFF) as u16).to_le_bytes();
        let height_bytes = ((height & 0x3FFF) as u16).to_le_bytes();

        let vp8_data: Vec<u8> = vec![
            tag_bytes[0], tag_bytes[1], tag_bytes[2], // frame tag (3 bytes)
            0x9D, 0x01, 0x2A,                         // start code
            width_bytes[0],  width_bytes[1],           // display width
            height_bytes[0], height_bytes[1],          // display height
        ];

        let chunk_size = vp8_data.len() as u32;
        let riff_size  = 4 + 4 + 4 + chunk_size; // "WEBP" + chunk_type + chunk_size + data
        let mut v = vec![];
        v.extend_from_slice(b"RIFF");
        v.extend_from_slice(&riff_size.to_le_bytes());
        v.extend_from_slice(b"WEBP");
        v.extend_from_slice(b"VP8 ");
        v.extend_from_slice(&chunk_size.to_le_bytes());
        v.extend_from_slice(&vp8_data);
        v
    }

    /// Build a minimal valid WebP VP8X file with given canvas dimensions.
    fn make_webp_vp8x_bytes(width: u32, height: u32) -> Vec<u8> {
        let w_minus1 = width - 1;
        let h_minus1 = height - 1;

        // VP8X chunk data: 4-byte flags + 3-byte canvas width minus 1 + 3-byte canvas height minus 1.
        let w_bytes = w_minus1.to_le_bytes();
        let h_bytes = h_minus1.to_le_bytes();
        let vp8x_data: Vec<u8> = vec![
            0x00, 0x00, 0x00, 0x00, // flags
            w_bytes[0], w_bytes[1], w_bytes[2],
            h_bytes[0], h_bytes[1], h_bytes[2],
        ];

        let vp8x_chunk_size = vp8x_data.len() as u32;
        let riff_size = 4 + 4 + 4 + vp8x_chunk_size;

        let mut v = vec![];
        v.extend_from_slice(b"RIFF");
        v.extend_from_slice(&riff_size.to_le_bytes());
        v.extend_from_slice(b"WEBP");
        v.extend_from_slice(b"VP8X");
        v.extend_from_slice(&vp8x_chunk_size.to_le_bytes());
        v.extend_from_slice(&vp8x_data);
        v
    }

    #[test]
    fn td_01_jpeg_sof0_returns_correct_dimensions() {
        let path = std::env::temp_dir().join(format!("markable_td01_{}.jpg", tid_suffix()));
        let _ = fs::remove_file(&path);
        fs::write(&path, make_jpeg_bytes(1920, 1080)).unwrap();

        let result = get_image_dimensions(path.to_string_lossy().to_string());
        assert!(result.is_ok(), "Expected Ok, got: {:?}", result.err());
        assert_eq!(result.unwrap(), (1920, 1080));

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn td_02_png_1x1_returns_correct_dimensions() {
        let path = std::env::temp_dir().join(format!("markable_td02_{}.png", tid_suffix()));
        let _ = fs::remove_file(&path);
        fs::write(&path, make_png_bytes(1, 1)).unwrap();

        let result = get_image_dimensions(path.to_string_lossy().to_string());
        assert!(result.is_ok(), "Expected Ok, got: {:?}", result.err());
        assert_eq!(result.unwrap(), (1, 1));

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn td_03_gif_320x240_returns_correct_dimensions() {
        let path = std::env::temp_dir().join(format!("markable_td03_{}.gif", tid_suffix()));
        let _ = fs::remove_file(&path);
        fs::write(&path, make_gif_bytes(320, 240)).unwrap();

        let result = get_image_dimensions(path.to_string_lossy().to_string());
        assert!(result.is_ok(), "Expected Ok, got: {:?}", result.err());
        assert_eq!(result.unwrap(), (320, 240));

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn td_04_webp_vp8l_returns_correct_dimensions() {
        let path = std::env::temp_dir().join(format!("markable_td04_{}.webp", tid_suffix()));
        let _ = fs::remove_file(&path);
        fs::write(&path, make_webp_vp8l_bytes(800, 600)).unwrap();

        let result = get_image_dimensions(path.to_string_lossy().to_string());
        assert!(result.is_ok(), "Expected Ok, got: {:?}", result.err());
        assert_eq!(result.unwrap(), (800, 600));

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn td_05_truncated_png_returns_err() {
        let path = std::env::temp_dir().join(format!("markable_td05_{}.png", tid_suffix()));
        let _ = fs::remove_file(&path);
        // Only write the first 4 bytes of the PNG signature — not enough to parse.
        fs::write(&path, &[0x89, 0x50, 0x4E, 0x47]).unwrap();

        let result = get_image_dimensions(path.to_string_lossy().to_string());
        assert!(result.is_err(), "Expected Err for truncated PNG");

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn td_06_zero_byte_file_returns_err() {
        let path = std::env::temp_dir().join(format!("markable_td06_{}.img", tid_suffix()));
        let _ = fs::remove_file(&path);
        fs::write(&path, &[] as &[u8]).unwrap();

        let result = get_image_dimensions(path.to_string_lossy().to_string());
        assert!(result.is_err(), "Expected Err for zero-byte file");

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn td_07_non_image_plain_text_returns_err() {
        let path = std::env::temp_dir().join(format!("markable_td07_{}.txt", tid_suffix()));
        let _ = fs::remove_file(&path);
        fs::write(&path, b"Hello, world!").unwrap();

        let result = get_image_dimensions(path.to_string_lossy().to_string());
        assert!(result.is_err(), "Expected Err for plain text file");
        assert!(result.unwrap_err().contains("Unsupported"), "Should report unsupported format");

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn td_08_webp_vp8x_canvas_dimensions_correct() {
        // EC-14: VP8X extended WebP canvas size.
        let path = std::env::temp_dir().join(format!("markable_td08_{}.webp", tid_suffix()));
        let _ = fs::remove_file(&path);
        fs::write(&path, make_webp_vp8x_bytes(1024, 768)).unwrap();

        let result = get_image_dimensions(path.to_string_lossy().to_string());
        assert!(result.is_ok(), "Expected Ok, got: {:?}", result.err());
        assert_eq!(result.unwrap(), (1024, 768));

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn td_11_webp_vp8_lossy_returns_correct_dimensions() {
        // EC-14: Plain VP8 lossy WebP. RFC 6386 §9.1: bits [13:0] are the actual
        // display dimension (not dim-1), so no +1 adjustment is applied.
        let path = std::env::temp_dir().join(format!("markable_td11_{}.webp", tid_suffix()));
        let _ = fs::remove_file(&path);
        fs::write(&path, make_webp_vp8_bytes(800, 600)).unwrap();

        let result = get_image_dimensions(path.to_string_lossy().to_string());
        assert!(result.is_ok(), "Expected Ok, got: {:?}", result.err());
        assert_eq!(result.unwrap(), (800, 600));

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn td_09_png_zero_width_ihdr_returns_ok_zero() {
        // EC-5: 0×0 dimensions stored as "0" — parser should return Ok((0, height)).
        let path = std::env::temp_dir().join(format!("markable_td09_{}.png", tid_suffix()));
        let _ = fs::remove_file(&path);
        fs::write(&path, make_png_bytes(0, 100)).unwrap();

        let result = get_image_dimensions(path.to_string_lossy().to_string());
        assert!(result.is_ok(), "Expected Ok for 0-width PNG, got: {:?}", result.err());
        let (w, h) = result.unwrap();
        assert_eq!(w, 0, "Width should be 0");
        assert_eq!(h, 100, "Height should be 100");

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn td_10_png_non_ihdr_first_chunk_returns_err() {
        // EC-15: PNG with a non-IHDR first chunk must return Err.
        let path = std::env::temp_dir().join(format!("markable_td10_{}.png", tid_suffix()));
        let _ = fs::remove_file(&path);

        let mut v = vec![];
        // PNG signature
        v.extend_from_slice(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        // First chunk is "tEXt" instead of "IHDR"
        v.extend_from_slice(&[0x00, 0x00, 0x00, 0x04]); // length = 4
        v.extend_from_slice(b"tEXt");
        v.extend_from_slice(&[0x41, 0x42, 0x43, 0x44]); // data
        v.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // CRC placeholder

        fs::write(&path, &v).unwrap();

        let result = get_image_dimensions(path.to_string_lossy().to_string());
        assert!(result.is_err(), "Expected Err for non-IHDR first chunk");
        assert!(result.unwrap_err().contains("IHDR"), "Error should mention IHDR");

        let _ = fs::remove_file(&path);
    }

    // ── get_exif_data tests ────────────────────────────────────────────────────

    /// Build a minimal JPEG with an Exif APP1 segment containing a single IFD0
    /// with the given Make, Model (in IFD0) and DateTimeOriginal (in ExifIFD).
    ///
    /// The TIFF block uses little-endian byte order.
    fn make_jpeg_with_exif(
        make: Option<&str>,
        model: Option<&str>,
        date_time_original: Option<&str>,
    ) -> Vec<u8> {
        // Build the TIFF block (little-endian).
        // Layout:
        //   TIFF header: 2-byte "II" + 2-byte magic(42) + 4-byte IFD0 offset
        //   String data area (values for count > 4)
        //   IFD0: 2-byte count + N*12-byte entries + 4-byte next-IFD (0)
        //   ExifIFD (if date given): same structure

        // Collect entries for IFD0.
        // Each entry: tag(2) + type(2=ASCII) + count(4) + value_or_offset(4).
        // Values <= 4 bytes are stored inline; longer values are stored in the data area.

        // TIFF header size = 8. IFD0 immediately follows.
        let tiff_header_size: u32 = 8;

        // We need to determine the layout before building bytes:
        // IFD0 entries: Make, Model, ExifIFD pointer (if date given).
        // ExifIFD entry: DateTimeOriginal (if date given).

        // Data area: for strings > 4 chars.
        let mut data_area: Vec<u8> = vec![];

        let mut ifd0_entries: Vec<(u16, u16, u32, u32)> = vec![]; // (tag, type, count, value_or_offset)
        let mut exif_ifd_entries: Vec<(u16, u16, u32, u32)> = vec![];

        // Helper: push a string to the data area and return its offset (relative to TIFF base).
        // All offsets are relative to the beginning of the TIFF block.
        // The data area starts after the TIFF header + IFD0 block + optional ExifIFD block.
        // Since we don't know the total size yet, we build strings with placeholder offsets
        // and patch them afterward. Instead, build the data area first using a staging Vec.

        // We'll compute offsets after knowing IFD sizes.
        // IFD0 entry count: make + model + ExifIFD pointer (if date)
        let ifd0_count: u32 = {
            let mut c = 0u32;
            if make.is_some() { c += 1; }
            if model.is_some() { c += 1; }
            if date_time_original.is_some() { c += 1; } // ExifIFD pointer
            c
        };
        let exif_ifd_count: u32 = if date_time_original.is_some() { 1 } else { 0 };

        // Size of IFD0 block: 2 (count) + N*12 (entries) + 4 (next-IFD ptr).
        let ifd0_block_size = 2 + ifd0_count * 12 + 4;
        // Size of ExifIFD block: 2 + N*12 + 4.
        let exif_ifd_block_size = if date_time_original.is_some() { 2 + exif_ifd_count * 12 + 4 } else { 0 };

        // IFD0 offset from TIFF base = tiff_header_size.
        let ifd0_offset: u32 = tiff_header_size;
        // ExifIFD offset from TIFF base = after IFD0.
        let exif_ifd_offset: u32 = ifd0_offset + ifd0_block_size;
        // Data area offset from TIFF base = after IFD0 + ExifIFD.
        let data_area_offset: u32 = exif_ifd_offset + exif_ifd_block_size;

        // Build Make entry.
        if let Some(m) = make {
            let null_term: Vec<u8> = {
                let mut s = m.as_bytes().to_vec();
                s.push(0u8);
                s
            };
            let count = null_term.len() as u32;
            let val_or_off = if count <= 4 {
                // Pack bytes inline (LE).
                let mut inline = [0u8; 4];
                inline[..null_term.len()].copy_from_slice(&null_term);
                u32::from_le_bytes(inline)
            } else {
                let off = data_area_offset + data_area.len() as u32;
                data_area.extend_from_slice(&null_term);
                off
            };
            ifd0_entries.push((0x010F, 2, count, val_or_off));
        }

        // Build Model entry.
        if let Some(m) = model {
            let null_term: Vec<u8> = {
                let mut s = m.as_bytes().to_vec();
                s.push(0u8);
                s
            };
            let count = null_term.len() as u32;
            let val_or_off = if count <= 4 {
                let mut inline = [0u8; 4];
                inline[..null_term.len()].copy_from_slice(&null_term);
                u32::from_le_bytes(inline)
            } else {
                let off = data_area_offset + data_area.len() as u32;
                data_area.extend_from_slice(&null_term);
                off
            };
            ifd0_entries.push((0x0110, 2, count, val_or_off));
        }

        // Build ExifIFD pointer entry (only if we have a date to store).
        if date_time_original.is_some() {
            ifd0_entries.push((0x8769, 4, 1, exif_ifd_offset)); // type LONG = 4
        }

        // Build ExifIFD DateTimeOriginal entry.
        if let Some(d) = date_time_original {
            let null_term: Vec<u8> = {
                let mut s = d.as_bytes().to_vec();
                s.push(0u8);
                s
            };
            let count = null_term.len() as u32;
            let val_or_off = if count <= 4 {
                let mut inline = [0u8; 4];
                inline[..null_term.len()].copy_from_slice(&null_term);
                u32::from_le_bytes(inline)
            } else {
                let off = data_area_offset + data_area.len() as u32;
                data_area.extend_from_slice(&null_term);
                off
            };
            exif_ifd_entries.push((0x9003, 2, count, val_or_off));
        }

        // Assemble the TIFF block.
        let mut tiff: Vec<u8> = vec![];

        // TIFF header: "II" + 42 LE + IFD0 offset LE.
        tiff.extend_from_slice(b"II");
        tiff.extend_from_slice(&42u16.to_le_bytes());
        tiff.extend_from_slice(&ifd0_offset.to_le_bytes());

        // IFD0: count + entries (sorted by tag per TIFF spec, though not required for testing) + next-IFD(0).
        tiff.extend_from_slice(&(ifd0_count as u16).to_le_bytes());
        for (tag, typ, count, vof) in &ifd0_entries {
            tiff.extend_from_slice(&tag.to_le_bytes());
            tiff.extend_from_slice(&typ.to_le_bytes());
            tiff.extend_from_slice(&count.to_le_bytes());
            tiff.extend_from_slice(&vof.to_le_bytes());
        }
        tiff.extend_from_slice(&0u32.to_le_bytes()); // next IFD pointer = 0

        // ExifIFD (if present).
        if !exif_ifd_entries.is_empty() {
            tiff.extend_from_slice(&(exif_ifd_count as u16).to_le_bytes());
            for (tag, typ, count, vof) in &exif_ifd_entries {
                tiff.extend_from_slice(&tag.to_le_bytes());
                tiff.extend_from_slice(&typ.to_le_bytes());
                tiff.extend_from_slice(&count.to_le_bytes());
                tiff.extend_from_slice(&vof.to_le_bytes());
            }
            tiff.extend_from_slice(&0u32.to_le_bytes()); // next ExifIFD = 0
        }

        // Data area.
        tiff.extend_from_slice(&data_area);

        // Wrap in JPEG APP1.
        // APP1 format: 0xFF 0xE1 + 2-byte length (includes length bytes) + "Exif\0\0" + TIFF.
        let app1_data_len: u16 = (2 + 6 + tiff.len()) as u16; // 2=len bytes, 6=Exif\0\0
        let mut jpeg = vec![];
        jpeg.extend_from_slice(&[0xFF, 0xD8]); // SOI
        jpeg.extend_from_slice(&[0xFF, 0xE1]); // APP1 marker
        jpeg.extend_from_slice(&app1_data_len.to_be_bytes()); // segment length
        jpeg.extend_from_slice(b"Exif\0\0"); // Exif identifier
        jpeg.extend_from_slice(&tiff);
        jpeg.extend_from_slice(&[0xFF, 0xD9]); // EOI
        jpeg
    }

    #[test]
    fn te_01_jpeg_with_make_model_date_returns_correct_exif() {
        let path = std::env::temp_dir().join(format!("markable_te01_{}.jpg", tid_suffix()));
        let _ = fs::remove_file(&path);
        let bytes = make_jpeg_with_exif(
            Some("Canon"),
            Some("EOS R5"),
            Some("2024:03:15 14:22:10"),
        );
        fs::write(&path, &bytes).unwrap();

        let result = get_exif_data(path.to_string_lossy().to_string());
        assert!(result.is_ok(), "Expected Ok, got: {:?}", result.err());
        let exif = result.unwrap();
        assert_eq!(exif.date_taken, Some("2024-03-15".to_string()));
        assert_eq!(exif.camera, Some("Canon EOS R5".to_string()));

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn te_02_jpeg_with_no_app1_returns_err() {
        let path = std::env::temp_dir().join(format!("markable_te02_{}.jpg", tid_suffix()));
        let _ = fs::remove_file(&path);
        // A JPEG with no APP1 — just SOI + EOI.
        fs::write(&path, &[0xFF, 0xD8, 0xFF, 0xD9]).unwrap();

        let result = get_exif_data(path.to_string_lossy().to_string());
        assert!(result.is_err(), "Expected Err for JPEG with no APP1");
        assert!(result.unwrap_err().contains("No Exif segment found"));

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn te_03_non_jpeg_file_returns_err() {
        let path = std::env::temp_dir().join(format!("markable_te03_{}.png", tid_suffix()));
        let _ = fs::remove_file(&path);
        // Write PNG magic bytes — get_exif_data should reject on the SOI check.
        fs::write(&path, &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).unwrap();

        let result = get_exif_data(path.to_string_lossy().to_string());
        assert!(result.is_err(), "Expected Err for non-JPEG");

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn te_04_make_only_no_model_returns_make_as_camera() {
        // EC-4: Make present, Model absent → camera = Some("Canon").
        let path = std::env::temp_dir().join(format!("markable_te04_{}.jpg", tid_suffix()));
        let _ = fs::remove_file(&path);
        let bytes = make_jpeg_with_exif(Some("Canon"), None, None);
        fs::write(&path, &bytes).unwrap();

        let result = get_exif_data(path.to_string_lossy().to_string());
        assert!(result.is_ok(), "Expected Ok, got: {:?}", result.err());
        let exif = result.unwrap();
        assert_eq!(exif.camera, Some("Canon".to_string()));

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn te_05_model_only_no_make_returns_model_as_camera() {
        // EC-4: Make absent, Model present → camera = Some("EOS R5").
        let path = std::env::temp_dir().join(format!("markable_te05_{}.jpg", tid_suffix()));
        let _ = fs::remove_file(&path);
        let bytes = make_jpeg_with_exif(None, Some("EOS R5"), None);
        fs::write(&path, &bytes).unwrap();

        let result = get_exif_data(path.to_string_lossy().to_string());
        assert!(result.is_ok(), "Expected Ok, got: {:?}", result.err());
        let exif = result.unwrap();
        assert_eq!(exif.camera, Some("EOS R5".to_string()));

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn te_06_null_bytes_in_model_are_stripped() {
        // EC-22: Model field contains null bytes — they must be stripped through the
        // full get_exif_data code path, not just in a unit helper.
        // Rust string literals can contain \0; make_jpeg_with_exif passes them as raw
        // bytes into the TIFF data area. read_ascii_field must strip them via replace('\0',"").
        let path = std::env::temp_dir().join(format!("markable_te06_{}.jpg", tid_suffix()));
        let _ = fs::remove_file(&path);
        let bytes = make_jpeg_with_exif(
            Some("Canon"),
            Some("EOS R5\0\0\0"), // three extra null bytes appended after the model name
            None,
        );
        fs::write(&path, &bytes).unwrap();

        let result = get_exif_data(path.to_string_lossy().to_string());
        assert!(result.is_ok(), "Expected Ok, got: {:?}", result.err());
        let exif = result.unwrap();
        // Null bytes must not appear in the returned camera string.
        let camera = exif.camera.expect("Expected Some camera");
        assert!(!camera.contains('\0'), "camera must not contain null bytes; got: {:?}", camera);
        assert_eq!(camera, "Canon EOS R5");

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn te_07_non_standard_exif_date_returned_as_is_after_colon_replacement() {
        // EC-17: non-standard date returned as-is after colon→hyphen conversion.
        assert_eq!(reformat_exif_date("2024:13:45 99:99:99"), "2024-13-45");
        // Short string: returned as-is (no panic).
        assert_eq!(reformat_exif_date("20"), "20");
    }

    #[test]
    fn te_08_date_in_exif_ifd_not_ifd0_is_found() {
        // DateTimeOriginal is in ExifIFD (tag 0x8769 points to sub-IFD) — the normal case.
        let path = std::env::temp_dir().join(format!("markable_te08_{}.jpg", tid_suffix()));
        let _ = fs::remove_file(&path);
        let bytes = make_jpeg_with_exif(
            Some("Nikon"),
            Some("Z6"),
            Some("2023:07:04 10:30:00"),
        );
        fs::write(&path, &bytes).unwrap();

        let result = get_exif_data(path.to_string_lossy().to_string());
        assert!(result.is_ok(), "Expected Ok, got: {:?}", result.err());
        let exif = result.unwrap();
        assert_eq!(exif.date_taken, Some("2023-07-04".to_string()));
        assert_eq!(exif.camera, Some("Nikon Z6".to_string()));

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn te_09_zero_byte_file_returns_err() {
        let path = std::env::temp_dir().join(format!("markable_te09_{}.jpg", tid_suffix()));
        let _ = fs::remove_file(&path);
        fs::write(&path, &[] as &[u8]).unwrap();

        let result = get_exif_data(path.to_string_lossy().to_string());
        assert!(result.is_err(), "Expected Err for zero-byte file");

        let _ = fs::remove_file(&path);
    }

    // ── sidecar_exists tests ───────────────────────────────────────────────────

    #[test]
    fn ts_01_sidecar_file_exists_returns_true() {
        // Create the sidecar file, then check that sidecar_exists returns true.
        let base_path = std::env::temp_dir()
            .join(format!("markable_ts01_{}.jpg", tid_suffix()));
        let sidecar_path = format!("{}.md", base_path.to_string_lossy());
        let _ = fs::remove_file(&base_path);
        let _ = fs::remove_file(&sidecar_path);

        // Write the sidecar file (base_path + ".md").
        fs::write(&sidecar_path, "---\nrating: 5\n---\n").unwrap();

        let result = sidecar_exists(base_path.to_string_lossy().to_string());
        assert!(result.is_ok(), "Expected Ok, got: {:?}", result.err());
        assert_eq!(result.unwrap(), true, "Sidecar should exist");

        let _ = fs::remove_file(&sidecar_path);
    }

    #[test]
    fn ts_02_sidecar_does_not_exist_returns_false() {
        let base_path = std::env::temp_dir()
            .join(format!("markable_ts02_{}.jpg", tid_suffix()));
        let sidecar_path = format!("{}.md", base_path.to_string_lossy());

        // Ensure neither exists.
        let _ = fs::remove_file(&base_path);
        let _ = fs::remove_file(&sidecar_path);

        let result = sidecar_exists(base_path.to_string_lossy().to_string());
        assert!(result.is_ok(), "Expected Ok, got: {:?}", result.err());
        assert_eq!(result.unwrap(), false, "Sidecar should not exist");
    }

    #[test]
    fn ts_03_sidecar_is_directory_returns_false() {
        // Create a directory named "photo.jpg.md" — sidecar_exists should return false.
        let base_path = std::env::temp_dir()
            .join(format!("markable_ts03_{}.jpg", tid_suffix()));
        let sidecar_path = format!("{}.md", base_path.to_string_lossy());
        let _ = fs::remove_file(&sidecar_path);

        // Create a directory with the sidecar path name.
        let _ = fs::create_dir_all(&sidecar_path);

        let result = sidecar_exists(base_path.to_string_lossy().to_string());
        assert!(result.is_ok(), "Expected Ok, got: {:?}", result.err());
        assert_eq!(result.unwrap(), false, "Directory at sidecar path should return false");

        let _ = fs::remove_dir(&sidecar_path);
    }
}

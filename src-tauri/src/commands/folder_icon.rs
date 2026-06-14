//! Batch reader for the `icon:` field in `_folder.md` files.
//!
//! Returns one entry per input path: `(path, Some(value) | None)`. A `None`
//! result indicates the file is missing, the read failed, there is no
//! frontmatter, or there is no `icon:` key (or the value is empty). The whole
//! batch never fails — individual file errors are silently coerced to `None`
//! so the renderer can degrade gracefully (NFR-1, EC-1).
//!
//! The function reads at most `MAX_BYTES` bytes per file because the
//! frontmatter is bounded — matches `FRONT_MATTER_MAX_BYTES` in `vault.rs`.
//! No write operations. No allocations beyond the output vector and a
//! per-file 4 KB stack buffer.

use std::fs::{self, File};
use std::io::Read;
use std::time::UNIX_EPOCH;

/// File stat payload returned by `stat_file`.
///
/// Used by the folder-icon-custom-cache (TS-side, FR-17) to key its in-memory
/// SVG cache by `(absolutePath, mtimeMs)` so external edits invalidate the
/// cache automatically. Size is reported alongside mtime to enable future
/// caps without an additional round-trip — currently the TS validator gates
/// size on add (32 KB cap, FR-16), so this field is informational.
#[derive(serde::Serialize)]
pub struct FileStat {
    /// Last-modified timestamp in milliseconds since the UNIX epoch.
    #[serde(rename = "mtimeMs")]
    pub mtime_ms: i64,
    /// File size in bytes.
    pub size: u64,
}

/// Tauri command — read file metadata for the custom-SVG cache key.
///
/// Returns mtimeMs + size. Errors when the file does not exist or the
/// metadata read fails. Used in the render path AFTER mount (out of band) —
/// NFR-2 still holds because no synchronous I/O happens during DOM
/// construction.
#[tauri::command]
pub fn stat_file(path: String) -> Result<FileStat, String> {
    let meta = fs::metadata(&path)
        .map_err(|e| format!("stat_file failed: {}: {}", path, e))?;
    // `modified()` may be unsupported on some platforms (returns Err). For
    // Markable's target platforms (macOS) it is always available, but we
    // fall back to 0 rather than failing the whole call.
    let mtime_ms = match meta.modified() {
        Ok(t) => match t.duration_since(UNIX_EPOCH) {
            Ok(d) => d.as_millis() as i64,
            Err(_) => 0,
        },
        Err(_) => 0,
    };
    Ok(FileStat {
        mtime_ms,
        size: meta.len(),
    })
}

/// Maximum bytes read per file. Frontmatter is bounded; matches
/// `FRONT_MATTER_MAX_BYTES` in `vault.rs`.
const MAX_BYTES: usize = 4096;

/// Tauri command — batch read `icon:` values.
///
/// Parameter name `paths` is camelCased on the JS side as `paths` (no rename
/// needed — single word). Returns a vec of `(path, Option<String>)` tuples
/// preserving input order.
#[tauri::command]
pub async fn read_folder_icon_map(
    paths: Vec<String>,
) -> Result<Vec<(String, Option<String>)>, String> {
    let mut out: Vec<(String, Option<String>)> = Vec::with_capacity(paths.len());
    for p in paths {
        let v = read_icon_from_file(&p);
        out.push((p, v));
    }
    Ok(out)
}

/// Read the `icon:` value from a single `_folder.md`.
///
/// Returns `None` on any failure (missing file, permission denied, invalid
/// UTF-8, missing or malformed frontmatter, missing key, empty value). The
/// function never panics and never returns an `Err` — all errors collapse to
/// `None` per the batch-tolerance contract.
fn read_icon_from_file(path: &str) -> Option<String> {
    let mut f = File::open(path).ok()?;
    let mut buf = [0u8; MAX_BYTES];
    let n = f.read(&mut buf).ok()?;
    let text = std::str::from_utf8(&buf[..n]).ok()?;

    let mut lines = text.lines();
    // The very first line must be exactly `---` (after trim) — otherwise the
    // file has no frontmatter.
    let first = lines.next()?.trim();
    if first != "---" {
        return None;
    }

    for line in lines {
        let trimmed = line.trim();
        // Closing delimiter — reached without seeing an `icon:` line.
        if trimmed == "---" {
            return None;
        }
        // Match `icon:` prefix. Use `strip_prefix` so we only match the exact
        // key (not `iconography:` etc.).
        if let Some(rest) = trimmed.strip_prefix("icon:") {
            let val = rest.trim();
            if val.is_empty() {
                return None;
            }
            // Strip a single pair of surrounding double-quotes if present.
            // Mirrors the TS writer's quoting policy (applyYamlKey emits
            // quoted values when the payload contains `:` or surrounding
            // whitespace — see folder-icon-store.ts and yaml-frontmatter.ts).
            let unquoted = if val.starts_with('"')
                && val.ends_with('"')
                && val.len() >= 2
            {
                val[1..val.len() - 1].replace("\\\"", "\"")
            } else {
                val.to_string()
            };
            return Some(unquoted);
        }
    }
    None
}

// ── Inline unit tests ─────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    /// Helper: write `content` to `<dir>/<name>` and return the absolute path.
    fn write_tmp(dir: &std::path::Path, name: &str, content: &str) -> String {
        let p = dir.join(name);
        let mut f = std::fs::File::create(&p).unwrap();
        f.write_all(content.as_bytes()).unwrap();
        p.to_string_lossy().to_string()
    }

    #[tokio::test]
    async fn returns_none_for_missing_file() {
        let r = read_folder_icon_map(vec!["/nonexistent/_folder.md".into()])
            .await
            .unwrap();
        assert_eq!(r.len(), 1);
        assert!(r[0].1.is_none());
    }

    #[tokio::test]
    async fn returns_some_for_well_formed_file() {
        let dir = tempdir().unwrap();
        let p = write_tmp(dir.path(), "_folder.md", "---\nicon: book\n---\n");
        let r = read_folder_icon_map(vec![p.clone()]).await.unwrap();
        assert_eq!(r[0].1, Some("book".to_string()));
    }

    #[tokio::test]
    async fn returns_none_when_icon_key_missing() {
        let dir = tempdir().unwrap();
        let p = write_tmp(
            dir.path(),
            "_folder.md",
            "---\nlayout: bookshelf\n---\n",
        );
        let r = read_folder_icon_map(vec![p]).await.unwrap();
        assert!(r[0].1.is_none());
    }

    #[tokio::test]
    async fn returns_none_for_malformed_frontmatter() {
        let dir = tempdir().unwrap();
        // No opening `---` at all.
        let p = write_tmp(
            dir.path(),
            "_folder.md",
            "icon: book\nno frontmatter",
        );
        let r = read_folder_icon_map(vec![p]).await.unwrap();
        assert!(r[0].1.is_none());
    }

    #[tokio::test]
    async fn mixed_batch_preserves_order_and_does_not_fail() {
        let dir = tempdir().unwrap();
        let good = write_tmp(
            dir.path(),
            "good.md",
            "---\nicon: lightbulb\n---\n",
        );
        let bad = "/nonexistent/_folder.md".to_string();
        let r = read_folder_icon_map(vec![good.clone(), bad.clone()])
            .await
            .unwrap();
        assert_eq!(r[0].0, good);
        assert_eq!(r[0].1, Some("lightbulb".to_string()));
        assert_eq!(r[1].0, bad);
        assert!(r[1].1.is_none());
    }

    #[tokio::test]
    async fn strips_surrounding_double_quotes() {
        let dir = tempdir().unwrap();
        let p = write_tmp(
            dir.path(),
            "_folder.md",
            "---\nicon: \"book\"\n---\n",
        );
        let r = read_folder_icon_map(vec![p]).await.unwrap();
        assert_eq!(r[0].1, Some("book".to_string()));
    }

    #[tokio::test]
    async fn returns_path_value_with_spaces_and_unicode() {
        // EC-22: path-shaped values (custom-SVG amendment) must round-trip
        // through the reader byte-identical. The value is typically quoted
        // on the writer side; the reader strips the quotes.
        let dir = tempdir().unwrap();
        let p = write_tmp(
            dir.path(),
            "_folder.md",
            "---\nicon: \"/Users/dave/My Icons/café.svg\"\n---\n",
        );
        let r = read_folder_icon_map(vec![p]).await.unwrap();
        assert_eq!(
            r[0].1,
            Some("/Users/dave/My Icons/café.svg".to_string())
        );
    }

    #[tokio::test]
    async fn empty_string_value_returns_none() {
        let dir = tempdir().unwrap();
        let p = write_tmp(dir.path(), "_folder.md", "---\nicon: \n---\n");
        let r = read_folder_icon_map(vec![p]).await.unwrap();
        assert!(r[0].1.is_none());
    }
}

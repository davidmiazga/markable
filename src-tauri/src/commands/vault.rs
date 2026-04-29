//! Vault Rust commands for the PKM system.
//!
//! Provides all vault-related Tauri commands: path validation, recursive index
//! build, index cache read/write, per-vault cache deletion, and file-system
//! watching via the `notify` crate.
//!
//! Front matter parsing here uses a simple line-by-line state machine (not a
//! full YAML parser) that matches the semantics in src/lib/index-parser.ts so
//! both sides agree on what constitutes a title and tags.

use serde::{Deserialize, Serialize};
use std::io::Write as IoWrite;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use uuid::Uuid;
use walkdir::WalkDir;

// ─── Data structures ──────────────────────────────────────────────────────────

/// Lightweight file record returned by list_vault_files.
/// No content parsing — used for incremental staleness checking.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    /// Unix timestamp in milliseconds.
    pub modified: u64,
    /// File size in bytes.
    pub size: u64,
    pub is_directory: bool,
}

/// Per-path validation result returned by validate_vault_paths.
/// The command never returns Err — all error information is embedded here.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathValidationResult {
    pub path: String,
    pub exists: bool,
    pub is_directory: bool,
    pub readable: bool,
    pub error: Option<String>,
}

/// Single indexed file entry in a vault index.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultIndexEntry {
    pub path: String,
    /// Filename stem (no extension).
    pub name: String,
    /// Unix timestamp in milliseconds.
    pub modified: u64,
    /// File size in bytes.
    pub size: u64,
    /// First H1 heading or filename stem when no title front matter.
    pub title: String,
    pub tags: Vec<String>,
    /// Wiki-link target stems extracted from the file content.
    pub outbound_links: Vec<String>,
}

/// A single line that matched the search query in a content search.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineMatch {
    /// 1-based line number within the file.
    pub line_number: u32,
    /// Full text of the matching line, trimmed of leading/trailing whitespace.
    pub line_text: String,
    /// 0-based character (Unicode scalar) offset of the first match start within
    /// `line_text` (after trimming). This is a character count, not a byte offset,
    /// so JavaScript's `String.prototype.slice()` can use it directly even when the
    /// line contains multi-byte UTF-8 characters before the match position.
    pub column_start: u32,
}

/// All matching lines found in a single file during a content search.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContentResult {
    /// Absolute path to the file.
    pub path: String,
    /// Display title: front-matter `title`, first H1 heading, or filename stem.
    pub title: String,
    /// All lines that matched the query, in line-number order.
    pub matches: Vec<LineMatch>,
}

/// Top-level payload returned by `search_vault_content`.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchPayload {
    /// Matched files, sorted by match count descending (AD-GS-10).
    pub results: Vec<FileContentResult>,
    /// True when the result count was truncated at `max_results`.
    pub capped: bool,
    /// Count of files that could not be read (permission error, invalid path, etc.).
    pub skipped_count: u32,
}

/// Lightweight record for a non-Markdown file (image, PDF, etc.).
/// Included in VaultIndexPayload so the File Browser can display all vault
/// contents, not just .md notes.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NonMdFile {
    pub path: String,
    /// Filename with extension (e.g. "photo.png").
    pub name: String,
}

/// Complete index payload returned by build_vault_index.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultIndexPayload {
    pub vault_id: String,
    /// Unix timestamp in milliseconds when the index was built.
    pub built_at: u64,
    pub entries: Vec<VaultIndexEntry>,
    pub total_files_found: u32,
    pub skipped_count: u32,
    pub capped: bool,
    /// All non-Markdown files found during the walk (images, PDFs, etc.).
    /// Not capped — the md-only cap does not apply here.
    pub non_md_files: Vec<NonMdFile>,
}

// ─── Path helpers ─────────────────────────────────────────────────────────────

/// Resolve the vault-index cache directory: app_data_dir/vault-index/
fn vault_index_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    Ok(data_dir.join("vault-index"))
}

/// Resolve the cache file path for a specific vault.
fn vault_index_path(app: &tauri::AppHandle, vault_id: &str) -> Result<PathBuf, String> {
    Ok(vault_index_dir(app)?.join(format!("{}.json", vault_id)))
}

// ─── Unix timestamp helper ────────────────────────────────────────────────────

/// Convert a SystemTime to milliseconds since the Unix epoch.
/// Returns 0 on overflow (should never happen for reasonable dates).
fn system_time_to_ms(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ─── Glob matching ────────────────────────────────────────────────────────────

/// Simple single-segment glob match (no path separators in pattern).
///
/// Supports only `*` as a wildcard that matches any sequence of characters
/// within a single path component. This is sufficient for patterns like
/// `*.log`, `node_modules`, and `.git`.
///
/// NOTE: `**` (double-star, cross-directory wildcard) is NOT supported.
/// Patterns are tested against individual path components only, so `**/*.md`
/// would not match nested `.md` files — only the literal string `**` would.
///
/// The match is case-sensitive (consistent with Linux/macOS filesystems).
fn glob_matches(pattern: &str, name: &str) -> bool {
    if !pattern.contains('*') {
        return pattern == name;
    }
    // Split on `*` and check that the parts appear in order in `name`.
    let parts: Vec<&str> = pattern.split('*').collect();
    let mut pos = 0usize;
    for (i, part) in parts.iter().enumerate() {
        if part.is_empty() {
            continue;
        }
        if i == 0 {
            // First segment must be a prefix.
            if !name.starts_with(part) {
                return false;
            }
            pos = part.len();
        } else if i == parts.len() - 1 {
            // Last segment must be a suffix.
            if !name[pos..].ends_with(part) {
                return false;
            }
        } else {
            // Middle segment must appear somewhere after `pos`.
            if let Some(idx) = name[pos..].find(part) {
                pos += idx + part.len();
            } else {
                return false;
            }
        }
    }
    true
}

/// Replace filesystem-unsafe characters in a vault name with `_`.
///
/// Matches the TypeScript `sanitiseVaultName()` in meta-manager.ts exactly.
/// Affected characters: `/` (path separator), `:` (HFS+ reserved), null byte `\0`.
/// Used to construct the meta folder component for exclusion during index build.
fn sanitise_vault_name(name: &str) -> String {
    name.chars()
        .map(|c| if matches!(c, '/' | ':' | '\0') { '_' } else { c })
        .collect()
}

/// Return true if any vault-relative path component equals `meta_folder_component`.
///
/// `meta_folder_component` is the pre-computed string `"{sanitised_name}_meta"`.
/// This exact-component match (not substring) prevents false positives for
/// directory names like `Work Notes_meta_backup` (EC-11 pattern).
///
/// Called inside `build_vault_index` walk loop to filter out meta folder files
/// (FR-4 / NFR-6).
fn is_meta_folder_component(rel_path: &Path, meta_folder_component: &str) -> bool {
    rel_path.components().any(|c| {
        c.as_os_str().to_string_lossy().as_ref() == meta_folder_component
    })
}

/// Return true if any component of `rel_path` (relative to the vault root)
/// matches any exclude pattern or starts with `.` (hidden).
///
/// Callers must pass `path.strip_prefix(root).unwrap_or(path)` so that only
/// the vault-relative segments are tested — the absolute path segments leading
/// to the root (e.g. `/var/folders/.tmpXXX/`) must not be tested because the
/// user has no control over where the OS places the temp or app directory.
fn should_exclude(rel_path: &Path, exclude_patterns: &[String]) -> bool {
    for component in rel_path.components() {
        let name = component.as_os_str().to_string_lossy();
        // Skip root and parent sentinel components (should not occur in a relative
        // path, but guard defensively).
        if name == "/" || name == "." || name == ".." {
            continue;
        }
        // Hidden files/dirs (starting with `.`) are excluded.
        if name.starts_with('.') {
            return true;
        }
        for pat in exclude_patterns {
            if glob_matches(pat, &name) {
                return true;
            }
        }
    }
    false
}

// ─── Front matter parser ──────────────────────────────────────────────────────

/// Maximum bytes read for front matter parsing (NFR-07).
const FRONT_MATTER_MAX_BYTES: usize = 4096;

/// Maximum bytes read per file during content search (NFR-7, EC-10).
/// Files larger than this are truncated before line scanning.
const SEARCH_MAX_FILE_BYTES: usize = 1_048_576; // 1 MB

/// Parsed result of a Markdown file's front matter section.
struct ParsedFrontMatter {
    title: Option<String>,
    tags: Vec<String>,
}

/// Parse YAML front matter from `content` using a simple line-by-line state
/// machine. Reads only the first 4 KB for the front matter section; wiki-links
/// are extracted from the full content.
///
/// Handles:
/// - `tags: [a, b, c]` inline form
/// - Block sequence:
///   ```yaml
///   tags:
///     - a
///     - b
///   ```
/// - `title: value` key
/// - First `# H1` heading as fallback title
fn parse_front_matter(content: &str) -> ParsedFrontMatter {
    let slice = if content.len() > FRONT_MATTER_MAX_BYTES {
        &content[..FRONT_MATTER_MAX_BYTES]
    } else {
        content
    };

    let lines: Vec<&str> = slice.lines().collect();

    // Front matter must start with `---` on the first line.
    if lines.is_empty() || lines[0].trim() != "---" {
        return ParsedFrontMatter {
            title: extract_h1(content),
            tags: vec![],
        };
    }

    let mut title: Option<String> = None;
    let mut tags: Vec<String> = vec![];
    let mut in_front_matter = true;
    let mut reading_tags_block = false;

    for line in &lines[1..] {
        let trimmed = line.trim();

        if trimmed == "---" {
            in_front_matter = false;
            break;
        }
        if !in_front_matter {
            break;
        }

        // title:
        if let Some(rest) = trimmed.strip_prefix("title:") {
            let val = rest.trim().trim_matches(|c| c == '"' || c == '\'');
            if !val.is_empty() {
                title = Some(val.to_string());
            }
            reading_tags_block = false;
            continue;
        }

        // tags: [a, b] (inline)
        if let Some(rest) = trimmed.strip_prefix("tags:") {
            let rest_trimmed = rest.trim();
            if rest_trimmed.starts_with('[') && rest_trimmed.ends_with(']') {
                let inner = &rest_trimmed[1..rest_trimmed.len() - 1];
                tags = inner
                    .split(',')
                    .map(|t| t.trim().trim_matches(|c| c == '"' || c == '\'').to_string())
                    .filter(|t| !t.is_empty())
                    .collect();
                reading_tags_block = false;
            } else if rest_trimmed.is_empty() {
                // Block sequence begins on subsequent lines.
                reading_tags_block = true;
                tags = vec![];
            }
            continue;
        }

        // Block sequence items `  - value`
        if reading_tags_block {
            if let Some(item) = line.trim_start().strip_prefix("- ") {
                let tag = item.trim().trim_matches(|c| c == '"' || c == '\'');
                if !tag.is_empty() {
                    tags.push(tag.to_string());
                }
            } else if !line.trim_start().starts_with('-') {
                reading_tags_block = false;
            }
        }
    }

    // Fall back to H1 when no front matter title was found.
    if title.is_none() {
        title = extract_h1(content);
    }

    ParsedFrontMatter { title, tags }
}

/// Scan `content` for the first Markdown H1 heading. Returns None if absent.
fn extract_h1(content: &str) -> Option<String> {
    for line in content.lines() {
        if let Some(rest) = line.strip_prefix("# ") {
            let h = rest.trim().to_string();
            if !h.is_empty() {
                return Some(h);
            }
        }
    }
    None
}

// ─── Wiki-link extractor ──────────────────────────────────────────────────────

/// Extract `[[wikilink]]` stems from `content`.
///
/// Uses the same regex pattern as backlinks.plugin.ts: `\[\[([^\[\]\n]*?)\]\]`.
/// Piped links (`[[target|display]]`) return only the target. Duplicates removed.
fn extract_wiki_links(content: &str) -> Vec<String> {
    // We use a hand-rolled scanner instead of the regex crate to avoid adding
    // a compile-time dependency — the pattern is simple enough to parse manually.
    // The algorithm scans for `[[` … `]]` pairs, ignoring nested brackets and newlines.
    let bytes = content.as_bytes();
    let len = bytes.len();
    let mut results: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut i = 0;

    while i + 1 < len {
        // Look for opening `[[`
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            let start = i + 2;
            let mut j = start;
            // Scan forward for `]]`, stopping at `[`, `]` (inner bracket), or `\n`.
            while j + 1 < len {
                if bytes[j] == b'\n' || bytes[j] == b'[' {
                    break;
                }
                if bytes[j] == b']' && bytes[j + 1] == b']' {
                    // Found closing `]]` — extract the capture.
                    if let Ok(raw) = std::str::from_utf8(&bytes[start..j]) {
                        // Take only the part before the first `|` (the target stem).
                        let stem = raw.splitn(2, '|').next().unwrap_or(raw).trim();
                        if !stem.is_empty() {
                            results.insert(stem.to_string());
                        }
                    }
                    i = j + 2;
                    break;
                }
                j += 1;
            }
            if j + 1 >= len || bytes[j] == b'\n' || bytes[j] == b'[' {
                i += 1;
            }
        } else {
            i += 1;
        }
    }

    results.into_iter().collect()
}

// ─── Per-file index helper ────────────────────────────────────────────────────

/// Read metadata, parse front matter, extract wiki-links, and assemble a
/// VaultIndexEntry for a single `.md` file at `path`.
///
/// Extracted so `build_vault_index` remains a clean walker loop (≤30 lines)
/// that calls this function for each eligible file.
///
/// Returns `Err` when the file cannot be read (EC-12) so the caller can
/// increment `skipped_count` and continue walking.
fn index_file(path: &Path, _vault_id: &str) -> Result<VaultIndexEntry, String> {
    // Read filesystem metadata for timestamps and size.
    let metadata = std::fs::metadata(path)
        .map_err(|e| format!("metadata error for {:?}: {}", path, e))?;

    let modified = metadata.modified().map(system_time_to_ms).unwrap_or(0);
    let size = metadata.len();

    // Read content for front matter and wiki-link parsing. EC-12: unreadable
    // file surfaces as an Err so the walker increments skipped_count.
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("read error for {:?}: {}", path, e))?;

    let fm = parse_front_matter(&content);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    // Title priority: front matter title > H1 heading > filename stem.
    let title = fm.title.unwrap_or_else(|| stem.clone());
    let outbound_links = extract_wiki_links(&content);

    Ok(VaultIndexEntry {
        path: path.to_string_lossy().to_string(),
        name: stem,
        modified,
        size,
        title,
        tags: fm.tags,
        outbound_links,
    })
}

// ─── Path validation helper ───────────────────────────────────────────────────

/// Validate that each path in `paths` exists and is an accessible directory.
///
/// Returns `Err` with a descriptive message for the first invalid path, or
/// `Ok(())` when all paths pass. Used by `create_vault` and `update_vault` to
/// share the same validation logic.
fn validate_paths(paths: &[String]) -> Result<(), String> {
    for p in paths {
        let path = Path::new(p);
        if !path.exists() {
            return Err(format!("Path does not exist: {}", p));
        }
        if !path.is_dir() {
            return Err(format!("Path is a file, not a folder: {}", p));
        }
    }
    Ok(())
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

/// Validate that each path in `root_paths` exists, is a directory, and is
/// readable. Never returns `Err` — per-path errors are embedded in the result.
#[tauri::command]
pub fn validate_vault_paths(root_paths: Vec<String>) -> Vec<PathValidationResult> {
    root_paths
        .into_iter()
        .map(|p| {
            let path = Path::new(&p);
            let exists = path.exists();
            let is_directory = path.is_dir();
            let (readable, error) = if exists && is_directory {
                match std::fs::read_dir(path) {
                    Ok(_) => (true, None),
                    Err(e) => (false, Some(format!("Directory is not readable: {}", e))),
                }
            } else if !exists {
                (false, Some("Path does not exist.".to_string()))
            } else {
                (false, Some("Path is a file, not a folder.".to_string()))
            };

            PathValidationResult {
                path: p,
                exists,
                is_directory,
                readable,
                error,
            }
        })
        .collect()
}

/// Validation-only stub — the actual vault entry is created/updated in TypeScript
/// via `updateSettings()`. This command is reserved for Phase 2 permission checking
/// and path canonicalization at the Tauri boundary.
///
/// Validate `name` and `root_paths`, then generate and return a new UUID v4
/// for the vault. TypeScript constructs the full VaultEntry from this UUID.
///
/// Validations performed:
/// - `name` must be non-empty after trimming whitespace.
/// - `root_paths` must be non-empty; each path must exist as a directory.
/// - Individual `root_paths` entries are trimmed before path-existence checks.
///
/// Returns the new UUID string on success; returns `Err` with a descriptive
/// message on the first validation failure.
#[tauri::command]
pub fn create_vault(
    name: String,
    root_paths: Vec<String>,
    _exclude_patterns: Vec<String>,
    _max_index_size: usize,
) -> Result<String, String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("Vault name must not be empty.".to_string());
    }

    if root_paths.is_empty() {
        return Err("At least one root path is required.".to_string());
    }

    // Trim individual path entries before existence check (LOW-5).
    let trimmed_paths: Vec<String> = root_paths.iter().map(|p| p.trim().to_string()).collect();
    validate_paths(&trimmed_paths)?;

    Ok(Uuid::new_v4().to_string())
}

/// Validation-only stub — the actual vault entry is created/updated in TypeScript
/// via `updateSettings()`. This command is reserved for Phase 2 permission checking
/// and path canonicalization at the Tauri boundary.
///
/// Validate updated fields for an existing vault.
///
/// Returns `Ok(())` when all provided fields pass validation; returns `Err` with
/// a descriptive message on failure.
///
/// Validations performed (only for fields that are `Some`):
/// - `name`: must be non-empty after trimming.
/// - `root_paths`: each path must exist and be a directory.
#[tauri::command]
pub fn update_vault(
    _id: String,
    name: Option<String>,
    root_paths: Option<Vec<String>>,
    _exclude_patterns: Option<Vec<String>>,
    _max_index_size: Option<usize>,
) -> Result<(), String> {
    if let Some(ref n) = name {
        if n.trim().is_empty() {
            return Err("Vault name must not be empty.".to_string());
        }
    }

    if let Some(ref paths) = root_paths {
        validate_paths(paths)?;
    }

    Ok(())
}

/// Lightweight Tauri boundary command for switching the active vault.
///
/// Returns `Ok(())` immediately. The actual state change (updating
/// `activeVaultId` in settings and loading the index) happens in TypeScript
/// via `vaultManager.switchVault()`. This command exists as the Tauri boundary
/// for future permission checking and index pre-warming in Phase 2.
///
/// NOTE (Phase 2): pre-warming the index cache and checking read permissions
/// will be added here when the fs watcher is implemented.
#[tauri::command]
pub fn switch_vault(_id: String) -> Result<(), String> {
    // Phase 2: validate permissions, pre-warm the disk cache, emit a Tauri event.
    Ok(())
}

/// Recursively scan `root_paths`, parse front matter and wiki-links from each
/// `.md` file, and return a VaultIndexPayload.
///
/// The heavy per-file work is delegated to `index_file()`, keeping this
/// function as a clean walker loop that handles cap logic and error counting.
///
/// Stops adding entries once `entries.len() == max_count` (capped=true). Hidden
/// files and directories, and paths matching `exclude_patterns`, are skipped.
/// Files inside `{sanitised_vault_name}_meta/` are excluded (FR-4 / NFR-6).
/// Files that cannot be read are counted in `skipped_count`.
#[tauri::command]
pub async fn build_vault_index(
    vault_id: String,
    root_paths: Vec<String>,
    exclude_patterns: Vec<String>,
    max_count: u32,
    vault_name: String,
) -> Result<VaultIndexPayload, String> {
    let max = max_count as usize;
    let mut entries: Vec<VaultIndexEntry> = Vec::new();
    let mut non_md_files: Vec<NonMdFile> = Vec::new();
    let mut total_files_found: u32 = 0;
    let mut skipped_count: u32 = 0;
    let mut capped = false;

    // Pre-compute the meta folder component name once (e.g. "Work Notes_meta").
    // This avoids recomputing it on every file during the walk (FR-4).
    let sanitised_name = sanitise_vault_name(&vault_name);
    let meta_component = format!("{}_meta", sanitised_name);

    let built_at = system_time_to_ms(SystemTime::now());

    for root in &root_paths {
        let root_path = Path::new(root);
        if !root_path.exists() {
            continue;
        }

        // WalkDir follows symlinks by default; min_depth(1) skips the root itself.
        for entry_result in WalkDir::new(root_path)
            .min_depth(1)
            .follow_links(false)
            .into_iter()
        {
            let entry = match entry_result {
                Ok(e) => e,
                Err(err) => {
                    eprintln!("[vault] walkdir error: {}", err);
                    skipped_count += 1;
                    continue;
                }
            };

            let path = entry.path();

            // Strip the root prefix so we check only vault-relative path components
            // (the OS-level parent directories, e.g. /var/folders/.tmp…, are not
            // under the user's control and must not trigger the hidden-dir filter).
            let rel = path.strip_prefix(root_path).unwrap_or(path);
            if should_exclude(rel, &exclude_patterns) {
                continue;
            }

            // FR-4 / NFR-6: exclude all files inside the vault meta folder so they
            // never appear in search results, backlinks, or wiki-link completions.
            if is_meta_folder_component(rel, &meta_component) {
                continue;
            }

            if !entry.file_type().is_file() {
                continue;
            }

            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if !ext.eq_ignore_ascii_case("md") {
                // Non-Markdown file: collect for the File Browser tree but do
                // not count against the .md cap or parse for links/tags.
                let name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();
                if !name.is_empty() && !name.starts_with('.') {
                    non_md_files.push(NonMdFile {
                        path: path.to_string_lossy().to_string(),
                        name,
                    });
                }
                continue;
            }

            total_files_found += 1;

            // Stop adding entries at cap, but continue walking to count total.
            if entries.len() >= max {
                capped = true;
                continue;
            }

            match index_file(path, &vault_id) {
                Ok(file_entry) => entries.push(file_entry),
                Err(e) => {
                    eprintln!("[vault] {}", e);
                    skipped_count += 1;
                }
            }
        }
    }

    Ok(VaultIndexPayload {
        vault_id,
        built_at,
        entries,
        total_files_found,
        skipped_count,
        capped,
        non_md_files,
    })
}

/// Read the cached index JSON for `vault_id` from disk.
/// Returns `Ok(None)` when no cache file exists.
/// Returns `Ok(Some(raw_json))` when found.
#[tauri::command]
pub async fn get_vault_index(
    app: tauri::AppHandle,
    vault_id: String,
) -> Result<Option<String>, String> {
    let path = vault_index_path(&app, &vault_id)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read index cache for \"{}\": {}", vault_id, e))?;
    Ok(Some(content))
}

/// Write the index JSON for `vault_id` to disk using a temp-file-swap for
/// atomicity (same pattern as write_raw_settings_to_disk in settings.rs).
/// Creates the vault-index/ directory if it does not exist.
#[tauri::command]
pub async fn save_vault_index(
    app: tauri::AppHandle,
    vault_id: String,
    index_json: String,
) -> Result<(), String> {
    let dir = vault_index_dir(&app)?;
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create vault-index dir: {}", e))?;
    }

    let path = dir.join(format!("{}.json", vault_id));

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp_path = path.with_extension(format!("tmp.{}", timestamp));

    let mut file = std::fs::File::create(&temp_path)
        .map_err(|e| format!("Failed to create temp index file: {}", e))?;

    file.write_all(index_json.as_bytes()).map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Failed to write index: {}", e)
    })?;

    file.sync_all().map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Failed to sync index to disk: {}", e)
    })?;

    std::fs::rename(&temp_path, &path).map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        format!("Atomic index write failed: {}", e)
    })?;

    Ok(())
}

/// Delete the cached index file for `vault_id`. No-op when absent.
/// Does NOT modify settings — the frontend handles settings update.
#[tauri::command]
pub fn delete_vault(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = vault_index_path(&app, &id)?;
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete index cache for \"{}\": {}", id, e))?;
    }
    Ok(())
}

/// Recursively scan `root_paths` and return lightweight FileEntry records
/// (no content parsing). Respects `exclude_patterns` and `max_count`.
/// Used for incremental staleness checking.
///
/// `vault_name` is required (H-1): the same `is_meta_folder_component` guard
/// used in `build_vault_index` is applied here so that meta folder files are
/// never included in staleness checks or other callers of this command.
///
/// Declared `async` for consistency with other I/O commands (`build_vault_index`,
/// `get_vault_index`, `save_vault_index`) that touch the filesystem (NEW-4 fix).
#[tauri::command]
pub async fn list_vault_files(
    root_paths: Vec<String>,
    exclude_patterns: Vec<String>,
    max_count: u32,
    vault_name: String,
) -> Result<Vec<FileEntry>, String> {
    let max = max_count as usize;
    let mut results: Vec<FileEntry> = Vec::new();

    // Pre-compute the meta folder component once, mirroring build_vault_index
    // (H-1: list_vault_files must exclude the meta folder for the same reason).
    let sanitised_name = sanitise_vault_name(&vault_name);
    let meta_component = format!("{}_meta", sanitised_name);

    for root in &root_paths {
        let root_path = Path::new(root);
        if !root_path.exists() {
            continue;
        }

        for entry_result in WalkDir::new(root_path)
            .min_depth(1)
            .follow_links(false)
            .into_iter()
        {
            if results.len() >= max {
                break;
            }

            let entry = match entry_result {
                Ok(e) => e,
                Err(_) => continue,
            };

            let path = entry.path();
            let rel = path.strip_prefix(root_path).unwrap_or(path);

            if should_exclude(rel, &exclude_patterns) {
                continue;
            }

            // H-1: skip all entries inside the vault meta folder so it never
            // appears in staleness checks or file-browser listing.
            if entry.file_type().is_dir() && is_meta_folder_component(rel, &meta_component) {
                // Skip the directory entry itself. WalkDir does not prune traversal
                // on `continue` (only filter_entry() does), so file entries inside
                // the meta folder are caught by the second check below.
                continue;
            }
            // Also skip non-directory entries that live inside the meta folder
            // (the directory skip above does not prune WalkDir traversal here
            // because we are not using into_iter().filter_entry(); we must check
            // every entry individually).
            if is_meta_folder_component(rel, &meta_component) {
                continue;
            }

            let metadata = match std::fs::metadata(path) {
                Ok(m) => m,
                Err(_) => continue,
            };

            let modified = metadata.modified().map(system_time_to_ms).unwrap_or(0);
            let size = metadata.len();
            let is_directory = metadata.is_dir();

            results.push(FileEntry {
                path: path.to_string_lossy().to_string(),
                name: path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string(),
                modified,
                size,
                is_directory,
            });
        }
    }

    Ok(results)
}

// ─── Watcher registry ────────────────────────────────────────────────────────

/// In-process registry mapping vault ID → active RecommendedWatcher.
///
/// Stored in Tauri managed state (`app.state::<WatcherRegistry>()`) so watcher
/// objects remain alive for the lifetime of the app and are reachable from any
/// async Tauri command. The inner `Mutex` ensures single-threaded access even
/// though `RecommendedWatcher` is `Send + Sync` (FsEventWatcher on macOS).
///
/// Drop of a `RecommendedWatcher` value automatically un-registers all FSEvents
/// callbacks, so `registry.remove(vault_id)` is sufficient cleanup.
pub type WatcherRegistry = std::sync::Mutex<std::collections::HashMap<String, notify::RecommendedWatcher>>;

// ─── watch_vault / unwatch_vault ─────────────────────────────────────────────

/// Start watching `root_paths` for file-system changes for the given vault.
///
/// Behaviour:
/// - Idempotent: if a watcher already exists for `vault_id`, it is stopped and
///   replaced with a fresh one (handles re-enable without explicit unwatch).
/// - Emits the Tauri event `"vault-file-changed"` with payload
///   `{ vaultId, eventType: "created"|"modified"|"deleted", path }` for each
///   relevant FSEvents notification. Other event kinds (e.g. metadata-only
///   changes, access events) are silently discarded.
/// - Debouncing of rapid event storms (git checkout etc.) is handled on the
///   TypeScript side in `vault-manager.ts`'s `scheduleIndexUpdate()` to keep
///   Rust free of async timer complexity and to keep the debounce logic testable.
///
/// The `app` parameter is injected automatically by Tauri's command dispatcher
/// and must appear AFTER the named parameters in the function signature.
#[tauri::command]
pub fn watch_vault(
    vault_id: String,
    root_paths: Vec<String>,
    app: tauri::AppHandle,
    registry: tauri::State<'_, WatcherRegistry>,
) -> Result<(), String> {
    use notify::{EventKind, RecursiveMode, Watcher};
    use tauri::Emitter;

    // Remove any existing watcher for this vault (idempotent restart).
    {
        let mut reg = registry.lock().map_err(|_| "watcher registry lock poisoned")?;
        reg.remove(&vault_id);
    }

    let vault_id_clone = vault_id.clone();
    let app_clone = app.clone();

    // Build the event handler closure. Captures `vault_id_clone` and `app_clone`
    // by value so it can be called from the FSEvents background thread.
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let event = match res {
            Ok(e) => e,
            Err(e) => {
                eprintln!("[watch_vault] watcher error: {}", e);
                return;
            }
        };

        // Map notify EventKind to the three event types the frontend understands.
        let event_type = match event.kind {
            EventKind::Create(_) => "created",
            EventKind::Modify(_) => "modified",
            EventKind::Remove(_) => "deleted",
            // Access, Other, Any — not interesting to the index updater.
            _ => return,
        };

        for path in &event.paths {
            let path_str = path.to_string_lossy().to_string();
            let payload = serde_json::json!({
                "vaultId":   vault_id_clone,
                "eventType": event_type,
                "path":      path_str,
            });
            // Emit a best-effort Tauri event; ignore emission errors
            // (e.g. window closed) rather than crashing the watcher thread.
            let _ = app_clone.emit("vault-file-changed", payload);
        }
    })
    .map_err(|e| format!("Failed to create watcher for vault '{}': {}", vault_id, e))?;

    // Register each configured root path for recursive watching.
    for root in &root_paths {
        watcher
            .watch(std::path::Path::new(root), RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch '{}': {}", root, e))?;
    }

    // Store the live watcher so it stays alive (dropping it stops watching).
    let mut reg = registry.lock().map_err(|_| "watcher registry lock poisoned")?;
    reg.insert(vault_id, watcher);

    Ok(())
}

/// Stop the file-system watcher for the given `vault_id`.
///
/// No-op when no watcher is currently registered for `vault_id`. Dropping the
/// `RecommendedWatcher` value automatically de-registers all FSEvents callbacks.
#[tauri::command]
pub fn unwatch_vault(
    vault_id: String,
    registry: tauri::State<'_, WatcherRegistry>,
) -> Result<(), String> {
    let mut reg = registry.lock().map_err(|_| "watcher registry lock poisoned")?;
    reg.remove(&vault_id);
    Ok(())
}

/// Search the text content of all `.md` files in `root_paths` for a case-insensitive
/// substring match of `query`.
///
/// Walk algorithm:
///   1. Use `WalkDir` over each root path in `root_paths`.
///   2. Skip entries that `should_exclude` returns true for (hidden files, patterns).
///   3. Process only files whose extension is `.md` (case-insensitive).
///   4. Read up to `SEARCH_MAX_FILE_BYTES` bytes per file. Files that cannot be
///      opened are silently skipped (EC-8, EC-9); `skipped_count` is incremented.
///   5. Convert raw bytes to a string via `String::from_utf8_lossy` (AD-GS-02).
///   6. Scan each line for a case-insensitive substring match of `query`.
///   7. Collect all matching lines into a `FileContentResult`. A file is only added
///      to `results` when at least one line matches.
///   8. Stop adding new files once `results.len() == max_results as usize`
///      (set `capped = true`). Files already in `results` are still fully scanned
///      (all their matches are included); the cap applies to the count of *files*.
///   9. Sort `results` by match count descending before returning (AD-GS-10).
///
/// Returns `Err` only when `query` is empty after trimming (caller should guard,
/// but the Rust side validates too for safety).
#[tauri::command]
pub async fn search_vault_content(
    root_paths: Vec<String>,
    exclude_patterns: Vec<String>,
    query: String,
    max_results: u32,
) -> Result<ContentSearchPayload, String> {
    // Length justified: file-at-a-time streaming pipeline with per-file error isolation;
    // extracting inner loops would require passing 4+ mutable accumulators by reference.
    use std::io::Read;

    let query_trimmed = query.trim().to_lowercase();
    if query_trimmed.is_empty() {
        return Err("query must not be empty".to_string());
    }

    let max = max_results as usize;
    let mut results: Vec<FileContentResult> = Vec::new();
    let mut capped = false;
    let mut skipped_count: u32 = 0;

    'roots: for root_str in &root_paths {
        let root = Path::new(root_str);
        for entry in WalkDir::new(root).follow_links(false).into_iter() {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => {
                    skipped_count += 1;
                    continue;
                }
            };

            // Only process regular files.
            if !entry.file_type().is_file() {
                continue;
            }

            let path = entry.path();

            // Exclude hidden/excluded paths (vault-relative, so strip the root prefix).
            let rel = path.strip_prefix(root).unwrap_or(path);
            if should_exclude(rel, &exclude_patterns) {
                continue;
            }

            // Only .md files (case-insensitive extension check).
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("");
            if !ext.eq_ignore_ascii_case("md") {
                continue;
            }

            // Stop adding new files if the cap is reached.
            if results.len() >= max {
                capped = true;
                break 'roots;
            }

            // Read up to SEARCH_MAX_FILE_BYTES bytes (EC-10, NFR-7).
            // Using File::open + take() rather than read_to_string so we can enforce
            // the per-file size cap before the full file is read into memory.
            let bytes: Vec<u8> = {
                let file = match std::fs::File::open(path) {
                    Ok(f) => f,
                    Err(_) => {
                        skipped_count += 1;
                        continue;
                    }
                };
                let mut reader = file.take(SEARCH_MAX_FILE_BYTES as u64);
                let mut buf = Vec::with_capacity(SEARCH_MAX_FILE_BYTES);
                match reader.read_to_end(&mut buf) {
                    Ok(_) => buf,
                    Err(_) => {
                        skipped_count += 1;
                        continue;
                    }
                }
            };

            // Lossy UTF-8 decode (AD-GS-02): invalid sequences become U+FFFD, which
            // cannot match any valid user query string, so search quality is unaffected.
            let content = String::from_utf8_lossy(&bytes);

            // Extract title for display (same priority as build_vault_index).
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let fm = parse_front_matter(&content);
            let title = fm.title.unwrap_or_else(|| stem.clone());

            // Scan lines for case-insensitive substring matches.
            let mut file_matches: Vec<LineMatch> = Vec::new();
            for (line_idx, line) in content.lines().enumerate() {
                let trimmed = line.trim();
                let lower = trimmed.to_lowercase();
                // `str::find()` returns a *byte* offset. We convert it to a
                // *character* (Unicode scalar) count so that JavaScript's
                // `String.prototype.slice()` can use `column_start` directly,
                // even when multi-byte UTF-8 characters appear before the match
                // (e.g. "日本語notes" — "notes" starts at char index 3, not byte 9).
                if let Some(byte_pos) = lower.find(&query_trimmed) {
                    let char_offset = lower[..byte_pos].chars().count() as u32;
                    file_matches.push(LineMatch {
                        line_number: (line_idx + 1) as u32,
                        line_text: trimmed.to_string(),
                        column_start: char_offset,
                    });
                }
            }

            if !file_matches.is_empty() {
                results.push(FileContentResult {
                    path: path.to_string_lossy().to_string(),
                    title,
                    matches: file_matches,
                });
            }
        }
    }

    // Sort by match count descending so the most-relevant files appear first (AD-GS-10).
    results.sort_by(|a, b| b.matches.len().cmp(&a.matches.len()));

    Ok(ContentSearchPayload {
        results,
        capped,
        skipped_count,
    })
}

// ─── Tag scanning ─────────────────────────────────────────────────────────────

/// One tag and the set of vault file paths that use it.
#[derive(serde::Serialize, Clone, Debug)]
pub struct TagEntry {
    pub tag: String,
    /// Absolute paths of every file in the vault that uses this tag
    /// (front matter OR inline #hashtag).
    #[serde(rename = "filePaths")]
    pub file_paths: Vec<String>,
    pub count: usize,
}

/// Scan `root_paths` for all tags used across the vault.
///
/// Collects tags from two sources per file:
/// - YAML front matter `tags:` field (same parser as `build_vault_index`)
/// - Inline `#hashtag` mentions in document body text (new)
///
/// The meta folder (`{vault_name}_meta/`) is excluded from the scan so
/// vocabulary definition files are not treated as content.
/// Results are sorted by usage count descending, then alphabetically.
#[tauri::command]
pub fn scan_vault_tags(
    root_paths: Vec<String>,
    exclude_patterns: Vec<String>,
    vault_name: String,
) -> Result<Vec<TagEntry>, String> {
    use std::collections::HashMap;

    let safe_name = sanitise_vault_name(&vault_name);
    let meta_component = format!("{}_meta", safe_name);
    let mut tag_files: HashMap<String, Vec<String>> = HashMap::new();

    for root_str in &root_paths {
        let root = Path::new(root_str);
        if !root.exists() {
            continue;
        }

        for entry in WalkDir::new(root).follow_links(false).into_iter() {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };

            if !entry.file_type().is_file() {
                continue;
            }

            let path = entry.path();
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if !ext.eq_ignore_ascii_case("md") {
                continue;
            }

            let rel = path.strip_prefix(root).unwrap_or(path);

            // Skip the vault meta folder (same guard as build_vault_index).
            if is_meta_folder_component(rel, &meta_component) {
                continue;
            }

            if should_exclude(rel, &exclude_patterns) {
                continue;
            }

            let content = match std::fs::read_to_string(path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let path_str = path.to_string_lossy().to_string();

            // Source 1: front matter tags (re-uses existing parser).
            let fm = parse_front_matter(&content);
            for tag in fm.tags {
                tag_files.entry(tag).or_default().push(path_str.clone());
            }

            // Source 2: inline #hashtags from body text.
            for hashtag in extract_inline_hashtags(&content) {
                let paths = tag_files.entry(hashtag).or_default();
                if !paths.contains(&path_str) {
                    paths.push(path_str.clone());
                }
            }
        }
    }

    let mut result: Vec<TagEntry> = tag_files
        .into_iter()
        .map(|(tag, paths)| TagEntry {
            count: paths.len(),
            file_paths: paths,
            tag,
        })
        .collect();

    result.sort_by(|a, b| b.count.cmp(&a.count).then(a.tag.cmp(&b.tag)));

    Ok(result)
}

/// Extract inline `#hashtag` mentions from document text.
///
/// Skips YAML front matter and fenced code blocks. Does not extract Markdown
/// headings (`# Title` — `#` followed by a space) or URL fragments (`#anchor`
/// inside link syntax where `#` is preceded by `[` or `(`).
fn extract_inline_hashtags(content: &str) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    let mut in_front_matter = false;
    let mut in_code_block = false;
    let mut first_line = true;

    for line in content.lines() {
        let trimmed = line.trim();

        // Detect and skip YAML front matter block.
        if first_line {
            first_line = false;
            if trimmed == "---" {
                in_front_matter = true;
                continue;
            }
        }

        if in_front_matter {
            if trimmed == "---" || trimmed == "..." {
                in_front_matter = false;
            }
            continue;
        }

        // Track fenced code blocks.
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_code_block = !in_code_block;
            continue;
        }
        if in_code_block {
            continue;
        }

        // Extract #hashtags from this line.
        let chars: Vec<char> = line.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            if chars[i] != '#' {
                i += 1;
                continue;
            }
            let prev = if i > 0 { chars[i - 1] } else { ' ' };
            // Skip URL fragments: # preceded by [ or (
            if prev == '[' || prev == '(' {
                i += 1;
                continue;
            }
            // Hashtag: # followed directly by a letter.
            // Headings use `# space`, sub-headings `## space` — these have a
            // space or another `#` after `#`, so `is_alphabetic()` excludes them.
            if i + 1 < chars.len() && chars[i + 1].is_alphabetic() {
                let start = i + 1;
                let mut end = start;
                while end < chars.len()
                    && (chars[end].is_alphanumeric()
                        || chars[end] == '-'
                        || chars[end] == '_'
                        || chars[end] == '/')
                {
                    end += 1;
                }
                let tag: String = chars[start..end].iter().collect();
                if !tag.is_empty() && !tags.contains(&tag) {
                    tags.push(tag);
                }
                i = end;
            } else {
                i += 1;
            }
        }
    }

    tags
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    fn write_temp_file(dir: &Path, name: &str, content: &str) -> PathBuf {
        let p = dir.join(name);
        let mut f = fs::File::create(&p).unwrap();
        f.write_all(content.as_bytes()).unwrap();
        p
    }

    // ── glob_matches ──────────────────────────────────────────────────────────

    #[test]
    fn glob_exact_match() {
        assert!(glob_matches("node_modules", "node_modules"));
        assert!(!glob_matches("node_modules", "node_modules2"));
    }

    #[test]
    fn glob_star_suffix() {
        assert!(glob_matches("*.log", "debug.log"));
        assert!(glob_matches("*.log", ".log"));
        assert!(!glob_matches("*.log", "debug.log.bak"));
    }

    #[test]
    fn glob_star_prefix() {
        assert!(glob_matches("temp*", "temp1"));
        assert!(glob_matches("temp*", "temp"));
        assert!(!glob_matches("temp*", "nottemp"));
    }

    #[test]
    fn glob_star_only() {
        assert!(glob_matches("*", "anything"));
        assert!(glob_matches("*", ""));
    }

    // ── should_exclude ────────────────────────────────────────────────────────
    // Tests use vault-relative paths (no leading abs components) because
    // should_exclude receives paths stripped of their root prefix.

    #[test]
    fn should_exclude_hidden_dir() {
        // Relative path: .git/config  →  ".git" starts with dot
        let path = Path::new(".git/config");
        assert!(should_exclude(path, &[]));
    }

    #[test]
    fn should_exclude_pattern_match() {
        // Relative: node_modules/pkg/index.js
        let path = Path::new("node_modules/pkg/index.js");
        assert!(should_exclude(path, &["node_modules".to_string()]));
    }

    #[test]
    fn should_not_exclude_normal_path() {
        // Relative: docs/guide.md  →  no hidden components, no matching patterns
        let path = Path::new("docs/guide.md");
        assert!(!should_exclude(path, &["node_modules".to_string(), ".git".to_string()]));
    }

    // ── parse_front_matter ────────────────────────────────────────────────────

    #[test]
    fn parse_fm_title_and_tags_inline() {
        let content = "---\ntitle: My Note\ntags: [rust, code]\n---\n# heading\n";
        let fm = parse_front_matter(content);
        assert_eq!(fm.title, Some("My Note".to_string()));
        assert_eq!(fm.tags, vec!["rust", "code"]);
    }

    #[test]
    fn parse_fm_tags_block_sequence() {
        let content = "---\ntags:\n  - alpha\n  - beta\n---\n";
        let fm = parse_front_matter(content);
        assert_eq!(fm.tags, vec!["alpha", "beta"]);
    }

    #[test]
    fn parse_fm_no_front_matter_extracts_h1() {
        let content = "# Hello World\nsome content";
        let fm = parse_front_matter(content);
        assert_eq!(fm.title, Some("Hello World".to_string()));
        assert!(fm.tags.is_empty());
    }

    #[test]
    fn parse_fm_malformed_falls_back_gracefully() {
        // No closing `---` — should not panic; title falls back to H1.
        let content = "---\ntitle: Unterminated\n# H1 Heading\n";
        let fm = parse_front_matter(content);
        // title set from front matter even if unclosed
        assert_eq!(fm.title, Some("Unterminated".to_string()));
    }

    #[test]
    fn parse_fm_empty_content() {
        let fm = parse_front_matter("");
        assert!(fm.title.is_none());
        assert!(fm.tags.is_empty());
    }

    // ── extract_wiki_links ────────────────────────────────────────────────────

    #[test]
    fn wiki_links_basic() {
        let content = "See [[note-a]] and [[note-b]].";
        let mut links = extract_wiki_links(content);
        links.sort();
        assert_eq!(links, vec!["note-a", "note-b"]);
    }

    #[test]
    fn wiki_links_piped() {
        let content = "See [[target|display text]].";
        let links = extract_wiki_links(content);
        assert_eq!(links, vec!["target"]);
    }

    #[test]
    fn wiki_links_deduplicated() {
        let content = "[[foo]] and [[foo]] again.";
        let links = extract_wiki_links(content);
        assert_eq!(links.len(), 1);
        assert_eq!(links[0], "foo");
    }

    #[test]
    fn wiki_links_empty_content() {
        assert!(extract_wiki_links("").is_empty());
        assert!(extract_wiki_links("no links here").is_empty());
    }

    #[test]
    fn wiki_links_ignore_newline_inside() {
        // A newline inside `[[...]]` should NOT produce a match.
        let content = "[[line1\nline2]]";
        assert!(extract_wiki_links(content).is_empty());
    }

    // ── validate_vault_paths ──────────────────────────────────────────────────

    #[test]
    fn validate_nonexistent_path() {
        let results = validate_vault_paths(vec!["/nonexistent/path/xyz".to_string()]);
        assert_eq!(results.len(), 1);
        assert!(!results[0].exists);
        assert!(results[0].error.is_some());
    }

    #[test]
    fn validate_existing_directory() {
        let dir = std::env::temp_dir();
        let results = validate_vault_paths(vec![dir.to_string_lossy().to_string()]);
        assert_eq!(results.len(), 1);
        assert!(results[0].exists);
        assert!(results[0].is_directory);
        assert!(results[0].readable);
    }

    #[test]
    fn validate_file_not_directory() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("test.md");
        fs::write(&file_path, "content").unwrap();
        let results = validate_vault_paths(vec![file_path.to_string_lossy().to_string()]);
        assert_eq!(results.len(), 1);
        assert!(results[0].exists);
        assert!(!results[0].is_directory);
        assert!(!results[0].readable);
    }

    // ── create_vault ──────────────────────────────────────────────────────────

    #[test]
    fn create_vault_returns_uuid() {
        let dir = tempfile::tempdir().unwrap();
        let result = create_vault(
            "Test Vault".to_string(),
            vec![dir.path().to_string_lossy().to_string()],
            vec![],
            500,
        );
        assert!(result.is_ok());
        let id = result.unwrap();
        // UUID v4 format: 8-4-4-4-12 hex chars
        assert_eq!(id.len(), 36);
        assert!(id.contains('-'));
    }

    #[test]
    fn create_vault_empty_name_fails() {
        let dir = tempfile::tempdir().unwrap();
        let result = create_vault(
            "  ".to_string(),
            vec![dir.path().to_string_lossy().to_string()],
            vec![],
            500,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty"));
    }

    #[test]
    fn create_vault_empty_paths_fails() {
        let result = create_vault("My Vault".to_string(), vec![], vec![], 500);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("root path"));
    }

    #[test]
    fn create_vault_nonexistent_path_fails() {
        let result = create_vault(
            "My Vault".to_string(),
            vec!["/nonexistent/path/xyz".to_string()],
            vec![],
            500,
        );
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn create_vault_trims_path_entries() {
        let dir = tempfile::tempdir().unwrap();
        // Path with leading/trailing whitespace should still resolve correctly.
        let padded = format!("  {}  ", dir.path().to_string_lossy());
        let result = create_vault("My Vault".to_string(), vec![padded], vec![], 500);
        assert!(result.is_ok());
    }

    // ── update_vault ──────────────────────────────────────────────────────────

    #[test]
    fn update_vault_valid_name_ok() {
        let result = update_vault(
            "some-id".to_string(),
            Some("New Name".to_string()),
            None,
            None,
            None,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn update_vault_empty_name_fails() {
        let result = update_vault(
            "some-id".to_string(),
            Some("  ".to_string()),
            None,
            None,
            None,
        );
        assert!(result.is_err());
    }

    #[test]
    fn update_vault_valid_paths_ok() {
        let dir = tempfile::tempdir().unwrap();
        let result = update_vault(
            "some-id".to_string(),
            None,
            Some(vec![dir.path().to_string_lossy().to_string()]),
            None,
            None,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn update_vault_invalid_path_fails() {
        let result = update_vault(
            "some-id".to_string(),
            None,
            Some(vec!["/nonexistent/path".to_string()]),
            None,
            None,
        );
        assert!(result.is_err());
    }

    #[test]
    fn switch_vault_ok() {
        assert!(switch_vault("any-id".to_string()).is_ok());
    }

    // ── build_vault_index ─────────────────────────────────────────────────────
    // Note: build_vault_index is async but the inner logic is sync-compatible.
    // We use a tokio runtime for these integration tests.

    #[tokio::test]
    async fn build_index_basic() {
        let dir = tempfile::tempdir().unwrap();
        write_temp_file(dir.path(), "note-a.md", "---\ntitle: Note A\ntags: [x]\n---\nSee [[note-b]].");
        write_temp_file(dir.path(), "note-b.md", "# Note B\n[[note-a]]");
        write_temp_file(dir.path(), "ignore.txt", "not markdown");

        let result = build_vault_index(
            "vault-1".to_string(),
            vec![dir.path().to_string_lossy().to_string()],
            vec![],
            500,
            "Test Vault".to_string(),
        )
        .await
        .unwrap();

        assert_eq!(result.vault_id, "vault-1");
        assert_eq!(result.entries.len(), 2);
        assert_eq!(result.total_files_found, 2);
        assert!(!result.capped);

        // Find note-a
        let note_a = result.entries.iter().find(|e| e.name == "note-a").unwrap();
        assert_eq!(note_a.title, "Note A");
        assert_eq!(note_a.tags, vec!["x"]);
        assert_eq!(note_a.outbound_links, vec!["note-b"]);
    }

    #[tokio::test]
    async fn build_index_cap_enforced() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..5 {
            write_temp_file(dir.path(), &format!("note-{}.md", i), "# Content");
        }
        let result = build_vault_index(
            "vault-cap".to_string(),
            vec![dir.path().to_string_lossy().to_string()],
            vec![],
            3,
            "Cap Vault".to_string(),
        )
        .await
        .unwrap();

        assert_eq!(result.entries.len(), 3);
        assert_eq!(result.total_files_found, 5);
        assert!(result.capped);
    }

    #[tokio::test]
    async fn build_index_excludes_hidden_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let hidden = dir.path().join(".hidden");
        fs::create_dir_all(&hidden).unwrap();
        write_temp_file(&hidden, "secret.md", "hidden");
        write_temp_file(dir.path(), "visible.md", "visible");

        let result = build_vault_index(
            "vault-hidden".to_string(),
            vec![dir.path().to_string_lossy().to_string()],
            vec![],
            500,
            "Hidden Vault".to_string(),
        )
        .await
        .unwrap();

        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].name, "visible");
    }

    #[tokio::test]
    async fn build_index_excludes_pattern() {
        let dir = tempfile::tempdir().unwrap();
        let nm = dir.path().join("node_modules");
        fs::create_dir_all(&nm).unwrap();
        write_temp_file(&nm, "pkg.md", "pkg");
        write_temp_file(dir.path(), "main.md", "main");

        let result = build_vault_index(
            "v1".to_string(),
            vec![dir.path().to_string_lossy().to_string()],
            vec!["node_modules".to_string()],
            500,
            "Pattern Vault".to_string(),
        )
        .await
        .unwrap();

        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].name, "main");
    }

    #[tokio::test]
    async fn build_index_empty_vault() {
        let dir = tempfile::tempdir().unwrap();
        let result = build_vault_index(
            "empty".to_string(),
            vec![dir.path().to_string_lossy().to_string()],
            vec![],
            500,
            "Empty Vault".to_string(),
        )
        .await
        .unwrap();

        assert_eq!(result.entries.len(), 0);
        assert_eq!(result.total_files_found, 0);
        assert!(!result.capped);
    }

    // ── Meta system tests ─────────────────────────────────────────────────────

    #[test]
    fn sanitise_vault_name_replaces_colon() {
        assert_eq!(sanitise_vault_name("Work: Notes"), "Work_ Notes");
    }

    #[test]
    fn sanitise_vault_name_replaces_slash() {
        assert_eq!(sanitise_vault_name("Notes/2024"), "Notes_2024");
    }

    #[test]
    fn sanitise_vault_name_replaces_null_byte() {
        assert_eq!(sanitise_vault_name("Note\x00s"), "Note_s");
    }

    #[test]
    fn sanitise_vault_name_no_change_for_safe_name() {
        assert_eq!(sanitise_vault_name("Work Notes"), "Work Notes");
    }

    #[test]
    fn sanitise_vault_name_handles_unicode() {
        // EC-18: unicode characters are safe filesystem characters; not replaced.
        assert_eq!(sanitise_vault_name("日本語"), "日本語");
    }

    #[test]
    fn sanitise_vault_name_replaces_multiple_unsafe_chars() {
        // EC-18: "Work: Notes/2024" → "Work_ Notes_2024"
        assert_eq!(sanitise_vault_name("Work: Notes/2024"), "Work_ Notes_2024");
    }

    #[test]
    fn is_meta_folder_component_detects_meta_dir() {
        let path = Path::new("Work Notes_meta/Work Notes_tags.md");
        assert!(is_meta_folder_component(path, "Work Notes_meta"));
    }

    #[test]
    fn is_meta_folder_component_detects_meta_dir_nested() {
        // File nested two levels inside the meta folder.
        let path = Path::new("Work Notes_meta/subdir/file.md");
        assert!(is_meta_folder_component(path, "Work Notes_meta"));
    }

    #[test]
    fn is_meta_folder_component_does_not_match_regular_dir() {
        let path = Path::new("notes/Work Notes_tags.md");
        assert!(!is_meta_folder_component(path, "Work Notes_meta"));
    }

    #[test]
    fn is_meta_folder_component_does_not_match_partial_name() {
        // A folder named "Work Notes_meta_old" must NOT match — exact component only.
        let path = Path::new("Work Notes_meta_old/file.md");
        assert!(!is_meta_folder_component(path, "Work Notes_meta"));
    }

    // ── list_vault_files ──────────────────────────────────────────────────────

    /// H-1: list_vault_files with a vault that has a `{name}_meta/` folder must
    /// not include any files from inside that folder in its results.
    #[tokio::test]
    async fn list_vault_files_excludes_meta_folder() {
        use std::fs;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let root = dir.path().to_str().unwrap().to_string();

        // Regular note — must be included.
        fs::write(dir.path().join("visible.md"), "# Visible\n").unwrap();

        // Meta folder and a file inside it — must be excluded.
        let meta_dir = dir.path().join("Test Vault_meta");
        fs::create_dir(&meta_dir).unwrap();
        fs::write(meta_dir.join("Test Vault_tags.md"), "# Tags\n- alpha\n").unwrap();

        let result = list_vault_files(
            vec![root],
            vec![],
            500,
            "Test Vault".to_string(),
        )
        .await
        .unwrap();

        // Only visible.md (and possibly the meta dir entry itself) should appear.
        // No file whose path contains the meta folder name must appear.
        let has_meta_file = result.iter().any(|e| e.path.contains("Test Vault_meta"));
        assert!(
            !has_meta_file,
            "list_vault_files must not return files inside the meta folder (H-1)"
        );

        let has_visible = result.iter().any(|e| e.name == "visible.md");
        assert!(has_visible, "visible.md must be included in results");
    }

    #[test]
    fn is_meta_folder_component_does_not_match_parent_dir_with_similar_name() {
        // EC-11: a non-meta file whose path contains the meta folder name as a
        // substring of a *different* component should not be excluded.
        let path = Path::new("notes/Work Notes_meta_backup/file.md");
        assert!(!is_meta_folder_component(path, "Work Notes_meta"));
    }

    // ── Integration: build_vault_index excludes meta folder ───────────────────

    #[tokio::test]
    async fn build_vault_index_excludes_meta_folder_files() {
        use std::fs;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let root = dir.path().to_str().unwrap().to_string();

        // Regular note — should be indexed.
        let note_path = dir.path().join("my-note.md");
        fs::write(&note_path, "# My Note\n").unwrap();

        // Meta folder file — must NOT be indexed (FR-4, NFR-6).
        let meta_dir = dir.path().join("Test Vault_meta");
        fs::create_dir(&meta_dir).unwrap();
        let meta_file = meta_dir.join("Test Vault_tags.md");
        fs::write(&meta_file, "# Tags\n- alpha\n").unwrap();

        let result = build_vault_index(
            "vault-1".to_string(),
            vec![root],
            vec![],
            100,
            "Test Vault".to_string(),
        )
        .await
        .unwrap();

        // Only my-note.md should appear.
        assert_eq!(result.entries.len(), 1, "meta folder files must be excluded");
        assert!(result.entries[0].path.ends_with("my-note.md"));
    }

    #[tokio::test]
    async fn build_vault_index_does_not_exclude_similarly_named_dirs() {
        use std::fs;
        use tempfile::TempDir;

        let dir = TempDir::new().unwrap();
        let root = dir.path().to_str().unwrap().to_string();

        // File in a dir that has a similar but non-exact name — must NOT be excluded.
        let similar_dir = dir.path().join("Test Vault_meta_backup");
        fs::create_dir(&similar_dir).unwrap();
        let file = similar_dir.join("note.md");
        fs::write(&file, "# Note\n").unwrap();

        let result = build_vault_index(
            "vault-1".to_string(),
            vec![root],
            vec![],
            100,
            "Test Vault".to_string(),
        )
        .await
        .unwrap();

        // The file in "Test Vault_meta_backup" must be indexed (not the exact meta dir).
        assert_eq!(result.entries.len(), 1);
    }
}

// ─── Content search tests ─────────────────────────────────────────────────────

#[cfg(test)]
mod content_search_tests {
    use super::*;

    // Helper: create a temp vault directory with named files and contents.
    fn make_vault(files: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for (name, content) in files {
            let path = dir.path().join(name);
            std::fs::write(&path, content).unwrap();
        }
        dir
    }

    /// D-1 — basic match returns correct LineMatch fields.
    #[tokio::test]
    async fn test_basic_match() {
        let dir = make_vault(&[("note.md", "line one\nfoo bar\nline three\n")]);
        let result = search_vault_content(
            vec![dir.path().to_str().unwrap().to_string()],
            vec![],
            "foo".to_string(),
            50,
        )
        .await
        .unwrap();

        assert_eq!(result.results.len(), 1);
        let file = &result.results[0];
        assert_eq!(file.matches.len(), 1);
        let m = &file.matches[0];
        assert_eq!(m.line_number, 2);
        assert_eq!(m.line_text, "foo bar");
        assert_eq!(m.column_start, 0);
        assert!(!result.capped);
        assert_eq!(result.skipped_count, 0);
    }

    /// D-2 — case-insensitive search (EC-11 related).
    #[tokio::test]
    async fn test_case_insensitive() {
        let dir = make_vault(&[("a.md", "Hello World\n")]);
        let result = search_vault_content(
            vec![dir.path().to_str().unwrap().to_string()],
            vec![],
            "hello".to_string(),
            50,
        )
        .await
        .unwrap();
        assert_eq!(result.results.len(), 1);
        assert_eq!(result.results[0].matches[0].line_text, "Hello World");
    }

    /// D-3 — EC-11: regex special characters treated as literals, not patterns.
    /// If regex were used, "$" would be an end-of-string anchor and would never match
    /// in the middle of a line. Substring matching must find it as a literal character.
    #[tokio::test]
    async fn test_regex_chars_literal() {
        let dir = make_vault(&[("a.md", "price: $5.00\nno match\n")]);
        let result = search_vault_content(
            vec![dir.path().to_str().unwrap().to_string()],
            vec![],
            "$5.00".to_string(),
            50,
        )
        .await
        .unwrap();
        assert_eq!(result.results.len(), 1);
    }

    /// D-4 — EC-10: file larger than 1 MB is truncated, not skipped.
    /// The match is placed 100 bytes beyond the 1 MB boundary; the search must NOT
    /// find it, but skipped_count must remain 0 (the file was opened and read, not
    /// skipped). Using 1 MB + 100 bytes as the filler ensures "FINDME" is clearly
    /// past the cap, not straddling the exact boundary (L-2).
    #[tokio::test]
    async fn test_large_file_truncated() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("big.md");
        // Fill 1 MB + 100 bytes with 'x', then append the search target immediately
        // after. The 100-byte margin guarantees "FINDME" is not straddling the cap.
        let filler = "x".repeat(1_048_576 + 100); // 1 MB + 100 bytes
        let beyond = "FINDME";
        std::fs::write(&path, format!("{}{}", filler, beyond)).unwrap();

        let result = search_vault_content(
            vec![dir.path().to_str().unwrap().to_string()],
            vec![],
            "FINDME".to_string(),
            50,
        )
        .await
        .unwrap();
        // FINDME is beyond the 1 MB cap, so it should NOT be found.
        assert_eq!(result.results.len(), 0);
        // The file was processed (not skipped) — skipped_count must be 0.
        assert_eq!(result.skipped_count, 0);
    }

    /// D-5 — EC-10: a match within the first 1 MB IS found even on a large file.
    #[tokio::test]
    async fn test_match_within_cap() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        // "FINDME" near the start, then 2 MB of filler beyond the cap.
        let content = format!("FINDME\n{}", "y".repeat(2_000_000));
        std::fs::write(&path, content).unwrap();

        let result = search_vault_content(
            vec![dir.path().to_str().unwrap().to_string()],
            vec![],
            "FINDME".to_string(),
            50,
        )
        .await
        .unwrap();
        assert_eq!(result.results.len(), 1);
    }

    /// D-6 — EC-5: empty vault returns empty results, not an error.
    #[tokio::test]
    async fn test_empty_vault() {
        let dir = tempfile::tempdir().unwrap();
        let result = search_vault_content(
            vec![dir.path().to_str().unwrap().to_string()],
            vec![],
            "anything".to_string(),
            50,
        )
        .await
        .unwrap();
        assert_eq!(result.results.len(), 0);
        assert!(!result.capped);
        assert_eq!(result.skipped_count, 0);
    }

    /// D-7 — max_results cap sets capped = true when more files match than max_results.
    #[tokio::test]
    async fn test_cap() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..5 {
            std::fs::write(dir.path().join(format!("note{}.md", i)), "foo").unwrap();
        }
        let result = search_vault_content(
            vec![dir.path().to_str().unwrap().to_string()],
            vec![],
            "foo".to_string(),
            3, // max_results = 3, but 5 files match
        )
        .await
        .unwrap();
        assert_eq!(result.results.len(), 3);
        assert!(result.capped);
    }

    /// D-8 — EC-8/EC-9: unreadable file increments skipped_count.
    /// Requires Unix permission control; skipped on non-Unix targets.
    #[cfg(unix)]
    #[tokio::test]
    async fn test_unreadable_file_skipped() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secret.md");
        std::fs::write(&path, "hidden content foo").unwrap();
        let mut perms = std::fs::metadata(&path).unwrap().permissions();
        perms.set_mode(0o000); // remove all permissions
        std::fs::set_permissions(&path, perms).unwrap();

        let result = search_vault_content(
            vec![dir.path().to_str().unwrap().to_string()],
            vec![],
            "foo".to_string(),
            50,
        )
        .await
        .unwrap();
        assert_eq!(result.skipped_count, 1);
        assert_eq!(result.results.len(), 0);

        // Restore permissions so the temp directory can be cleaned up.
        let mut perms = std::fs::metadata(&path).unwrap().permissions();
        perms.set_mode(0o644);
        std::fs::set_permissions(&path, perms).unwrap();
    }

    /// D-9 — AD-GS-10: results are sorted by match count descending.
    #[tokio::test]
    async fn test_results_sorted_by_match_count() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("one_match.md"), "foo\n").unwrap();
        std::fs::write(dir.path().join("three_matches.md"), "foo\nfoo\nfoo\n").unwrap();
        std::fs::write(dir.path().join("two_matches.md"), "foo\nfoo\n").unwrap();

        let result = search_vault_content(
            vec![dir.path().to_str().unwrap().to_string()],
            vec![],
            "foo".to_string(),
            50,
        )
        .await
        .unwrap();
        assert_eq!(result.results.len(), 3);
        // Most matches first.
        assert_eq!(result.results[0].matches.len(), 3);
        assert_eq!(result.results[1].matches.len(), 2);
        assert_eq!(result.results[2].matches.len(), 1);
    }

    /// D-10 — EC-20: multi-root vault merges results from all roots into one list.
    #[tokio::test]
    async fn test_multi_root() {
        let dir1 = tempfile::tempdir().unwrap();
        let dir2 = tempfile::tempdir().unwrap();
        std::fs::write(dir1.path().join("a.md"), "foo in root1\n").unwrap();
        std::fs::write(dir2.path().join("b.md"), "foo in root2\n").unwrap();

        let result = search_vault_content(
            vec![
                dir1.path().to_str().unwrap().to_string(),
                dir2.path().to_str().unwrap().to_string(),
            ],
            vec![],
            "foo".to_string(),
            50,
        )
        .await
        .unwrap();
        assert_eq!(result.results.len(), 2);
    }

    /// D-11 — empty query returns Err (Rust-side validation).
    #[tokio::test]
    async fn test_empty_query_returns_err() {
        let dir = tempfile::tempdir().unwrap();
        let result = search_vault_content(
            vec![dir.path().to_str().unwrap().to_string()],
            vec![],
            "".to_string(),
            50,
        )
        .await;
        assert!(result.is_err());
    }

    /// D-12 — NFR-3: large vault does not panic or hang (smoke test).
    /// Not a hard timing assertion — verifies no infinite loop or crash.
    #[tokio::test]
    async fn test_large_vault_no_panic() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..50 {
            std::fs::write(
                dir.path().join(format!("note{}.md", i)),
                format!("content line {}\nanother line\n", i),
            )
            .unwrap();
        }
        let result = search_vault_content(
            vec![dir.path().to_str().unwrap().to_string()],
            vec![],
            "line".to_string(),
            50,
        )
        .await;
        assert!(result.is_ok());
    }

    /// D-12b — H-1: multi-byte UTF-8 characters before the match produce a
    /// character-count column_start, not a byte-offset column_start.
    ///
    /// "日本語notes" — "日", "本", "語" are each 3 bytes in UTF-8, so "notes"
    /// starts at byte offset 9 but at character index 3. The fix in
    /// `search_vault_content` must return `column_start = 3`, not 9.
    #[tokio::test]
    async fn test_multibyte_column_start_is_char_count() {
        let dir = make_vault(&[("cjk.md", "日本語notes\n")]);
        let result = search_vault_content(
            vec![dir.path().to_str().unwrap().to_string()],
            vec![],
            "notes".to_string(),
            50,
        )
        .await
        .unwrap();

        assert_eq!(result.results.len(), 1, "should find one matching file");
        let m = &result.results[0].matches[0];
        assert_eq!(
            m.column_start, 3,
            "column_start must be the char count (3), not the byte offset (9)"
        );
        assert_eq!(m.line_text, "日本語notes");
    }

    /// D-13 — M-4 / AD-GS-02: files with invalid UTF-8 bytes are searched lossily
    /// (via `from_utf8_lossy`) rather than skipped, so `skipped_count` is NOT
    /// incremented. This test verifies the implemented behaviour deviates from the
    /// original EC-9 requirement (which said "file skipped, counted") as documented
    /// in AD-GS-02.
    #[tokio::test]
    async fn test_invalid_utf8_searched_lossily_not_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("invalid.md");

        // Write a file that contains invalid UTF-8 bytes followed by a valid ASCII
        // query target. The 0xFF byte is not valid in UTF-8; from_utf8_lossy replaces
        // it with U+FFFD, which cannot match any user query (so it does not interfere).
        let mut content: Vec<u8> = b"valid prefix ".to_vec();
        content.push(0xFF); // invalid UTF-8 byte
        content.extend_from_slice(b" FINDME\n");
        std::fs::write(&path, &content).unwrap();

        let result = search_vault_content(
            vec![dir.path().to_str().unwrap().to_string()],
            vec![],
            "FINDME".to_string(),
            50,
        )
        .await
        .unwrap();

        // The file must NOT be skipped (skipped_count stays 0).
        assert_eq!(
            result.skipped_count, 0,
            "invalid UTF-8 file should not increment skipped_count (lossy decode, not skip)"
        );
        // The valid ASCII query must still be found in the lossily-decoded content.
        assert_eq!(
            result.results.len(), 1,
            "FINDME must be found in the lossily-decoded file"
        );
    }
}

#[cfg(test)]
mod tag_scan_tests {
    use super::*;
    use std::fs;

    fn write_file(dir: &std::path::Path, name: &str, content: &str) {
        fs::write(dir.join(name), content).unwrap();
    }

    // ── extract_inline_hashtags ───────────────────────────────────────────────

    #[test]
    fn hashtag_basic() {
        let tags = extract_inline_hashtags("Hello #world and #rust-lang today");
        assert_eq!(tags, vec!["world", "rust-lang"]);
    }

    #[test]
    fn hashtag_skips_front_matter() {
        let content = "---\ntags:\n  - fm-tag\n---\nBody has #body-tag";
        let tags = extract_inline_hashtags(content);
        assert_eq!(tags, vec!["body-tag"]);
    }

    #[test]
    fn hashtag_skips_code_block() {
        let content = "Some text\n```\n#inside-code\n```\nAfter #outside";
        let tags = extract_inline_hashtags(content);
        assert_eq!(tags, vec!["outside"]);
    }

    #[test]
    fn hashtag_ignores_headings() {
        // `# Heading` has space after #, so it is NOT a hashtag.
        let tags = extract_inline_hashtags("# My Heading\n## Sub\nNormal #tag text");
        assert_eq!(tags, vec!["tag"]);
    }

    #[test]
    fn hashtag_ignores_url_fragment() {
        // [label](#anchor) → should NOT extract "anchor"
        let tags = extract_inline_hashtags("[link](#section) and #real-tag");
        assert_eq!(tags, vec!["real-tag"]);
    }

    #[test]
    fn hashtag_deduplicates_within_file() {
        let tags = extract_inline_hashtags("Use #rust and more #rust ideas");
        assert_eq!(tags, vec!["rust"]);
    }

    // ── scan_vault_tags ───────────────────────────────────────────────────────

    #[test]
    fn scan_collects_front_matter_tags() {
        let dir = tempfile::tempdir().unwrap();
        write_file(
            dir.path(),
            "note.md",
            "---\ntags:\n  - project\n  - work\n---\nBody text",
        );
        let result = scan_vault_tags(
            vec![dir.path().to_str().unwrap().to_string()],
            vec![],
            "test_vault".to_string(),
        )
        .unwrap();
        let tags: Vec<&str> = result.iter().map(|e| e.tag.as_str()).collect();
        assert!(tags.contains(&"project"), "should find front matter tag 'project'");
        assert!(tags.contains(&"work"), "should find front matter tag 'work'");
    }

    #[test]
    fn scan_collects_inline_hashtags() {
        let dir = tempfile::tempdir().unwrap();
        write_file(dir.path(), "note.md", "No front matter\n\nHere is #inline-tag");
        let result = scan_vault_tags(
            vec![dir.path().to_str().unwrap().to_string()],
            vec![],
            "test_vault".to_string(),
        )
        .unwrap();
        let tags: Vec<&str> = result.iter().map(|e| e.tag.as_str()).collect();
        assert!(tags.contains(&"inline-tag"));
    }

    #[test]
    fn scan_excludes_meta_folder() {
        let dir = tempfile::tempdir().unwrap();
        let meta_dir = dir.path().join("test_vault_meta");
        fs::create_dir_all(&meta_dir).unwrap();
        write_file(dir.path(), "note.md", "---\ntags:\n  - real-tag\n---");
        write_file(&meta_dir, "test_vault_tags.md", "---\ntags:\n  - meta-only\n---");
        let result = scan_vault_tags(
            vec![dir.path().to_str().unwrap().to_string()],
            vec![],
            "test_vault".to_string(),
        )
        .unwrap();
        let tags: Vec<&str> = result.iter().map(|e| e.tag.as_str()).collect();
        assert!(tags.contains(&"real-tag"), "real-tag must be found");
        assert!(!tags.contains(&"meta-only"), "meta-only must not leak from meta folder");
    }

    #[test]
    fn scan_sorted_by_count_desc() {
        let dir = tempfile::tempdir().unwrap();
        write_file(dir.path(), "a.md", "---\ntags:\n  - popular\n---");
        write_file(dir.path(), "b.md", "---\ntags:\n  - popular\n  - rare\n---");
        let result = scan_vault_tags(
            vec![dir.path().to_str().unwrap().to_string()],
            vec![],
            "test_vault".to_string(),
        )
        .unwrap();
        assert_eq!(result[0].tag, "popular", "highest-count tag must be first");
        assert_eq!(result[0].count, 2);
    }
}

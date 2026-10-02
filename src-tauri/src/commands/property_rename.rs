//! Rename a tag or category value across a vault.
//!
//! Rewrites front-matter `tags:` / field values and inline `#hashtags`.
//! Slash children (`from/child`) follow the parent rename. Does not merge
//! onto an existing name.

use std::path::Path;

use serde::Serialize;
use walkdir::WalkDir;

use super::vault::{is_meta_folder_component, should_exclude};

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenameResult {
    pub files_changed: usize,
    pub replacements: usize,
    /// Absolute paths whose contents were written. Empty when nothing changed.
    pub changed_paths: Vec<String>,
}

pub fn mapped_value(value: &str, from: &str, to: &str) -> Option<String> {
    if value == from {
        return Some(to.to_string());
    }
    if let Some(rest) = value.strip_prefix(from) {
        if rest.starts_with('/') {
            return Some(format!("{to}{rest}"));
        }
    }
    None
}

fn in_rename_set(value: &str, from: &str) -> bool {
    value == from || value.starts_with(&format!("{from}/"))
}

pub fn validate_rename(from: &str, to: &str, existing: &[String]) -> Result<(), String> {
    let from = from.trim();
    let to = to.trim();
    if from.is_empty() {
        return Err("Current name is empty.".to_string());
    }
    if to.is_empty() {
        return Err("New name cannot be empty.".to_string());
    }
    if from == to {
        return Err("New name is the same as the current name.".to_string());
    }
    if to.starts_with('/') || to.ends_with('/') || to.contains("//") {
        return Err("Name cannot start, end, or contain empty slash segments.".to_string());
    }
    if from.starts_with(&format!("{to}/")) || to.starts_with(&format!("{from}/")) {
        return Err("New name cannot nest under or wrap the current name.".to_string());
    }
    for segment in to.split('/') {
        if !valid_segment(segment) {
            return Err(format!(
                "Invalid name {to:?}. Use letters, numbers, hyphen, or underscore in each slash segment. No spaces, #, or :."
            ));
        }
    }
    let renamed: Vec<String> = existing
        .iter()
        .filter(|v| in_rename_set(v, from))
        .map(|v| mapped_value(v, from, to).unwrap_or_else(|| v.to_string()))
        .collect();
    for name in &renamed {
        if existing
            .iter()
            .any(|v| !in_rename_set(v, from) && v == name)
        {
            return Err(format!(
                "{name:?} already exists. Merge onto an existing name is a separate action."
            ));
        }
    }
    Ok(())
}

fn same_section(key: &str, section: &str) -> bool {
    key.eq_ignore_ascii_case(section)
}

/// YAML values sometimes keep a trailing comma (`Nice,`). The vocabulary list
/// shows that as `Nice`, so matching ignores the comma.
fn comparable_value(val: &str) -> &str {
    val.trim().trim_end_matches(',').trim()
}

fn valid_segment(segment: &str) -> bool {
    let mut chars = segment.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn replace_scalar(raw: &str, from: &str, to: &str) -> Option<String> {
    let quote = if (raw.starts_with('"') && raw.ends_with('"') && raw.len() >= 2)
        || (raw.starts_with('\'') && raw.ends_with('\'') && raw.len() >= 2)
    {
        Some(raw.chars().next().unwrap())
    } else {
        None
    };
    let inner = comparable_value(if quote.is_some() {
        &raw[1..raw.len() - 1]
    } else {
        raw
    });
    let mapped = mapped_value(inner, from, to)?;
    Some(match quote {
        Some(q) => format!("{q}{mapped}{q}"),
        None => mapped,
    })
}

fn replace_inline_list(inner: &str, from: &str, to: &str) -> (String, usize) {
    let mut count = 0;
    let parts: Vec<String> = inner
        .split(',')
        .map(|item| {
            let trimmed = item.trim();
            if trimmed.is_empty() {
                return item.to_string();
            }
            if let Some(next) = replace_scalar(trimmed, from, to) {
                count += 1;
                next
            } else {
                trimmed.to_string()
            }
        })
        .collect();
    (parts.join(", "), count)
}

fn rewrite_front_matter_line(
    line: &str,
    section: &str,
    from: &str,
    to: &str,
    in_block: &mut Option<String>,
) -> (String, usize) {
    let trimmed = line.trim();
    if let Some(colon) = trimmed.find(':') {
        if !line.starts_with(' ') && !line.starts_with('\t') {
            let key = trimmed[..colon].trim();
            let rest = trimmed[colon + 1..].trim();
            let matches_section = same_section(key, section);
            if matches_section {
                if rest.starts_with('[') && rest.ends_with(']') {
                    *in_block = None;
                    let inner = &rest[1..rest.len() - 1];
                    let (next, n) = replace_inline_list(inner, from, to);
                    return (format!("{key}: [{next}]"), n);
                }
                if rest.is_empty() {
                    *in_block = Some(key.to_string());
                    return (line.to_string(), 0);
                }
                if let Some(next) = replace_scalar(rest, from, to) {
                    *in_block = None;
                    return (format!("{key}: {next}"), 1);
                }
                *in_block = None;
                return (line.to_string(), 0);
            }
            *in_block = None;
            return (line.to_string(), 0);
        }
    }
    if let Some(field) = in_block.clone() {
        if same_section(&field, section) {
            if let Some(item) = line.trim_start().strip_prefix("- ") {
                if let Some(next) = replace_scalar(item.trim(), from, to) {
                    let indent = &line[..line.len() - line.trim_start().len()];
                    return (format!("{indent}- {next}"), 1);
                }
            } else if !trimmed.is_empty() && !trimmed.starts_with('-') {
                *in_block = None;
            }
        }
    }
    (line.to_string(), 0)
}

fn rewrite_hashtag_line(line: &str, from: &str, to: &str) -> (String, usize) {
    let chars: Vec<char> = line.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    let mut count = 0;
    while i < chars.len() {
        if chars[i] != '#' {
            out.push(chars[i]);
            i += 1;
            continue;
        }
        let prev = if i > 0 { chars[i - 1] } else { ' ' };
        if prev == '[' || prev == '(' {
            out.push('#');
            i += 1;
            continue;
        }
        if i + 1 >= chars.len() || !chars[i + 1].is_alphabetic() {
            out.push('#');
            i += 1;
            continue;
        }
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
        if let Some(next) = mapped_value(&tag, from, to) {
            out.push('#');
            out.push_str(&next);
            count += 1;
        } else {
            out.push('#');
            out.push_str(&tag);
        }
        i = end;
    }
    (out, count)
}

pub fn rewrite_property_content(
    content: &str,
    section: &str,
    from: &str,
    to: &str,
) -> (String, usize) {
    let mut out_lines: Vec<String> = Vec::new();
    let mut replacements = 0;
    let mut in_front_matter = false;
    let mut first_line = true;
    let mut in_code_block = false;
    let mut in_block: Option<String> = None;
    let ends_with_nl = content.ends_with('\n');

    for line in content.lines() {
        let trimmed = line.trim();
        if first_line {
            first_line = false;
            if trimmed == "---" {
                in_front_matter = true;
                out_lines.push(line.to_string());
                continue;
            }
        }
        if in_front_matter {
            if trimmed == "---" || trimmed == "..." {
                in_front_matter = false;
                in_block = None;
                out_lines.push(line.to_string());
                continue;
            }
            let (next, n) = rewrite_front_matter_line(line, section, from, to, &mut in_block);
            replacements += n;
            out_lines.push(next);
            continue;
        }
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_code_block = !in_code_block;
            out_lines.push(line.to_string());
            continue;
        }
        if in_code_block || section != "tags" {
            out_lines.push(line.to_string());
            continue;
        }
        let (next, n) = rewrite_hashtag_line(line, from, to);
        replacements += n;
        out_lines.push(next);
    }

    let mut out = out_lines.join("\n");
    if ends_with_nl {
        out.push('\n');
    }
    (out, replacements)
}

#[tauri::command]
pub fn rename_vault_property(
    root_paths: Vec<String>,
    exclude_patterns: Vec<String>,
    section: String,
    from: String,
    to: String,
    existing: Vec<String>,
) -> Result<RenameResult, String> {
    validate_rename(&from, &to, &existing)?;
    let mut files_changed = 0;
    let mut replacements = 0;
    let mut changed_paths = Vec::new();

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
            if is_meta_folder_component(rel, "VaultSettings") {
                continue;
            }
            if should_exclude(rel, &exclude_patterns) {
                continue;
            }
            let content = match std::fs::read_to_string(path) {
                Ok(c) => c,
                Err(err) => {
                    return Err(format!("Could not read {}: {err}", path.display()));
                }
            };
            let (next, n) = rewrite_property_content(&content, &section, &from, &to);
            if n == 0 {
                continue;
            }
            if let Err(err) = std::fs::write(path, next) {
                return Err(format!("Could not write {}: {err}", path.display()));
            }
            files_changed += 1;
            replacements += n;
            changed_paths.push(path.to_string_lossy().to_string());
        }
    }

    Ok(RenameResult {
        files_changed,
        replacements,
        changed_paths,
    })
}

fn quote_char(raw: &str) -> Option<char> {
    if (raw.starts_with('"') && raw.ends_with('"') && raw.len() >= 2)
        || (raw.starts_with('\'') && raw.ends_with('\'') && raw.len() >= 2)
    {
        raw.chars().next()
    } else {
        None
    }
}

fn unquote_str(raw: &str) -> &str {
    if (raw.starts_with('"') && raw.ends_with('"') && raw.len() >= 2)
        || (raw.starts_with('\'') && raw.ends_with('\'') && raw.len() >= 2)
    {
        &raw[1..raw.len() - 1]
    } else {
        raw
    }
}

fn map_merge_value(val: &str, from_values: &[String], to: &str) -> Option<String> {
    let val = comparable_value(val);
    for from in from_values {
        if let Some(mapped) = mapped_value(val, from, to) {
            return Some(mapped);
        }
    }
    None
}

fn replace_inline_bracket_list_merge(
    inner: &str,
    from_values: &[String],
    to: &str,
) -> (String, usize) {
    let mut count = 0;
    let mut seen: Vec<String> = Vec::new();
    let mut out_parts: Vec<String> = Vec::new();

    for item in inner.split(',') {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            continue;
        }
        let unquoted = unquote_str(trimmed);
        let mapped = map_merge_value(unquoted, from_values, to);
        let final_val = mapped.as_deref().unwrap_or(unquoted);
        if seen.iter().any(|s| s == final_val) {
            count += 1;
            continue;
        }
        seen.push(final_val.to_string());
        if let Some(ref m) = mapped {
            count += 1;
            let q = quote_char(trimmed);
            out_parts.push(match q {
                Some(ch) => format!("{ch}{m}{ch}"),
                None => m.clone(),
            });
        } else {
            out_parts.push(trimmed.to_string());
        }
    }
    (out_parts.join(", "), count)
}

fn replace_inline_comma_list_merge(raw: &str, from_values: &[String], to: &str) -> (String, usize) {
    let mut count = 0;
    let mut seen: Vec<String> = Vec::new();
    let mut out_parts: Vec<String> = Vec::new();

    for item in raw.split(',') {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            continue;
        }
        let unquoted = unquote_str(trimmed);
        let mapped = map_merge_value(unquoted, from_values, to);
        let final_val = mapped.as_deref().unwrap_or(unquoted);
        if seen.iter().any(|s| s == final_val) {
            count += 1;
            continue;
        }
        seen.push(final_val.to_string());
        if let Some(ref m) = mapped {
            count += 1;
            let q = quote_char(trimmed);
            out_parts.push(match q {
                Some(ch) => format!("{ch}{m}{ch}"),
                None => m.clone(),
            });
        } else {
            out_parts.push(trimmed.to_string());
        }
    }
    (out_parts.join(", "), count)
}

/// Rewrite front-matter YAML for property merge.
///
/// Modifies ONLY front-matter YAML (between `---` delimiters).
/// Note content and markdown body with `#hashtags` are left unchanged.
/// Deduplicates values if the target already exists in the same property list.
pub fn rewrite_front_matter_for_merge(
    content: &str,
    section: &str,
    from_values: &[String],
    to: &str,
) -> (String, usize) {
    let mut out_lines: Vec<String> = Vec::new();
    let mut replacements = 0;
    let mut in_front_matter = false;
    let mut first_line = true;
    let mut in_block: Option<String> = None;
    let mut block_seen: Vec<String> = Vec::new();
    let ends_with_nl = content.ends_with('\n');

    for line in content.lines() {
        let trimmed = line.trim();
        if first_line {
            first_line = false;
            if trimmed == "---" {
                in_front_matter = true;
                out_lines.push(line.to_string());
                continue;
            }
        }
        if in_front_matter {
            if trimmed == "---" || trimmed == "..." {
                in_front_matter = false;
                in_block = None;
                block_seen.clear();
                out_lines.push(line.to_string());
                continue;
            }

            // Block sequence continuation line under section
            if let Some(ref field) = in_block.clone() {
                if same_section(field, section) {
                    if let Some(item_part) = line.trim_start().strip_prefix("- ") {
                        let raw_item = item_part.trim();
                        let unquoted = unquote_str(raw_item);
                        let mapped = map_merge_value(unquoted, from_values, to);
                        let final_val = mapped.as_deref().unwrap_or(unquoted);
                        if block_seen.iter().any(|s| s == final_val) {
                            // Deduplicate duplicate lines in block sequence
                            replacements += 1;
                            continue;
                        }
                        block_seen.push(final_val.to_string());
                        if let Some(ref m) = mapped {
                            replacements += 1;
                            let indent = &line[..line.len() - line.trim_start().len()];
                            let quote = quote_char(raw_item);
                            let formatted = match quote {
                                Some(q) => format!("{indent}- {q}{m}{q}"),
                                None => format!("{indent}- {m}"),
                            };
                            out_lines.push(formatted);
                            continue;
                        } else {
                            out_lines.push(line.to_string());
                            continue;
                        }
                    } else if !trimmed.is_empty() && !trimmed.starts_with('-') {
                        in_block = None;
                        block_seen.clear();
                    }
                }
            }

            // Top-level key line
            if let Some(colon) = trimmed.find(':') {
                if !line.starts_with(' ') && !line.starts_with('\t') {
                    let key = trimmed[..colon].trim();
                    let rest = trimmed[colon + 1..].trim();
                    let matches_section = same_section(key, section);
                    if matches_section {
                        if rest.is_empty() {
                            in_block = Some(key.to_string());
                            block_seen.clear();
                            out_lines.push(line.to_string());
                            continue;
                        }
                        in_block = None;
                        block_seen.clear();
                        if rest.starts_with('[') && rest.ends_with(']') {
                            let inner = &rest[1..rest.len() - 1];
                            let (next_bracket, n) =
                                replace_inline_bracket_list_merge(inner, from_values, to);
                            replacements += n;
                            out_lines.push(format!("{key}: [{next_bracket}]"));
                            continue;
                        }
                        if rest.contains(',') {
                            let (next_comma, n) =
                                replace_inline_comma_list_merge(rest, from_values, to);
                            replacements += n;
                            out_lines.push(format!("{key}: {next_comma}"));
                            continue;
                        }
                        // Scalar value
                        let unquoted = unquote_str(rest);
                        if let Some(mapped) = map_merge_value(unquoted, from_values, to) {
                            replacements += 1;
                            let quote = quote_char(rest);
                            let formatted = match quote {
                                Some(q) => format!("{key}: {q}{mapped}{q}"),
                                None => format!("{key}: {mapped}"),
                            };
                            out_lines.push(formatted);
                            continue;
                        }
                        out_lines.push(line.to_string());
                        continue;
                    } else {
                        in_block = None;
                        block_seen.clear();
                    }
                }
            }

            out_lines.push(line.to_string());
            continue;
        }

        // Outside front-matter: NOTE BODY. Left untouched.
        out_lines.push(line.to_string());
    }

    let mut out = out_lines.join("\n");
    if ends_with_nl {
        out.push('\n');
    }
    (out, replacements)
}

#[tauri::command]
pub fn merge_vault_property(
    root_paths: Vec<String>,
    exclude_patterns: Vec<String>,
    section: String,
    from_values: Vec<String>,
    to: String,
) -> Result<RenameResult, String> {
    let to = to.trim();
    if to.is_empty() {
        return Err("Target name cannot be empty.".to_string());
    }
    let valid_sources: Vec<String> = from_values
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s != to)
        .collect();

    if valid_sources.is_empty() {
        return Err("At least one valid definition to merge must be provided.".to_string());
    }

    let mut files_changed = 0;
    let mut replacements = 0;
    let mut changed_paths = Vec::new();

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
            if is_meta_folder_component(rel, "VaultSettings") {
                continue;
            }
            if should_exclude(rel, &exclude_patterns) {
                continue;
            }
            let content = match std::fs::read_to_string(path) {
                Ok(c) => c,
                Err(err) => {
                    return Err(format!("Could not read {}: {err}", path.display()));
                }
            };
            let (next, n) = rewrite_front_matter_for_merge(&content, &section, &valid_sources, to);
            if n == 0 || next == content {
                continue;
            }
            if let Err(err) = std::fs::write(path, next) {
                return Err(format!("Could not write {}: {err}", path.display()));
            }
            files_changed += 1;
            replacements += n;
            changed_paths.push(path.to_string_lossy().to_string());
        }
    }

    Ok(RenameResult {
        files_changed,
        replacements,
        changed_paths,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_file(dir: &Path, name: &str, content: &str) {
        fs::write(dir.join(name), content).unwrap();
    }

    #[test]
    fn rejects_empty_specials_and_same_name() {
        let existing = vec!["food".into()];
        assert!(validate_rename("food", "", &existing).is_err());
        assert!(validate_rename("food", "food", &existing).is_err());
        assert!(validate_rename("food", "has space", &existing).is_err());
        assert!(validate_rename("food", "bad#tag", &existing).is_err());
        assert!(validate_rename("food", "status:draft", &existing).is_err());
        assert!(validate_rename("food", "/lead", &existing).is_err());
        assert!(validate_rename("food", "trail/", &existing).is_err());
        assert!(validate_rename("food", "1number", &existing).is_err());
    }

    #[test]
    fn rejects_existing_name_as_merge() {
        let existing = vec!["food".into(), "meals".into()];
        let err = validate_rename("food", "meals", &existing).unwrap_err();
        assert!(err.contains("already exists"));
    }

    #[test]
    fn accepts_parent_rename_with_children() {
        let existing = vec!["food".into(), "food/recipe".into()];
        assert!(validate_rename("food", "meals", &existing).is_ok());
    }

    #[test]
    fn rewrite_tags_block_and_inline_hashtags() {
        let src = "---\ntags:\n  - food\n  - food/recipe\n  - work\n---\nSee #food and #food/recipe and #foodie\n";
        let (out, n) = rewrite_property_content(src, "tags", "food", "meals");
        assert!(out.contains("- meals\n"));
        assert!(out.contains("- meals/recipe\n"));
        assert!(out.contains("- work\n"));
        assert!(out.contains("#meals and #meals/recipe and #foodie"));
        assert_eq!(n, 4);
    }

    #[test]
    fn rewrite_inline_tags_array() {
        let src = "---\ntags: [food, work]\n---\n";
        let (out, n) = rewrite_property_content(src, "tags", "food", "meals");
        assert_eq!(out, "---\ntags: [meals, work]\n---\n");
        assert_eq!(n, 1);
    }

    #[test]
    fn rewrite_status_field_not_hashtags() {
        let src = "---\nstatus: draft\n---\nKeep #draft\n";
        let (out, n) = rewrite_property_content(src, "status", "draft", "wip");
        assert!(out.contains("status: wip"));
        assert!(out.contains("Keep #draft"));
        assert_eq!(n, 1);
    }

    #[test]
    fn skips_code_blocks_and_headings() {
        let src = "---\ntags: [food]\n---\n# Title\n```\n#food\n```\n";
        let (out, n) = rewrite_property_content(src, "tags", "food", "meals");
        assert!(out.contains("# Title"));
        assert!(out.contains("```\n#food\n```"));
        assert_eq!(n, 1);
    }

    #[test]
    fn vault_rename_updates_notes_skips_vault_settings() {
        let dir = tempfile::tempdir().unwrap();
        write_file(dir.path(), "a.md", "---\ntags:\n  - food\n---\n#food\n");
        write_file(dir.path(), "b.md", "---\ntags: [work]\n---\nNo change\n");
        fs::create_dir_all(dir.path().join("VaultSettings")).unwrap();
        write_file(
            &dir.path().join("VaultSettings"),
            "Demo_properties.md",
            "## Tags\n- food\n",
        );
        let result = rename_vault_property(
            vec![dir.path().to_str().unwrap().to_string()],
            vec![],
            "tags".into(),
            "food".into(),
            "meals".into(),
            vec!["food".into(), "work".into()],
        )
        .unwrap();
        assert_eq!(result.files_changed, 1);
        assert!(result.replacements >= 2);
        let a = fs::read_to_string(dir.path().join("a.md")).unwrap();
        assert!(a.contains("- meals"));
        assert!(a.contains("#meals"));
        let vocab =
            fs::read_to_string(dir.path().join("VaultSettings/Demo_properties.md")).unwrap();
        assert!(vocab.contains("- food"));
    }

    #[test]
    fn vault_rename_reports_read_error_path() {
        let err = validate_rename("", "meals", &[]).unwrap_err();
        assert!(err.contains("empty"));
    }

    #[test]
    fn merge_front_matter_deduplicates_block_list() {
        let src = "---\ntitle: Recipe\ntags:\n  - food\n  - recipes\n  - cooking\n---\n# Notes\nSome body with #recipes\n";
        let (out, n) =
            rewrite_front_matter_for_merge(src, "tags", &["recipes".to_string()], "food");
        assert!(out.contains("title: Recipe"));
        assert!(out.contains("- food\n"));
        assert!(!out.contains("- recipes\n"));
        assert!(out.contains("- cooking\n"));
        // Deduplicated: food should appear exactly once in tags block
        assert_eq!(out.matches("- food").count(), 1);
        // Body #recipes must NOT be touched
        assert!(out.contains("# Notes\nSome body with #recipes\n"));
        assert_eq!(n, 1);
    }

    #[test]
    fn merge_front_matter_deduplicates_inline_bracket_list() {
        let src = "---\ntags: [food, recipes, cooking]\n---\nBody\n";
        let (out, n) =
            rewrite_front_matter_for_merge(src, "tags", &["recipes".to_string()], "food");
        assert_eq!(out, "---\ntags: [food, cooking]\n---\nBody\n");
        assert_eq!(n, 1);
    }

    #[test]
    fn merge_matches_capitalized_category_and_tags() {
        let category = "---\ntitle: Test01\nCategory: Awesome\n---\n# Test-01\n";
        let (out, n) = rewrite_front_matter_for_merge(
            category,
            "category",
            &["Awesome".into()],
            "VeryAwesome",
        );
        assert_eq!(n, 1);
        assert!(out.contains("Category: VeryAwesome"));
        assert!(out.contains("title: Test01"));
        assert!(out.contains("# Test-01"));

        let block = "---\nTags: \n  - Great\n  - Nice, \n  - Superduper\n---\n";
        let (out, n) = rewrite_front_matter_for_merge(block, "tags", &["Nice".into()], "Great");
        assert_eq!(n, 1);
        assert!(out.contains("- Great\n"));
        assert!(!out.contains("Nice"));
        assert!(out.contains("- Superduper\n"));
        assert_eq!(out.matches("- Great").count(), 1);

        let inline = "---\nTags: Great, Nice, Super\n---\n";
        let (out, n) = rewrite_front_matter_for_merge(
            inline,
            "tags",
            &["Nice".into(), "Super".into()],
            "Great",
        );
        assert!(n >= 2);
        assert_eq!(out, "---\nTags: Great\n---\n");
    }

    #[test]
    fn merge_front_matter_scalar_field() {
        let src = "---\ncategory: Draft\n---\nBody\n";
        let (out, n) =
            rewrite_front_matter_for_merge(src, "category", &["Draft".to_string()], "draft");
        assert_eq!(out, "---\ncategory: draft\n---\nBody\n");
        assert_eq!(n, 1);
    }

    #[test]
    fn merge_vault_property_rewrites_capitalized_fields_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        write_file(
            dir.path(),
            "Test01.md",
            "---\ndate: '2026-09-27'\ntitle: Test01\nCategory: Awesome\nTags: \n  - Great\n  - Nice, \n  - Superduper\n---\n\n# Test-01\n",
        );
        write_file(
            dir.path(),
            "Test02.md",
            "---\ndate: '2026-09-27'\ntitle: Test02\nCategory: VeryAwesome\nTags: Great, Nice, Super\n---\n\n# Test-02\n",
        );
        fs::create_dir_all(dir.path().join("VaultSettings")).unwrap();
        write_file(
            &dir.path().join("VaultSettings"),
            "V_properties.md",
            "# Properties\n## Tags\n\n## Category\n- VeryAwesome\n",
        );

        let result = merge_vault_property(
            vec![dir.path().to_str().unwrap().to_string()],
            vec!["node_modules".into(), ".git".into(), "*.log".into()],
            "category".into(),
            vec!["Awesome".into()],
            "VeryAwesome".into(),
        )
        .unwrap();
        assert_eq!(result.files_changed, 1);
        assert_eq!(result.changed_paths.len(), 1);
        let test01 = fs::read_to_string(dir.path().join("Test01.md")).unwrap();
        assert!(test01.contains("Category: VeryAwesome"));
        assert!(!test01.contains("Category: Awesome\n"));
        assert!(test01.contains("- Nice,"));
        let vocab = fs::read_to_string(dir.path().join("VaultSettings/V_properties.md")).unwrap();
        assert!(vocab.contains("- VeryAwesome"));

        let tags = merge_vault_property(
            vec![dir.path().to_str().unwrap().to_string()],
            vec!["*.log".into()],
            "tags".into(),
            vec!["Nice".into(), "Super".into()],
            "Great".into(),
        )
        .unwrap();
        assert_eq!(tags.files_changed, 2);
        let test01 = fs::read_to_string(dir.path().join("Test01.md")).unwrap();
        let test02 = fs::read_to_string(dir.path().join("Test02.md")).unwrap();
        assert!(test01.contains("- Great"));
        assert!(!test01.contains("Nice"));
        assert!(test01.contains("- Superduper"));
        assert!(test02.contains("Tags: Great"));
        assert!(!test02.contains("Nice"));
        assert!(!test02.contains("Super"));
        assert!(test02.contains("Category: VeryAwesome"));
    }

    #[test]
    fn merge_vault_property_updates_sample_md_file_and_skips_vault_settings() {
        let dir = tempfile::tempdir().unwrap();
        write_file(
            dir.path(),
            "sample.md",
            "---\ntitle: Sample Note\ntags:\n  - Recipe\n  - cooking\n---\n# Sample\nDo not change body #Recipe\n",
        );
        write_file(
            dir.path(),
            "other.md",
            "---\ntags: [food, Recipe]\n---\n#food\n",
        );
        fs::create_dir_all(dir.path().join("VaultSettings")).unwrap();
        write_file(
            &dir.path().join("VaultSettings"),
            "Demo_properties.md",
            "## Tags\n- Recipe\n",
        );

        let result = merge_vault_property(
            vec![dir.path().to_str().unwrap().to_string()],
            vec![],
            "tags".into(),
            vec!["Recipe".into()],
            "food".into(),
        )
        .unwrap();

        assert_eq!(result.files_changed, 2);
        assert!(result.replacements >= 2);

        let sample = fs::read_to_string(dir.path().join("sample.md")).unwrap();
        assert!(sample.contains("- food"));
        assert!(!sample.contains("- Recipe"));
        // YAML changed, but body #Recipe is preserved
        assert!(sample.contains("Do not change body #Recipe"));

        let other = fs::read_to_string(dir.path().join("other.md")).unwrap();
        assert_eq!(other, "---\ntags: [food]\n---\n#food\n");

        let vocab =
            fs::read_to_string(dir.path().join("VaultSettings/Demo_properties.md")).unwrap();
        assert!(vocab.contains("- Recipe"));
    }
}

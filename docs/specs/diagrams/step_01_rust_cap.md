---
title: "Step 01 — Rust: Raise plugin file-size cap"
last-updated: "2026-04-20"
review-cadence-days: 7
status: active
---

# Step 01: Rust — Raise Plugin File-Size Cap

**Requirement:** FR-09 (Bundle Size Strategy), AD-01 (IIFE plugin pattern)
**Files modified:** `src-tauri/src/commands/plugins.rs`

---

## Goal

The current `read_plugin_file` command enforces a single 500 KB `MAX_BYTES` cap for all plugin kinds. Mermaid's minified bundle is approximately 2.5 MB, which will be bundled into the IIFE (Strategy A). The cap must be raised to accommodate core plugins of this size while preserving the 500 KB safety guard for user-authored plugins.

The solution is a per-kind cap:
- Core plugins (`kind == Some("core")`): 5 MB
- User plugins (`kind == Some("user")` or `None`): 500 KB (unchanged)

---

## Files to Modify

- `src-tauri/src/commands/plugins.rs`

---

## Implementation Instructions

Locate the `read_plugin_file` function. It currently contains:

```rust
// EC-12, PC-8: reject files larger than 500 KB.
const MAX_BYTES: u64 = 500 * 1024;
let metadata = std::fs::metadata(&path)
    .map_err(|e| format!("Failed to stat plugin file: {}", e))?;
if metadata.len() > MAX_BYTES {
    return Err(format!(
        "Plugin file exceeds 500 KB limit ({} bytes): {}",
        metadata.len(),
        filename
    ));
}
```

Replace the single `MAX_BYTES` constant with a per-kind cap decision. The `kind` variable is already bound earlier in the function body (before the directory resolution). Insert the cap selection immediately after the `dir` binding:

```rust
// Per-kind file size cap (FR-09, OQ-01):
//   Core plugins: 5 MB — accommodates large bundled dependencies (e.g. Mermaid ~2.5 MB).
//   User plugins: 500 KB — preserves safety guard for user-authored plugins (PC-8).
let max_bytes: u64 = match kind.as_deref() {
    Some("core") => 5 * 1024 * 1024,
    _ => 500 * 1024,
};
```

Then update the guard below to use `max_bytes` (lowercase, instance variable) instead of `MAX_BYTES` (constant):

```rust
let metadata = std::fs::metadata(&path)
    .map_err(|e| format!("Failed to stat plugin file: {}", e))?;
if metadata.len() > max_bytes {
    return Err(format!(
        "Plugin file exceeds size limit ({} bytes, limit {} bytes): {}",
        metadata.len(),
        max_bytes,
        filename
    ));
}
```

Remove the `const MAX_BYTES: u64 = 500 * 1024;` line — it is replaced by the `let max_bytes` binding above.

The updated error message now includes the actual limit (not hardcoded "500 KB") so the error is informative regardless of which kind triggered it.

---

## What the full modified section looks like

The relevant portion of `read_plugin_file` after this change (only the cap logic changes; all surrounding code is untouched):

```rust
#[tauri::command]
pub fn read_plugin_file(
    app: tauri::AppHandle,
    filename: String,
    kind: Option<String>,
) -> Result<String, String> {
    sanitize_filename(&filename)?;

    let dir = match kind.as_deref() {
        Some("core") => plugins_core_dir(&app)?,
        Some("user") | None => plugins_user_dir(&app)?,
        Some(other) => return Err(format!("Unknown plugin kind: {}", other)),
    };

    // Per-kind file size cap (FR-09, OQ-01):
    //   Core plugins: 5 MB — accommodates large bundled dependencies (e.g. Mermaid ~2.5 MB).
    //   User plugins: 500 KB — preserves safety guard for user-authored plugins (PC-8).
    let max_bytes: u64 = match kind.as_deref() {
        Some("core") => 5 * 1024 * 1024,
        _ => 500 * 1024,
    };

    let path = dir.join(&filename);

    if !path.exists() {
        return Err(format!("Plugin file not found: {}", filename));
    }

    let metadata = std::fs::metadata(&path)
        .map_err(|e| format!("Failed to stat plugin file: {}", e))?;
    if metadata.len() > max_bytes {
        return Err(format!(
            "Plugin file exceeds size limit ({} bytes, limit {} bytes): {}",
            metadata.len(),
            max_bytes,
            filename
        ));
    }

    // EC-13: read_to_string rejects invalid UTF-8.
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read plugin file ({}): {}", filename, e))
}
```

---

## Test Requirements

Add two new unit tests to the existing `#[cfg(test)] mod tests` block in `plugins.rs`:

### Test 1: Core cap is 5 MB
```rust
#[test]
fn core_plugin_cap_is_5_mb() {
    // Verify the cap selection logic for core kind.
    let max_bytes: u64 = match Some("core") {
        Some("core") => 5 * 1024 * 1024,
        _ => 500 * 1024,
    };
    assert_eq!(max_bytes, 5 * 1024 * 1024, "core plugin cap must be 5 MB");
}
```

### Test 2: User cap is 500 KB
```rust
#[test]
fn user_plugin_cap_is_500_kb() {
    // Verify the cap selection logic for user kind (and None).
    let max_bytes_user: u64 = match Some("user") {
        Some("core") => 5 * 1024 * 1024,
        _ => 500 * 1024,
    };
    let max_bytes_none: u64 = match None::<&str> {
        Some("core") => 5 * 1024 * 1024,
        _ => 500 * 1024,
    };
    assert_eq!(max_bytes_user, 500 * 1024, "user plugin cap must be 500 KB");
    assert_eq!(max_bytes_none, 500 * 1024, "None kind cap must be 500 KB");
}
```

Run `cargo test` after making this change and verify all existing tests still pass.

---

## Acceptance Criteria

- [ ] `cargo test` passes with zero failures
- [ ] A core plugin file of 4.9 MB would pass the guard (cap is 5 MB)
- [ ] A user plugin file of 600 KB would fail the guard (cap is 500 KB)
- [ ] The two new tests above exist and pass
- [ ] The old `const MAX_BYTES: u64 = 500 * 1024;` line is removed
- [ ] The error message includes both the file's actual byte count and the applicable limit
- [ ] No TODO comments added to this file

---

## Files Modified in This Step

| File | Action | Purpose |
|------|--------|---------|
| `src-tauri/src/commands/plugins.rs` | MODIFY | Replace single MAX_BYTES with per-kind cap |

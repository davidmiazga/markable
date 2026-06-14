---
title: "Step 04 — Rust read_folder_icon_map + Bridge Wrapper"
last-updated: "2026-06-05"
review-cadence-days: 14
status: active
---

# Step 04 — Rust `read_folder_icon_map` + Bridge Wrapper

## Goal

Add the **one** new Tauri command this feature requires: a batch reader
that returns the `icon:` value from each `_folder.md` in a path list,
without round-tripping each file through the JS bridge. Expose it as a
typed `FileResult` wrapper in `src/lib/bridge.ts`.

This step is the only Rust change in the **catalog/path map** pipeline.

**Amendment 2026-06-05.** No functional change required for the
custom-SVG amendment. The Rust command returns the raw string
verbatim — catalog iconIds and absolute paths flow through
identically. The TS side interprets via `interpretIconValue()`
(step_01). One small test addition: cover path-shaped values with
spaces/unicode (EC-22) to prove the reader does not truncate or
transform them.

**Note: if step_05 needs a `stat_file` command for the custom-SVG
cache (FR-17),** add it here as a sibling of `read_folder_icon_map`
in this same module (or in a new `commands/files.rs` block — Lead
Developer's choice). The window-size invariant precaution
(`src-tauri/src/lib.rs`) still applies — see WARNING below.

## Inputs

- Requirements: FR-6, FR-11, NFR-2 (no render-path file I/O).
- Constraint: C-4 (typed bridge wrapper), C-7 (vault index extension,
  not a side channel — note: we are NOT extending the vault index
  payload itself; the icon map is computed on-demand by the render
  path. C-7's "single source of truth" principle still holds because
  the icon source is `_folder.md`, period).
- Existing precedent for similar batch reads: `vault.rs`'s
  `index_file()` reads the first `FRONT_MATTER_MAX_BYTES = 4096` bytes
  to parse front matter without loading the whole file.

## Files

| Action | File |
|---|---|
| Create | `src-tauri/src/commands/folder_icon.rs` |
| Edit | `src-tauri/src/commands/mod.rs` (add `pub mod folder_icon;`) |
| Edit | `src-tauri/src/lib.rs` (register `read_folder_icon_map` in `invoke_handler!`). **No window-size code is touched.** |
| Edit | `src/lib/bridge.ts` (add `readFolderIconMap`) |
| Create | `tests/folder-icons/bridge-icon-map.test.ts` |

## Rust API

```rust
// src-tauri/src/commands/folder_icon.rs
//! Batch reader for the `icon:` field in _folder.md files.
//!
//! Returns one entry per input path: (path, Some(value) | None). A
//! None result indicates: file missing, read failed, no frontmatter,
//! or no `icon:` key. The whole batch never fails — individual file
//! errors are silently coerced to None so the renderer can degrade
//! gracefully (NFR-1).

use std::fs::File;
use std::io::Read;

/// Maximum bytes read per file. Frontmatter is bounded; matches
/// FRONT_MATTER_MAX_BYTES in vault.rs.
const MAX_BYTES: usize = 4096;

/// Tauri command. Parameters are camelCased on the JS side.
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

/// Read the `icon:` value from a single _folder.md. Returns None on
/// any error or absence.
fn read_icon_from_file(path: &str) -> Option<String> {
    let mut f = File::open(path).ok()?;
    let mut buf = [0u8; MAX_BYTES];
    let n = f.read(&mut buf).ok()?;
    let text = std::str::from_utf8(&buf[..n]).ok()?;

    let mut lines = text.lines();
    // First non-empty line must be exactly "---".
    let first = lines.next()?.trim();
    if first != "---" {
        return None;
    }

    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            return None; // closing delim reached without seeing icon
        }
        if let Some(rest) = trimmed.strip_prefix("icon:") {
            let val = rest.trim();
            if val.is_empty() { return None; }
            // Strip surrounding double-quotes, mirror TS writer's quoting.
            let unquoted = if val.starts_with('"') && val.ends_with('"') && val.len() >= 2 {
                val[1..val.len()-1].replace("\\\"", "\"")
            } else {
                val.to_string()
            };
            return Some(unquoted);
        }
    }
    None
}

// ── Unit tests ────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

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
        let p = write_tmp(dir.path(), "_folder.md", "---\nlayout: bookshelf\n---\n");
        let r = read_folder_icon_map(vec![p]).await.unwrap();
        assert!(r[0].1.is_none());
    }

    #[tokio::test]
    async fn returns_none_for_malformed_frontmatter() {
        let dir = tempdir().unwrap();
        let p = write_tmp(dir.path(), "_folder.md", "icon: book\nno frontmatter");
        let r = read_folder_icon_map(vec![p]).await.unwrap();
        assert!(r[0].1.is_none());
    }

    #[tokio::test]
    async fn mixed_batch_preserves_order_and_does_not_fail() {
        let dir = tempdir().unwrap();
        let good = write_tmp(dir.path(), "good.md", "---\nicon: lightbulb\n---\n");
        let bad  = "/nonexistent/_folder.md".to_string();
        let r = read_folder_icon_map(vec![good.clone(), bad.clone()]).await.unwrap();
        assert_eq!(r[0].0, good);
        assert_eq!(r[0].1, Some("lightbulb".to_string()));
        assert_eq!(r[1].0, bad);
        assert!(r[1].1.is_none());
    }

    #[tokio::test]
    async fn strips_surrounding_double_quotes() {
        let dir = tempdir().unwrap();
        let p = write_tmp(dir.path(), "_folder.md", "---\nicon: \"book\"\n---\n");
        let r = read_folder_icon_map(vec![p]).await.unwrap();
        assert_eq!(r[0].1, Some("book".to_string()));
    }

    #[tokio::test]
    async fn returns_path_value_with_spaces_and_unicode() {
        // EC-22: path-shaped values (used by custom-SVG amendment) must
        // round-trip through the reader byte-identical. The value will
        // typically be quoted on the writer side (step_03); the reader
        // strips surrounding quotes. Whitespace and unicode chars must
        // survive.
        let dir = tempdir().unwrap();
        let p = write_tmp(
            dir.path(),
            "_folder.md",
            "---\nicon: \"/Users/dave/My Icons/café.svg\"\n---\n",
        );
        let r = read_folder_icon_map(vec![p]).await.unwrap();
        assert_eq!(r[0].1, Some("/Users/dave/My Icons/café.svg".to_string()));
    }

    #[tokio::test]
    async fn empty_string_value_returns_none() {
        let dir = tempdir().unwrap();
        let p = write_tmp(dir.path(), "_folder.md", "---\nicon: \n---\n");
        let r = read_folder_icon_map(vec![p]).await.unwrap();
        assert!(r[0].1.is_none());
    }
}
```

## Registration

```rust
// src-tauri/src/commands/mod.rs
pub mod folder_icon;
```

```rust
// src-tauri/src/lib.rs
// inside the .invoke_handler(tauri::generate_handler![...]) macro list,
// add:
crate::commands::folder_icon::read_folder_icon_map,
```

> **WARNING — Window-size invariant.** `src-tauri/src/lib.rs` contains
> the `setup()` window-sizing hook (the `50% × 80%` invariant from
> CLAUDE.md). When editing this file, change **only** the
> `invoke_handler!` list. Verify after editing:
>
> ```bash
> npm run test:run -- tests/settings/window-defaults.test.ts
> ```

## TS bridge wrapper

```typescript
// src/lib/bridge.ts

/**
 * Batch-read the `icon:` field from a list of _folder.md absolute paths.
 *
 * Returns one [path, value] entry per input, preserving order. value is
 * the literal string from the frontmatter (no catalog validation — that
 * happens in getFolderIconClass at render time), or null when the file
 * is missing/malformed or has no icon key.
 *
 * Used by buildFolderIconMap() during renderTreeContent. The batch is
 * one round-trip; individual file errors are silently coerced to null.
 */
export async function readFolderIconMap(
  paths: string[],
): Promise<FileResult<Array<[string, string | null]>>> {
  try {
    const v = await invoke<Array<[string, string | null]>>(
      "read_folder_icon_map",
      { paths },
    );
    return { ok: true, value: v };
  } catch (error) {
    const message = typeof error === "string" ? error : String(error);
    return {
      ok: false,
      error: { message, command: "read_folder_icon_map" } satisfies TauriCommandError,
    };
  }
}
```

## Failing test (write FIRST — Red)

```typescript
// tests/folder-icons/bridge-icon-map.test.ts
import { describe, it, expect, vi } from "vitest";
import * as core from "@tauri-apps/api/core";
import { readFolderIconMap } from "../../src/lib/bridge";

describe("bridge.readFolderIconMap (step_04)", () => {
  it("forwards the paths array to the Rust command and returns the typed result", async () => {
    const spy = vi.spyOn(core, "invoke").mockResolvedValue([
      ["/v/A/_folder.md", "book"],
      ["/v/B/_folder.md", null],
    ] as any);
    const r = await readFolderIconMap(["/v/A/_folder.md", "/v/B/_folder.md"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value[0]).toEqual(["/v/A/_folder.md", "book"]);
      expect(r.value[1]).toEqual(["/v/B/_folder.md", null]);
    }
    expect(spy).toHaveBeenCalledWith("read_folder_icon_map", {
      paths: ["/v/A/_folder.md", "/v/B/_folder.md"],
    });
  });

  it("returns ok=false with the error message when invoke throws", async () => {
    vi.spyOn(core, "invoke").mockRejectedValue("boom");
    const r = await readFolderIconMap([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe("boom");
  });
});
```

## Green

1. Implement `folder_icon.rs`.
2. Wire it into `commands/mod.rs` and `lib.rs`'s `invoke_handler!`.
3. Add the `readFolderIconMap` wrapper to `bridge.ts`.
4. Run `cargo test` from `src-tauri/` — all 6 inline tests pass.
5. Run `npm run test:run -- tests/folder-icons/bridge-icon-map.test.ts`
   — passes.
6. Run `npm run test:run -- tests/settings/window-defaults.test.ts` —
   passes (window invariant intact, NFR-5).

## Refactor

- Cap `paths.len()` defensively? Not needed — the caller is the render
  path and `_folder.md` count is bounded by the vault index, which is
  itself capped (`VaultEntry.maxIndexSize`, default 500).
- Add tracing/log? Skip for MVP. Add later only if debugging proves
  it's needed.

## Definition of Done

- [ ] `cargo test` from `src-tauri/` passes (including the 6 new
      inline tests).
- [ ] `npm run test:run -- tests/folder-icons/bridge-icon-map.test.ts`
      passes.
- [ ] `npm run test:run -- tests/settings/window-defaults.test.ts`
      passes (window invariant — EC-15).
- [ ] `src-tauri/src/lib.rs` diff shows **only** the `invoke_handler!`
      list change. No window-size code touched.
- [ ] `npm run build:plugins && npm run sync:plugins` (C-8) — not
      strictly required for this step (no `src/plugins` changes), but
      run defensively.

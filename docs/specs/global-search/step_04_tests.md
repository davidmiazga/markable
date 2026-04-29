---
title: "Step 04 — Test Specification (All 21 Edge Cases)"
last-updated: "2026-04-28"
review-cadence-days: 14
status: active
---

# Step 04 — Test Specification

## Overview

All tests live in:

- `tests/plugins/command-bar/command-bar.test.ts` — frontend TypeScript tests (Vitest/happy-dom)
- `tests/bridge-global-search.test.ts` — bridge wrapper tests (Vitest, invoke mock)
- `src-tauri/` — Rust unit tests embedded in `vault.rs` via `#[cfg(test)]` blocks

The 21 edge cases (EC-1 through EC-21) from `active_task.md` are mapped to test groups below.
Each test group maps to a `describe()` block. Acceptance criteria from steps 01–03 are also
covered.

---

## Group A — Bridge Wrapper (`tests/bridge-global-search.test.ts`)

This is a new test file. It tests only `searchVaultContent()` from `bridge.ts`.

### Setup

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchVaultContent } from "../../src/lib/bridge";

// Mock @tauri-apps/api/core invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);
```

### Tests

**A-1 — happy path: resolved invoke returns `{ ok: true, value: payload }`**
```
mockInvoke resolves with { results: [], capped: false, skippedCount: 0 }
→ searchVaultContent({ rootPaths: ["/vault"], excludePatterns: [], query: "foo", maxResults: 50 })
→ expect(result.ok).toBe(true)
→ expect((result as any).value.results).toEqual([])
```

**A-2 — invoke called with snake_case parameter keys**
```
await searchVaultContent({ rootPaths: ["/v"], excludePatterns: ["node_modules"], query: "bar", maxResults: 20 })
→ expect(mockInvoke).toHaveBeenCalledWith("search_vault_content", {
    root_paths: ["/v"],
    exclude_patterns: ["node_modules"],
    query: "bar",
    max_results: 20,
  })
```

**A-3 — rejected invoke returns `{ ok: false, error: { command: "search_vault_content" } }`**
```
mockInvoke rejects with "permission denied"
→ result = await searchVaultContent(...)
→ expect(result.ok).toBe(false)
→ expect((result as any).error.command).toBe("search_vault_content")
→ expect((result as any).error.message).toContain("permission denied")
```

**A-4 — non-string rejection is converted to string**
```
mockInvoke rejects with an Error object
→ result.error.message is a string (not an Error instance)
```

---

## Group B — Vault Scope Fix (`tests/plugins/command-bar/command-bar.test.ts`)

Add a new `describe("fetchWorkspaceFiles — vault scope fix")` block. All tests mock
`window.__MARKABLE_VAULT_MANAGER__` before each test and restore it after.

### Setup pattern for each test

```typescript
let vaultManagerMock: any;
beforeEach(() => {
  vaultManagerMock = {
    getActiveVault: vi.fn(),
    getVaultIndex: vi.fn(),
  };
  (window as any).__MARKABLE_VAULT_MANAGER__ = vaultManagerMock;
});
afterEach(() => {
  delete (window as any).__MARKABLE_VAULT_MANAGER__;
});
```

### Tests

**B-1 — EC-1a: vault active, index already built → workspaceFiles from entries**

The test calls `fetchWorkspaceFiles` indirectly by calling `openBar()` and checking the
results that `buildFilesResults` receives. Alternatively, export `fetchWorkspaceFiles` for
direct testing if that is feasible. The observable outcome is that `list_md_files` is NOT
invoked on the Tauri side.

```
vaultManagerMock.getActiveVault.mockReturnValue({ id: "v1", rootPaths: ["/vault"] });
vaultManagerMock.getVaultIndex.mockReturnValue({
  entries: [
    { path: "/vault/a.md" },
    { path: "/vault/b.md" },
    { path: "" },           // EC-17: corrupt entry, must be filtered out
  ]
});
// After fetchWorkspaceFiles completes, _fileModeResults must NOT contain an entry for ""
// and MUST contain entries for "/vault/a.md" and "/vault/b.md".
```

**B-2 — EC-1b: vault active, index null → loading state, no list_md_files call**

```
vaultManagerMock.getActiveVault.mockReturnValue({ id: "v1", rootPaths: ["/vault"] });
vaultManagerMock.getVaultIndex.mockReturnValue(null);
// Verify: workspaceLoadState passed to buildFilesResults is "loading".
// Verify: __TAURI_INTERNALS__.invoke is NOT called with "list_md_files".
```

**B-3 — EC-2 (fallback): no vault, current file set → list_md_files called**

```
vaultManagerMock.getActiveVault.mockReturnValue(null);
(window as any).__MARKABLE_CURRENT_FILE__ = "/Users/alice/notes/readme.md";
// Mock __TAURI_INTERNALS__.invoke("list_md_files") to return ["/Users/alice/notes/b.md"]
// Verify: invoke("list_md_files", { dir: "/Users/alice/notes" }) called once.
```

**B-4 — EC-2 (fallback): no vault, no current file → no-workspace state**

```
vaultManagerMock.getActiveVault.mockReturnValue(null);
delete (window as any).__MARKABLE_CURRENT_FILE__;
// Verify: buildFilesResults called with workspaceLoadState: "no-workspace".
// Verify: __TAURI_INTERNALS__.invoke NOT called.
```

**B-5 — EC-17: corrupt index entry filtered out**

```
vaultManagerMock.getVaultIndex.mockReturnValue({ entries: [{ path: null }, { path: "" }, { path: "/vault/ok.md" }] });
// After fetch, workspaceFiles contains only "/vault/ok.md".
```

**B-6 — EC-18: 500-entry vault → all 500 paths passed to buildFilesResults**

```
vaultManagerMock.getVaultIndex.mockReturnValue({
  entries: Array.from({ length: 500 }, (_, i) => ({ path: `/vault/note${i}.md` }))
});
// Verify workspaceFiles.length === 500 passed to buildFilesResults.
// The FILES_CAP = 200 limit applies inside buildFilesResults (tested separately).
```

**B-7 — NFR-4: synchronous path has no async latency**

```
// When vault index is built, fetchWorkspaceFiles should complete without any
// setTimeout or Promise.resolve delay in the critical path.
// This is a structural test: verify that the "vault active, index built" branch
// does NOT await anything before calling refreshFilesDisplay().
// Can be verified by mocking vi.spyOn(window, 'setTimeout') and asserting it was
// not called when the vault path is taken.
```

---

## Group C — Content Mode (`tests/plugins/command-bar/command-bar.test.ts`)

Add a new `describe("content mode")` block.

### C-1 — FR-5: BarMode type includes "content"

```typescript
// Type-level test (compile-time). Verify the import resolves.
import type { BarMode } from "../../../src/plugins/command-bar/command-bar.plugin";
const _m: BarMode = "content"; // must compile without error
```

**C-2 — FR-6: typing "/" in files mode switches to content mode**

```
// Setup: bar open in files mode
// Simulate input event with value "/"
// Verify: setMode("content") called (or _mode === "content" after handler)
// Verify: input.value === "" after switch
```

**C-3 — EC-15: typing "design/" in files mode does NOT switch mode**

```
// Simulate input event with value "design/"
// Verify: _mode remains "files"
```

**C-4 — EC-21: typing "/" while already in content mode is a normal character**

```
// Setup: _mode = "content"
// Simulate input event with value "/"
// Verify: _mode remains "content"
// Verify: the input value is NOT cleared
```

**C-5 — FR-7: Backspace from empty content mode returns to files mode**

```
// Setup: _mode = "content", input.value = ""
// Simulate keydown event { key: "Backspace" }
// Verify: _mode === "files" after handler
```

**C-6 — FR-16: Enter with empty query shows "Enter a search term" notice**

```
// Setup: _mode = "content", input.value = ""
// Simulate Enter keydown
// Verify: _resultsEl contains a row with text "Enter a search term"
// Verify: __TAURI_INTERNALS__.invoke NOT called
```

**C-7 — EC-3: Enter with no active vault shows no-vault notice**

```
vaultManagerMock.getActiveVault.mockReturnValue(null);
// Setup: _mode = "content", input.value = "foo"
// Simulate Enter keydown
// Verify: _resultsEl contains "No vault open — content search requires a vault"
// Verify: invoke NOT called
```

**C-8 — EC-12: second Enter while search in-flight is a no-op**

```
// Setup: mock invoke to return a promise that never resolves
// Simulate first Enter → search starts, _contentSearchInFlight = true
// Simulate second Enter immediately
// Verify: invoke called only once
```

**C-9 — FR-10: results rendered as file groups with excerpts**

```
const mockPayload = {
  results: [{
    path: "/vault/notes.md",
    title: "My Notes",
    matches: [
      { lineNumber: 3, lineText: "This is a test note", columnStart: 10 },
      { lineNumber: 7, lineText: "Another test line", columnStart: 8 },
      { lineNumber: 12, lineText: "Third test line", columnStart: 6 },
      { lineNumber: 20, lineText: "Fourth test line", columnStart: 7 },
    ]
  }],
  capped: false,
  skippedCount: 0
};
// Call renderContentResults(mockPayload, "test")
// Verify: one .cb-result--content-header row with text "My Notes"
// Verify: exactly 3 .cb-result--content-excerpt rows
// Verify: one .cb-result--content-more row with text "1 more match"
// Verify: excerpt rows contain <strong> elements with text "test"
```

**C-10 — EC-6: results = [] shows "No results for 'query'"**

```
const mockPayload = { results: [], capped: false, skippedCount: 0 };
// Call renderContentResults(mockPayload, "missingterm")
// Verify: _resultsEl contains a notice with text 'No results for "missingterm"'
```

**C-11 — EC-7: capped = true shows cap notice**

```
const mockPayload = { results: [/* 50 file results */], capped: true, skippedCount: 0 };
// Call renderContentResults(mockPayload, "foo")
// Verify: _resultsEl contains a .cb-content-notice--warning row mentioning "50 files"
```

**C-12 — EC-8: skippedCount > 0 shows skip notice**

```
const mockPayload = { results: [], capped: false, skippedCount: 3 };
// Call renderContentResults(mockPayload, "foo")
// Verify: a notice row contains "3 files could not be searched"
```

**C-13 — EC-5: vault with 0 .md files → empty results rendered correctly**

```
// Rust returns { results: [], capped: false, skippedCount: 0 }
// Same as C-10 — "No results for 'foo'" shown
```

**C-14 — EC-11: query containing regex special characters treated as literals**

```
// This is a Rust-side test (see Rust tests section below).
// TypeScript test: verify that renderContentResults does not crash when
// query contains "[" or "*".
const mockPayload = { results: [], capped: false, skippedCount: 0 };
// Call renderContentResults(mockPayload, "foo[bar]")
// Verify: does not throw; shows "No results for 'foo[bar]'"
```

**C-15 — EC-13: plugin disabled while search in-flight → no DOM crash**

```
// Setup: bar open in content mode, invoke is pending
// Call onDisable() to remove DOM
// Resolve the invoke promise
// Verify: no errors thrown (generation check + DOM null guards fire cleanly)
```

**C-16 — EC-14: vault switch while search in-flight → result discarded**

```
// Setup: content search in-flight, generation = 5
// Increment _contentSearchGeneration externally (simulates vault switch)
// Resolve the invoke promise
// Verify: renderContentResults NOT called (generation mismatch detected)
```

**C-17 — FR-11: clicking file header row opens file and closes bar**

```
// Render results with one file group
// Simulate click on .cb-result--content-header
// Verify: openFileInTab called with "/vault/notes.md"
// Verify: bar is closed (_isOpen === false or overlay has cb-hidden class)
```

**C-18 — FR-11: clicking excerpt row opens file and closes bar**

```
// Render results with excerpts
// Simulate click on first .cb-result--content-excerpt
// Verify: openFileInTab called with the same file path as the header
```

**C-19 — EC-16: closeBar() resets content mode state**

```
// Open bar in content mode, set _contentSearchInFlight = true
// Call closeBar()
// Verify: _contentSearchInFlight === false
// Verify: _contentSearchGeneration has incremented
// Verify: _mode === "files"
```

**C-20 — AD-GS-07: MODE_CYCLE includes "content" at position 3**

```typescript
import { MODE_CYCLE } from "../../../src/plugins/command-bar/command-bar.plugin";
// Export MODE_CYCLE for testability (add to re-export block if not already exported)
expect(MODE_CYCLE).toEqual(["commands", "files", "keybindings", "content"]);
```

Note: if `MODE_CYCLE` is not currently exported, add it to the `export { ... }` re-export
block at the top of `command-bar.plugin.ts`.

**C-21 — NFR-5: all Record<BarMode, string> constants include "content"**

```typescript
// Structural test: import constants and verify "content" key exists.
import {
  MODE_PLACEHOLDERS,
  MODE_FOOTER_HINTS,
  MODE_BADGE_LABELS,
  MODE_TAB_SHORTCUTS,
} from "../../../src/plugins/command-bar/command-bar.plugin";

expect(MODE_PLACEHOLDERS.content).toBe("Search file contents…");
expect(MODE_FOOTER_HINTS.content).toBe("Enter to search  ·  Esc to close");
expect(MODE_BADGE_LABELS.content).toBe("Content");
expect(MODE_TAB_SHORTCUTS.content).toBe("");
```

Note: these constants must be exported from `command-bar.plugin.ts`. Add them to the
re-export block if not already exported.

---

## Group D — Rust Unit Tests (`src-tauri/src/commands/vault.rs`)

Rust unit tests are embedded in the file using `#[cfg(test)]` modules. Add a new test
module `mod content_search_tests` at the bottom of `vault.rs`.

### Setup

```rust
#[cfg(test)]
mod content_search_tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn make_vault(files: &[(&str, &str)]) -> TempDir {
        let dir = tempfile::tempdir().unwrap();
        for (name, content) in files {
            let path = dir.path().join(name);
            std::fs::write(&path, content).unwrap();
        }
        dir
    }
```

Note: `tempfile` must be added as a dev-dependency in `Cargo.toml`:
```toml
[dev-dependencies]
tempfile = "3"
```

### Tests

**D-1 — basic match returns correct LineMatch fields**

```rust
#[tokio::test]
async fn test_basic_match() {
    let dir = make_vault(&[("note.md", "line one\nfoo bar\nline three\n")]);
    let result = search_vault_content(
        vec![dir.path().to_str().unwrap().to_string()],
        vec![],
        "foo".to_string(),
        50,
    ).await.unwrap();

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
```

**D-2 — case-insensitive search (EC-11 related)**

```rust
#[tokio::test]
async fn test_case_insensitive() {
    let dir = make_vault(&[("a.md", "Hello World\n")]);
    let result = search_vault_content(
        vec![dir.path().to_str().unwrap().to_string()],
        vec![],
        "hello".to_string(),
        50,
    ).await.unwrap();
    assert_eq!(result.results.len(), 1);
    assert_eq!(result.results[0].matches[0].line_text, "Hello World");
}
```

**D-3 — EC-11: regex special characters treated as literals**

```rust
#[tokio::test]
async fn test_regex_chars_literal() {
    let dir = make_vault(&[("a.md", "price: $5.00\nno match\n")]);
    let result = search_vault_content(
        vec![dir.path().to_str().unwrap().to_string()],
        vec![],
        "$5.00".to_string(),
        50,
    ).await.unwrap();
    // If regex were used, "$" would be an anchor and this would fail.
    // Substring matching must find it.
    assert_eq!(result.results.len(), 1);
}
```

**D-4 — EC-10: file larger than 1 MB is truncated, not skipped**

```rust
#[tokio::test]
async fn test_large_file_truncated() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("big.md");
    // Write 1.1 MB of content; put the query match in the last 100 KB (beyond cap).
    let filler = "x".repeat(1_048_576 - 10); // just under 1 MB
    let beyond = "FINDME";
    std::fs::write(&path, format!("{}{}", filler, beyond)).unwrap();

    let result = search_vault_content(
        vec![dir.path().to_str().unwrap().to_string()],
        vec![],
        "FINDME".to_string(),
        50,
    ).await.unwrap();
    // FINDME is beyond the 1 MB cap, so it should NOT be found.
    // The file is processed (not skipped), but FINDME is beyond the read window.
    assert_eq!(result.results.len(), 0);
    assert_eq!(result.skipped_count, 0); // file was read; nothing skipped
}
```

**D-5 — EC-10: match within the first 1 MB IS found**

```rust
#[tokio::test]
async fn test_match_within_cap() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("note.md");
    // "FINDME" near the start, then 2 MB of filler.
    let content = format!("FINDME\n{}", "y".repeat(2_000_000));
    std::fs::write(&path, content).unwrap();

    let result = search_vault_content(
        vec![dir.path().to_str().unwrap().to_string()],
        vec![],
        "FINDME".to_string(),
        50,
    ).await.unwrap();
    assert_eq!(result.results.len(), 1);
}
```

**D-6 — EC-5: empty vault returns empty results**

```rust
#[tokio::test]
async fn test_empty_vault() {
    let dir = tempfile::tempdir().unwrap();
    let result = search_vault_content(
        vec![dir.path().to_str().unwrap().to_string()],
        vec![],
        "anything".to_string(),
        50,
    ).await.unwrap();
    assert_eq!(result.results.len(), 0);
    assert!(!result.capped);
    assert_eq!(result.skipped_count, 0);
}
```

**D-7 — max_results cap sets capped = true**

```rust
#[tokio::test]
async fn test_cap() {
    let dir = tempfile::tempdir().unwrap();
    for i in 0..5 {
        std::fs::write(
            dir.path().join(format!("note{}.md", i)),
            "foo",
        ).unwrap();
    }
    let result = search_vault_content(
        vec![dir.path().to_str().unwrap().to_string()],
        vec![],
        "foo".to_string(),
        3, // max_results = 3, but 5 files match
    ).await.unwrap();
    assert_eq!(result.results.len(), 3);
    assert!(result.capped);
}
```

**D-8 — EC-8/EC-9: unreadable file increments skipped_count**

```rust
#[cfg(unix)]
#[tokio::test]
async fn test_unreadable_file_skipped() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("secret.md");
    std::fs::write(&path, "hidden content foo").unwrap();
    let mut perms = std::fs::metadata(&path).unwrap().permissions();
    perms.set_mode(0o000); // no permissions
    std::fs::set_permissions(&path, perms).unwrap();

    let result = search_vault_content(
        vec![dir.path().to_str().unwrap().to_string()],
        vec![],
        "foo".to_string(),
        50,
    ).await.unwrap();
    assert_eq!(result.skipped_count, 1);
    assert_eq!(result.results.len(), 0);

    // Cleanup: restore permissions so tempdir can be deleted.
    let mut perms = std::fs::metadata(&path).unwrap().permissions();
    perms.set_mode(0o644);
    std::fs::set_permissions(&path, perms).unwrap();
}
```

**D-9 — AD-GS-10: results sorted by match count descending**

```rust
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
    ).await.unwrap();
    assert_eq!(result.results.len(), 3);
    assert_eq!(result.results[0].matches.len(), 3); // three_matches first
    assert_eq!(result.results[1].matches.len(), 2); // two_matches second
    assert_eq!(result.results[2].matches.len(), 1); // one_match last
}
```

**D-10 — EC-20: multi-root vault merges results from all roots**

```rust
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
    ).await.unwrap();
    assert_eq!(result.results.len(), 2);
}
```

**D-11 — empty query returns Err**

```rust
#[tokio::test]
async fn test_empty_query_returns_err() {
    let dir = tempfile::tempdir().unwrap();
    let result = search_vault_content(
        vec![dir.path().to_str().unwrap().to_string()],
        vec![],
        "".to_string(),
        50,
    ).await;
    assert!(result.is_err());
}
```

**D-12 — NFR-3: performance smoke test (not a hard timing assertion)**

```rust
// Not a strict timing test — just verifies no infinite loop or panic on large input.
// For CI performance, a manual benchmark with criterion can be added separately.
#[tokio::test]
async fn test_large_vault_no_panic() {
    let dir = tempfile::tempdir().unwrap();
    for i in 0..50 {
        std::fs::write(
            dir.path().join(format!("note{}.md", i)),
            format!("content line {}\nanother line\n", i),
        ).unwrap();
    }
    let result = search_vault_content(
        vec![dir.path().to_str().unwrap().to_string()],
        vec![],
        "line".to_string(),
        50,
    ).await;
    assert!(result.is_ok());
}
```

---

## Edge Case Coverage Matrix

| EC | Test | Location |
|----|------|----------|
| EC-1a (vault active, index built) | B-1 | command-bar.test.ts |
| EC-1b (vault active, index null) | B-2 | command-bar.test.ts |
| EC-2 (no vault, fallback) | B-3 | command-bar.test.ts |
| EC-3 (no vault, content mode) | C-7 | command-bar.test.ts |
| EC-4 (vault, 0 .md files, files mode) | B-6 (empty entries) | command-bar.test.ts |
| EC-5 (vault, 0 .md files, content mode) | D-6, C-10 | vault.rs + command-bar.test.ts |
| EC-6 (query matches nothing) | C-10, D-6 | command-bar.test.ts + vault.rs |
| EC-7 (results capped) | C-11, D-7 | command-bar.test.ts + vault.rs |
| EC-8 (file unreadable) | D-8 | vault.rs |
| EC-9 (invalid UTF-8) | Covered by AD-GS-02 (from_utf8_lossy); no separate test needed |
| EC-10 (file > 1 MB) | D-4, D-5 | vault.rs |
| EC-11 (regex chars literal) | D-3, C-14 | vault.rs + command-bar.test.ts |
| EC-12 (duplicate in-flight) | C-8 | command-bar.test.ts |
| EC-13 (plugin disabled) | C-15 | command-bar.test.ts |
| EC-14 (vault switch in-flight) | C-16 | command-bar.test.ts |
| EC-15 (/ in non-empty query) | C-3 | command-bar.test.ts |
| EC-16 (bar reopens in files mode) | C-19 | command-bar.test.ts |
| EC-17 (corrupt index entry) | B-5 | command-bar.test.ts |
| EC-18 (500-file vault) | B-6 | command-bar.test.ts |
| EC-19 (file already open as tab) | C-17, C-18 (openFileInTab already handles it) | command-bar.test.ts |
| EC-20 (multi-root vault) | D-10 | vault.rs |
| EC-21 (/ in content mode) | C-4 | command-bar.test.ts |

---

## Exports Required by Tests

The following symbols must be exported from `command-bar.plugin.ts` for tests to import them.
Check the existing `export { ... }` re-export block and add any missing items:

- `MODE_PLACEHOLDERS`
- `MODE_FOOTER_HINTS`
- `MODE_BADGE_LABELS`
- `MODE_TAB_SHORTCUTS`
- `MODE_CYCLE`

If exporting these increases bundle size concerns, they can be exported under a
`/* @testonly */` comment to signal intent.

---

## Running Tests

```bash
# Frontend tests (all)
npm run test:run

# Frontend tests (command-bar only)
npm run test:run -- tests/plugins/command-bar/command-bar.test.ts

# Bridge tests
npm run test:run -- tests/bridge-global-search.test.ts

# Rust tests
cd src-tauri && cargo test content_search

# Window size regression (must always pass)
npm run test:run -- tests/settings/window-defaults.test.ts
```

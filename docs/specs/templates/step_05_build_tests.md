---
title: "Step 05 — Build Registration and Test Suite"
last-updated: "2026-04-16"
review-cadence-days: 7
status: active
---

# Step 05: Build Registration and Test Suite

**Goal**: Register the templates plugin in the IIFE build pipeline and write comprehensive unit tests covering all pure logic and edge cases.

## Requirement Traceability

- FR-8.5 (build registration)
- NFR-3 (no external deps)
- NFR-5 (IIFE self-containment)
- All EC-* edge cases

## 1. Build Registration

### `scripts/build-plugins.mjs`

Add to the `PLUGINS` array:

```javascript
["templates", "src/plugins/templates/templates.plugin.ts"],
```

Update the final success message count:

```javascript
console.log("\n[build-plugins] All 7 core plugins built successfully.");
```

### `vite.plugins.config.ts`

Add a new `pluginConfig` entry to the exported array:

```typescript
pluginConfig(
  "templates",
  resolve(__dirname, "src/plugins/templates/templates.plugin.ts"),
  false,
),
```

### `src-tauri/tauri.conf.json`

Verify that the `bundle.resources` entry `"plugins/core/*"` already covers all `.js` files in that directory. No change needed — the glob captures the new `templates.js` automatically.

## 2. Test File

**File**: `tests/plugins/templates/templates.test.ts`

### Test Structure

```
describe("Templates Plugin")
  describe("validateTemplateName")
    - rejects empty string
    - rejects whitespace-only string
    - rejects name with forward slash
    - rejects name with backslash
    - rejects name starting with dot
    - accepts valid simple name
    - accepts name with spaces
    - accepts name with hyphens and underscores
    - accepts name already ending with .md

  describe("getWorkingDirectory")
    - returns parent directory of current file
    - returns null when __MARKABLE_CURRENT_FILE__ is null
    - returns null when path has no slash (defensive)
    - handles root-level file path

  describe("resolveTemplatesFolder")
    - returns workDir/templatesFolderName
    - returns null when no file open
    - uses custom folder name from settings

  describe("STARTER_TEMPLATES")
    - blank.md is empty string
    - note.md contains YAML front matter
    - meeting-notes.md contains expected sections
    - all keys end with .md

  describe("DEFAULT_SETTINGS")
    - templatesFolderName is "Templates"
    - setupComplete is false
    - createStarterTemplates is true

  describe("applyTemplate (integration-style)")
    - calls openNewTab and dispatches content
    - handles empty content (EC-6) — openNewTab called, no dispatch
    - handles read_file failure (EC-5) — shows alert, no tab created
    - sets cursor at end of document (FR-4.4)

  describe("saveAsTemplate (integration-style)")
    - shows alert when no file open (EC-1)
    - validates filename (EC-8)
    - appends .md if missing
    - calls ensure_directory before writing (FR-5.3)
    - checks for existing file and confirms overwrite (EC-7)
    - writes file on confirm
    - aborts on cancel

  describe("openPicker")
    - shows alert when no file open (EC-1)
    - is no-op when picker already open (EC-12)
    - shows setup wizard when setupComplete is false
    - shows picker UI when setupComplete is true

  describe("Picker filter logic")
    - filters by case-insensitive substring
    - empty filter shows all templates
    - no match shows empty message
    - filter updates on input event

  describe("Picker keyboard navigation")
    - ArrowDown moves selection forward
    - ArrowDown clamps at end
    - ArrowUp moves selection backward
    - ArrowUp clamps at beginning
    - Enter applies selected template
    - Escape closes picker (EC-19)

  describe("Setup wizard")
    - creates folder via ensure_directory
    - writes starter templates when checked
    - skips starters when unchecked
    - saves settings on success
    - shows error and stays open on folder creation failure (EC-15)
    - opens picker after successful setup (FR-6.4)

  describe("Plugin lifecycle")
    - onEnable sets window.__MARKABLE_TEMPLATES__
    - onDisable removes window.__MARKABLE_TEMPLATES__
    - onDisable closes picker if open
    - onDisable clears all module-level state
```

### Test Setup Pattern

Follow the existing pattern from `tests/plugins/backlinks/`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validateTemplateName,
  getWorkingDirectory,
  resolveTemplatesFolder,
  STARTER_TEMPLATES,
  DEFAULT_SETTINGS,
} from "../../../src/plugins/templates/templates.plugin";
```

For integration-style tests that need window globals, set up mocks:

```typescript
beforeEach(() => {
  (window as any).__MARKABLE_CURRENT_FILE__ = "/Users/test/docs/current.md";
  (window as any).__MARKABLE_TAB_MANAGER__ = {
    openNewTab: vi.fn(),
  };
  (window as any).__MARKABLE_EDITOR_VIEW__ = {
    state: { doc: { length: 0, toString: () => "" } },
    dispatch: vi.fn(),
  };
  (window as any).__TAURI_INTERNALS__ = {
    invoke: vi.fn(),
  };
});

afterEach(() => {
  delete (window as any).__MARKABLE_CURRENT_FILE__;
  delete (window as any).__MARKABLE_TAB_MANAGER__;
  delete (window as any).__MARKABLE_EDITOR_VIEW__;
  delete (window as any).__TAURI_INTERNALS__;
  delete (window as any).__MARKABLE_TEMPLATES__;
});
```

## 3. Rust Test Verification

Ensure all `ensure_directory` tests from step_01 pass:

```bash
cargo test -- ensure_directory
```

Expected: 4 tests pass.

## 4. Full Test Suite Run

```bash
# Rust
cargo test

# Frontend
npm test
```

Expected:
- Rust: 57+ tests (53 existing + 4 new `ensure_directory` tests)
- Frontend: 1291+ existing + ~30-40 new templates tests

## 5. Build Verification

```bash
npm run build:plugins
```

Expected: "All 7 core plugins built successfully." with `templates.js` in `src-tauri/plugins/core/`.

Verify the output file:
- Contains `var __markablePlugin__`
- Does not contain `require(` or `import(`
- Contains the string `"templates"` (the plugin id)

## Files Changed

| File | Change |
|---|---|
| `scripts/build-plugins.mjs` | Add templates entry to PLUGINS array, update count |
| `vite.plugins.config.ts` | Add pluginConfig entry for templates |
| `tests/plugins/templates/templates.test.ts` | **NEW** — full test suite |

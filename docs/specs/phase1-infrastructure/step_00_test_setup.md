# Step 00: Test Infrastructure Setup (Test Architecture)

**Status:** REQUIRED BEFORE SCAFFOLDING
**Purpose:** Establish test framework, mocking strategy, and test environment configuration before any implementation code is written
**Acceptance Criteria:** Vitest configured, Rust test workspace ready, Tauri command mocks working, first test passes

---

## Overview

This step configures the testing infrastructure for Phase 1. It is **intentionally placed before scaffolding** to ensure all code written subsequently is test-ready. This includes:

1. **Frontend (TypeScript):** Vitest with Tauri command mocks and DOM helpers
2. **Backend (Rust):** Cargo test workspace with atomic write mocks
3. **Integration:** Test utilities for command invocation

**Output:** Complete test configuration, helper libraries, and a working example test for each environment.

---

## Implementation Tasks

### Task 0.1: Configure Vitest (Frontend Test Runner)

After `npm create tauri-app` (step 01), install Vitest and configure it.

**Install Vitest and dependencies:**

```bash
cd /Users/dave/Documents/web-local-dev/MarkdownEditor-Rewrite/markable-2.0

npm install -D vitest @testing-library/dom @testing-library/user-event happy-dom
```

**File: `vitest.config.ts` (NEW)**

```typescript
/// <reference types="vitest" />
import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'src-tauri'],
  },
})
```

**Key settings:**
- `globals: true` — Use global `describe`, `it`, `expect` (no imports needed)
- `environment: 'happy-dom'` — Lightweight DOM implementation for Node.js (no browser needed)
- `setupFiles` — Global test setup file (see Task 0.2)
- `include` — Only test files matching `tests/**/*.test.ts`

**File: `tests/setup.ts` (NEW)**

```typescript
/**
 * Global test setup for Vitest
 *
 * This runs before any tests. It sets up mocks for Tauri commands
 * and other global test utilities.
 */

import { vi } from 'vitest'

/**
 * Mock Tauri invoke() function
 *
 * Tests will override this on a per-test basis.
 */
global.tauriInvoke = vi.fn()

declare global {
  var tauriInvoke: ReturnType<typeof vi.fn>
}
```

**Update `package.json` with test script:**

```json
{
  "scripts": {
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:run": "vitest run"
  }
}
```

---

### Task 0.2: Create Tauri Command Mock Helpers

Tests need to mock Tauri command invocations. Create helpers to make this easy.

**File: `tests/mocks/tauri.ts` (NEW)**

```typescript
/**
 * Tauri command mock helpers
 *
 * Provides utilities to mock Tauri invoke() calls in tests.
 */

import { vi } from 'vitest'
import type { FileResult, DialogResult } from '../../src/lib/errors'

/**
 * Mock successful file read command
 */
export function mockReadFileSuccess(content: string) {
  const mockFn = vi.fn().mockResolvedValue({
    ok: true,
    value: content,
  } as FileResult<string>)

  return mockFn
}

/**
 * Mock file read error
 */
export function mockReadFileError(message: string) {
  const mockFn = vi.fn().mockResolvedValue({
    ok: false,
    error: {
      message,
      command: 'read_file',
    },
  } as FileResult<string>)

  return mockFn
}

/**
 * Mock successful file write command
 */
export function mockWriteFileSuccess() {
  const mockFn = vi.fn().mockResolvedValue({
    ok: true,
    value: undefined,
  } as FileResult<void>)

  return mockFn
}

/**
 * Mock file write error
 */
export function mockWriteFileError(message: string) {
  const mockFn = vi.fn().mockResolvedValue({
    ok: false,
    error: {
      message,
      command: 'write_file',
    },
  } as FileResult<void>)

  return mockFn
}

/**
 * Mock dialog cancellation
 */
export function mockDialogCancelled() {
  const mockFn = vi.fn().mockResolvedValue({
    cancelled: true,
  } as DialogResult)

  return mockFn
}

/**
 * Mock successful dialog with path
 */
export function mockDialogSuccess(path: string) {
  const mockFn = vi.fn().mockResolvedValue({
    cancelled: false,
    path,
  } as DialogResult)

  return mockFn
}
```

---

### Task 0.3: Create a Test Example File

Create a minimal test file to verify Vitest is working.

**File: `tests/example.test.ts` (NEW)**

```typescript
/**
 * Example test to verify Vitest setup
 *
 * This test runs before any real tests and verifies:
 * 1. Vitest is configured correctly
 * 2. Happy-DOM environment works
 * 3. Test utilities are available
 */

import { describe, it, expect } from 'vitest'

describe('Vitest Setup', () => {
  it('should run a basic test', () => {
    expect(1 + 1).toBe(2)
  })

  it('should have DOM APIs available', () => {
    const div = document.createElement('div')
    div.textContent = 'Hello, World!'
    expect(div.textContent).toBe('Hello, World!')
  })

  it('should have a happy-dom environment', () => {
    // This runs in Node.js with happy-dom, not a real browser
    expect(typeof window).toBe('object')
    expect(typeof document).toBe('object')
  })
})
```

---

### Task 0.4: Configure Rust Test Workspace

Rust tests are configured by default with Cargo. Set up a test organization pattern.

**File: `src-tauri/src/lib.rs` (NEW, or UPDATE if exists)**

```rust
//! Markable 2.0 — Tauri Backend Library
//!
//! This module re-exports command implementations and provides
//! shared utilities for testing.

pub mod commands;

#[cfg(test)]
mod tests {
    #[test]
    fn it_works() {
        assert_eq!(1 + 1, 2);
    }
}
```

**File: `src-tauri/src/commands/mod.rs` (NEW)**

```rust
//! Command registry module for Markable 2.0
//!
//! Each submodule (io, dialogs, etc.) exports commands that are
//! registered via the `tauri::generate_handler![]` macro in main.rs.

pub mod io;
pub mod dialogs;

// Re-export command functions for easy registration
pub use io::{read_file, write_file};
pub use dialogs::{open_file_dialog, save_file_dialog};
```

---

### Task 0.5: Create Rust Test Utilities

For Rust, create helpers for testing file I/O operations.

**File: `src-tauri/src/test_utils.rs` (NEW)**

```rust
//! Test utilities for Markable 2.0 backend
//!
//! Provides helpers for creating temporary files, mocking I/O, etc.

#[cfg(test)]
pub mod temp_file {
    use std::fs;
    use std::path::{Path, PathBuf};

    /// Create a temporary test file with content
    pub fn create_temp_file(content: &str) -> std::io::Result<PathBuf> {
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join(format!("test_{}.md", std::process::id()));
        fs::write(&file_path, content)?;
        Ok(file_path)
    }

    /// Clean up a temporary test file
    pub fn remove_temp_file(path: &Path) -> std::io::Result<()> {
        fs::remove_file(path)
    }
}

#[cfg(test)]
mod tests {
    use super::temp_file::*;

    #[test]
    fn test_create_and_remove_temp_file() {
        let path = create_temp_file("test content").expect("Failed to create temp file");
        assert!(path.exists());
        remove_temp_file(&path).expect("Failed to remove temp file");
        assert!(!path.exists());
    }
}
```

---

### Task 0.6: Create Integration Test Structure

Set up a directory structure for integration tests.

```bash
mkdir -p /Users/dave/Documents/web-local-dev/MarkdownEditor-Rewrite/markable-2.0/tests/

# Create subdirectories for organization
mkdir -p /Users/dave/Documents/web-local-dev/MarkdownEditor-Rewrite/markable-2.0/tests/mocks
mkdir -p /Users/dave/Documents/web-local-dev/MarkdownEditor-Rewrite/markable-2.0/tests/integration
```

**File: `tests/mocks/index.ts` (NEW)**

```typescript
/**
 * Test mocks and utilities
 *
 * Re-export all mock helpers for easy access in tests
 */

export * from './tauri'
```

---

### Task 0.7: Configure TypeScript for Tests

Tests should have strict type checking.

**Update `tsconfig.json` to include tests:**

Verify that the `include` array covers tests:

```json
{
  "include": ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts"],
  "exclude": ["node_modules", "dist", "src-tauri"]
}
```

---

### Task 0.8: Verify Test Infrastructure

Run the example test to confirm everything works.

```bash
cd /Users/dave/Documents/web-local-dev/MarkdownEditor-Rewrite/markable-2.0

# Run tests once and exit
npm run test:run

# Expected output:
# ✓ tests/example.test.ts (3 tests)
#
# Test Files  1 passed (1)
#      Tests  3 passed (3)
```

For Rust:

```bash
cd /Users/dave/Documents/web-local-dev/MarkdownEditor-Rewrite/markable-2.0/src-tauri

cargo test --lib

# Expected output:
# running 1 test
# test tests::it_works ... ok
```

---

### Task 0.9: Create Test Documentation

Document testing patterns for the team.

**File: `docs/testing.md` (NEW)**

```markdown
# Testing Guide for Markable 2.0

## Frontend Tests (TypeScript + Vitest)

### Running Tests

```bash
# Run tests in watch mode
npm test

# Run tests once and exit
npm run test:run

# Run tests with UI dashboard
npm run test:ui
```

### Writing a Test

```typescript
import { describe, it, expect } from 'vitest'
import { mockReadFileSuccess, mockReadFileError } from './mocks/tauri'

describe('FileReader', () => {
  it('should read file successfully', async () => {
    const mockFn = mockReadFileSuccess('# Hello World')
    // Use mockFn in your test...
  })

  it('should handle read errors', async () => {
    const mockFn = mockReadFileError('File not found')
    // Use mockFn in your test...
  })
})
```

### Mocking Tauri Commands

Use helpers from `tests/mocks/tauri.ts`:

- `mockReadFileSuccess(content)` — Successful file read
- `mockReadFileError(message)` — File read error
- `mockWriteFileSuccess()` — Successful file write
- `mockWriteFileError(message)` — File write error
- `mockDialogSuccess(path)` — Dialog with file path
- `mockDialogCancelled()` — Dialog cancelled by user

## Backend Tests (Rust)

### Running Tests

```bash
cd src-tauri

# Run all tests
cargo test

# Run tests with output
cargo test -- --nocapture

# Run a specific test
cargo test test_atomic_write
```

### Writing a Test

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_atomic_write() {
        // Your test here
    }
}
```

### Test Utilities

Use helpers from `src/test_utils.rs`:

- `temp_file::create_temp_file(content)` — Create a temporary test file
- `temp_file::remove_temp_file(path)` — Clean up a temporary file

## Test Conventions

- **File naming:** `<module>.test.ts` for TypeScript, tests in `src` for Rust
- **Describe blocks:** Group related tests with `describe()`
- **Test names:** Use present tense: "should do X" or "handles Y gracefully"
- **Mocking:** Mock external dependencies (Tauri commands, file I/O, dialogs)
- **Assertions:** Use `expect()` and be explicit about what you're testing

## Edge Case Testing

Every feature must include edge case tests. See `docs/requirements/active_task.md` for the Edge Case Inventory (EC-1 through EC-20).

Each edge case should have at least one test covering it.
```

---

## Acceptance Checklist (Step 00 Complete When All Pass)

- [ ] Vitest installed and configured (vitest.config.ts exists)
- [ ] `npm run test:run` runs example tests successfully
- [ ] Test setup file (tests/setup.ts) exists
- [ ] Mock helpers (tests/mocks/tauri.ts) created
- [ ] Example test (tests/example.test.ts) passes
- [ ] Rust test utilities (src-tauri/src/test_utils.rs) created
- [ ] `cargo test` in src-tauri runs successfully
- [ ] Test directories created (tests/mocks, tests/integration)
- [ ] TypeScript includes tests in tsconfig.json
- [ ] Testing documentation (docs/testing.md) complete
- [ ] package.json has test scripts: test, test:ui, test:run

---

## Files Created in This Step

| File | Purpose |
|------|---------|
| `vitest.config.ts` | Vitest configuration for frontend tests |
| `tests/setup.ts` | Global test setup and mocks |
| `tests/mocks/tauri.ts` | Tauri command mock helpers |
| `tests/mocks/index.ts` | Mock utilities re-export |
| `tests/example.test.ts` | Example test to verify setup |
| `tests/integration/` | Directory for integration tests |
| `src-tauri/src/lib.rs` | Rust library root (test organization) |
| `src-tauri/src/test_utils.rs` | Rust test utilities (temp files, etc.) |
| `docs/testing.md` | Testing guide and conventions |
| `package.json` | Updated with test scripts |

---

## Dependencies Added

### Frontend (npm)

```json
{
  "devDependencies": {
    "vitest": "^1.0.0+",
    "@testing-library/dom": "^9.0.0+",
    "@testing-library/user-event": "^14.0.0+",
    "happy-dom": "^12.0.0+"
  }
}
```

### Backend (Cargo)

No additional dependencies required. Rust `#[test]` attribute is built-in.

---

## Notes

- **Why Vitest?** Fast, native ES modules, great Vite integration, minimal config
- **Why happy-dom?** Lightweight DOM for testing, no need for browser overhead
- **Why mock Tauri commands?** Tests shouldn't depend on a running Tauri app
- **Why Rust test_utils?** Provides reusable helpers for file I/O testing without polluting production code

---

## Next Step

After completing this step, proceed to `step_01_scaffolding.md`. All subsequent code will be written with TDD in mind: write tests first, then implementation.

**Important:** Before any implementation code is written in step 01+, write tests in the appropriate test file (e.g., `tests/bridge.test.ts`, `src-tauri/src/commands/io.rs` with `#[test]` functions).

---

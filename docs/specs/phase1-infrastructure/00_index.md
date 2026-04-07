# Markable 2.0 — Phase 1: Infrastructure & "Tahoe" Workaround — Master Blueprint

**Date:** 2026-04-04
**Status:** Architecture Complete — Ready for Lead Developer
**Based on:** `docs/requirements/active_task.md`

---

## Executive Summary

Phase 1 establishes the foundational infrastructure for Markable 2.0: a **Tauri v2 + Vite + TypeScript** project with a working **Rust-TypeScript command bridge**, **file dialog integration**, and **CodeMirror 6 Markdown editor**. Most critically, Phase 1 solves the **macOS Sequoia/Tahoe DMG build incompatibility** using the `CI=true` headless workaround, with a fallback manual DMG creation script.

This phase delivers **no editor features**—only the platform. Subsequent phases (2–4) will add multi-file tabs, live preview, theming, and export/import.

**The architecture enforces:**
- Modular Rust code (separate `io.rs`, `commands/mod.rs`, `dialogs.rs`)
- TypeScript strict mode with discriminated unions for error handling
- Atomic file writes (temp-file-swap pattern) mandatory in all `write_file` operations
- Granular Tauri v2 capabilities (no blanket filesystem access)
- No TODO comments in source; all deferred work in architecture specs

---

## Stack Decision (Web-Researched 2026-04-04)

| Technology | Version | Rationale |
|---|---|---|
| **Tauri** | v2.10.1 (@tauri-apps/cli, @tauri-apps/api) | Official v2 stable, macOS-first Rust-TypeScript bridge, signed app support, dialog plugin v2.6.0 with native file dialogs |
| **Vite** | v5 (stable) | Fast HMR (dev cycle <2s), esbuild-based transpilation, native TypeScript support, zero-config with `npm create tauri-app` |
| **TypeScript** | 5.x+ (from scaffolding) | Strict mode enforced; ES2022 target for modern JavaScript support |
| **CodeMirror 6** | @codemirror/view 6.40.0, @codemirror/state 6.5.4, @codemirror/lang-markdown 6.5.0 | Modern editor with composable extensions; markdown support; Typora-style decoration layer ready (Phase 2) |
| **create-dmg** | 8.1.0 (fallback only) | Scriptable DMG creation for Phase 1 fallback; requires Node 20+ |
| **Rust Edition** | 2021 | Stable, modern async/await, latest library ecosystem |

**Constraints enforced throughout:**
- C1: Tauri v2 APIs only (no v1 patterns)
- C2: TypeScript strict mode (noImplicitAny, strict)
- C3: Rust 2021 edition
- C4: macOS 13+ target
- C5: All writes use atomic temp-file-swap (no direct `fs::write`)
- C6: Code signing mandatory; signingIdentity placeholder in tauri.conf.json
- C7: No TODO in source; deferred work in specs only
- C8: No base64 images; asset:// protocol for Phase 2

---

## High-Level Architecture

### Data Flow

```
User
  ├─ [UI] TypeScript: main.ts + editor/ + lib/
  │   ├─ CodeMirror 6 EditorView (src/editor/editor.ts)
  │   ├─ File dialogs (src/lib/dialogs.ts)
  │   └─ Tauri command bridge (src/lib/bridge.ts + errors.ts)
  │
  └─ [IPC] Tauri v2 invoke()
      │
      └─ [Rust] src-tauri/src/
          ├─ main.rs (entry, command registration)
          ├─ lib.rs (app setup, capability loading)
          ├─ commands/mod.rs (command registry)
          ├─ commands/io.rs (read_file, write_file with atomic swap)
          └─ commands/dialogs.rs (open_file_dialog, save_file_dialog)
```

### Component Map (All Files Touched in Phase 1)

```
Root/
├── package.json                                      [NEW — scaffolding, updated by steps 00, 01, 03, 05, 06]
├── package-lock.json                                [NEW — npm install]
├── tsconfig.json                                    [NEW — scaffolding, strict config per step 01]
├── vite.config.ts                                  [NEW — scaffolding, port 1420 per step 01]
├── vitest.config.ts                                [NEW — step 00: Vitest configuration]
├── index.html                                      [NEW — scaffolding, updated per step 05, 06]
│
├── src/
│   ├── main.ts                                      [NEW — scaffolding, updated per step 05, 06]
│   ├── lib/
│   │   ├── bridge.ts                                [NEW — step 04: Tauri command invocations]
│   │   ├── errors.ts                                [NEW — step 04: TauriCommandError, FileResult<T>]
│   │   └── dialogs.ts                               [NEW — step 06: openFileDialog, saveFileDialog wrappers]
│   └── editor/
│       ├── editor.ts                                [NEW — step 05: createEditor factory function]
│       └── extensions.ts                            [NEW — step 05: buildExtensions with error handling]
│
├── src-tauri/
│   ├── Cargo.toml                                   [NEW — scaffolding, deps updated per steps 04, 06]
│   ├── Cargo.lock                                   [NEW — cargo build]
│   ├── tauri.conf.json                              [NEW — scaffolding, updated per steps 01, 03]
│   ├── build.rs                                     [NEW — scaffolding]
│   ├── capabilities/
│   │   └── default.json                             [NEW — step 02: fs, dialog, window, event capabilities]
│   └── src/
│       ├── main.rs                                  [NEW — scaffolding, updated per steps 04, 06]
│       ├── lib.rs                                   [NEW — scaffolding, updated per steps 04, 06]
│       └── commands/
│           ├── mod.rs                               [NEW — step 04, updated per step 06]
│           ├── io.rs                                [NEW — step 04: read_file, write_file, atomic swap]
│           └── dialogs.rs                           [NEW — step 06: open_file_dialog, save_file_dialog]
│
├── scripts/
│   └── build-dmg-fallback.sh                        [NEW — step 03: fallback DMG creation script]
│
├── tests/
│   ├── setup.ts                                     [NEW — step 00: global test setup]
│   ├── example.test.ts                              [NEW — step 00: example test for verification]
│   ├── mocks/
│   │   ├── index.ts                                 [NEW — step 00: mock utilities re-export]
│   │   └── tauri.ts                                 [NEW — step 00: Tauri command mock helpers]
│   ├── integration/                                 [NEW — step 00: integration test directory]
│   ├── bridge.test.ts                               [NEW — step 04: command invocation tests]
│   └── editor.test.ts                               [NEW — step 05: editor factory + extension tests]
│
└── docs/
    ├── build-notes/
    │   └── macos-dmg-workaround.md                  [UPDATE — step 03: ADR with root cause, build steps, verification]
    └── specs/
        └── phase1-infrastructure/
            ├── 00_index.md                          [THIS FILE — master checklist]
            ├── step_01_scaffolding.md               [NEW]
            ├── step_02_permissions.md               [NEW]
            ├── step_03_dmg_workaround.md            [NEW]
            ├── step_04_rust_command_bridge.md       [NEW]
            ├── step_05_codemirror_setup.md          [NEW]
            └── step_06_file_dialogs.md              [NEW]
```

---

## Tauri v2 Command Signatures (API Contract)

All commands are invoked from TypeScript via `@tauri-apps/api/core::invoke()`.

### Core File I/O Commands

| Command | Rust Signature | TypeScript Wrapper | Return on Cancel | EC Coverage |
|---------|---|---|---|---|
| **read_file** | `#[tauri::command] pub fn read_file(path: String) -> Result<String, String>` | `readFile(path: string): Promise<FileResult<string>>` | N/A (sync) | EC-5, EC-6, EC-7, EC-8, EC-12, EC-16, EC-17 |
| **write_file** | `#[tauri::command] pub fn write_file(path: String, content: String) -> Result<(), String>` | `writeFile(path: string, content: string): Promise<FileResult<void>>` | N/A (sync) | EC-9, EC-10, EC-11, EC-13, EC-17 |

### File Dialog Commands

| Command | Rust Signature | TypeScript Wrapper | Return on Cancel | EC Coverage |
|---------|---|---|---|---|
| **open_file_dialog** | `#[tauri::command] pub async fn open_file_dialog(app: tauri::AppHandle) -> Result<Option<String>, String>` | `openFileDialog(): Promise<DialogResult>` | `{ cancelled: true }` | EC-14, EC-20 |
| **save_file_dialog** | `#[tauri::command] pub async fn save_file_dialog(app: tauri::AppHandle) -> Result<Option<String>, String>` | `saveFileDialog(): Promise<DialogResult>` | `{ cancelled: true }` | EC-15, EC-20 |

### TypeScript Bridge Types

```typescript
// Error representation
interface TauriCommandError {
  message: string;      // "File not found: /path/to/file"
  command: string;      // "read_file", "write_file", etc.
  path?: string;        // path argument if applicable
}

// Discriminated union for results
type FileResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: TauriCommandError };

type DialogResult =
  | { cancelled: false; path: string }
  | { cancelled: true };

// Function signatures
async function readFile(path: string): Promise<FileResult<string>>
async function writeFile(path: string, content: string): Promise<FileResult<void>>
async function openFileDialog(): Promise<DialogResult>
async function saveFileDialog(): Promise<DialogResult>
```

### Atomic Write Algorithm (Mandatory for write_file)

1. Generate temp filename with random suffix: `{target_path}.tmp.{random_u64}`
2. Write content to temp file in same directory as target
3. Call `std::fs::sync_all()` on temp file handle
4. Call `std::fs::rename(temp_path, target_path)` — atomic on POSIX
5. If any step fails, delete temp file and return descriptive error
6. If rename fails with "File exists", retry once after deleting orphaned temp
7. Original file **never written to directly**; always atomic swap

**Error cases:**
- `"File not found: {path}"` — parent directory does not exist
- `"Permission denied: {path}"` — no write permission
- `"Disk full: insufficient space to write {path}"` — ENOSPC
- `"Write failed: atomic swap could not complete"` — rename failed after retries

---

## Error Handling & User Feedback

### Error Flow Architecture

All operations follow a consistent error handling pattern:

```
TypeScript UI Event
  ↓
Rust Command (via invoke)
  ↓
Result<T, String> (Rust)
  ↓
FileResult<T> discriminated union (TypeScript)
  ↓
Display to User (modal, toast, or status bar)
```

### Error Display Strategy (Phase 1)

For Phase 1, errors are displayed using **browser `alert()`** for simplicity:

```typescript
// Pattern used in step_06 (File Dialogs) and main.ts
const result = await readFile(path);

if (!result.ok) {
  alert(`Error opening file: ${result.error.message}`);
  return;
}
```

**Rationale:**
- Simple to implement and test
- Guaranteed visibility (modal blocks interaction)
- Works cross-platform without native dependencies
- Can be replaced in Phase 2 with a custom toast/snackbar UI

### Error Message Standardization

All Rust commands return standardized error messages following this pattern:

```
"{Operation} {Context}: {Reason}"

Examples:
- "File not found: /path/to/file"
- "Permission denied: /path/to/file"
- "Disk full: insufficient space to write /path/to/file"
- "Write failed: atomic swap could not complete"
```

**TypeScript representation:**

```typescript
interface TauriCommandError {
  message: string;  // Standardized message above
  command: string;  // "read_file", "write_file", etc.
  path?: string;    // Original path if applicable
}
```

### Error Handling in Tests

Test errors using mock helpers:

```typescript
// Mock a read error
const mockFn = mockReadFileError("File not found: /path/to/file");
const result = await readFile("/path/to/file");
expect(result.ok).toBe(false);
expect(result.error.message).toContain("File not found");
```

### Future (Phase 2+)

Phase 2 will replace `alert()` with a custom UI component:
- Toast notifications for non-critical errors
- Modal dialogs for critical errors
- Status bar persistent messages for background operations
- Undo capability for certain operations

---

## Edge Case Coverage Matrix

Every edge case from `docs/requirements/active_task.md` is addressed by at least one step. Below is the mapping:

| EC # | Edge Case | Step File | Coverage Strategy |
|------|-----------|-----------|-------------------|
| EC-1 | CI=true on non-macOS | step_03 | CI var is harmless on Linux/Win; documented as macOS-only in build scripts |
| EC-2 | Missing signingIdentity in tauri.conf.json | step_01, step_03 | Build fails with clear error; tauri.conf.json includes placeholder + comments |
| EC-3 | DMG build fails even with CI=true | step_03 | Fallback script provided; build docs outline this scenario |
| EC-4 | App is unsigned (no code signature) | step_03 | spctl verification documented; build instructions explain signing setup |
| EC-5 | File path doesn't exist (read_file) | step_04 | read_file returns `"File not found: {path}"` |
| EC-6 | File path is directory (read_file) | step_04 | read_file returns `"Is a directory: {path}"` |
| EC-7 | Permission denied on read | step_04 | read_file returns `"Permission denied: {path}"` |
| EC-8 | File deleted mid-operation (read) | step_04 | read_file returns `"File not found: {path}"` |
| EC-9 | Disk full during write_file | step_04 | write_file returns `"Disk full: insufficient space to write {path}"` |
| EC-10 | Permission denied on write | step_04 | write_file returns `"Permission denied: {path}"` |
| EC-11 | Write killed mid-swap | step_04 | Temp file orphaned, original untouched; test verifies via SIGKILL |
| EC-12 | Invalid UTF-8 in file path | step_04 | Rust String is UTF-8; non-UTF-8 paths fail on Rust side with "Permission denied" or file-not-found |
| EC-13 | Atomic rename fails | step_04 | write_file returns `"Write failed: atomic swap could not complete"` after retries |
| EC-14 | File Open dialog cancelled | step_06 | open_file_dialog returns `Ok(None)`, mapped to `{ cancelled: true }` |
| EC-15 | File Save As dialog cancelled | step_06 | save_file_dialog returns `Ok(None)`, mapped to `{ cancelled: true }` |
| EC-16 | Concurrent reads on same file | step_04 | Multiple read_file calls allowed; no blocking or race conditions |
| EC-17 | Concurrent read + write on same file | step_04 | Read may see old or new content; atomic swap prevents corruption |
| EC-18 | CodeMirror init fails (missing DOM) | step_05 | createEditor returns null, console.error with message; no panic |
| EC-19 | CodeMirror markdown plugin fails | step_05 | buildExtensions catches error, logs warning, returns extensions without markdown |
| EC-20 | Tauri permissions misconfigured | step_02, step_04, step_06 | Operations fail with "Permission denied"; capabilities/default.json documents grants |

---

## Non-Functional Requirements Traceability

| NFR | Description | Addressed In | Success Criteria |
|-----|---|---|---|
| **NF1** | Build Reproducibility | step_01, step_03 | Pinned versions; `CI=true npm run tauri build` is deterministic |
| **NF2** | Build Speed (Dev) | step_01 (Vite HMR) | `npm run tauri dev` launches <30s; TypeScript HMR <2s |
| **NF3** | Code is Test-Ready | step_04 (modular Rust), step_05 (factory pattern) | Rust has public interfaces; TypeScript modules export testable functions |
| **NF4** | macOS-First Experience | step_01, step_03 | Window title bar visible; title bar style "Overlay"; signed app support |
| **NF5** | Atomic File Writes | step_04 | All write_file ops use temp-file-swap; atomic rename on POSIX |
| **NF6** | Error Handling | step_04, step_05, step_06 | No panics in source; all errors returned with descriptive messages |

---

## Dependency Versions (Web-Researched 2026-04-04)

### npm Packages (Frontend)

```json
{
  "@tauri-apps/api": "^2.10.1",
  "@tauri-apps/cli": "^2.10.1",
  "@codemirror/view": "^6.40.0",
  "@codemirror/state": "^6.5.4",
  "@codemirror/lang-markdown": "^6.5.0",
  "vite": "^5.0.0",
  "typescript": "^5.0.0"
}
```

### Rust Crates (Tauri Backend, from scaffold)

```toml
[dependencies]
tauri = "2.10"
tauri-build = "2.10"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
# Exact versions pinned by Cargo.lock
```

### Fallback Tools (Optional, step 03)

```bash
npm install -D create-dmg@8.1.0  # Only if DMG build fails with CI=true
```

### Dialog API (Core Tauri v2, No Plugin Needed)

⚠️ **Important:** Tauri v2 includes dialog support in the core API. **Do NOT install `tauri-plugin-dialog`** as a separate package.

The dialog functionality is accessed via:
- Rust: `use tauri::api::dialog::FileDialogBuilder;`
- TypeScript: Wrapped in `src/lib/dialogs.ts` which calls the Rust commands

If you see references to `tauri-plugin-dialog` in documentation, those apply to Tauri v1. Tauri v2's dialog API is built-in.

---

## Implementation Checklist (Master Checklist for Phase 1)

### Step 0: Test Infrastructure Setup (R0 — REQUIRED FIRST)
- [ ] Install Vitest: `npm install -D vitest @testing-library/dom happy-dom`
- [ ] Create `vitest.config.ts` with happy-dom environment
- [ ] Create `tests/setup.ts` with Tauri mock setup
- [ ] Create `tests/mocks/tauri.ts` with command mock helpers
- [ ] Create `tests/example.test.ts` and verify `npm run test:run` passes
- [ ] Create `src-tauri/src/test_utils.rs` with file I/O test helpers
- [ ] Verify `cargo test` in src-tauri passes
- [ ] Create `docs/testing.md` with testing guide

### Step 1: Scaffolding (R1)
- [ ] Run `npm create tauri-app@latest markable`
- [ ] Choose: vanilla template, TypeScript, npm
- [ ] Verify `npm install` succeeds
- [ ] Verify `npm run tauri dev` opens window
- [ ] Verify hot reload works (edit src/main.ts)
- [ ] Verify no build warnings or errors
- [ ] Pin @tauri-apps/api, @tauri-apps/cli in package.json
- [ ] Configure tsconfig.json: strict mode, ES2022 target, noImplicitAny
- [ ] Configure vite.config.ts: port 1420, strictPort true
- [ ] Configure tauri.conf.json: window hiddenTitle, titleBarStyle "Overlay"
- [ ] All files match step_01_scaffolding.md

### Step 2: Permissions (R2)
- [ ] Create src-tauri/capabilities/default.json with granular scopes
- [ ] Define fs:default (read/write user-selected paths only)
- [ ] Define dialog:default (open/save dialogs)
- [ ] Define core:window:allow-show, core:event allow-emit/listen
- [ ] Verify tauri.conf.json references capabilities/default.json
- [ ] Document rationale for each permission grant

### Step 3: DMG Workaround (R3 — CRITICAL)
- [ ] Create scripts/build-dmg-fallback.sh with create-dmg command
- [ ] Update tauri.conf.json bundle config: add signingIdentity placeholder + comments
- [ ] Update docs/build-notes/macos-dmg-workaround.md with ADR structure (Context, Decision, Consequences)
- [ ] Document CI=true environment variable requirement
- [ ] Document code signing setup (Apple Developer ID)
- [ ] Document verification: `spctl --assess --verbose`
- [ ] Test: `CI=true npm run tauri build` produces working DMG
- [ ] Test fallback: `cargo tauri build --bundles app && ./scripts/build-dmg-fallback.sh`

### Step 4: Rust Command Bridge (R4)
- [ ] Create src-tauri/src/commands/io.rs with read_file, write_file
- [ ] Implement atomic write algorithm: temp file → sync_all → rename
- [ ] Return descriptive error messages per spec
- [ ] Create src-tauri/src/commands/mod.rs registry
- [ ] Update src-tauri/src/lib.rs and main.rs to register commands
- [ ] Create src/lib/bridge.ts with invoke wrappers (FileResult discriminated union)
- [ ] Create src/lib/errors.ts with TauriCommandError type
- [ ] Create tests/bridge.test.ts: success, not found, is_directory, permission, UTF-8, disk full, atomic, concurrent
- [ ] Create Rust unit tests in src-tauri/src/commands/io.rs
- [ ] Verify `npm run tauri dev` allows manual testing via browser console

### Step 5: CodeMirror Setup (R5)
- [ ] Install @codemirror/view@6.40.0, @codemirror/state@6.5.4, @codemirror/lang-markdown@6.5.0
- [ ] Create src/editor/editor.ts: createEditor(target, initialDoc?) factory
- [ ] Create src/editor/extensions.ts: buildExtensions with try/catch markdown plugin
- [ ] Update src/main.ts to create editor on DOM ready
- [ ] Update index.html: add `<div id="editor" role="textbox" aria-label="Markdown editor"></div>`
- [ ] Create tests/editor.test.ts: createEditor success, null return, extensions load, markdown fallback
- [ ] Verify syntax highlighting works for headings, bold, italic, code, links
- [ ] Verify no console errors

### Step 6: File Dialogs (R6)
- [ ] Create src-tauri/src/commands/dialogs.rs with open_file_dialog, save_file_dialog
- [ ] Use tauri::dialog::FileDialogBuilder with .add_filter("Markdown", &["md", "txt"])
- [ ] Implement cancel handling: Ok(None) → { cancelled: true }
- [ ] Update src-tauri/src/lib.rs and main.rs to register dialog commands
- [ ] Create src/lib/dialogs.ts with openFileDialog, saveFileDialog wrappers
- [ ] Update src/main.ts: add button event listeners for file open/save
- [ ] Update index.html: add buttons with id="btn-open" and id="btn-save"
- [ ] Implement flow: button → dialog → readFile (or writeFile) → editor update
- [ ] Verify dialogs appear and file selection works
- [ ] Verify cancel closes dialog without error

### Code Quality (All Steps)
- [ ] No TODO comments in source files
- [ ] All Rust code compiles with `cargo build` (no warnings)
- [ ] All TypeScript code passes `tsc --noEmit` (strict mode)
- [ ] No panics in Rust; all Result types handled
- [ ] No implicit any in TypeScript

### Documentation (All Steps)
- [ ] docs/specs/phase1-infrastructure/ fully populated
- [ ] docs/build-notes/macos-dmg-workaround.md complete with ADR
- [ ] package.json includes scripts: tauri dev, tauri build
- [ ] tauri.conf.json includes comments for critical fields
- [ ] README references build instructions

---

## Known Limitations & Deferred Work

### Known Limitations (Not Blocking Phase 1)

1. **Sequoia/Tahoe DMG Compiler:** No official Tauri patch as of 2026-04-04. The `CI=true` workaround is primary; manual fallback is secondary. See docs/build-notes/macos-dmg-workaround.md.
2. **Code Signing:** Requires Apple Developer ID account. Personal accounts are acceptable for development builds.
3. **Atomic Writes on POSIX:** `fs::rename` is atomic on macOS; behavior on other platforms may differ (future scope).

### Deferred to Phase 2+

- **Live Preview (Typora-style):** Decoration-based syntax hiding; requires Phase 2 architecture
- **Multi-File Tabs:** Tab management, session state
- **Settings & Persistence:** JSON config, window state restore
- **Theming:** CSS variables, plugin architecture
- **Menu System:** Native Tauri menu, menu events
- **Export/Import:** PDF, HTML output
- **Auto-Save:** Debounced save, file watcher
- **Plugin System:** Extension points, error isolation

All deferred items are logged here; **no TODO comments in source code**.

---

## Development Environment Setup (Prerequisites)

### Required Tools

- **Node.js** 18+ (for Vite, npm; test with `node --version`)
- **Rust** 1.70+ (for Tauri, Cargo; test with `rustc --version`)
- **macOS** 13+ (build target; Xcode Command Line Tools required)
- **Apple Developer ID** (for code signing; personal account acceptable)

### Verification Commands

```bash
# Verify Rust
rustc --version                    # Expect: rustc 1.70.0+
cargo --version                    # Expect: cargo 1.70.0+

# Verify Node
node --version                     # Expect: v18.0.0+
npm --version                      # Expect: 9.0.0+

# Verify Xcode tools
xcode-select --print-path          # Expect: /Applications/Xcode.app/Contents/Developer
codesign --version                 # Expect: version X.Y

# Verify Apple Developer ID (after setup)
security find-identity -v -p codesigning /Library/Keychains/System.keychain
```

---

## Handoff Summary

**Requirements source:** `docs/requirements/active_task.md`

**Architecture blueprint:** This file (`docs/specs/phase1-infrastructure/00_index.md`)

**Step files created:**
- `docs/specs/phase1-infrastructure/step_00_test_setup.md` — Test infrastructure (Vitest, Rust tests, mocks)
- `docs/specs/phase1-infrastructure/step_01_scaffolding.md` — Tauri v2 + Vite + TypeScript init
- `docs/specs/phase1-infrastructure/step_02_permissions.md` — Tauri v2 capabilities, default.json
- `docs/specs/phase1-infrastructure/step_03_dmg_workaround.md` — DMG build ADR, CI=true, code signing
- `docs/specs/phase1-infrastructure/step_04_rust_command_bridge.md` — Rust module structure, atomic writes, test specs
- `docs/specs/phase1-infrastructure/step_05_codemirror_setup.md` — CM6 setup, extensions, editor factory
- `docs/specs/phase1-infrastructure/step_06_file_dialogs.md` — Dialog commands, TypeScript wrappers, UI wiring

**Next Step:** Activate `@lead-developer`. Start with this `00_index.md` as orientation, then implement each `step_NN_*.md` file in strict order (00 → 01 → 02 → 03 → 04 → 05 → 06). Follow Red/Green/Refactor TDD pattern. All tests must pass before moving to the next step. No skipping steps.

**Code Reviewer Mandate:** After each step completion, verify against the Edge Case Coverage Matrix. All 20 edge cases (EC-1 through EC-20) must be covered by tests or documented handling by the end of Step 6.

---

**Architecture Complete — Ready for Implementation**

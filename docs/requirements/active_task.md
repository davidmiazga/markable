# Active Task: Markable 2.0 — Phase 1 Infrastructure & "Tahoe" Workaround

**Status:** Requirements Validated
**Date:** 2026-04-04
**Phase:** 1 — Infrastructure & Build Foundation

---

## Executive Summary

Phase 1 establishes the foundational infrastructure for Markable 2.0, focusing on **project scaffolding**, **macOS Tahoe/Sequoia DMG build compatibility**, and **core file I/O capabilities**. This phase does not deliver the full editor experience—that comes in Phase 2. Instead, Phase 1 ensures the build pipeline is solid, the Rust-TypeScript bridge is functional, and basic CodeMirror 6 integration works.

This phase is **critical** because it unblocks all downstream development. Without a working build and stable file I/O, subsequent phases cannot proceed. The macOS Sequoia/Tahoe DMG compiler incompatibility is a known blocker that must be solved upfront.

---

## Functional Requirements

### R1: Tauri v2 + Vite + TypeScript Scaffolding

**What must be built:**
- Initialize a new Tauri v2 project with Vite + TypeScript (vanilla template).
- Verify the initial dev build completes: `npm run tauri dev` launches a window.
- Configure Tauri's dev and build scripts in `package.json`.
- Tauri CLI version locked in `package.json` (or via `cargo.lock` equivalent).

**Acceptance Criteria:**
- `npm install` succeeds without warnings.
- `npm run tauri dev` opens a Tauri window with a working TypeScript environment.
- Hot reload works (edit a TypeScript file, window reflects change).
- No build errors or deprecation warnings on initial setup.

---

### R2: Tauri v2 Permission Scopes

**What must be built:**
- Define granular permission scopes in `src-tauri/capabilities/default.json`.
- Enable `fs` scope with read/write access to user-selected directories.
- Enable `dialog` scope for File Open and Save As dialogs.
- Document the reasoning behind each scope choice.

**Acceptance Criteria:**
- `tauri.conf.json` and `capabilities/default.json` are properly configured.
- No "permission denied" errors when attempting file I/O operations.
- The app does not request blanket filesystem access; scopes are granular.

---

### R3: macOS DMG Build Workaround (CRITICAL)

**What must be built:**

This is the **single most critical requirement** for Phase 1 because it blocks all macOS distribution.

#### 3.1 CI=true Headless DMG

- Set `CI=true` in the build environment to force Tauri's bundler to use a "headless" DMG creation method.
- This bypasses the AppleScript-based icon positioning that triggers the Sequoia/Tahoe security checks.
- Document the environment variable requirement in build scripts and CI/CD.

**Build command:**
```bash
CI=true npm run tauri build
```

#### 3.2 Code Signing & Notarization

- Configure `signingIdentity` in `tauri.conf.json` with a valid Apple Developer ID.
- Provide placeholders and instructions for users to substitute their own signing identity.
- Document that unsigned apps are flagged as "Damaged" by Gatekeeper on macOS Tahoe+.

**Verification command:**
```bash
spctl --assess --verbose /path/to/Markable.app
```

Expected output: `accepted` (not `rejected`).

#### 3.3 Fallback: App-Only Build + Manual DMG

- If `CI=true` still fails, provide a fallback script:
  ```bash
  cargo tauri build --bundles app
  create-dmg --volname "Markable" --window-pos 200 120 --window-size 600 300 \
    "Markable.dmg" "src-tauri/target/release/bundle/macos/Markable.app"
  ```
- Document this as a workaround for developers, not end-users.

#### 3.4 Documentation

- Create `docs/build-notes/macos-dmg-workaround.md` with:
  - Explanation of the Sequoia/Tahoe incompatibility.
  - Step-by-step build instructions with `CI=true`.
  - Fallback procedures if the primary workaround fails.
  - Links to Tauri GitHub issues for latest updates.

**Acceptance Criteria:**
- `CI=true npm run tauri build` produces a working DMG file (no "Damaged" errors).
- DMG can be opened and the app can be dragged to `/Applications`.
- The app launches without Gatekeeper warnings.
- Signing identity is properly configured (verified via `spctl`).

---

### R4: Rust Command Bridge (File I/O)

**What must be built:**

Establish a working Tauri IPC bridge for file operations. This is the backbone for all file I/O in Phase 2+.

#### 4.1 read_file Command

**Function signature (Rust):**
```rust
#[tauri::command]
fn read_file(path: String) -> Result<String, String>
```

**Behavior:**
- Accept an absolute file path.
- Read the file contents as UTF-8.
- Return the contents on success, or a descriptive error message on failure.

**Error cases to handle:**
- File not found → `"File not found: <path>"`
- Permission denied → `"Permission denied: <path>"`
- Invalid UTF-8 → `"Invalid UTF-8 in file: <path>"`

#### 4.2 write_file Command

**Function signature (Rust):**
```rust
#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String>
```

**Behavior:**
- Accept an absolute file path and content string.
- Write the content atomically (temp-file-swap pattern).
- Return success or a descriptive error message.

**Atomic Write Pattern (MUST IMPLEMENT):**
1. Write to a temporary file in the same directory as the target file.
2. Sync the temporary file to disk.
3. Atomically rename the temp file to the target path (using `std::fs::rename`).
4. If any step fails, ensure the original file is untouched.

**Error cases to handle:**
- Path is invalid or contains invalid characters.
- Disk is full → `"Disk full: insufficient space to write <path>"`
- Permission denied → `"Permission denied: <path>"`
- Temp-file-swap fails → `"Write failed: atomic swap could not complete"`

#### 4.3 Frontend TypeScript Bridge

**Function signatures (TypeScript):**
```typescript
async function readFile(path: string): Promise<string>
async function writeFile(path: string, content: string): Promise<void>
```

**Behavior:**
- Use Tauri's `@tauri-apps/api/core` to invoke the Rust commands.
- Wrap errors in a descriptive format for UI consumption.

**Acceptance Criteria:**
- `npm run tauri dev` allows manual testing of `readFile` and `writeFile` via browser console.
- Reading a valid file returns its contents.
- Writing to a new file creates it; writing to an existing file replaces it atomically.
- All error cases produce user-friendly messages.
- Atomic swap is verified by killing the app mid-write and confirming the original file is uncorrupted.

---

### R5: Basic CodeMirror 6 Integration

**What must be built:**

A minimal, functional CodeMirror 6 editor with Markdown syntax highlighting. This is the foundation for Phase 2's live preview mode.

#### 5.1 CodeMirror 6 Setup

**Dependencies to install:**
```bash
npm install @codemirror/view @codemirror/state @codemirror/basic-setup @codemirror/lang-markdown
```

**Basic EditorView:**
- Create an EditorView instance in `src/main.ts` or a dedicated module.
- Attach it to a DOM element (e.g., `#editor`).
- Enable `basicSetup` extension (includes line numbers, folding, gutter, etc.).
- Load `markdown()` language support for syntax highlighting.

#### 5.2 Markdown Syntax Highlighting

**Requirements:**
- Headings (`#`, `##`, etc.) are highlighted.
- Bold (`**text**`), italic (`*text*`), and code inline (`` `text` ``) are highlighted.
- Code blocks with fence markers (` ``` `) are highlighted.
- Links (`[text](url)`) are highlighted.
- No custom decorations or live preview hiding in Phase 1 — just basic syntax highlighting.

**Acceptance Criteria:**
- A `.md` file opened in the editor displays syntax colors.
- Editing the text updates highlighting in real-time.
- No console errors related to CodeMirror.

---

### R6: File Dialog Integration

**What must be built:**

Use Tauri's native file dialogs for Open and Save As operations.

#### 6.1 File Open Dialog

**Function signature (Rust):**
```rust
#[tauri::command]
async fn open_file_dialog() -> Result<String, String>
```

**Behavior:**
- Invoke `tauri::api::dialog::FileDialogBuilder` with:
  - Default directory: user's home folder or last-opened directory.
  - File filters: `.md` and `.txt` files.
- Return the selected file path (absolute) on success.
- Return `None` (or error) if the user cancels.

**Acceptance Criteria:**
- Clicking a button triggers the dialog.
- User can navigate to a `.md` file and select it.
- Selected path is returned and can be used with `read_file`.

#### 6.2 File Save As Dialog

**Function signature (Rust):**
```rust
#[tauri::command]
async fn save_file_dialog() -> Result<String, String>
```

**Behavior:**
- Invoke `tauri::api::dialog::FileDialogBuilder` with:
  - Default directory: last-saved directory or home folder.
  - Default file name: `"untitled.md"`.
- Return the selected file path on success.

**Acceptance Criteria:**
- Clicking a button triggers the dialog.
- User can specify a new filename and location.
- Selected path is returned and can be used with `write_file`.

---

## Non-Functional Requirements

### NF1: Build Reproducibility

- The build process must be deterministic: running `CI=true npm run tauri build` twice produces identical (bit-for-bit or functionally equivalent) artifacts.
- All build dependencies are pinned to specific versions (no floating versions like `^1.0.0`).

### NF2: Build Speed (Development)

- `npm run tauri dev` must launch a window within 30 seconds on a modern machine.
- Hot reload of TypeScript files must complete within 2 seconds.

### NF3: Code is Test-Ready

- Rust modules have public interfaces suitable for unit testing.
- No monolithic `main.rs`; code is modularized by concern (e.g., `io.rs`, `commands.rs`).
- TypeScript is organized into modules with clear exports.

### NF4: macOS-First Experience

- The app uses Tauri's `hide_on_close` behavior (standard macOS convention).
- The window title bar is visible and functional.
- No platform-specific #[cfg] blocks in Phase 1 (architecture is platform-agnostic, even if build is macOS-only).

### NF5: Atomic File Writes

- All `write_file` operations use the temp-file-swap pattern.
- If a write is interrupted (process kill, power failure), the original file remains uncorrupted.

### NF6: Error Handling

- All errors from Rust are returned to TypeScript with descriptive messages.
- No panics in production code; all `Result` types are handled.

---

## Edge Case Inventory

> Every item below must be covered by a test or explicit handling. This list is the Code Reviewer's mandatory checklist for Phase 1.

| # | Edge Case | Expected Behavior |
|---|---|---|
| EC-1 | Build with `CI=true` on non-macOS platform | Build succeeds but is skipped/documented as macOS-only. |
| EC-2 | Build with missing `signingIdentity` in `tauri.conf.json` | Build fails with clear error message pointing to config file. |
| EC-3 | DMG build fails even with `CI=true` | Fallback script provided; build instructions document this scenario. |
| EC-4 | App is unsigned (no code signature) | Running `spctl --assess` returns `rejected`; documentation explains next steps. |
| EC-5 | File path passed to `read_file` does not exist | Return error: `"File not found: <path>"`. |
| EC-6 | File path passed to `read_file` points to a directory | Return error: `"Is a directory: <path>"`. |
| EC-7 | User lacks read permission on file | Return error: `"Permission denied: <path>"`. |
| EC-8 | File being read is deleted mid-operation | Return error: `"File not found: <path>"`. |
| EC-9 | Disk is full during `write_file` | Return error: `"Disk full: insufficient space to write <path>"`; original file untouched. |
| EC-10 | User lacks write permission on target directory | Return error: `"Permission denied: <path>"`. |
| EC-11 | Write operation is killed/interrupted mid-swap | Original file remains uncorrupted (temp file may be orphaned). |
| EC-12 | File path contains invalid UTF-8 sequences | Behavior is platform-dependent; document assumptions (Rust String handles UTF-8 paths on macOS). |
| EC-13 | Temp file swap atomic rename fails on macOS | Return error: `"Write failed: atomic swap could not complete"`. |
| EC-14 | File Open dialog is cancelled by user | Return error or empty string; TypeScript handles gracefully (no-op). |
| EC-15 | File Save As dialog is cancelled by user | Return error; TypeScript handles gracefully (no-op). |
| EC-16 | Multiple simultaneous `read_file` calls on the same file | All succeed (reads are concurrent and non-blocking). |
| EC-17 | Simultaneous `read_file` and `write_file` on the same file | Read may get old or new content; no crash or corruption. |
| EC-18 | CodeMirror initialization fails (missing DOM element) | Console error with clear message; app does not panic. |
| EC-19 | CodeMirror fails to load markdown language plugin | Fallback to plaintext mode; console warning. |
| EC-20 | Tauri permissions are misconfigured | Operations fail with "Permission denied" or similar; error messages guide user. |

---

## Technical Constraints

### C1: Tauri v2 (Not v1)
- All code must target Tauri v2 APIs.
- No legacy Tauri v1 patterns or plugins.

### C2: TypeScript Strict Mode
- `tsconfig.json` must have `"strict": true`.
- No implicit `any` types.

### C3: Rust Edition 2021
- Use Rust 2021 edition syntax.
- Dependencies must support Rust 1.70+.

### C4: macOS 13+
- Target macOS 13 (Ventura) or later.
- Do not use APIs newer than macOS 13.

### C5: Atomic Saves are Mandatory
- **Every** file write must use temp-file-swap pattern.
- No direct `std::fs::write()` calls to the target file.

### C6: Code Signing is Mandatory
- All macOS builds must be code-signed.
- Unsigned apps will fail Gatekeeper verification on Tahoe+.

### C7: No TODO Comments in Source
- Deferred work must be logged in architecture spec files (`docs/specs/`), not in comments.

### C8: No base64 Image Embedding
- Images are always referenced by path.
- Tauri's `asset://` protocol will be used in Phase 2.

---

## Acceptance Criteria

All of the following must be true before Phase 1 is complete:

### Build & Execution
- [ ] `npm install` succeeds without errors or warnings.
- [ ] `npm run tauri dev` launches a Tauri window with a working editor.
- [ ] Hot reload works for TypeScript changes.
- [ ] `CI=true npm run tauri build` produces a working macOS DMG (no "Damaged" errors).
- [ ] The built app opens without Gatekeeper warnings.
- [ ] Code signing is verified: `spctl --assess --verbose /path/to/Markable.app` returns `accepted`.

### File I/O
- [ ] `read_file` Rust command is implemented and callable from TypeScript.
- [ ] `write_file` Rust command is implemented with atomic swap pattern.
- [ ] A test file can be opened via dialog and read successfully.
- [ ] A test file can be saved via dialog and verified on disk.
- [ ] Atomic write is tested: interrupt a write and verify original file is uncorrupted.

### CodeMirror 6
- [ ] CodeMirror 6 editor is visible and editable in the Tauri window.
- [ ] Markdown syntax highlighting works (headings, bold, italic, code fences, links).
- [ ] Editing text updates highlighting in real-time.
- [ ] No console errors related to CodeMirror or Tauri.

### Permissions & Dialogs
- [ ] File Open dialog appears and allows file selection.
- [ ] File Save As dialog appears and allows filename entry.
- [ ] `fs` and `dialog` permission scopes are configured.

### Code Quality
- [ ] All Rust code compiles with no warnings (or documented allowances).
- [ ] All TypeScript code passes `tsc --noEmit` (strict mode).
- [ ] No TODO comments in source files.

### Documentation
- [ ] `docs/build-notes/macos-dmg-workaround.md` exists and is complete.
- [ ] `tauri.conf.json` has comments explaining critical fields (signing, permissions).
- [ ] `package.json` documents how to run dev and build commands.

---

## Out of Scope for Phase 1

Explicitly deferred (do NOT implement):

- Live preview mode (hiding Markdown syntax) — Phase 2.
- Multi-file tabs — Phase 2 (basic scaffolding only).
- Settings and persistence — Phase 2.
- Theming — Phase 2.
- Menu system — Phase 2.
- Export/Import — Phase 2.
- Auto-save — Phase 2.
- Any editor features beyond basic syntax highlighting.
- Plugin system or architecture — Phase 2+.

---

## Dependencies & Constraints

### Required Tools
- **Node.js** 18+ (for Vite and npm).
- **Rust** 1.70+ (for Tauri CLI).
- **macOS 13+** (build target; development can be on macOS 12 but targeting is 13+).
- **Apple Developer ID** (for code signing; personal account is acceptable for development).
- **Xcode Command Line Tools** (for code signing utilities).

### Tauri Crate Versions
- `tauri` v2.x
- `tauri-build` v2.x
- All other Tauri crates follow v2.x.

### npm Packages
- `@tauri-apps/api` — latest v2.x
- `@codemirror/view`, `@codemirror/state`, `@codemirror/basic-setup`, `@codemirror/lang-markdown` — latest stable versions.
- `vite` — latest v5.x

### Known Limitations
- **Sequoia/Tahoe DMG Compiler:** No official Tauri patch exists as of 2026-04-04. The `CI=true` workaround is the primary solution; fallback is manual `.app` + `create-dmg`.
- **Code Signing:** Developer must have an Apple Developer ID. Temporary certificate workarounds are not supported for Phase 1 production builds.

---

## Handoff to Phase 2

**Upon completion of Phase 1, the following artifacts exist:**

1. **Working Tauri v2 project** with dev and build pipelines functional.
2. **Rust command bridge** (`read_file`, `write_file`) with atomic saves.
3. **File dialog integration** (Open, Save As).
4. **CodeMirror 6 editor** with Markdown syntax highlighting.
5. **Build documentation** (`docs/build-notes/macos-dmg-workaround.md`).
6. **Test infrastructure** (basis for TDD in Phase 2).

**Phase 2 builds on Phase 1 by adding:**
- Multi-file tab support.
- Live preview (Typora-style syntax hiding).
- Settings and state persistence.
- Theming.
- Menu system.
- Menu-driven export/import.

---

## Summary

Phase 1 is the **infrastructure and build foundation** for Markable 2.0. It establishes a working Tauri v2 + Vite + TypeScript environment, solves the critical macOS Tahoe DMG compiler incompatibility, and provides a functional file I/O bridge from TypeScript to Rust. By the end of Phase 1, developers have a solid platform to build the editor features in Phase 2.

**Phase 1 does not deliver the editor experience**; it delivers the platform on which the editor will be built.

---

**Next step:** Activate `@software-architect` and provide this document as context for architecture design.

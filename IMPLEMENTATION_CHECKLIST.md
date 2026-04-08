# Markable 2.0 — Phase 1 Implementation Checklist

**Status:** Architecture Complete. Ready for Lead Developer.

**Total Steps:** 7 (step_00 through step_06)
**Estimated Timeline:** ~2-3 weeks for full Phase 1
**Test-Driven:** All implementation follows Red/Green/Refactor TDD pattern

---

## Overview

This checklist guides you through Phase 1 implementation. **Follow steps in strict order** (00 → 01 → 02 → 03 → 04 → 05 → 06). Each step has:
- Clear acceptance criteria
- Detailed tasks with code examples
- Test requirements
- Edge case coverage

**No TODO comments in source code.** All deferred work is logged in architecture specs.

---

## Pre-Implementation Verification

Before starting, verify your environment:

```bash
# Check Node.js (18+)
node --version

# Check Rust (1.70+)
rustc --version

# Check Xcode tools (macOS)
xcode-select --print-path
codesign --version

# Verify Apple Developer ID (for code signing)
security find-identity -v -p codesigning /Library/Keychains/System.keychain
```

**All checks passing?** Proceed to Step 00.

---

## Step 00: Test Infrastructure Setup ✅

**Goal:** Set up Vitest, Rust tests, and mocking infrastructure before any implementation code.

**Time estimate:** 1-2 hours

**Key deliverables:**
- [ ] Vitest installed and configured (`vitest.config.ts`)
- [ ] Test mocks and helpers created (`tests/mocks/tauri.ts`)
- [ ] Example tests pass (`npm run test:run`)
- [ ] Rust test utilities in place (`src-tauri/src/test_utils.rs`)
- [ ] Testing guide written (`docs/testing.md`)

**Files to create/modify:**
```
✓ vitest.config.ts                    (NEW)
✓ tests/setup.ts                      (NEW)
✓ tests/mocks/tauri.ts                (NEW)
✓ tests/mocks/index.ts                (NEW)
✓ tests/example.test.ts               (NEW)
✓ src-tauri/src/lib.rs                (NEW)
✓ src-tauri/src/test_utils.rs         (NEW)
✓ docs/testing.md                     (NEW)
✓ package.json                        (UPDATE: add test scripts)
```

**Success criteria:**
- `npm run test:run` shows 3 passing tests
- `cargo test --lib` in src-tauri passes
- Zero TypeScript errors in tsconfig

**Next:** Move to Step 01 once all checkboxes pass.

---

## Step 01: Tauri v2 + Vite + TypeScript Scaffolding

**Goal:** Initialize a new Tauri project with strict TypeScript configuration.

**Time estimate:** 30-45 minutes

**Key deliverables:**
- [ ] Project scaffolded via `npm create tauri-app`
- [ ] Dependencies installed (`npm install`)
- [ ] TypeScript in strict mode (tsconfig.json)
- [ ] Vite hot reload working (<2s)
- [ ] `npm run tauri dev` opens a window
- [ ] `npm run build` succeeds with zero warnings

**Files created by scaffolding:**
```
✓ package.json + package-lock.json
✓ tsconfig.json                       (CONFIGURE for strict mode)
✓ vite.config.ts                      (VERIFY port 1420)
✓ index.html
✓ src/main.ts
✓ src/style.css
✓ src-tauri/Cargo.toml + Cargo.lock
✓ src-tauri/src/main.rs
✓ src-tauri/tauri.conf.json           (VERIFY base config)
```

**Success criteria:**
- `npm run tauri dev` launches in <30s
- Hot reload works (edit src/main.ts → page updates <2s)
- `tsc --noEmit` produces zero errors
- `npm run build` completes without warnings

**Next:** Move to Step 02 once window opens and hot reload works.

---

## Step 02: Tauri v2 Capabilities & Permissions

**Goal:** Configure granular security scopes for file I/O and dialogs.

**Time estimate:** 30 minutes

**Key deliverables:**
- [ ] `src-tauri/capabilities/default.json` created
- [ ] fs:default scope configured (read/write user-selected paths)
- [ ] dialog:allow-open, dialog:allow-save scopes added
- [ ] Window and event capabilities configured
- [ ] tauri.conf.json references capabilities

**Files to create:**
```
✓ src-tauri/capabilities/default.json (NEW)
```

**Success criteria:**
- `src-tauri/capabilities/default.json` is valid JSON
- All permission grants are documented with rationale
- Build completes without capability warnings

**Next:** Move to Step 03 once capabilities are defined.

---

## Step 03: macOS DMG Build Workaround & Code Signing ⚠️ CRITICAL

**Goal:** Enable macOS builds with the CI=true workaround and code signing.

**Time estimate:** 1-2 hours

**Key deliverables:**
- [ ] Code signing configured in tauri.conf.json (`signingIdentity`)
- [ ] `scripts/build-dmg-fallback.sh` created and tested
- [ ] `scripts/build-macos.sh` convenience script created
- [ ] `docs/build-notes/macos-dmg-workaround.md` complete with ADR
- [ ] Tier 1 build succeeds: `CI=true npm run tauri build`
- [ ] Code signature verified: `spctl --assess --verbose` returns "accepted"
- [ ] Tier 2 fallback tested (optional but recommended)

**Files to create/modify:**
```
✓ src-tauri/tauri.conf.json           (UPDATE: add signingIdentity)
✓ scripts/build-dmg-fallback.sh       (NEW, make executable)
✓ scripts/build-macos.sh              (NEW, make executable)
✓ scripts/setup-signing.sh            (NEW, optional helper)
✓ docs/build-notes/macos-dmg-workaround.md (UPDATE: full ADR + instructions)
```

**Success criteria:**
- `CI=true npm run tauri build` produces Markable.dmg without errors
- `spctl --assess --verbose src-tauri/target/release/bundle/macos/Markable.app` returns "accepted"
- DMG can be opened in Finder and app dragged to /Applications
- App launches without Gatekeeper warnings

**⚠️ Critical:** Without code signing, app will be flagged as "Damaged" on Sequoia.

**Next:** Move to Step 04 once DMG build succeeds.

---

## Step 04: Rust File I/O Command Bridge

**Goal:** Implement atomic file reads/writes and expose via Tauri commands.

**Time estimate:** 2-3 hours

**Key deliverables:**
- [ ] `src-tauri/src/commands/io.rs` created with read_file, write_file
- [ ] Atomic write algorithm implemented (temp file → sync_all → rename)
- [ ] Error messages standardized ("File not found: {path}", etc.)
- [ ] `src-tauri/src/commands/mod.rs` registry created
- [ ] Commands registered in main.rs and lib.rs
- [ ] `src/lib/bridge.ts` with discriminated union types
- [ ] `src/lib/errors.ts` with TauriCommandError interface
- [ ] Tests pass: `npm run test:run` and `cargo test`
- [ ] Edge cases EC-5 through EC-13 covered by tests

**Files to create:**
```
✓ src-tauri/src/commands/io.rs        (NEW)
✓ src-tauri/src/commands/mod.rs       (NEW)
✓ src-tauri/src/lib.rs                (UPDATE: export commands)
✓ src-tauri/src/main.rs               (UPDATE: register commands)
✓ src/lib/bridge.ts                   (NEW)
✓ src/lib/errors.ts                   (NEW)
✓ tests/bridge.test.ts                (NEW)
```

**Test requirements (edge cases):**
- EC-5: File doesn't exist (read)
- EC-6: Path is directory (read)
- EC-7: Permission denied (read)
- EC-8: File deleted mid-operation
- EC-9: Disk full (write)
- EC-10: Permission denied (write)
- EC-11: Write killed mid-swap (atomic safety)
- EC-12: Invalid UTF-8 path handling
- EC-13: Atomic rename failure recovery

**Success criteria:**
- All tests pass: `npm run test:run` (TypeScript) and `cargo test` (Rust)
- `npm run tauri dev` launches without errors
- No TODO comments in source files
- Error messages match standardized format

**Next:** Move to Step 05 once all tests pass.

---

## Step 05: CodeMirror 6 Markdown Editor Setup

**Goal:** Initialize CodeMirror 6 with Markdown syntax highlighting.

**Time estimate:** 1.5-2 hours

**Key deliverables:**
- [ ] CodeMirror 6 and markdown extension installed
- [ ] `src/editor/editor.ts` with createEditor factory
- [ ] `src/editor/extensions.ts` with buildExtensions
- [ ] Editor mounted in src/main.ts
- [ ] index.html updated with editor container
- [ ] Syntax highlighting working (headings, bold, italic, code, links)
- [ ] Tests pass: `npm run test:run`
- [ ] Edge cases EC-18, EC-19 covered by tests

**Files to create:**
```
✓ src/editor/editor.ts                (NEW)
✓ src/editor/extensions.ts            (NEW)
✓ tests/editor.test.ts                (NEW)
✓ src/main.ts                         (UPDATE: create editor)
✓ index.html                          (UPDATE: add editor container)
```

**Test requirements (edge cases):**
- EC-18: CodeMirror init fails (missing DOM)
- EC-19: Markdown plugin fails (fallback gracefully)

**Success criteria:**
- `npm run tauri dev` shows working editor with Markdown syntax highlighting
- Typing in editor updates the display
- No console errors
- All tests pass

**Next:** Move to Step 06 once editor renders and tests pass.

---

## Step 06: File Dialog Integration

**Goal:** Implement native file open/save dialogs and wire to editor.

**Time estimate:** 1.5-2 hours

**Key deliverables:**
- [ ] `src-tauri/src/commands/dialogs.rs` with open_file_dialog, save_file_dialog
- [ ] Dialog commands registered in main.rs
- [ ] `src/lib/dialogs.ts` with TypeScript wrappers
- [ ] Toolbar UI with Open/Save buttons added to index.html
- [ ] Button styles in src/style.css
- [ ] Event handlers in src/main.ts (openFile, saveFile, saveFileAs)
- [ ] Tests pass: `npm run test:run`
- [ ] Edge cases EC-14, EC-15, EC-20 covered by tests

**Files to create/modify:**
```
✓ src-tauri/src/commands/dialogs.rs   (NEW)
✓ src-tauri/src/main.rs               (UPDATE: register dialogs)
✓ src/lib/dialogs.ts                  (NEW)
✓ tests/main.test.ts                  (NEW, optional)
✓ index.html                          (UPDATE: add toolbar)
✓ src/style.css                       (UPDATE: toolbar styles)
✓ src/main.ts                         (UPDATE: dialog handlers)
```

**Test requirements (edge cases):**
- EC-14: File Open dialog cancelled
- EC-15: File Save As dialog cancelled
- EC-20: Tauri permissions misconfigured (should fail gracefully)

**Success criteria:**
- `npm run tauri dev` shows toolbar with "📂 Open" and "💾 Save" buttons
- Clicking Open shows file dialog (Finder on macOS)
- Selecting file loads contents into editor
- Clicking Save writes editor contents to disk
- Cancelling dialogs doesn't cause errors
- All tests pass
- No console errors

**Next:** Proceed to Phase 1 completion once all tests pass.

---

## Phase 1 Completion Criteria

Once all 7 steps are complete, verify:

### Code Quality
- [ ] Zero TODO comments in any source file
- [ ] `tsc --noEmit` produces zero errors
- [ ] `cargo build --release` succeeds
- [ ] `npm run test:run` shows all tests passing
- [ ] `cargo test` shows all Rust tests passing
- [ ] No console warnings or errors in `npm run tauri dev`

### Build & Distribution
- [ ] `CI=true npm run tauri build` produces `Markable.dmg`
- [ ] DMG opens in Finder without "Damaged" errors
- [ ] App can be dragged to /Applications
- [ ] App launches from /Applications without Gatekeeper warnings
- [ ] `spctl --assess --verbose /Applications/Markable.app` returns "accepted"

### Edge Case Coverage
- [ ] All 20 edge cases (EC-1 through EC-20) are tested or documented
- [ ] Each step's acceptance checklist items are checked off

### Documentation
- [ ] `docs/specs/phase1-infrastructure/` fully populated
- [ ] `docs/build-notes/macos-dmg-workaround.md` complete with ADR
- [ ] `docs/testing.md` documents testing patterns
- [ ] `PLAN.md` and `CLAUDE.md` are up-to-date

### Handoff
- [ ] All files match spec files (no divergence)
- [ ] No skipped steps
- [ ] Architecture specs reflect implementation

---

## Debugging Checklist

**If a step fails, check:**

### Step 00 (Tests)
- [ ] Node.js version 18+? (`node --version`)
- [ ] Vitest installed? (`npm list vitest`)
- [ ] `npm run test:run` output for error messages

### Step 01 (Scaffolding)
- [ ] Rust installed? (`rustc --version`)
- [ ] Port 1420 free? (`lsof -i :1420`)
- [ ] Xcode tools? (`xcode-select --print-path`)
- [ ] Check Tauri build output for specific errors

### Step 03 (Code Signing)
- [ ] Apple ID available? (`security find-identity`)
- [ ] signingIdentity matches? (Check tauri.conf.json)
- [ ] `CI=true` set? (`echo $CI`)
- [ ] Run `spctl --assess --verbose` to verify signature

### Step 04 (Rust Commands)
- [ ] Cargo dependencies resolved? (`cargo build`)
- [ ] Rust error output for specific failures
- [ ] Check `src-tauri/src/main.rs` registers commands

### Step 05 (CodeMirror)
- [ ] DOM ready before editor init? (Check console)
- [ ] CodeMirror dependencies installed? (`npm list @codemirror/view`)
- [ ] Editor target element exists? (Check index.html #editor)

### Step 06 (Dialogs)
- [ ] Dialog capabilities in default.json? (EC-20)
- [ ] Commands registered in main.rs?
- [ ] Buttons have correct IDs? (btn-open, btn-save)

---

## Time Estimates

| Step | Task | Estimate |
|------|------|----------|
| 00 | Test Infrastructure | 1-2 hrs |
| 01 | Scaffolding | 30-45 min |
| 02 | Permissions | 30 min |
| 03 | Build + Signing | 1-2 hrs |
| 04 | File I/O | 2-3 hrs |
| 05 | CodeMirror | 1.5-2 hrs |
| 06 | Dialogs | 1.5-2 hrs |
| **Total** | **Phase 1** | **~9-13 hrs** |

---

## Communication

- **Questions?** Check the spec file for your current step (e.g., step_04_rust_command_bridge.md)
- **Stuck on an edge case?** Refer to `docs/requirements/active_task.md` for edge case definitions
- **Test failing?** Review test patterns in `docs/testing.md`
- **Build failing?** Check troubleshooting sections in relevant step file

---

## Ready to Start?

✅ **Checklist complete.** Environment verified. Architecture specs ready.

**Next:** Begin with **Step 00: Test Infrastructure Setup** (docs/specs/phase1-infrastructure/step_00_test_setup.md).

Good luck! 🚀

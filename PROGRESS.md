# Markable 2.0 — Progress Tracker

**Last Updated:** 2026-04-28
**Current Status:** Phase 1 complete ✅ — Phase 2 in progress 🟡

---

## Phase 2 Status

### Completed ✅
- **Tab system** — Multi-file tabs, regular/vertical/minimal modes
- **File browser** — Vault system, sidebar panel, file tree
- **Plugin system** — Core plugin scaffold, copy-on-install pattern, sync script
- **Settings panel** — Appearance, editor, content, keybindings, plugins sections
- **Command bar** — Fuzzy search overlay, keyboard navigation
- **Keybindings** — Panel UI, default keybindings, workflow integration
- **Daily note** — Rust commands, plugin scaffold
- **Auto-save** — Plugin with core logic and settings UI
- **Status bar** — Plugin
- **Live preview** — Typora-style hide-syntax-unless-active-line
- **Themes** — 5 default themes (Nord, Solarized Dark/Light, Dracula, Monokai) bundled into app install; `copy_default_themes` Rust command auto-installs on first launch; `sync:themes` dev script; Nord and Solarized Dark color values restored to original palette
- **Font** — Inter Variable (woff2, 100–900 weight axis) bundled in `public/fonts/`, loaded via `<link>` in index.html; works without system font installed
- **Heading scale** — CSS custom properties (`--heading-h1-size` … `--heading-h6-weight`) control all heading sizes/weights from top of `styles.css`
- **Vault UX refactor** — New Vault decoupled from Manage Vaults modal; hover-reveal unmount button (12% → 50% on row hover, red on button hover); inline rename on double-click; context menu (Unmount / Rename / Edit Type); Manage Vaults entry points in Plugin Panel footer + `vault-manage` keybinding slot; 31 Vitest tests; code-reviewer approved 2026-04-25
- **Find & Replace** — Custom floating widget (Cmd-F / Cmd-Shift-F); CM6 panel suppressed; drag + position persistence; match count with 999+ cap; all 29 edge cases covered; 72 Vitest tests; code-reviewer approved 2026-04-09
- **Tiny Three** — Paste Link (Cmd-K), Move Line Up/Down (Opt-↑/↓), Close All (Cmd-Shift-W); 21 Vitest tests; code-reviewer approved 2026-04-09
- **Export HTML** — Cmd-Opt-E; `marked` v18 conversion; standalone HTML with embedded CSS; 48 Vitest tests; code-reviewer approved 2026-04-09
- **Word Count** — Plugin
- **Auto TOC** — Plugin
- **Focus Mode** — Plugin
- **Typewriter Mode** — Plugin
- **Templates** — Plugin
- **Backlinks** — Plugin
- **YAML Pane** — Plugin
- **Math (LaTeX)** — Plugin
- **Media Preview** — Plugin
- **Diagrams (Mermaid)** — Plugin
- **Insert Count** — Plugin
- **Knowledge Graph** — Plugin
- **File Browser link update (FR-02.11)** — Post-rename/move `[[wiki-link]]` update banner; same-stem guard suppresses no-op moves; `reloadVaultIndex` after update; 12 new Vitest tests (EC-01–EC-09, EC-11, EC-18); code-reviewer approved 2026-04-27
- **Wikilink Autocomplete + Spell Check** — Vault-index autocomplete source for `[[` with vault-relative `detail`, lazy `info` title, pipe suppression, self-link allowed; module-level `spellCheckCompartment` toggle; `EditorSettings.spellCheck` field; "Editor" settings section; `makeApplyCallback` refactor; 18 new Vitest tests; code-reviewer approved 2026-04-27
- **Non-MD file support in vault index** — `NonMdFile` struct in Rust `build_vault_index`; `nonMdFiles?: NonMdFile[]` on `VaultIndex` TypeScript type; file browser renders images/PDFs/other assets alongside `.md` files in the tree; `nonMdFiles` optional to handle cached indexes; `@codemirror` import leak from `settings.ts` fixed (moved `spellCheckCompartment` to `window.__MARKABLE_SPELL_CHECK_COMPARTMENT__` global); 2026-04-27
- **Media file preview — VSCode-style content area** — Clicking a non-MD asset in the file browser opens it as a tab in the main content area (images via `<img>`, PDFs via `<embed>`, unsupported types show "Cannot preview" message); `TabEntry.kind: "editor" | "media"` discriminated union; `openMediaInTab()` on TabManager with dedup; `div#media-viewer` permanent DOM fixture in `#editor` toggled via `has-media-tab` CSS class; `saveActiveTab`/`saveActiveTabAs`/`markActiveTabDirty`/`saveSession` all guarded for media tabs; sidebar preview approach (200px panel) designed, built, then superseded by this content-area approach; 42 new Vitest tests; code-reviewer approved (2 rounds) 2026-04-27
- **Window size default invariant enforcement** — `sizeH` regression (`"50%"` instead of `"80%"`) found and fixed in `DEFAULT_SETTINGS` and `applyWindowSettings` fallback; `tests/settings/window-defaults.test.ts` (6 tests) added as permanent regression guard; `docs/specs/invariants/window-size-defaults.md` canonical invariant spec; `CLAUDE.md` ⚠️ section expanded with recovery procedure including on-disk `settings.json` patch one-liner; 2026-04-27
- **Backlinks bug fix** — Two bugs in `scheduleIndexRebuild`: (1) vault-mode path construction used `currentFileDir + bareFilename`, giving wrong paths for cross-directory vault files; (2) index always read from disk so unsaved in-memory `[[links]]` were invisible. Fix: vault fast path seeds link map directly from `VaultIndexEntry.outboundLinks` (Rust-parsed, all directories), then overrides each open editor tab's entry with its in-memory `tab.doc`; no-vault directory-scan path unchanged; 2026-04-28
- **Wiki-link hover preview popover** — Hovering a `[[wikilink]]` span for 180 ms triggers async file read; popover shows title (front matter / H1 / filename stem), vault-relative path label, and 200-word plain-text excerpt. 60 ms grace period keeps popover alive when mouse moves from span into popover (EC-08). Monotonic version counter discards stale overlapping fetches (EC-04). `position: fixed` with right/bottom viewport clamping. Full cleanup in `onDisable`. 31 new Vitest tests; code-reviewer approved 2026-04-28
- **Tab right-click context menu** — four-item menu (Close Tab, Close Other Tabs, Close All Tabs, Reveal in Finder) on all three tab renderers (regular, vertical, minimal). `tab-context-menu.ts` singleton DOM module with viewport clamping and outside-click/Escape/renderer-re-render dismissal. `closeOtherTabs(id)` and `closeAllTabs()` added to TabManager using snapshot-and-batch pattern. `revealInFinder` bridge wrapper added. Reviewer-caught `closeOtherTabs` stale-renderer bug fixed (direct `_notifyRenderer()` call, no `activateTab` delegation) plus `_captureActiveTab()` guard in `closeAllTabs` survived-branch. 28 new Vitest tests; code-reviewer approved 2026-04-28
- **Drag & drop `.md`/`.txt` files to open** — Feature already existed in `main.ts` (`onDragDropEvent` handler). Extracted handler to `src/tabs/drag-drop.ts` (`createDragDropHandler` factory) for testability. 23 new Vitest tests covering EC-01–EC-07, EC-10, EC-12–EC-13, NFR-6: event type guard (enter/over/leave ignored), empty-paths guard, extension filter (.pdf/.png/.docx/.MD all rejected, .txt/.md accepted, case-sensitive), mixed payload, dedup passthrough, sequential ordering, `refreshRecentFilesMenu` called after all opens. TypeScript clean. 2026-04-28

### Known Regressions 🔴
None.

### In Progress / Next 🟡
- TBD

---

## Phase 1 Progress Tracker (archived)

**Last Updated:** 2026-04-06
**Current Status:** ALL PHASE 1 STEPS COMPLETE ✅ (Steps 00-02, 04-06 complete; Step 03 deferred)

---

## Quick Status Summary

| Phase | Status | Progress | Notes |
|-------|--------|----------|-------|
| **Requirements** | ✅ COMPLETE | 100% | `docs/requirements/active_task.md` finalized |
| **Architecture** | ✅ COMPLETE | 100% | `docs/specs/phase1-infrastructure/00_index.md` + 7 step files |
| **Adjustments** | ✅ COMPLETE | 100% | 5 adjustments validated by requirements-analyst |
| **Implementation** | ✅ COMPLETE | 100% | All core steps (00-02, 04-06) complete, Step 03 deferred for distribution |

---

## Implementation Progress (7 Steps)

### Step 00: Test Infrastructure Setup
- **Status:** ✅ COMPLETE (2026-04-07)
- **What was done:** Vitest 4.1.3 configured with happy-dom, mock helpers for Tauri commands created, 6 example tests passing, Rust test_utils with temp file helpers, 2 Rust tests passing
- **Files Created:** vitest.config.ts, tests/mocks/tauri.ts, tests/example.test.ts

### Step 01: Tauri v2 + Vite + TypeScript Scaffolding
- **Status:** ✅ COMPLETE (2026-04-07)
- **What was done:** Scaffolded via npm create tauri-app (vanilla-ts), fixed package name to "markable", configured tsconfig strict mode (ES2022), Vite port 1420, Cargo.toml + tauri.conf.json fixed, tsc --noEmit zero errors, npm run build succeeds
- **Files Created:** package.json, tsconfig.json, vite.config.ts, index.html, src/main.ts, src-tauri/ (full Rust backend)

### Step 02: Tauri v2 Capabilities & Permissions
- **Status:** ✅ COMPLETE (2026-04-07)
- **What was done:** Created src-tauri/capabilities/default.json with granular scopes (window, events, dialogs), updated tauri.conf.json to reference capabilities and added window label "main", build succeeds with zero warnings
- **Files Created:** src-tauri/capabilities/default.json, src-tauri/capabilities/README.md

### Step 03: macOS DMG Build Workaround & Code Signing ⚠️ CRITICAL
- **Status:** ⏸️ DEFERRED
- **Reason:** Skipping distribution steps until app is feature-complete and working as expected
- **When to resume:** After Step 06 passes, when ready for real macOS distribution
- **Note:** No code signing identity currently available; will set up before final build

### Step 04: Rust File I/O Command Bridge
- **Status:** ✅ COMPLETE (2026-04-07)
- **What was done:** Implemented read_file and write_file Rust commands with atomic swap pattern, created TypeScript bridge with discriminated union types (FileResult<T>), comprehensive test suite: 9 Rust tests (all file operations + atomic safety), 18 TypeScript tests (mock verification + edge cases)
- **Files Created:** src-tauri/src/commands/io.rs, src-tauri/src/commands/mod.rs, src/lib/bridge.ts, src/lib/errors.ts, tests/bridge.test.ts

### Step 05: CodeMirror 6 Markdown Editor Setup
- **Status:** ✅ COMPLETE (2026-04-06)
- **What was done:** Installed CodeMirror 6 packages (codemirror, @codemirror/basic-setup), created editor factory with createEditor/getEditorContent/setEditorContent, implemented Markdown syntax highlighting via buildExtensions, replaced generic CSS with full CM6-aware styling (light/dark mode), verified build succeeds and all 18 tests pass
- **Files Created:** src/editor/editor.ts, src/editor/extensions.ts, updated src/styles.css, installed codemirror packages

### Step 06: File Dialog Integration
- **Status:** ✅ COMPLETE & VISUALLY VERIFIED (2026-04-06)
- **Visual Verification:** All 5 test suites passed ✅
  - File open dialog: Works, filters .md/.txt files, loads content correctly
  - File save dialog: Works, saves to disk with atomic writes
  - Save existing files: Works without dialog, updates on disk
  - Dialog cancellation: Graceful, no errors, app remains responsive
  - UI/Layout: Toolbar displays correctly, buttons have proper states, editor fills space, dark mode works
- **What was done:** Implemented Rust file dialog commands (open_file_dialog, save_file_dialog) using Tauri v2 dialog plugin with file filters, created TypeScript bridge wrapper (src/lib/dialogs.ts) with DialogResult discriminated union, added toolbar UI with Open/Save buttons and file name display, implemented event handlers for file operations (openFile, saveFile, saveFileAs), updated CSS for toolbar layout and dark mode support, created capabilities/default.json with dialog permissions, all tests pass (18 passing)
- **Files Created:** src-tauri/src/commands/dialogs.rs, src/lib/dialogs.ts, src-tauri/capabilities/default.json
- **Files Modified:** index.html (toolbar), src/styles.css (toolbar+editor layout), src/main.ts (event handlers), src/lib/bridge.ts (re-export dialogs), src-tauri/src/lib.rs (plugin registration), src-tauri/src/commands/mod.rs (export dialogs), src-tauri/Cargo.toml (dialog plugin dependency)

---

## Session Notes

### Current Session (2026-04-06 - Continued/Context 3)

**Summary of work completed:**
1. ✅ Step 05 (CodeMirror 6 Editor): Finished CSS styling, verified build and tests
2. ✅ Step 06 (File Dialogs): Implemented full file dialog system end-to-end
3. ✅ Added mandatory visual verification testing to workflow

**Step 05 completion:**
- Installed CodeMirror packages (codemirror, @codemirror/basic-setup)
- Created editor factory (src/editor/editor.ts, src/editor/extensions.ts)
- Replaced boilerplate CSS with CM6-aware styling (light/dark mode)
- All 18 tests passing, build succeeds

**Step 06 completion:**
- Implemented Rust dialog commands using tauri-plugin-dialog v2
- Created TypeScript bridge (src/lib/dialogs.ts) with DialogResult type
- Added toolbar UI with Open/Save buttons and file name display
- Implemented file operation handlers (open, save, save-as)
- Full visual testing completed and verified ✅

**Key learnings:**
- Tauri v2 dialog plugin uses callback-based API (not async/await)
- Need to use mpsc channel to synchronously wait for dialog result
- Capabilities field not supported at root level in tauri.conf.json
- Dialog plugin has built-in permissions, capabilities file is documentation

**What's ready for next session:**
- Phase 1 infrastructure 100% complete
- App is fully functional for file editing
- Step 03 (DMG/code signing) deferred until app feature-complete
- Ready to begin Phase 2 features (multi-file, live preview, theming, menu)

### Previous Session (2026-04-06)

**What was accomplished:**
1. Lead-developer agent reviewed initial plan
2. Identified 5 adjustments needed:
   - Test infrastructure (step_00_test_setup.md) ✅ CREATED
   - Dialog plugin clarification ✅ ADDED to 00_index.md
   - Fallback DMG script ✅ VERIFIED (already in step_03)
   - Code signing setup ✅ VERIFIED (already in step_03)
   - Error UI pattern ✅ ADDED to 00_index.md
3. Requirements-analyst validated all adjustments ✅
4. Implementation checklist created (IMPLEMENTATION_CHECKLIST.md) ✅
5. Progress tracking system created (this file) ✅

**What's ready:**
- ✅ All architecture specs complete (docs/specs/phase1-infrastructure/)
- ✅ All 20 edge cases mapped to steps
- ✅ Implementation checklist with detailed steps
- ✅ Test infrastructure spec (step_00)
- ✅ Progress tracking in place

**Next session should:**
1. Read PROGRESS.md (this file) to understand current status
2. Check "Step 00: Test Infrastructure Setup" section above
3. Follow IMPLEMENTATION_CHECKLIST.md for detailed tasks
4. Update PROGRESS.md after each step completes
5. Use RESUME.md if clarification needed on resuming work

---

## How to Resume Work

**For the next session:**

1. **Understand where you left off:**
   ```
   Read this file (PROGRESS.md)
   → Shows which step is current
   → Shows acceptance criteria for that step
   → Shows blockers if any
   ```

2. **Get detailed instructions:**
   ```
   Open: IMPLEMENTATION_CHECKLIST.md
   → Shows exactly what to do for current step
   → Lists files to create/modify
   → Provides test requirements
   ```

3. **Follow the step spec:**
   ```
   Open: docs/specs/phase1-infrastructure/step_NN_*.md
   → Detailed tasks with code examples
   → Acceptance criteria
   → Troubleshooting if needed
   ```

4. **Update progress when done:**
   ```
   Edit: PROGRESS.md
   → Update step status to "✅ COMPLETE"
   → Update current step to next step
   → Add session notes
   → Commit: git add PROGRESS.md && git commit -m "Progress: Step XX complete"
   ```

**See RESUME.md for detailed instructions.**

---

## Estimated Timeline

| Phase | Duration | Status |
|-------|----------|--------|
| Step 00 (Tests) | 1-2 hrs | ⏸️ Paused |
| Step 01 (Scaffold) | 30-45 min | ⏸️ Paused |
| Step 02 (Permissions) | 30 min | ⏸️ Paused |
| Step 03 (Build/Sign) | 1-2 hrs | ⏸️ Paused |
| Step 04 (I/O) | 2-3 hrs | ⏸️ Paused |
| Step 05 (CM6) | 1.5-2 hrs | ⏸️ Paused |
| Step 06 (Dialogs) | 1.5-2 hrs | ⏸️ Paused |
| **Total Phase 1** | **~9-13 hrs** | ⏸️ Paused |

---

## Key Files to Consult

- **IMPLEMENTATION_CHECKLIST.md** — Step-by-step tasks (read this for detailed instructions)
- **RESUME.md** — How to resume work (read this when starting a new session)
- **docs/specs/phase1-infrastructure/00_index.md** — Architecture blueprint
- **docs/specs/phase1-infrastructure/step_NN_*.md** — Individual step specs with code examples
- **docs/requirements/active_task.md** — Edge cases (EC-1 through EC-20)
- **docs/testing.md** — Testing patterns and conventions

---

## Blockers & Dependencies

**Current blockers:** None

**Optional requirement before Step 03:**
- Apple Developer ID configured for code signing
- See RESUME.md for code signing setup instructions

---

## Success Criteria Checklist (Phase 1 Complete)

- [ ] All 7 steps (00-06) completed
- [ ] All tests passing: `npm run test:run` + `cargo test`
- [ ] DMG builds successfully: `CI=true npm run tauri build`
- [ ] Code signature valid: `spctl --assess` returns "accepted"
- [ ] App launches without warnings from /Applications
- [ ] All 20 edge cases (EC-1 through EC-20) tested or documented
- [ ] Zero TODO comments in source code
- [ ] Documentation complete (specs, testing guide, build notes)

---

## How to Update This File

**After each step completes:**

```bash
# 1. Update the step status to COMPLETE
# 2. Update the next step status to CURRENT
# 3. Add brief notes about what was done
# 4. Commit the progress

git add PROGRESS.md
git commit -m "Progress: Step XX complete, moving to Step YY"
```

**Example:**

```markdown
### Step 00: Test Infrastructure Setup
- **Status:** ✅ COMPLETE
- ...

### Step 01: Tauri v2 + Vite + TypeScript Scaffolding
- **Status:** 🟡 IN PROGRESS
- **Notes:** Currently at Task 1.6 (npm run tauri dev)
- ...
```

---

**Last Updated:** 2026-04-06
**Ready for:** Step 00 Implementation
**Estimated Time to Phase 1 Complete:** ~9-13 hours

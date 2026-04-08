To address the incompatibility between **Tauri v2** and the **macOS "Tahoe" DMG compiler** (referring to the heightened security and bundle verification changes in macOS 15 Sequoia and upcoming revisions), we will integrate a specific **Build & Packaging Workaround** into the infrastructure phase.

This bug typically manifests as a "Damaged" file error or a failure during the `hdiutil` phase of the Tauri bundler because the traditional DMG "beautification" process (setting icons and backgrounds) is being flagged by the new system-level security checks or failing due to deprecated filesystem calls in the compiler.

Update: Reported successful workaround identified by users includes successfully re-running builds using older Provisioner versions. No official patch has yet been released (as of 04.04.26).

---

# Learnings from Markable 1.0

Markable 1.0 (Milkdown Crepe + Tauri v2) is a working reference implementation in `markable-1.0-usesMildownCrepe/`. The following patterns proved successful and should be carried forward into 2.0:

## Patterns to Keep

- **Relative image paths** in `assets/` next to the document — portable, no base64 bloat. Uses Tauri's `asset://` protocol for display.
- **Window state persistence** — debounced save (1000ms) on move/resize, restored before window show to prevent visual flash.
- **Auto-save with 1500ms debounce** — responsive without disk thrashing. Only saves when a file path exists; prompts otherwise.
- **Settings as JSON in app config dir** with default-merging on load, so new settings appear seamlessly on app update.
- **Dynamic menu rebuilding** after settings changes keeps native menus in sync.
- **Plugin system with error isolation** — 5-error limit disables misbehaving plugins. Worth adapting for CM6 extensions.
- **Customizable keyboard shortcuts** with a recording UI in settings. Uses `e.code` for letter keys to avoid Alt/Option character mapping issues.
- **Separate settings WebView** — clean separation of concerns.

## macOS-Specific Solutions

- **Hide-on-close** — app stays in dock (standard macOS behavior).
- **150ms delay on recent-file menu events** — ensures window is focused before emitting event (real macOS quirk).
- **Overlay title bar** with draggable region for clean appearance.

## Improvements Needed in 2.0

- **Atomic saves** — 1.0 uses raw `fs::write()`. 2.0 must implement temp-file-swap pattern.
- **No test suite** in 1.0. 2.0 mandates TDD (Red/Green/Refactor).
- **Monolithic `main.ts`** (20KB) — decompose into focused modules in 2.0.
- **Editor destruction/recreation on file open** — CM6 can replace documents in-place, which is cleaner and preserves undo history.

## What to Leave Behind

- Milkdown/Crepe — replaced by CodeMirror 6 for finer live-preview control.
- MutationObserver hack for lazy-loading images — CM6 decorations handle this natively.
- Line-number plugin — CM6 has this built in.

---

# Markdown Editor (CM6 + Tauri v2)

### *Updated for macOS "Tahoe"/Sequoia Compatibility*

## Phase 1: Infrastructure & "Tahoe" Workaround

### Step 1 — Project Scaffolding

- **Initialize:** `npm create tauri-app@latest` (Vanilla + Vite + TS).

- **Tauri v2 Permissions:** Define granular `fs` and `dialog` scopes in `src-tauri/capabilities/default.json`.

### Step 1.1 — [CRITICAL] macOS DMG Compiler Workaround

To bypass the current incompatibility with the Tahoe/Sequoia DMG builder:

1. **Environment Variable Injection:** Set `CI=true` in your build environment. This forces the Tauri bundler to use a "headless" DMG creation method that skips the problematic AppleScript-based icon positioning which triggers the compiler bug.

2. **Target Override:** If the DMG build still fails, update `tauri.conf.json` to build the `.app` bundle exclusively, and use a third-party tool like `create-dmg` via a custom script until the Tauri CLI patch is upstreamed.

3. **Code Signing & Notarization:** macOS Tahoe effectively removes the "Right-click -> Open" bypass for unsigned apps. You **must** include a `signingIdentity` in your `tauri.conf.json` or the app will be flagged as "Damaged" upon installation.

---

## Phase 2: Native Engine (Rust + CM6)

### Step 2 — High-Performance File I/O

- **Atomic Saves:** Implement the `save_file` command in Rust using a temporary file swap to ensure no data loss during the CM6 debounce.

- **Workspace Scanner:** Use `std::fs` to recursively index the user's Markdown vault.

### Step 3 — CodeMirror 6 "Typora-Mode"

- **Modular Assembly:** Combine `@codemirror/lang-markdown` with custom **State Fields**.

- **Live Preview Extension:** Use a `Decoration` extension to hide Markdown syntax (e.g., `#`, `**`, `>`) unless the cursor is on the active line.

---

## Phase 3: Assets & Performance

### Step 4 — Native Image Management

- **No Base64:** Use Tauri's `asset` protocol. When an image is dropped:
  
  1. Rust copies the file to the local `./assets` folder.
  
  2. The editor inserts a relative path link.

- **Lazy Rendering:** Implement a CM6 `Widget` to render images only when they enter the viewport.

---

## 🔍 Research & Debugging Instructions for "Tahoe" Bug

If the build continues to fail during the packaging phase, follow these research steps to find the latest community workarounds:

1. **Check the "Headless" Flag:** Monitor the [Tauri GitHub Issues](https://github.com/tauri-apps/tauri/issues) for keywords like `hdiutil failure` or `AppleScript DMG error`.
   
   - *Workaround:* Try running `cargo tauri build --bundles app` and then manually run a shell script to bundle it:
     
     Bash
     
     ```
     # Researching manual DMG creation as a fallback
     create-dmg --volname "Markdown Editor" --window-pos 200 120 --window-size 600 300 "MarkdownEditor.dmg" "src-tauri/target/release/bundle/macos/Markdown Editor.app"
     ```

2. **Verify Notarization Logs:** If the app builds but won't open, run `spctl --assess --verbose /path/to/app`. If it returns "rejected," the issue is Tahoe's new strict notarization requirements.

3. **Tauri CLI Branch:** Research if there is a pending PR for the Tauri CLI. You may need to install the CLI directly from a fix-branch:
   
   Bash
   
   ```
   cargo install tauri-cli --git https://github.com/tauri-apps/tauri --branch fix/macos-dmg-compiler
   ```

---

## Checklist

### 🏁 Phase 1 (Updated)

- [ ] Initialize Tauri v2 with Vite/TS.

- [ ] **Workaround Applied:** `CI=true` verified in build logs.

- [ ] **Notarization Config:** Apple Developer ID and Team ID added to `tauri.conf.json`.

- [ ] **CM6 Setup:** Basic Markdown syntax highlighting working.

- [ ] ```
  **Rust Bridge:** `read_file` and `write_file` commands functional.
  ```

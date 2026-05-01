# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Markable 2.0 is a native macOS Markdown editor built with **Tauri v2** (Rust backend) + **CodeMirror 6** (TypeScript frontend) + **Vite**. The editor features a "Typora-style" live preview mode that hides Markdown syntax unless the cursor is on the active line.

## Commands

```bash
npm run tauri dev          # Start dev server + Tauri window
npm run tauri build        # Production build
npm test                   # Run frontend tests (watch mode)
npm run test:run           # Run frontend tests once (CI/non-watch)
npm run test:run -- tests/some.test.ts   # Run a single test file
cargo test                 # Run Rust tests (from src-tauri/)
npm run build:plugins      # Recompile all plugin IIFEs (src/plugins/**/*.ts → src-tauri/plugins/core/*.js)
npm run sync:plugins       # Copy compiled plugins to app data directory
```

> **Plugin build rule**: changes to `src/plugins/**/*.ts` do NOT hot-reload. Always run `npm run build:plugins && npm run sync:plugins` after editing any plugin source.

## Architecture

### Frontend → Backend boundary (`src/lib/bridge.ts`)

All Tauri Rust commands are called through `src/lib/bridge.ts`, which wraps `invoke()` with typed discriminated-union results (`FileResult<T>` with `ok: true/false`). Never call `invoke()` directly in feature code — always add a typed wrapper to `bridge.ts`.

### Editor layer (`src/editor/`)

- `editor.ts` — creates the CodeMirror 6 instance
- `extensions.ts` — assembles all CM6 extensions; the `previewCompartment` and `pluginCompartment` are the two hot-swap Compartments
- `live-preview.ts` — the Typora-style hide-syntax ViewPlugin; uses `marked` for inline HTML rendering. This is the most complex file in the frontend.
- `format.ts` — all formatting commands (bold, heading, list toggling, etc.)
- `list-engine.ts` / `list-keybindings.ts` — smart list continuation and indent/outdent

### Plugin system (`src/plugins/`)

All plugins (core and user) are loaded as IIFE `.js` files from disk at runtime, not compiled in. `index.ts` exports a singleton `pluginManager` (PluginManager class) that:
1. Scans `plugins/core/` and `plugins/user/` via Tauri commands
2. Evaluates each file via `evaluatePlugin()` (in `user-plugin-loader.ts`)
3. Injects a `MarkablePluginAPI` object (from `markable-plugin-api.ts`) — the only API surface plugins may use

A user file with the same filename as a core file overrides the core file (EC-7/EC-8). CM6 globals (`@codemirror/*`) are exposed as `window` globals before any plugin IIFE runs (`src/lib/cm-globals.ts`) so plugins can bundle them as externals and share the same slot-ID namespace.

### Vault / file system (`src/lib/vault-manager.ts`, `src/lib/vault-types.ts`)

A "vault" is a watched folder. The vault index (built by `build_vault_index` Rust command) tracks all `.md` files and wiki-link relationships. `vault-manager.ts` manages the current vault state, file-watcher events, and index updates. File system operations always go through the Rust commands in `src-tauri/src/commands/`.

### UI chrome (`src/tabs/`, `src/sidebar/`, `src/settings/`)

- `tabs/tab-manager.ts` — manages open documents as tabs; each tab owns its own CM6 editor state
- `sidebar/sidebar-manager.ts` — panels register themselves via `MarkablePluginAPI.registerSidebarPanel()`; the sidebar toggles per-panel
- `settings/settings-panel.ts` — settings are a plain `MarkableSettings` object persisted via `get_settings`/`save_settings` Tauri commands

## Key Conventions

- **No code without validated requirements.** Always check `docs/requirements/active_task.md` exists before implementing.
- **No TODO comments in source code.** Log deferred work in `docs/specs/[feature]/00_index.md`.
- **Atomic saves**: All file writes use temp-file-swap pattern (Rust side).
- **Asset protocol**: Images use Tauri's `asset://` protocol, never base64 embedding.
- **Code signing is mandatory** for macOS builds — unsigned apps will be flagged as damaged on Sequoia+.

## ⚠️ Window Launch Size — DO NOT CHANGE

**The window must always launch at 50% width × 80% height, centered. This must never regress.**

### Two locations that must always agree

**Location 1 — `src/lib/settings.ts`** (`DEFAULT_SETTINGS.window`):
```typescript
sizeW: "50%",   // 50% of screen width
sizeH: "80%",   // 80% of screen height — NOT "50%", this is the one that regresses
```

**Location 2 — `src-tauri/src/lib.rs`** (the `.setup()` hook):
```rust
let phys  = monitor.size();
let scale = monitor.scale_factor();
let logical_w = phys.width  as f64 / scale * 0.5;
let logical_h = phys.height as f64 / scale * 0.8;
window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: logical_w, height: logical_h }));
window.center();
```

If you change one location you must change the other. The percentage values in
`DEFAULT_SETTINGS` (TypeScript) and the multipliers in `lib.rs` (Rust) are
two representations of the same invariant.

### Rules

- Uses `LogicalSize` (NOT `PhysicalSize`) — Retina displays return physical pixels from `monitor.size()`, dividing by `scale_factor()` is mandatory.
- Do NOT hardcode pixel values. Do NOT switch to `PhysicalSize`.
- **Verify both locations are still intact any time `lib.rs` or `settings.ts` is touched for any reason.**

### Regression test

`tests/settings/window-defaults.test.ts` asserts the exact values of `sizeW`
and `sizeH` in `DEFAULT_SETTINGS`. Run it with:

```bash
npm run test:run -- tests/settings/window-defaults.test.ts
```

A failing test here means a regression has been introduced. Fix it before merge.

### If the window still launches at the wrong size after fixing the code

Fixing source code alone is not enough. The app persists settings to disk and
the saved file overrides `DEFAULT_SETTINGS` on every launch. Patch the cached
file too:

```bash
python3 -c "
import json
path = '/Users/daveslaptop/Library/Application Support/com.markable.app/settings.json'
with open(path) as f:
    data = json.load(f)
data['window']['sizeH'] = '80%'
with open(path, 'w') as f:
    json.dump(data, f, indent=2)
print('Done. sizeH is now:', data['window']['sizeH'])
"
```

Then restart the app. Full recovery steps are in
`docs/specs/invariants/window-size-defaults.md`.

### Canonical reference

Full invariant rationale, all affected locations, and the complete recovery
procedure are documented in `docs/specs/invariants/window-size-defaults.md`.

## Build Notes

The macOS Sequoia/Tahoe DMG compiler has known incompatibilities with Tauri v2. See `docs/build-notes/macos-dmg-workaround.md` for current workarounds:
- Set `CI=true` in build env to use headless DMG creation
- Fallback: build `.app` only via `cargo tauri build --bundles app`, then use `create-dmg`
- A valid `signingIdentity` must be configured in `tauri.conf.json`

## Agent Workflow

This project uses a phased agent pipeline in `.claude/agents/`. **Do not skip phases.**

1. **Requirements Analyst** — produces `docs/requirements/active_task.md`
2. **Software Architect** — produces `docs/specs/[feature]/00_index.md` + step files
3. **Lead Developer** — implements via TDD following step files exactly
4. **Code Reviewer** — final audit; all Critical/High issues must be resolved before merge

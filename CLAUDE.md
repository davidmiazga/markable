# Markable 2.0 — Claude Code Project Guide

## Project Overview

Markable 2.0 is a native macOS Markdown editor built with **Tauri v2** (Rust backend) + **CodeMirror 6** (TypeScript frontend) + **Vite**. The editor features a "Typora-style" live preview mode that hides Markdown syntax unless the cursor is on the active line.

## Agent Workflow (Mandatory)

This project uses a **phased agent pipeline**. Each phase has a dedicated agent in `/agents/` and must be activated in order. **Do not skip phases.**

1. **Requirements Analyst** (`@requirements-analyst`) — Extracts and validates requirements. Produces `docs/requirements/active_task.md`.
2. **Software Architect** (`@software-architect`) — Designs system architecture. Produces `docs/specs/[feature]/00_index.md` + step files.
3. **Lead Developer** (`@lead-developer`) — Implements via TDD (Red/Green/Refactor). Follows step files exactly.
4. **Code Reviewer** (`@code-reviewer`) — Final audit against requirements and edge cases. Must approve before merge.

### Phase Gates
- Requirements phase produces: `docs/requirements/active_task.md` (includes Edge Case Inventory)
- Architecture phase produces: `docs/specs/[feature]/00_index.md` + `step_NN_*.md` files
- Development phase: all tests pass, no TODOs in source, `00_index.md` steps checked off
- Review phase: all Critical/High issues resolved, edge cases covered by tests

## Tech Stack

- **Frontend**: TypeScript, Vite, CodeMirror 6
- **Backend**: Rust (Tauri v2 commands)
- **Bundler**: Tauri CLI (`cargo tauri build`)
- **Package manager**: npm
- **Test runner**: TBD (Vitest likely for frontend, `cargo test` for Rust)

## Project Structure

```
markable-2.0/
  agents/                    # Agent persona definitions (do not modify without discussion)
  docs/
    requirements/            # Validated requirement specs (active_task.md)
    specs/                   # Architecture blueprints and step files
    architecture/            # High-level architecture diagrams/docs
    build-notes/             # Build workarounds, signing notes, CI config
  src/                       # Frontend source (TypeScript + CM6)
  src-tauri/                 # Rust backend (created by Tauri scaffolding)
  tests/                     # Test suites
  PLAN.md                    # Vision document and phase overview
  FEATURES.md                # Feature specifications and requirements
```

## Key Conventions

- **No code without validated requirements.** Always check `docs/requirements/active_task.md` exists before implementing.
- **No TODO comments in source code.** Log deferred work in `docs/specs/[feature]/00_index.md`.
- **Atomic saves**: All file writes use temp-file-swap pattern (Rust side).
- **Asset protocol**: Images use Tauri's `asset://` protocol, never base64 embedding.
- **Code signing is mandatory** for macOS builds — unsigned apps will be flagged as damaged on Sequoia+.

## ⚠️ Window Launch Size — DO NOT CHANGE

**The window must always launch at 50% width × 80% height, centered. This must never regress.**

File: `src-tauri/src/lib.rs` — the `.setup()` hook must always read:
```rust
let phys  = monitor.size();
let scale = monitor.scale_factor();
let logical_w = phys.width  as f64 / scale * 0.5;
let logical_h = phys.height as f64 / scale * 0.8;
window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: logical_w, height: logical_h }));
window.center();
```
- Uses `LogicalSize` (NOT `PhysicalSize`) — Retina displays return physical pixels from `monitor.size()`, dividing by `scale_factor()` is mandatory.
- Do NOT hardcode pixel values. Do NOT switch to `PhysicalSize`.
- **Verify this code is still intact any time `lib.rs` is touched for any reason.**

## Build Notes

The macOS Sequoia/Tahoe DMG compiler has known incompatibilities with Tauri v2. See `docs/build-notes/macos-dmg-workaround.md` for current workarounds. Key points:
- Set `CI=true` in build env to use headless DMG creation
- Fallback: build `.app` only via `cargo tauri build --bundles app`, then use `create-dmg`
- A valid `signingIdentity` must be configured in `tauri.conf.json`

## Commands

```bash
# Development (after Tauri scaffolding is complete)
npm run tauri dev          # Start dev server + Tauri window
npm run tauri build        # Production build
cargo test                 # Run Rust tests
npm test                   # Run frontend tests (TBD)
```

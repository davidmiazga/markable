# Markable

A macOS-first Markdown editor / PKM app: **Tauri 2**, **CodeMirror 6**, **Vite**, vanilla TypeScript.

This repository is the Git project. Clone and work here — not in a parent container folder.

## Start

```bash
npm install
npm run tauri dev
```

| Command | Purpose |
|---|---|
| `npm run test:run` | Frontend tests once |
| `npm exec -- tsc --noEmit` | Typecheck |
| `npm run build` | Typecheck + Vite production bundle |
| `npm run build:plugins && npm run sync:plugins` | Rebuild runtime plugin IIFEs after `src/plugins/**` edits |
| `cargo test` (in `src-tauri/`) | Rust tests |

See [docs/testing.md](docs/testing.md) for the recorded baseline.

## Where truth lives

| Need | Read |
|---|---|
| Current planning and verified state | [planning/README.md](planning/README.md) |
| How the code is structured | [planning/ARCHITECTURE.md](planning/ARCHITECTURE.md) |
| Agent conventions (window size invariant, plugin build rule) | [CLAUDE.md](CLAUDE.md) |
| Last-known feature requirement | [docs/requirements/active_task.md](docs/requirements/active_task.md) |
| Historical session docs | [planning/old/README.md](planning/old/README.md) |

## Status snapshot (2026-09-22)

Local `main` is one commit ahead of GitHub. Vitest: 4828 passed, 7 Collections failures. Rust `fmt --check` is dirty. Software-machine / Beads are **not** initialized yet (layout must exist first).

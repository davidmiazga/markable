# Separate App Approach — CX requirements

Canonical copy. The workspace starter at `jobWorking/planning/SeparateApp-CXrequirements-v1.0.md` points here.

Overview: every app can install or uninstall every plugin. There are no capability limits — only different first-run expectations and customer experience. Pack membership is locked in [`flavors/packs.json`](../flavors/packs.json). Flavor files choose packs; they do not hide plugins.

## Host (not a pack)

Engine surfaces in `packs.json` → `host.modules`. Always present. Not IIFE plugins and not togglable: editor, tabs, sidebar shell, settings, find, theme load, status-bar host, menus, vault runtime, plugin loader.

`status-bar` source exists under `src/plugins/` but is imported by the host, not built as an IIFE.

## Plugin packs

| Pack | First-run plugins (today) | Planned / missing |
|---|---|---|
| `base` | markdown-toolbar, command-bar, typing-assist, auto-save, word-count | — |
| `pkm` | file-browser, backlinks, knowledge-graph, yaml-pane, media-preview, outline-panel | — |
| `project` | *(empty)* | kanban |
| `quicknote` | templates, insert-count, auto-title | sync |
| `diary` | daily-note | calendar |
| `added` | diagrams, math, focus-mode, typewriter-mode, auto-toc | AI |

`added` is never in a flavor's `enabledPacks`. Users can still turn those plugins on later.

## Apps

### 1. Re-markable

Catch-all. Identifier `com.markable.app`. First-run packs: `base` + `pkm` from [`flavors/remarkable.json`](../flavors/remarkable.json). No `added` plugins on install. No kitchen-sink override. Bolster AI. A workspace switcher toward apps 2–6 is deferred. Launch with `npm run dev:remarkable`.

### 2. Markable

Base editing only (`enabledPacks: ["base"]`). Identifier `com.markable.editor`. Single-file editor. No project, PKM, or added plugins on install. Plugins remain installable. Launch with `npm run dev:markable`.

### 3. Markable-Project

`base` + `project`. Asana / Folia competitor. Kanban is planned, not shipped. AI compatible. iO-workflow helpers later.

### 4. Markable-KnowledgeBank

`base` + `pkm` via [`flavors/knowledgebank.json`](../flavors/knowledgebank.json). Identifier `com.markable.knowledgebank`. Launch: `npm run dev:knowledgebank`. Library / resource management (text, PDF, books, video, files). Heaviest AI expectation.

### 5. Markable-QuickNote

`base` + `quicknote`. Fast notes and to-dos. Needs a user-provided sync service. Apple Notes / SimpleNote competitor.

### 6. Markable-Diary

`base` + `diary`. Daily routine, calendar, results over time. Calendar is planned.

## Composition rule

`flavor.enabledPacks` is the product intent and the first-run enablement. `defaultEnabledPlugins` remains an optional override; no flavor uses it now.

---
title: "Command Bar — Step 03: Result Builders"
last-updated: "2026-04-19"
review-cadence-days: 7
status: active
---

# Step 03 — Result Builders

## Goal

Implement the three result builder functions that produce `CommandBarResult[]` arrays
for each category. These functions run synchronously on every open of the Command Bar
(FR-03.A.2) and must complete well within the 80ms latency budget (NFR-01).

---

## Files to Modify

| File | Change |
|------|--------|
| `src/plugins/command-bar/command-bar.plugin.ts` | Add builder functions (inline, no separate modules per IIFE rules) |
| `tests/plugins/command-bar/command-bar.test.ts` | Unit tests for builders |

The builder functions read from window globals. For testability, they accept their
dependencies as parameters (dependency injection), with window globals as the
default argument. See the "Testing Strategy" section.

---

## Types

Defined in the plugin file (carries forward from 00_index.md):

```typescript
type ResultCategory = "commands" | "headings" | "recent";

interface CommandBarResult {
  id: string;
  category: ResultCategory;
  label: string;
  sublabel?: string;        // path for recent files
  keybinding?: string;      // formatted key badge string for Category A
  headingLevel?: number;    // 1-6 for Category B
  dimmed: boolean;
  action: () => void;
}

interface CommandDef {
  id: string;
  label: string;
  defaultKey: string;
  section: string;
}

interface CommandBarSettings {
  showCommands: boolean;
  showHeadings: boolean;
  showRecentFiles: boolean;
}

interface PluginManagerLike {
  getStates(): Record<string, boolean>;
  toggle(id: string, enabled: boolean): Promise<void>;
  getDefinitions(): Array<{ id: string; name: string }>;
}

interface MarkableSettings {
  recentFiles: string[];
  keybindings?: Record<string, string>;
}
```

---

## Category A: Command builder

### `buildCommandResults(deps): CommandBarResult[]`

```typescript
interface CommandBuilderDeps {
  commands: CommandDef[];
  pluginManager: PluginManagerLike;
  keybindings: Record<string, string>;
  currentFile: string | null;
  navigateToPlugin: (pluginId: string) => void;
}
```

#### Algorithm

1. Determine `hasFile = currentFile !== null`.
2. Define `REQUIRES_FILE` set:
   ```typescript
   const REQUIRES_FILE_IDS = new Set([
     "file-save", "file-save-as", "file-export", "file-print",
     "edit-paste-plain", "edit-paste-link", "edit-copy-plain", "edit-copy-html",
     "edit-duplicate-line", "edit-delete-line", "edit-goto-line",
     "edit-find", "edit-find-replace",
   ]);
   ```
   A command requires a file if its `id` is in `REQUIRES_FILE_IDS` OR if its `id`
   starts with `"format-"`.
3. For each `cmd` in `commands`:
   - Skip `"command-bar-open"` itself (it should not appear as a result — it is the
     invoking command, not a navigable command).
   - Compute `activeKey = keybindings[cmd.id] ?? cmd.defaultKey`.
   - Compute `keybinding = activeKey ? formatKeyForDisplay(activeKey) : undefined`.
   - Compute `dimmed = !hasFile && requiresFile(cmd.id)`.
   - Build action closure: `() => { if (!dimmed) handleAction(cmd.id); }`.
     The `handleAction` call goes via `window.__MARKABLE_COMMAND_BAR_OPEN__`? No —
     the plugin does NOT have access to the internal `handleAction()`. Instead, the
     plugin fires a synthetic `menu-event` or uses the existing `__TAURI_INTERNALS__`
     invoke pattern.
     **Correct approach**: The Command Bar plugin dispatches actions using
     `window.__MARKABLE_HANDLE_ACTION__` — a new global registered in `main.ts`
     that wraps `handleAction`. See Infrastructure Note below.
   - Push one `CommandBarResult` for this command.
4. After processing all `commands`, process plugin dual-results:
   - Call `pluginManager.getDefinitions()` to get all loaded plugins.
   - For each plugin definition `{ id, name }`:
     - Get `isEnabled = pluginManager.getStates()[id] ?? false`.
     - **Action result**: label = `isEnabled ? "${name} Disabled" : "${name} Enabled"`,
       action = `() => pluginManager.toggle(id, !isEnabled)`.
       dimmed = false (plugin toggles never require a file).
     - **Navigate result**: label = `"${name}"`,
       action = `() => navigateToPlugin(id)`.
       dimmed = false.
     - The action result is pushed first, navigate result second (FR-04.2).
     - Both results have `category: "commands"`.
5. Return the complete `CommandBarResult[]`.

#### Infrastructure Note: `__MARKABLE_HANDLE_ACTION__`

Add to `main.ts` alongside the other Command Bar globals:

```typescript
(window as unknown as Record<string, unknown>)["__MARKABLE_HANDLE_ACTION__"] =
  handleAction;
```

This exposes the existing `handleAction(action: string)` function to the IIFE plugin.
The plugin calls `(window as any).__MARKABLE_HANDLE_ACTION__(actionId)` to dispatch
commands (matching what the menu-event listener already does).

This global must be added to step_01 (update step_01 to include it). Update
`step_01_infrastructure.md` Acceptance Criteria accordingly.

#### `navigateToPlugin(id)` implementation in plugin

```typescript
function navigateToPlugin(id: string): void {
  // Open the Plugins Panel by dispatching the "app-plugins" action
  const handleAction = (window as any).__MARKABLE_HANDLE_ACTION__;
  if (typeof handleAction === "function") handleAction("app-plugins");
  // TODO: scroll/focus to specific plugin id — the plugins panel does not
  // currently expose a "scroll to plugin" API. For now, opening the panel
  // is sufficient. Deferred: add panel.scrollToPlugin(id) in a follow-up.
}
```

Note: Scrolling to a specific plugin in the panel is a deferred enhancement (marked as
a TODO per project convention for deferred work in spec files, not source code).

#### `formatKeyForDisplay(key: string): string`

Copy the same implementation from `keybindings-panel.ts` inline into the plugin:

```typescript
function formatKeyForDisplay(key: string): string {
  return key.split("-").map((part) => {
    switch (part) {
      case "Cmd":   return "⌘";
      case "Shift": return "⇧";
      case "Alt":   return "⌥";
      case "Ctrl":  return "⌃";
      default:      return part;
    }
  }).join("");
}
```

---

## Category B: Heading builder

### `buildHeadingResults(deps): CommandBarResult[]`

```typescript
interface HeadingBuilderDeps {
  cmState: any | null;   // window.__CM_STATE__ (CodeMirror EditorState)
  currentFile: string | null;
  handleAction: (action: string) => void;
}
```

#### Algorithm

```typescript
function buildHeadingResults(deps: HeadingBuilderDeps): CommandBarResult[] {
  const { cmState, currentFile } = deps;
  if (!cmState) return [];

  const results: CommandBarResult[] = [];
  const doc = cmState.doc;
  const HEADING_RE = /^(#{1,6})\s+(.+)$/;

  // Scan line by line (AD-04: line-by-line regex, not Lezer AST)
  let lineNum = 1;
  for (let i = 0; i < doc.lines; i++, lineNum++) {
    const line = doc.line(lineNum);
    const m = HEADING_RE.exec(line.text);
    if (!m) continue;

    const level = m[1].length;
    const text = m[2];
    const lineFrom = line.from;   // captured in closure for cursor placement
    const lineTo = line.to;       // not used but captured for safety

    results.push({
      id: `heading:${lineNum}:${lineFrom}`,
      category: "headings",
      label: text,
      headingLevel: level,
      dimmed: currentFile === null,  // FR-05.3: dimmed when no file
      action: () => {
        const view = (window as any).__CM_VIEW__;
        if (!view) return;
        view.dispatch({
          selection: { anchor: lineFrom },
          scrollIntoView: true,
        });
        view.focus();
      },
    });
  }

  return results;
}
```

**Performance note (EC-22, NFR-01)**: The `doc.line(lineNum)` call on a CodeMirror 6
document is O(log n) per call via the B-tree structure. For 500 headings in a 50,000-line
document, this is 50,000 O(log n) calls ≈ 50,000 × 16 ≈ 800,000 operations. This is
well within the 80ms budget (modern JS: ~10^8 simple ops/sec). Alternatively, use
`doc.iterLines()` for O(n) iteration without repeated tree walks:

```typescript
// Preferred for large documents:
let lineNum = 1;
doc.iterLines((text) => {
  const m = HEADING_RE.exec(text);
  if (m) {
    const line = doc.line(lineNum); // O(log n) only for matched lines
    // ... push result
  }
  lineNum++;
});
```

With `iterLines`, the O(log n) lookup only happens for matched heading lines
(typically << total lines), making the scan effectively O(n) for the iteration plus
O(k log n) for k headings.

---

## Category C: Recent files builder

### `buildRecentFileResults(deps): CommandBarResult[]`

```typescript
interface RecentFilesBuilderDeps {
  recentFiles: string[];
  openFileByPath: (path: string) => Promise<void>;
}
```

#### Algorithm

```typescript
function buildRecentFileResults(deps: RecentFilesBuilderDeps): CommandBarResult[] {
  return deps.recentFiles.map((filePath, idx) => {
    const basename = filePath.split("/").pop() ?? filePath;
    const dir = filePath.slice(0, filePath.length - basename.length);
    // Abbreviate home directory to "~"
    const homeDir = "/Users/";
    const sublabel = dir.startsWith(homeDir)
      ? "~/" + dir.slice(homeDir.indexOf("/", homeDir.indexOf("/") + 1) + 1)
      : dir;

    return {
      id: `recent:${idx}`,
      category: "recent",
      label: basename,
      sublabel: sublabel || "/",
      dimmed: false,
      action: () => {
        const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
        if (tabManager && typeof tabManager.openFileInTab === "function") {
          void tabManager.openFileInTab(filePath);
        }
      },
    };
  });
}
```

**Home directory abbreviation**: On macOS, paths under `/Users/<username>/` are
abbreviated as `~/...`. The implementation above uses the pattern
`/Users/` + find second `/` to determine the home prefix. A simpler and more
portable approach uses `filePath.replace(/^\/Users\/[^/]+\//, "~/")`:

```typescript
const abbrevPath = (p: string) => p.replace(/^\/Users\/[^/]+\//, "~/");
const sublabel = abbrevPath(dir) || "/";
```

Use the regex approach. It is simpler, correct on macOS, and does not require knowing
the username.

---

## Top-level rebuild function

```typescript
function buildAllResults(settings: CommandBarSettings): CommandBarResult[] {
  const cmds = (window as any).__MARKABLE_COMMANDS__ as CommandDef[] ?? [];
  const pm = (window as any).__MARKABLE_PLUGIN_MANAGER__;
  const getSettings = (window as any).__MARKABLE_GET_SETTINGS__;
  const appSettings = typeof getSettings === "function" ? getSettings() : { recentFiles: [], keybindings: {} };
  const cmState = (window as any).__CM_STATE__;
  const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ ?? null;
  const handleAction = (window as any).__MARKABLE_HANDLE_ACTION__;

  const results: CommandBarResult[] = [];

  if (settings.showCommands) {
    const commandResults = buildCommandResults({
      commands: cmds,
      pluginManager: pm,
      keybindings: appSettings.keybindings ?? {},
      currentFile,
      navigateToPlugin: (id) => {
        if (typeof handleAction === "function") handleAction("app-plugins");
      },
    });
    results.push(...commandResults);
  }

  if (settings.showHeadings) {
    const headingResults = buildHeadingResults({
      cmState,
      currentFile,
      handleAction,
    });
    results.push(...headingResults);
  }

  if (settings.showRecentFiles) {
    const recentResults = buildRecentFileResults({
      recentFiles: appSettings.recentFiles ?? [],
      openFileByPath: (path) => {
        const tm = (window as any).__MARKABLE_TAB_MANAGER__;
        if (tm) void tm.openFileInTab(path);
      },
    });
    results.push(...recentResults);
  }

  return results;
}
```

---

## Context-invalid dimming logic

The `requiresFile(id: string): boolean` helper:

```typescript
const REQUIRES_FILE_IDS = new Set([
  "file-save", "file-save-as", "file-export", "file-print",
  "edit-paste-plain", "edit-paste-link", "edit-copy-plain", "edit-copy-html",
  "edit-duplicate-line", "edit-delete-line", "edit-goto-line",
  "edit-find", "edit-find-replace",
]);

function requiresFile(id: string): boolean {
  return REQUIRES_FILE_IDS.has(id) || id.startsWith("format-");
}
```

---

## Testing Strategy

To test the builder functions without a live DOM or window globals, the builders accept
their dependencies as parameters. Tests provide mock objects:

```typescript
// Example mock for buildCommandResults
const mockDeps: CommandBuilderDeps = {
  commands: [
    { id: "file-save", label: "Save", defaultKey: "Cmd-S", section: "File" },
    { id: "format-bold", label: "Bold", defaultKey: "Cmd-B", section: "Format" },
  ],
  pluginManager: {
    getStates: () => ({ "focus-mode": true }),
    toggle: async () => {},
    getDefinitions: () => [{ id: "focus-mode", name: "Focus Mode" }],
  },
  keybindings: {},
  currentFile: null,
  navigateToPlugin: jest.fn(),
};
```

---

## Test Cases

### Category A (FR-03.A, FR-04, FR-05)

```typescript
// "command-bar-open" is excluded from results (not navigable to itself)
const results = buildCommandResults(mockDeps);
expect(results.find(r => r.id === "cmd:command-bar-open")).toBeUndefined();

// File-save dimmed when no file open (FR-05.1, FR-05.3)
const saveResult = results.find(r => r.label === "Save");
expect(saveResult?.dimmed).toBe(true);  // currentFile = null

// Format commands dimmed when no file open
const boldResult = results.find(r => r.label === "Bold");
expect(boldResult?.dimmed).toBe(true);

// Plugin dual-result: action result comes first (FR-04.2)
// Focus Mode is enabled, so action label = "Focus Mode Disabled" (EC-24)
const fmActionIdx = results.findIndex(r => r.label === "Focus Mode Disabled");
const fmNavIdx    = results.findIndex(r => r.label === "Focus Mode");
expect(fmActionIdx).toBeLessThan(fmNavIdx);
expect(fmActionIdx).not.toBe(-1);

// Navigate result is not dimmed (FR-04.3)
const fmNav = results.find(r => r.label === "Focus Mode");
expect(fmNav?.dimmed).toBe(false);

// EC-24: when plugin is disabled, action label = "Focus Mode Enabled"
const disabledDeps = { ...mockDeps, pluginManager: { ...mockDeps.pluginManager, getStates: () => ({ "focus-mode": false }) } };
const disabledResults = buildCommandResults(disabledDeps);
const enableLabel = disabledResults.find(r => r.label === "Focus Mode Enabled");
expect(enableLabel).toBeDefined();

// EC-25: command with defaultKey="" has no keybinding badge
const statusBarCmd = { id: "view-toggle-statusbar", label: "Status Bar", defaultKey: "", section: "View" };
const resultWithEmptyKey = buildCommandResults({ ...mockDeps, commands: [statusBarCmd] });
expect(resultWithEmptyKey[0].keybinding).toBeUndefined();

// File-new NOT dimmed when no file open (FR-05.4)
const newCmd = { id: "file-new", label: "New", defaultKey: "Cmd-N", section: "File" };
const newResult = buildCommandResults({ ...mockDeps, commands: [newCmd], currentFile: null });
expect(newResult[0].dimmed).toBe(false);

// File-save NOT dimmed when file IS open
const withFileDeps = { ...mockDeps, currentFile: "/Users/test/file.md" };
const saveResultWithFile = buildCommandResults(withFileDeps).find(r => r.label === "Save");
expect(saveResultWithFile?.dimmed).toBe(false);
```

### Category B (FR-03.B, EC-01, EC-03, EC-09, EC-28, EC-29)

```typescript
// EC-03: no headings → empty results, no section header
const emptyState = { doc: { lines: 0, line: () => ({ text: "", from: 0 }), iterLines: () => {} } };
expect(buildHeadingResults({ cmState: emptyState, currentFile: "/file.md" })).toHaveLength(0);

// Heading level correctly captured
const mockState = makeMockState("# Title\n## Sub\n### Deep");
const headings = buildHeadingResults({ cmState: mockState, currentFile: "/file.md" });
expect(headings[0].headingLevel).toBe(1);
expect(headings[0].label).toBe("Title");
expect(headings[1].headingLevel).toBe(2);

// EC-01: headings dimmed when no file open
const dimmedHeadings = buildHeadingResults({ cmState: mockState, currentFile: null });
expect(dimmedHeadings.every(r => r.dimmed)).toBe(true);

// EC-09: heading with Markdown syntax — raw text preserved
const boldHeadingState = makeMockState("## **Bold Heading**");
const bh = buildHeadingResults({ cmState: boldHeadingState, currentFile: "/file.md" });
expect(bh[0].label).toBe("**Bold Heading**");

// EC-29: duplicate headings have distinct ids
const dupState = makeMockState("## Notes\n## Notes");
const dup = buildHeadingResults({ cmState: dupState, currentFile: "/file.md" });
expect(dup[0].id).not.toBe(dup[1].id);
expect(dup[0].action).not.toBe(dup[1].action);  // distinct closures for distinct lines
```

### Category C (FR-03.C, EC-16, EC-17)

```typescript
// EC-16: empty recent files → empty results
expect(buildRecentFileResults({ recentFiles: [], openFileByPath: async () => {} })).toHaveLength(0);

// Correct basename extraction
const r = buildRecentFileResults({ recentFiles: ["/Users/dave/Notes/my-note.md"], openFileByPath: async () => {} });
expect(r[0].label).toBe("my-note.md");
expect(r[0].sublabel).toBe("~/Notes/");

// Recency order preserved (FR-03.C.3) — no sorting applied
const paths = ["/Users/dave/a.md", "/Users/dave/b.md"];
const rc = buildRecentFileResults({ recentFiles: paths, openFileByPath: async () => {} });
expect(rc[0].label).toBe("a.md");
expect(rc[1].label).toBe("b.md");
```

---

## Acceptance Criteria

- [ ] `buildCommandResults()` excludes `"command-bar-open"` from results.
- [ ] `buildCommandResults()` dims format commands and file-requiring commands when `currentFile` is null.
- [ ] `buildCommandResults()` does NOT dim New, Open, or plugin navigate results when `currentFile` is null.
- [ ] Plugin dual-results: action result appears immediately before navigate result (FR-04.2).
- [ ] EC-24: action result label correctly reflects current plugin state ("Enabled" when disabled, "Disabled" when enabled).
- [ ] EC-25: commands with empty `defaultKey` have no `keybinding` property.
- [ ] `buildHeadingResults()` returns empty array when `cmState` is null.
- [ ] `buildHeadingResults()` correctly parses h1–h6.
- [ ] EC-09: heading labels include raw Markdown syntax.
- [ ] EC-29: duplicate headings have distinct `id` values.
- [ ] `buildRecentFileResults()` abbreviates `/Users/<name>/` to `~/`.
- [ ] All builder tests pass via `npm test`.

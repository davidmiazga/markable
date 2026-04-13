/**
 * IIFE entry point for the Auto TOC core plugin.
 *
 * Compiled by scripts/build-plugins.mjs into:
 *   src-tauri/plugins/core/auto-toc.js
 *
 * Self-containment rules (same as all .plugin.ts files):
 *   - No @codemirror/* imports as values — accessed via window.__CM_VIEW__.
 *   - No app-internal module imports (bridge, settings, main, plugin-types).
 *   - CSS injected as <style id="__markable_auto_toc_css__"> in onEnable.
 *   - import type annotations are erased by tsc; safe for IDE support.
 *
 * Architecture overview:
 *   The plugin registers a CM6 updateListener that debounces at 150 ms.
 *   On each fired update it calls scanHeadings() on the current document text,
 *   then rebuilds the sidebar DOM via rebuildTOC(). Clicking a TOC item
 *   dispatches a CM6 selection + scrollIntoView effect, then focuses the editor.
 *
 * Layout strategy (Strategy A — wrapper element):
 *   onEnable wraps #editor in a .toc-editor-row flex container and appends
 *   #toc-sidebar as a sibling. onDisable reverses this exactly, leaving #app
 *   in the identical state as before enable ran.
 *
 * Test-environment note:
 *   The CM6 globals (window.__CM_VIEW__) are NOT accessed at module-evaluation
 *   time. All CM6 access is deferred into onEnable() and the listener factory
 *   so that test files can import the exported pure functions (scanHeadings,
 *   HeadingEntry) without needing a real browser window or mocked globals.
 */

// Type-only imports — erased by tsc, no runtime code emitted.
import type { EditorView as EditorViewType, ViewUpdate } from "@codemirror/view";
import type { MarkablePluginAPI } from "../markable-plugin-api";

// ── Exported types ────────────────────────────────────────────────────────────

/**
 * Represents a single heading extracted from the document.
 *
 * Exported so that tests can import this type alongside scanHeadings()
 * without depending on any runtime CM6 or DOM code.
 */
export interface HeadingEntry {
  /** ATX heading level: 1 = H1, 6 = H6. */
  level: number;
  /** Raw heading text after the "# " sequence. May be empty string for "# ". */
  text: string;
  /**
   * Absolute character offset of the line's first character within the document.
   * Matches the value that CM6's doc.line(n).from returns for the same line,
   * because CM6 uses LF-only line endings internally (same as String.split("\n")).
   */
  lineFrom: number;
  /** 1-based line number within the document. */
  lineNumber: number;
}

// ── Module-level state ────────────────────────────────────────────────────────
// All variables are private to the IIFE closure after bundling. They are reset
// to their initial values in onDisable to support clean toggle cycles.

/** Debounce delay in milliseconds — consistent with word-count plugin. */
const DEBOUNCE_MS = 150;

/**
 * Live EditorView reference captured on each updateListener invocation.
 * Null until the first update fires after onEnable.
 */
let _view: EditorViewType | null = null;

/** Guards the updateListener hot path. Set true in onEnable, false in onDisable. */
let _enabled = false;

/** Active debounce timer. Cleared before each new schedule and in onDisable. */
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Most recent scanHeadings() result. Cached so that selection-only changes
 * can skip re-scanning the full document.
 */
let _lastEntries: HeadingEntry[] = [];

/** The .toc-list div inside #toc-sidebar. Null when the plugin is disabled. */
let _tocList: HTMLElement | null = null;

/** The .toc-editor-row wrapper div. Null when the plugin is disabled. */
let _tocEditorRow: HTMLDivElement | null = null;

/** The #toc-sidebar root div. Null when the plugin is disabled. */
let _tocSidebar: HTMLDivElement | null = null;

// ── CM6 globals accessor ──────────────────────────────────────────────────────

/**
 * Lazily retrieve the EditorView class from the window.__CM_VIEW__ global.
 *
 * Bug #5 fix rationale: NOT imported from @codemirror/view directly because the
 * build marks all @codemirror/* packages as external. At runtime, cm-globals.ts
 * assigns the main app's CM6 module objects to window globals before any plugin
 * IIFE runs. Destructuring from those globals ensures this plugin's extensions
 * are registered on the same CM6 instance (same StateField slot IDs) as the
 * main editor.
 *
 * The function is called lazily (only inside onEnable and the listener body)
 * rather than at module-evaluation time. This allows test files to import the
 * scanHeadings() pure function from this module without needing a real browser
 * window or a mocked __CM_VIEW__ global (EC-27, EC-28 test coverage).
 *
 * @returns The EditorView constructor/namespace from the shared CM6 instance.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function getCmEditorView(): typeof EditorViewType {
  return ((window as any).__CM_VIEW__ as typeof import("@codemirror/view"))
    .EditorView;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── CSS constant ──────────────────────────────────────────────────────────────

/**
 * Sidebar CSS injected as a <style> tag in onEnable and removed in onDisable.
 *
 * All colours use CSS variables so the sidebar automatically adopts the active
 * theme (EC-19, EC-20). Font sizes are hard-coded in px and are independent
 * of the editor zoom level (EC-18).
 */
const TOC_CSS = `
.toc-editor-row {
  display: flex;
  flex-direction: row;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

#toc-sidebar {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-titlebar);
  border-left: 1px solid var(--border-color);
  overflow: hidden;
}

.toc-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 0;
}

.toc-item {
  display: block;
  width: 100%;
  background: none;
  border: none;
  border-left: 2px solid transparent;
  text-align: left;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  line-height: 1.4;
  padding: 4px 12px;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-sizing: border-box;
}

.toc-item:hover {
  background: var(--code-bg);
}

.toc-item-active {
  color: var(--text-primary);
  border-left: 2px solid var(--link-color);
  background: var(--selection-bg);
}

.toc-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  color: var(--text-secondary);
  pointer-events: none;
  user-select: none;
}
`;

// ── Pure functions ────────────────────────────────────────────────────────────

/**
 * Scan a Markdown document string and return all ATX headings in document order.
 *
 * This is a pure function with no CM6 or DOM dependency. It is exported so that
 * tests can import and exercise it directly from the TypeScript source without
 * needing a built IIFE or a real browser environment.
 *
 * Rules (CommonMark ATX headings):
 *   - Exactly 1–6 `#` characters at the start of the line.
 *   - Must be followed by a literal space character.
 *   - Everything after "# " is the heading text (stored verbatim, per FR-6).
 *   - Lines starting with 7+ `#` are NOT headings.
 *   - Lines where `#` appears after a non-# character are NOT headings.
 *   - Headings inside fenced code blocks (``` or ~~~) are excluded (EC-25).
 *
 * @param docText - Full document text using LF line endings (same as CM6 internal).
 * @returns       Array of HeadingEntry objects in document order.
 */
export function scanHeadings(docText: string): HeadingEntry[] {
  const result: HeadingEntry[] = [];

  // Whether we are currently inside a fenced code block, and which marker
  // opened it. CommonMark requires the closing fence to use the same marker
  // as the opener (``` closes only a ``` fence; ~~~ closes only a ~~~ fence).
  // Tracking the opener prevents a ~~~ fence from being closed by a ``` line.
  let fenceMarker: "```" | "~~~" | null = null;

  // Accumulated character offset for the start of the current line.
  // This matches CM6's doc.line(n).from because both use LF-only line counting.
  let lineStart = 0;

  // 1-based line counter for the lineNumber field.
  let lineNumber = 1;

  // Regex for ATX headings: 1–6 # chars at line start followed by a space.
  // match[1] = the # characters, match[2] = heading text (may be empty string).
  const HEADING_RE = /^(#{1,6}) (.*)/;

  const lines = docText.split("\n");

  for (const line of lines) {
    const trimmed = line.trimStart();

    // Detect code fence open/close using marker-type tracking so that a ~~~
    // fence can only be closed by a ~~~ line (and ``` only by ```) per CommonMark.
    const lineMarker = trimmed.startsWith("```")
      ? "```"
      : trimmed.startsWith("~~~")
        ? "~~~"
        : null;

    if (lineMarker !== null) {
      if (fenceMarker === null) {
        // Opening a new fence.
        fenceMarker = lineMarker;
      } else if (lineMarker === fenceMarker) {
        // Closing the open fence with a matching marker.
        fenceMarker = null;
      }
      // A non-matching marker inside a fence is treated as regular content.
      lineStart += line.length + 1;
      lineNumber++;
      continue;
    }

    // Only test for headings when we are outside a code fence.
    if (fenceMarker === null) {
      const match = HEADING_RE.exec(line);
      if (match) {
        result.push({
          level: match[1].length,
          text: match[2], // Verbatim — no inline Markdown stripping (FR-6).
          lineFrom: lineStart,
          lineNumber,
        });
      }
    }

    lineStart += line.length + 1; // +1 accounts for the \n separator.
    lineNumber++;
  }

  return result;
}

/**
 * Determine which heading is "active" given the current cursor position.
 *
 * The active heading is the last heading whose lineFrom is <= the cursor
 * position. Returns -1 when the cursor is above all headings (EC-3).
 *
 * This is O(n) on the number of headings, not the document size.
 *
 * @param entries   - Heading entries in document order (from scanHeadings).
 * @param cursorPos - Current cursor character offset in the document.
 * @returns         Index into entries of the active heading, or -1.
 */
export function findActiveIndex(entries: HeadingEntry[], cursorPos: number): number {
  let active = -1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].lineFrom <= cursorPos) {
      active = i;
    } else {
      // Entries are in document order. Once we pass the cursor, no later
      // entry can become active — bail early.
      break;
    }
  }
  return active;
}

// ── CSS lifecycle helpers ─────────────────────────────────────────────────────

/**
 * Inject the sidebar <style> tag into <head>.
 *
 * Guarded by the element id so repeated onEnable calls (from rapid toggle
 * cycles) never insert duplicate <style> tags (EC-11, EC-12).
 */
function injectCSS(): void {
  const STYLE_ID = "__markable_auto_toc_css__";
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = TOC_CSS;
  document.head.appendChild(style);
}

/**
 * Remove the sidebar <style> tag injected by injectCSS().
 * No-op if the tag is not present (e.g. onDisable called before onEnable).
 */
function removeCSS(): void {
  document.getElementById("__markable_auto_toc_css__")?.remove();
}

// ── DOM lifecycle helpers ─────────────────────────────────────────────────────

/**
 * Create the #toc-sidebar element and its inner .toc-list child.
 *
 * Does NOT insert the sidebar into the document — that is done by enableLayout().
 * Sets the module-level _tocList reference so that rebuildTOC() can write to it.
 *
 * @returns The newly created sidebar root div.
 */
function createSidebar(): HTMLDivElement {
  const sidebar = document.createElement("div");
  sidebar.id = "toc-sidebar";

  const list = document.createElement("div");
  list.className = "toc-list";
  sidebar.appendChild(list);

  // Store a reference so rebuildTOC() can populate it without re-querying.
  _tocList = list;

  return sidebar;
}

/**
 * Insert the .toc-editor-row wrapper into #app and move #editor into it.
 *
 * Layout after this call:
 *   #app (flex: column)
 *     .toc-editor-row (flex: row; flex: 1)
 *       #editor  (flex: 1)
 *       #toc-sidebar (width: 220px)
 *     #statusbar (full width; unchanged)
 *
 * The statusbar remains a direct child of #app, so it spans full width (EC-21).
 *
 * @param sidebar - The #toc-sidebar element returned by createSidebar().
 */
function enableLayout(sidebar: HTMLDivElement): void {
  const app = document.getElementById("app")!;
  const editor = document.getElementById("editor")!;
  const statusbar = document.getElementById("statusbar");

  const row = document.createElement("div");
  row.className = "toc-editor-row";
  _tocEditorRow = row;

  // Insert the wrapper before the statusbar so the statusbar stays full-width.
  // If there is no statusbar, append to the end of #app.
  if (statusbar) {
    app.insertBefore(row, statusbar);
  } else {
    app.appendChild(row);
  }

  // Move #editor from #app into the row wrapper.
  row.appendChild(editor);
  // Append the sidebar as the right-side sibling of #editor.
  row.appendChild(sidebar);
}

/**
 * Reverse the layout changes made by enableLayout().
 *
 * After this call #app is in exactly the same state as before onEnable ran:
 *   #app (flex: column)
 *     #editor
 *     #statusbar
 *
 * Also nulls out _tocEditorRow, _tocSidebar, and _tocList so they can be
 * garbage-collected and do not leak across toggle cycles (EC-11, EC-12).
 */
function disableLayout(): void {
  const app = document.getElementById("app")!;
  const editor = document.getElementById("editor")!;
  const statusbar = document.getElementById("statusbar");

  // Move #editor back to #app before the statusbar (same position as before enable).
  if (statusbar) {
    app.insertBefore(editor, statusbar);
  } else {
    app.appendChild(editor);
  }

  // Remove the wrapper from the DOM. The sidebar is a child of the row, so
  // removing the row removes the sidebar in the same operation. Calling
  // _tocSidebar?.remove() separately would be a no-op here (the sidebar is
  // already gone when the row is removed) and would create fragile ordering.
  _tocEditorRow?.remove();

  _tocSidebar = null;
  _tocEditorRow = null;
  _tocList = null;
}

// ── DOM render helper ─────────────────────────────────────────────────────────

/**
 * Replace the contents of .toc-list with the current heading entries.
 *
 * Called on every debounce tick. Uses innerHTML = "" to discard all existing
 * child nodes and their inline event listeners in one operation — no explicit
 * removeEventListener calls are needed because the nodes are thrown away.
 *
 * The entire list is rebuilt on every call (both doc changes and selection
 * changes). This is intentional: with up to 200+ headings (EC-9 uses 201 as
 * the boundary) the DOM cost is negligible and the code is simpler than a
 * partial-update path.
 *
 * @param entries   - Current heading list from scanHeadings().
 * @param activeIdx - Index of the heading that should show the active style, or -1.
 */
function rebuildTOC(entries: HeadingEntry[], activeIdx: number): void {
  if (!_tocList) return;

  // Discard all existing children and their event listeners.
  _tocList.innerHTML = "";

  if (entries.length === 0) {
    // Empty state: centered "No headings" message (FR-9, EC-1, EC-2).
    const empty = document.createElement("div");
    empty.className = "toc-empty";
    empty.textContent = "No headings";
    _tocList.appendChild(empty);
    return;
  }

  // Base left padding for H1 items. Each subsequent level adds INDENT_PER_LEVEL px.
  const BASE_PADDING = 12;
  const INDENT_PER_LEVEL = 12;

  // Cache the EditorView class once per rebuild rather than per-click so the
  // window global lookup is not repeated on every click event.
  const EditorView = getCmEditorView();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const btn = document.createElement("button");
    btn.className = "toc-item";

    // Mark the active heading with an extra CSS class.
    if (i === activeIdx) {
      btn.classList.add("toc-item-active");
    }

    // Compute left padding: H1 = 12px, H2 = 24px, H3 = 36px, …
    const indent = (entry.level - 1) * INDENT_PER_LEVEL;
    btn.style.paddingLeft = `${BASE_PADDING + indent}px`;

    // EC-6: An empty heading (e.g. "# " with no text) gets a non-breaking space
    // so the button has visible height and remains clickable.
    btn.textContent = entry.text || "\u00A0";

    // Capture lineFrom in the closure so the click handler always dispatches
    // to the correct position even when the list is rebuilt later.
    const lineFrom = entry.lineFrom;
    btn.addEventListener("click", () => {
      if (!_view) return;
      // Move the cursor to the heading line and scroll it to the vertical centre.
      _view.dispatch({
        selection: { anchor: lineFrom },
        effects: EditorView.scrollIntoView(lineFrom, { y: "center" }),
      });
      // Ensure the editor receives focus so the user can type immediately (FR-8).
      _view.focus();
    });

    _tocList.appendChild(btn);
  }
}

// ── CM6 listener factory ──────────────────────────────────────────────────────

/**
 * Build and return the CM6 updateListener extension for the TOC plugin.
 *
 * This is a factory function rather than a module-level constant so that
 * getCmEditorView() is not called at module-evaluation time. Calling it at
 * module load would fail in test environments where window.__CM_VIEW__ is
 * not defined. The factory is invoked inside onEnable(), which only runs in
 * a real browser/Tauri context where the global is guaranteed to be present.
 *
 * Behaviour:
 *   - Always captures the latest _view reference from update.view.
 *   - Skips processing when neither the document nor the selection changed.
 *   - Debounces at DEBOUNCE_MS to avoid redundant DOM updates during fast typing.
 *   - When only the selection changed, reuses _lastEntries (skips re-scan).
 *   - Snapshots doc text BEFORE the setTimeout so the correct content is used
 *     (CM6 transactions may be discarded or merged after the current tick).
 *
 * @returns A CM6 Extension (EditorView.updateListener instance).
 */
function buildTocUpdateListener() {
  const EditorView = getCmEditorView();
  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!_enabled) return;

    // Always capture the latest view reference — cheap assignment, always safe.
    _view = update.view;

    const docChanged = update.docChanged;
    const selChanged = update.selectionSet;

    if (!docChanged && !selChanged) return;

    // Cancel any pending debounce before scheduling a new one.
    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }

    // Snapshot immutable values from the transaction state BEFORE the async delay.
    // docText is null when only the selection changed — triggers reuse of _lastEntries.
    const docText = docChanged ? update.state.doc.toString() : null;
    const cursorPos = update.state.selection.main.head;

    _debounceTimer = setTimeout(() => {
      // Guard: the plugin may have been disabled during the debounce window (EC-10).
      if (!_enabled) return;

      if (docText !== null) {
        // Document content changed — rescan from scratch.
        _lastEntries = scanHeadings(docText);
      }
      // Recalculate which heading is active and repaint the list.
      const activeIdx = findActiveIndex(_lastEntries, cursorPos);
      rebuildTOC(_lastEntries, activeIdx);
    }, DEBOUNCE_MS);
  });
}

// ── Plugin export ─────────────────────────────────────────────────────────────

/**
 * Auto TOC plugin export object.
 *
 * onEnable sequence:
 *   1. Set _enabled flag.
 *   2. Inject CSS <style> tag (idempotent).
 *   3. Create #toc-sidebar and enable layout wrapper.
 *   4. Build and register CM6 updateListener via api.addExtensions().
 *   5. Trigger an initial TOC build from the current document state so the
 *      sidebar is populated immediately without waiting for a user keystroke.
 *
 * onDisable sequence (exact reversal):
 *   1. Clear _enabled flag.
 *   2. Cancel any pending debounce.
 *   3. Remove CM6 extension via api.removeExtensions().
 *   4. Dismantle layout wrapper and remove sidebar.
 *   5. Remove CSS <style> tag.
 *   6. Reset all module-level state to initial values.
 */
export default {
  id: "auto-toc",
  name: "Auto TOC",
  version: "1.0.0",
  description: "Table of contents sidebar",
  detail:
    "Displays a real-time table of contents in a right-side sidebar, listing all headings in the document. The active heading is highlighted as you move the cursor through the document. Click any heading to jump to it instantly.",

  onEnable(api: MarkablePluginAPI): void {
    _enabled = true;

    // Forward-compatibility stub. The auto-toc plugin has no persistent settings
    // in Phase 1. Calling loadSettings() now means the call site is already wired
    // when Phase 2 (persisted heading-depth filter, etc.) adds settings. The returned
    // Promise is intentionally not awaited — the MarkablePluginAPI implementation
    // catches all errors internally and returns null on failure, so unhandled
    // rejection is impossible (FR-12).
    void api.loadSettings();

    injectCSS();
    _tocSidebar = createSidebar();
    enableLayout(_tocSidebar);

    // Build the CM6 listener here (not at module level) so getCmEditorView() is
    // only called in a real runtime context where window.__CM_VIEW__ exists.
    api.addExtensions([buildTocUpdateListener()]);

    // Initial build: populate the TOC immediately when the plugin is first enabled
    // rather than waiting for the next document change or cursor movement.
    //
    // This reads from window.__MARKABLE_EDITOR_VIEW__ — a global set in main.ts
    // after the editor is created. If this global is absent (e.g. in test contexts
    // or if the app sequence changes), the sidebar shows the empty state and the
    // updateListener populates it on the first CM6 transaction.
    //
    // Architecture note: the MarkablePluginAPI design (Decision 1 in
    // markable-plugin-api.ts) intentionally omits the raw EditorView from the
    // plugin API surface. This global is an explicit, documented deviation from
    // that constraint — accepted for Phase 1 because the alternative (waiting for
    // the first keystroke) produces a visible empty-state flash on every enable.
    // The global exposes the EditorView to all plugins loaded in the same WebView.
    // For a local first-party desktop app this is acceptable. This deviation is
    // tracked in docs/specs/auto-toc/00_index.md deferred items for future audit.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const liveView = (window as any).__MARKABLE_EDITOR_VIEW__ as
      | EditorViewType
      | undefined;
    /* eslint-enable @typescript-eslint/no-explicit-any */

    if (liveView) {
      _view = liveView;
      _lastEntries = scanHeadings(liveView.state.doc.toString());
      const activeIdx = findActiveIndex(
        _lastEntries,
        liveView.state.selection.main.head,
      );
      rebuildTOC(_lastEntries, activeIdx);
    } else {
      // No editor view available yet — render the empty state.
      // The updateListener will trigger a full rebuild on the next transaction.
      rebuildTOC([], -1);
    }
  },

  onDisable(api: MarkablePluginAPI): void {
    _enabled = false;

    // Cancel any in-flight debounce to prevent a stale rebuild after disable.
    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }

    // Remove the CM6 extension from the editor's Compartment.
    api.removeExtensions();

    // Dismantle the sidebar and restore the original #app layout.
    disableLayout();

    // Remove the injected CSS.
    removeCSS();

    // Reset all module-level state so the next onEnable call starts clean.
    _view = null;
    _lastEntries = [];
    // _tocList, _tocEditorRow, _tocSidebar are already nulled by disableLayout().
  },
};

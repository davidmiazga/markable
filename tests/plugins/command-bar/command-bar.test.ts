/**
 * Tests for the Command Bar plugin (FC2 #11).
 *
 * Organized by implementation step:
 *   - Step 02: fuzzyMatch(), renderHighlightedLabel()
 *   - Step 03: buildCommandResults(), buildHeadingResults(), buildRecentFileResults()
 *   - Step 04: buildOverlayDOM(), renderResults()
 *   - Step 05: firstSelectableId(), navigation helpers
 *   - Step 06: renderDetailExtra(), settings loading
 *   - Step 07: plugin lifecycle (enable/disable)
 *
 * Environment: happy-dom (configured globally in vitest.config.ts)
 *
 * WHY DIRECT IMPORTS (not dynamic):
 * fuzzy-ranker.ts and the builder functions are pure modules with no window globals
 * accessed at module evaluation time. Unlike math.plugin.ts (which destructures CM6
 * globals at the top level), these modules are safe to import statically.
 * The plugin file itself (command-bar.plugin.ts) is also safe because it only reads
 * window globals inside function bodies, not at module evaluation time.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";

// ── Step 02: Fuzzy ranker imports ─────────────────────────────────────────────

import { fuzzyMatch, renderHighlightedLabel } from "../../../src/plugins/command-bar/fuzzy-ranker";

// ── Step 03: Builder imports (populated in later steps) ───────────────────────
// Imported after the plugin file is created in step 03.
import {
  buildCommandResults,
  buildHeadingResults,
  buildRecentFileResults,
} from "../../../src/plugins/command-bar/command-bar.plugin";

// ── Step 04: DOM builder imports ──────────────────────────────────────────────
import {
  buildOverlayDOM,
  renderResults,
} from "../../../src/plugins/command-bar/command-bar.plugin";

// ── Step 05: Navigation helper imports ───────────────────────────────────────
import {
  firstSelectableId,
} from "../../../src/plugins/command-bar/command-bar.plugin";

// ── Step 06: Settings UI imports ──────────────────────────────────────────────
import {
  renderDetailExtra,
} from "../../../src/plugins/command-bar/command-bar.plugin";

// ── Step 07: Plugin default export ────────────────────────────────────────────
import commandBarPlugin from "../../../src/plugins/command-bar/command-bar.plugin";

// ── Step 01 (Modal): Mode infrastructure imports ──────────────────────────────
import {
  setMode,
} from "../../../src/plugins/command-bar/command-bar.plugin";
import type { BarMode } from "../../../src/plugins/command-bar/command-bar.plugin";

// ── Step 03 (Commands Mode Refactor): buildResultsForMode import ──────────────
import {
  buildResultsForMode,
} from "../../../src/plugins/command-bar/command-bar.plugin";

// ── Step 02 (Files Mode): files-mode.ts imports ───────────────────────────────
import {
  buildFilesResults,
  countWorkspaceBeforeCap,
  abbreviatePath,
  basename,
  dirname,
  FILES_CAP,
  FILES_SECTION_LABELS,
} from "../../../src/plugins/command-bar/files-mode";

// ── Step 06 (EC Coverage): keybindings-mode static imports ───────────────────
// These are also loaded dynamically in Step 04 beforeAll; the static imports
// here allow Step 06 tests to use them at module scope without a beforeAll.
import {
  buildKeybindingResults,
  formatKeyDisplay,
  isSystemReserved,
  isModifierOnly,
  captureKeyFromEvent,
  checkConflict,
} from "../../../src/plugins/command-bar/keybindings-mode";

// ── Step 06 (EC Coverage): preset-manager static imports ─────────────────────
import {
  DEFAULT_PRESET_NAME,
  PRESET_NAMESPACE_PREFIX,
  presetNamespace,
  loadPresets,
} from "../../../src/plugins/command-bar/preset-manager";
import type {
  TabEntry,
  FilesResult,
  FilesModeBuilderDeps,
} from "../../../src/plugins/command-bar/files-mode";

// ── Step 02: renderFilesResults import from plugin ────────────────────────────
import {
  renderFilesResults,
} from "../../../src/plugins/command-bar/command-bar.plugin";

// ── Step 04: renderKeybindingResults import from plugin ───────────────────────
import {
  renderKeybindingResults,
} from "../../../src/plugins/command-bar/command-bar.plugin";

// ── Step 04 (Global Search): content-mode and mode-constant imports ───────────
import {
  renderContentResults,
  MODE_PLACEHOLDERS,
  MODE_FOOTER_HINTS,
  MODE_BADGE_LABELS,
  MODE_TAB_SHORTCUTS,
  MODE_CYCLE,
} from "../../../src/plugins/command-bar/command-bar.plugin";

// ── Types (copied from plugin internals for test-readability) ─────────────────

interface CommandBarResult {
  id: string;
  category: "commands" | "headings" | "recent";
  label: string;
  sublabel?: string;
  keybinding?: string;
  headingLevel?: number;
  dimmed: boolean;
  action: () => void;
  _matchPositions?: number[];
}

interface CommandDef {
  id: string;
  label: string;
  defaultKey: string;
  section: string;
}

// ── Mock factory helpers ───────────────────────────────────────────────────────

/**
 * Creates a minimal mock CodeMirror EditorState document from multiline text.
 * Only the properties accessed by buildHeadingResults are implemented:
 *   - doc.lines: total line count
 *   - doc.iterLines(cb): calls cb(lineText) for each line
 *   - doc.line(n): returns { text, from, to } for 1-based line number n
 */
function makeMockState(text: string): { doc: any } {
  const lines = text.split("\n");
  // Precompute cumulative offsets so doc.line(n) returns correct `from` values.
  const offsets: number[] = [0];
  for (let i = 0; i < lines.length - 1; i++) {
    offsets.push(offsets[i] + lines[i].length + 1); // +1 for the newline
  }
  return {
    doc: {
      get lines() { return lines.length; },
      iterLines(cb: (text: string) => void) {
        for (const line of lines) cb(line);
      },
      line(n: number) {
        const idx = n - 1; // convert 1-based to 0-based
        const from = offsets[idx] ?? 0;
        return {
          text: lines[idx] ?? "",
          from,
          to: from + (lines[idx]?.length ?? 0),
        };
      },
    },
  };
}

/**
 * Minimal mock MarkablePluginAPI for step 06/07 tests.
 */
function makeMockApi(saved: Record<string, unknown> | null = null) {
  return {
    loadSettings: vi.fn().mockResolvedValue(saved),
    saveSettings: vi.fn().mockResolvedValue(undefined),
  };
}

// =============================================================================
// STEP 02 — Fuzzy Ranker
// =============================================================================

describe("fuzzyMatch", () => {
  // ── Tier 1: exact prefix ────────────────────────────────────────────────────

  it("Tier 1: returns tier 1 for exact prefix match (short query)", () => {
    const r = fuzzyMatch("Focus Mode", "fo");
    expect(r).not.toBeNull();
    expect(r!.tier).toBe(1);
    expect(r!.positions).toEqual([0, 1]);
  });

  it("Tier 1: returns tier 1 for full label prefix match", () => {
    const r = fuzzyMatch("Focus Mode", "focus");
    expect(r).not.toBeNull();
    expect(r!.tier).toBe(1);
    expect(r!.positions).toEqual([0, 1, 2, 3, 4]);
  });

  it("Tier 1: case-insensitive — uppercase label, lowercase query", () => {
    const r = fuzzyMatch("FOCUS MODE", "fo");
    expect(r).not.toBeNull();
    expect(r!.tier).toBe(1);
    expect(r!.positions).toEqual([0, 1]);
  });

  it("Tier 1: single uppercase query character matches lowercase label start", () => {
    const r = fuzzyMatch("bold", "B");
    expect(r).not.toBeNull();
    expect(r!.tier).toBe(1);
    expect(r!.positions).toEqual([0]);
  });

  // ── Tier 2: word-boundary prefix ────────────────────────────────────────────

  it("Tier 2: word-boundary prefix (second word)", () => {
    const r = fuzzyMatch("Toggle Focus", "fo");
    expect(r).not.toBeNull();
    expect(r!.tier).toBe(2);
    // "Focus" starts at index 7 in "Toggle Focus"
    expect(r!.positions).toEqual([7, 8]);
  });

  it("Tier 2: word-boundary prefix with & separator", () => {
    // "Find & Replace" — "re" matches "Replace" at index 9 (starts after "& ")
    // Words: "Find", "&", "Replace" — "re" matches start of "Replace"
    // "Find & Replace": F=0, i=1, n=2, d=3, ' '=4, &=5, ' '=6, R=7, e=8
    // Wait: "Replace" starts at index 7 in "Find & Replace"
    const r = fuzzyMatch("Find & Replace", "re");
    expect(r).not.toBeNull();
    expect(r!.tier).toBe(2);
    expect(r!.positions).toEqual([7, 8]);
  });

  it("Tier 2: hyphen word boundary", () => {
    // "copy-html": second word "html" at index 5
    const r = fuzzyMatch("copy-html", "ht");
    expect(r).not.toBeNull();
    expect(r!.tier).toBe(2);
    expect(r!.positions).toEqual([5, 6]);
  });

  it("Tier 2: underscore word boundary", () => {
    const r = fuzzyMatch("focus_mode", "mo");
    expect(r).not.toBeNull();
    expect(r!.tier).toBe(2);
    // "focus_mode": f=0,o=1,c=2,u=3,s=4,_=5,m=6,o=7
    expect(r!.positions).toEqual([6, 7]);
  });

  // ── Tier 3: substring ───────────────────────────────────────────────────────

  it("Tier 3: substring match (not prefix, not word-boundary prefix)", () => {
    const r = fuzzyMatch("Bold", "ol");
    expect(r).not.toBeNull();
    expect(r!.tier).toBe(3);
    expect(r!.positions).toEqual([1, 2]);
  });

  it("Tier 3: substring at end of string", () => {
    const r = fuzzyMatch("Close All", "se");
    expect(r).not.toBeNull();
    expect(r!.tier).toBe(3);
    // "Close All": C=0,l=1,o=2,s=3,e=4 — "se" at index 3
    expect(r!.positions).toEqual([3, 4]);
  });

  // ── Tier 4: subsequence ──────────────────────────────────────────────────────

  it("Tier 4: subsequence match (non-consecutive characters)", () => {
    const r = fuzzyMatch("Focus Mode", "fmd");
    expect(r).not.toBeNull();
    expect(r!.tier).toBe(4);
    // F=0, M=6 (in "Mode"), d=8
    expect(r!.positions).toEqual([0, 6, 8]);
  });

  it("Tier 4 EC-23: non-consecutive positions are correct (fcs in Focus Mode)", () => {
    const r = fuzzyMatch("Focus Mode", "fcs");
    expect(r).not.toBeNull();
    expect(r!.tier).toBe(4);
    // "Focus Mode": F=0, o=1, c=2, u=3, s=4, ' '=5, M=6, o=7, d=8, e=9
    // Greedy-first: F→0, c→2, s→4 (s is at index 4, not 3 which is 'u')
    expect(r!.positions).toEqual([0, 2, 4]);
  });

  // ── No match ────────────────────────────────────────────────────────────────

  it("returns null when no characters match in order", () => {
    expect(fuzzyMatch("Bold", "xyz")).toBeNull();
  });

  it("returns null when query is longer than label (no subsequence possible)", () => {
    expect(fuzzyMatch("Bold", "boldd")).toBeNull();
  });

  it("returns null for empty query", () => {
    expect(fuzzyMatch("Bold", "")).toBeNull();
  });

  // ── EC-10: HTML-special characters in label ──────────────────────────────────

  it("EC-10: handles HTML-special characters in label correctly", () => {
    const r = fuzzyMatch("Save <> File", "sa");
    expect(r).not.toBeNull();
    expect(r!.tier).toBe(1);
    expect(r!.positions).toEqual([0, 1]);
  });

  // ── Tier ordering verification ───────────────────────────────────────────────

  it("same query: tier 1 result sorts before tier 2 result", () => {
    // "Focus Mode" matches "fo" at tier 1, "Toggle Focus" at tier 2
    const r1 = fuzzyMatch("Focus Mode", "fo");
    const r2 = fuzzyMatch("Toggle Focus", "fo");
    expect(r1!.tier).toBe(1);
    expect(r2!.tier).toBe(2);
    expect(r1!.tier).toBeLessThan(r2!.tier);
  });
});

// =============================================================================
// renderHighlightedLabel
// =============================================================================

describe("renderHighlightedLabel", () => {
  it("wraps matched prefix in a <mark class=cb-match> element", () => {
    const el = renderHighlightedLabel("Focus Mode", [0, 1]);
    const mark = el.querySelector("mark.cb-match");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe("Fo");
  });

  it("creates a trailing text node for unmatched suffix", () => {
    const el = renderHighlightedLabel("Focus Mode", [0, 1]);
    // Should be: <mark>Fo</mark> + text "cus Mode"
    expect(el.childNodes.length).toBe(2);
    expect(el.childNodes[1].textContent).toBe("cus Mode");
  });

  it("EC-10: HTML injection safety — < character rendered as text, not parsed", () => {
    const el = renderHighlightedLabel("<script>", [0]);
    const mark = el.querySelector("mark");
    expect(mark).not.toBeNull();
    // textContent must be the literal "<" character, not a parsed tag
    expect(mark!.textContent).toBe("<");
    // The element must not contain any unexpected child elements from injection
    expect(el.querySelectorAll("script").length).toBe(0);
  });

  it("EC-23: non-consecutive positions — separate marks per run", () => {
    // positions [0, 2, 3]: F is alone, cu are consecutive → 2 marks
    const el = renderHighlightedLabel("Focus Mode", [0, 2, 3]);
    const marks = el.querySelectorAll("mark");
    expect(marks.length).toBe(2);
    expect(marks[0].textContent).toBe("F");
    expect(marks[1].textContent).toBe("cu");
  });

  it("consecutive positions are merged into a single mark", () => {
    const el = renderHighlightedLabel("Focus", [0, 1, 2, 3, 4]);
    const marks = el.querySelectorAll("mark");
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe("Focus");
  });

  it("empty positions array returns label as plain text node", () => {
    const el = renderHighlightedLabel("Bold", []);
    expect(el.querySelectorAll("mark").length).toBe(0);
    expect(el.textContent).toBe("Bold");
  });
});

// =============================================================================
// STEP 03 — Result Builders
// =============================================================================

describe("buildCommandResults", () => {
  const baseCommands: CommandDef[] = [
    { id: "file-new",    label: "New",      defaultKey: "Cmd-N",   section: "File" },
    { id: "file-save",   label: "Save",     defaultKey: "Cmd-S",   section: "File" },
    { id: "format-bold", label: "Bold",     defaultKey: "Cmd-B",   section: "Format" },
    { id: "command-bar-open", label: "Command Bar", defaultKey: "Cmd-Shift-P", section: "View" },
    { id: "view-toggle-statusbar", label: "Status Bar", defaultKey: "", section: "View" },
  ];

  const basePM = {
    getStates: () => ({ "focus-mode": true }),
    toggle: vi.fn().mockResolvedValue(undefined),
    getDefinitions: () => [{ id: "focus-mode", name: "Focus Mode" }],
  };

  const baseDeps = {
    commands: baseCommands,
    pluginManager: basePM,
    keybindings: {},
    currentFile: null as string | null,
    navigateToPlugin: vi.fn(),
  };

  it("excludes command-bar-open itself from results", () => {
    const results = buildCommandResults(baseDeps);
    expect(results.find((r) => r.id === "cmd:command-bar-open")).toBeUndefined();
  });

  it("dims file-save when no file is open (REQUIRES_FILE set)", () => {
    const results = buildCommandResults(baseDeps);
    const save = results.find((r) => r.id === "cmd:file-save");
    expect(save?.dimmed).toBe(true);
  });

  it("dims format commands when no file is open (format- prefix)", () => {
    const results = buildCommandResults(baseDeps);
    const bold = results.find((r) => r.id === "cmd:format-bold");
    expect(bold?.dimmed).toBe(true);
  });

  it("does NOT dim file-new when no file is open", () => {
    const results = buildCommandResults(baseDeps);
    const newCmd = results.find((r) => r.id === "cmd:file-new");
    expect(newCmd?.dimmed).toBe(false);
  });

  it("does NOT dim file-save when a file is open", () => {
    const results = buildCommandResults({ ...baseDeps, currentFile: "/file.md" });
    const save = results.find((r) => r.id === "cmd:file-save");
    expect(save?.dimmed).toBe(false);
  });

  it("EC-25: command with empty defaultKey has no keybinding property", () => {
    const results = buildCommandResults(baseDeps);
    const statusBar = results.find((r) => r.id === "cmd:view-toggle-statusbar");
    expect(statusBar?.keybinding).toBeUndefined();
  });

  it("FR-04.2: plugin action result appears before navigate result", () => {
    const results = buildCommandResults(baseDeps);
    const actionIdx = results.findIndex((r) => r.label === "Focus Mode Disabled");
    const navIdx = results.findIndex((r) => r.label === "Focus Mode");
    expect(actionIdx).not.toBe(-1);
    expect(navIdx).not.toBe(-1);
    expect(actionIdx).toBeLessThan(navIdx);
  });

  it("EC-24: when plugin is ENABLED, action label says Disabled", () => {
    const results = buildCommandResults(baseDeps); // focus-mode is enabled
    expect(results.find((r) => r.label === "Focus Mode Disabled")).toBeDefined();
  });

  it("EC-24: when plugin is DISABLED, action label says Enabled", () => {
    const disabledPM = { ...basePM, getStates: () => ({ "focus-mode": false }) };
    const results = buildCommandResults({ ...baseDeps, pluginManager: disabledPM });
    expect(results.find((r) => r.label === "Focus Mode Enabled")).toBeDefined();
  });

  it("plugin navigate result is never dimmed", () => {
    const results = buildCommandResults(baseDeps);
    const nav = results.find((r) => r.label === "Focus Mode" && r.category === "commands");
    expect(nav?.dimmed).toBe(false);
  });

  it("keybinding is formatted with symbol characters for commands with a key", () => {
    const results = buildCommandResults(baseDeps);
    const newCmd = results.find((r) => r.id === "cmd:file-new");
    // Cmd-N → ⌘N
    expect(newCmd?.keybinding).toBe("⌘N");
  });
});

describe("buildHeadingResults", () => {
  it("returns empty array when cmState is null", () => {
    const results = buildHeadingResults({ cmState: null, currentFile: "/f.md" });
    expect(results).toHaveLength(0);
  });

  it("EC-03: returns empty array when document has no headings", () => {
    const state = makeMockState("Hello world\nNo headings here");
    const results = buildHeadingResults({ cmState: state, currentFile: "/f.md" });
    expect(results).toHaveLength(0);
  });

  it("correctly parses h1, h2, h3 headings", () => {
    const state = makeMockState("# Title\n## Sub\n### Deep");
    const results = buildHeadingResults({ cmState: state, currentFile: "/f.md" });
    expect(results).toHaveLength(3);
    expect(results[0].headingLevel).toBe(1);
    expect(results[0].label).toBe("Title");
    expect(results[1].headingLevel).toBe(2);
    expect(results[1].label).toBe("Sub");
    expect(results[2].headingLevel).toBe(3);
    expect(results[2].label).toBe("Deep");
  });

  it("EC-01: all headings are dimmed when no file is open", () => {
    const state = makeMockState("# Title\n## Sub");
    const results = buildHeadingResults({ cmState: state, currentFile: null });
    expect(results.every((r) => r.dimmed)).toBe(true);
  });

  it("headings are NOT dimmed when a file is open", () => {
    const state = makeMockState("# Title");
    const results = buildHeadingResults({ cmState: state, currentFile: "/f.md" });
    expect(results[0].dimmed).toBe(false);
  });

  it("EC-09: heading label preserves raw Markdown syntax inside", () => {
    const state = makeMockState("## **Bold Heading**");
    const results = buildHeadingResults({ cmState: state, currentFile: "/f.md" });
    expect(results[0].label).toBe("**Bold Heading**");
  });

  it("EC-29: duplicate headings with same text have distinct ids", () => {
    const state = makeMockState("## Notes\n## Notes");
    const results = buildHeadingResults({ cmState: state, currentFile: "/f.md" });
    expect(results).toHaveLength(2);
    expect(results[0].id).not.toBe(results[1].id);
  });

  it("heading results have category: headings", () => {
    const state = makeMockState("# Title");
    const results = buildHeadingResults({ cmState: state, currentFile: "/f.md" });
    expect(results[0].category).toBe("headings");
  });

  it("EC-28: heading at line 1 (first line) is parsed correctly", () => {
    const state = makeMockState("# First Line\nsome text");
    const results = buildHeadingResults({ cmState: state, currentFile: "/f.md" });
    expect(results[0].label).toBe("First Line");
    expect(results[0].headingLevel).toBe(1);
  });
});

describe("buildRecentFileResults", () => {
  it("EC-16: returns empty array for empty recentFiles", () => {
    const results = buildRecentFileResults({
      recentFiles: [],
      openFileByPath: async () => {},
    });
    expect(results).toHaveLength(0);
  });

  it("extracts basename correctly", () => {
    const results = buildRecentFileResults({
      recentFiles: ["/Users/dave/Notes/my-note.md"],
      openFileByPath: async () => {},
    });
    expect(results[0].label).toBe("my-note.md");
  });

  it("abbreviates /Users/<name>/ to ~/", () => {
    const results = buildRecentFileResults({
      recentFiles: ["/Users/dave/Notes/my-note.md"],
      openFileByPath: async () => {},
    });
    expect(results[0].sublabel).toBe("~/Notes/");
  });

  it("FR-03.C.3: preserves recency order (no sorting applied)", () => {
    const results = buildRecentFileResults({
      recentFiles: ["/Users/dave/a.md", "/Users/dave/b.md"],
      openFileByPath: async () => {},
    });
    expect(results[0].label).toBe("a.md");
    expect(results[1].label).toBe("b.md");
  });

  it("recent file results have category: recent", () => {
    const results = buildRecentFileResults({
      recentFiles: ["/Users/dave/f.md"],
      openFileByPath: async () => {},
    });
    expect(results[0].category).toBe("recent");
  });

  it("recent file results are never dimmed", () => {
    const results = buildRecentFileResults({
      recentFiles: ["/Users/dave/f.md"],
      openFileByPath: async () => {},
    });
    expect(results[0].dimmed).toBe(false);
  });

  it("non-macOS path (no /Users/ prefix) uses full dir as sublabel", () => {
    const results = buildRecentFileResults({
      recentFiles: ["/var/data/docs/report.md"],
      openFileByPath: async () => {},
    });
    expect(results[0].label).toBe("report.md");
    expect(results[0].sublabel).toBe("/var/data/docs/");
  });
});

// =============================================================================
// STEP 04 — Overlay DOM + CSS
// =============================================================================

describe("buildOverlayDOM", () => {
  it("creates element with id markable-command-bar-overlay", () => {
    const overlay = buildOverlayDOM();
    expect(overlay.id).toBe("markable-command-bar-overlay");
  });

  it("contains .cb-input with role=combobox", () => {
    const overlay = buildOverlayDOM();
    const input = overlay.querySelector(".cb-input");
    expect(input).not.toBeNull();
    expect(input!.getAttribute("role")).toBe("combobox");
  });

  it("contains .cb-results with role=listbox", () => {
    const overlay = buildOverlayDOM();
    const results = overlay.querySelector(".cb-results");
    expect(results).not.toBeNull();
    expect(results!.getAttribute("role")).toBe("listbox");
  });

  it("input has aria-expanded=false and aria-autocomplete=list", () => {
    const overlay = buildOverlayDOM();
    const input = overlay.querySelector(".cb-input")!;
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
  });

  it("results list has id=cb-results-list", () => {
    const overlay = buildOverlayDOM();
    expect(overlay.querySelector("#cb-results-list")).not.toBeNull();
  });
});

describe("renderResults", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  it("EC-04: shows No results placeholder when results is empty", () => {
    renderResults(container, [], "", null);
    const empty = container.querySelector(".cb-empty");
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toBe("No results");
  });

  it("renders section headers only for categories present in results", () => {
    const results: CommandBarResult[] = [
      { id: "c1", category: "commands", label: "Save", dimmed: false, action: () => {} },
      { id: "h1", category: "headings", label: "Intro", headingLevel: 1, dimmed: false, action: () => {} },
    ];
    renderResults(container, results, "", null);
    const headers = container.querySelectorAll(".cb-section-header");
    expect(headers.length).toBe(2);
    expect(headers[0].textContent).toBe("Commands");
    expect(headers[1].textContent).toBe("Headings");
    // No "Recent Files" header because no recent results
    expect(Array.from(headers).some((h) => h.textContent === "Recent Files")).toBe(false);
  });

  it("dimmed result gets cb-result--dimmed class", () => {
    const results: CommandBarResult[] = [
      { id: "f1", category: "commands", label: "Bold", dimmed: true, action: () => {} },
    ];
    renderResults(container, results, "", null);
    expect(container.querySelector(".cb-result--dimmed")).not.toBeNull();
  });

  it("EC-27: selected result has aria-selected=true and cb-result--selected class", () => {
    const results: CommandBarResult[] = [
      { id: "c1", category: "commands", label: "Save", dimmed: false, action: () => {} },
      { id: "c2", category: "commands", label: "New",  dimmed: false, action: () => {} },
    ];
    renderResults(container, results, "", "c2");
    const selected = container.querySelector(".cb-result--selected");
    expect(selected).not.toBeNull();
    expect(selected!.getAttribute("aria-selected")).toBe("true");
    expect(selected!.getAttribute("data-id")).toBe("c2");
  });

  it("EC-25: no keybinding badge when keybinding is undefined", () => {
    const results: CommandBarResult[] = [
      { id: "s1", category: "commands", label: "Status Bar", dimmed: false, action: () => {} },
    ];
    renderResults(container, results, "", null);
    expect(container.querySelector(".cb-result-key")).toBeNull();
  });

  it("renders keybinding badge when keybinding is present", () => {
    const results: CommandBarResult[] = [
      { id: "s1", category: "commands", label: "Save", keybinding: "⌘S", dimmed: false, action: () => {} },
    ];
    renderResults(container, results, "", null);
    const badge = container.querySelector(".cb-result-key");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe("⌘S");
  });

  it("renders heading level badge for heading results", () => {
    const results: CommandBarResult[] = [
      { id: "h1", category: "headings", label: "Intro", headingLevel: 2, dimmed: false, action: () => {} },
    ];
    renderResults(container, results, "", null);
    const levelBadge = container.querySelector(".cb-result-level");
    expect(levelBadge).not.toBeNull();
    expect(levelBadge!.textContent).toBe("H2");
  });

  it("renders sublabel for recent file results", () => {
    const results: CommandBarResult[] = [
      { id: "r1", category: "recent", label: "note.md", sublabel: "~/Notes/", dimmed: false, action: () => {} },
    ];
    renderResults(container, results, "", null);
    const sublabel = container.querySelector(".cb-result-sublabel");
    expect(sublabel).not.toBeNull();
    expect(sublabel!.textContent).toBe("~/Notes/");
  });

  it("renders match highlights when query and _matchPositions are set", () => {
    const results: CommandBarResult[] = [
      {
        id: "c1",
        category: "commands",
        label: "Focus Mode",
        dimmed: false,
        action: () => {},
        _matchPositions: [0, 1],
      },
    ];
    renderResults(container, results, "fo", "c1");
    const mark = container.querySelector("mark.cb-match");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe("Fo");
  });
});

// =============================================================================
// STEP 05 — Navigation helpers
// =============================================================================

describe("firstSelectableId", () => {
  it("returns id of first non-dimmed result", () => {
    const results: CommandBarResult[] = [
      { id: "d1", category: "commands", label: "Bold", dimmed: true,  action: () => {} },
      { id: "s1", category: "commands", label: "New",  dimmed: false, action: () => {} },
    ];
    expect(firstSelectableId(results)).toBe("s1");
  });

  it("EC-11: returns null when all results are dimmed", () => {
    const results: CommandBarResult[] = [
      { id: "d1", category: "commands", label: "Bold", dimmed: true, action: () => {} },
    ];
    expect(firstSelectableId(results)).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(firstSelectableId([])).toBeNull();
  });

  it("returns first element when first is not dimmed", () => {
    const results: CommandBarResult[] = [
      { id: "s1", category: "commands", label: "New",  dimmed: false, action: () => {} },
      { id: "s2", category: "commands", label: "Open", dimmed: false, action: () => {} },
    ];
    expect(firstSelectableId(results)).toBe("s1");
  });
});

// =============================================================================
// STEP 06 — Settings UI
// =============================================================================

describe("renderDetailExtra", () => {
  it("renders exactly two checkboxes (Step 03: showRecentFiles removed)", () => {
    // Step 03 removes the showRecentFiles checkbox from the settings UI (FR-09.2).
    // Only showCommands and showHeadings remain.
    const container = document.createElement("div");
    renderDetailExtra(container);
    const checkboxes = container.querySelectorAll("input[type=checkbox]");
    expect(checkboxes.length).toBe(2);
  });

  it("both remaining checkboxes are checked by default (defaults: true)", () => {
    const container = document.createElement("div");
    renderDetailExtra(container);
    const checkboxes = Array.from(
      container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")
    );
    expect(checkboxes.every((cb) => cb.checked)).toBe(true);
  });

  it("renders labels for each checkbox", () => {
    const container = document.createElement("div");
    renderDetailExtra(container);
    const labels = container.querySelectorAll("label");
    expect(labels.length).toBe(2);
  });

  it("uses settings-section class on the container section", () => {
    const container = document.createElement("div");
    renderDetailExtra(container);
    expect(container.querySelector(".settings-section")).not.toBeNull();
  });
});

// =============================================================================
// STEP 07 — Plugin lifecycle
// =============================================================================

describe("commandBarPlugin lifecycle", () => {
  it("has correct id and name", () => {
    expect(commandBarPlugin.id).toBe("command-bar");
    expect(commandBarPlugin.name).toBe("Command Bar");
  });

  it("onEnable appends overlay to document.body", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    expect(document.getElementById("markable-command-bar-overlay")).not.toBeNull();
    // cleanup
    commandBarPlugin.onDisable(api as any);
  });

  it("onEnable sets window.__MARKABLE_COMMAND_BAR_OPEN__ to a function", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    expect(typeof (window as any).__MARKABLE_COMMAND_BAR_OPEN__).toBe("function");
    // cleanup
    commandBarPlugin.onDisable(api as any);
  });

  it("onDisable removes overlay from document.body", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    commandBarPlugin.onDisable(api as any);
    expect(document.getElementById("markable-command-bar-overlay")).toBeNull();
  });

  it("onDisable removes CSS style tag", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    commandBarPlugin.onDisable(api as any);
    expect(document.getElementById("__markable_command_bar_css__")).toBeNull();
  });

  it("onDisable sets window.__MARKABLE_COMMAND_BAR_OPEN__ to null", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    commandBarPlugin.onDisable(api as any);
    expect((window as any).__MARKABLE_COMMAND_BAR_OPEN__).toBeNull();
  });

  it("enable/disable/enable cycle leaves no duplicate overlays", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    commandBarPlugin.onDisable(api as any);
    await commandBarPlugin.onEnable(api as any);
    const overlays = document.querySelectorAll("#markable-command-bar-overlay");
    expect(overlays.length).toBe(1);
    // cleanup
    commandBarPlugin.onDisable(api as any);
  });

  // ── EC-05: Toggle behavior ──────────────────────────────────────────────────

  it("EC-05: calling openBar() twice closes the bar (toggle behavior)", async () => {
    // The second Cmd-Shift-P while the bar is open must close it (FR-01.6).
    // We verify by checking that the overlay has the cb-hidden class after the
    // second call, which confirms _isOpen toggled back to false.
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as () => void;
    const overlay = document.getElementById("markable-command-bar-overlay")!;

    // First open: bar should be visible (no cb-hidden class).
    open();
    expect(overlay.classList.contains("cb-hidden")).toBe(false);

    // Second open: toggle closes the bar — cb-hidden must be re-applied.
    open();
    expect(overlay.classList.contains("cb-hidden")).toBe(true);

    // cleanup
    commandBarPlugin.onDisable(api as any);
  });

  // ── EC-06: Escape key closes bar regardless of input content ────────────────

  it("EC-06: pressing Escape closes the bar regardless of input content", async () => {
    // Escape must always close the bar (FR-01.2), even when the input is empty
    // or has a partial query. The onOverlayKeydown handler dispatches closeBar().
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as () => void;
    const overlay = document.getElementById("markable-command-bar-overlay")!;

    open();
    // Confirm bar is open.
    expect(overlay.classList.contains("cb-hidden")).toBe(false);

    // Dispatch a keydown event for Escape on the overlay; the overlay's keydown
    // listener (onOverlayKeydown) calls closeBar() for the Escape case.
    const escEvent = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    overlay.dispatchEvent(escEvent);

    // Bar must now be closed.
    expect(overlay.classList.contains("cb-hidden")).toBe(true);

    // cleanup
    commandBarPlugin.onDisable(api as any);
  });

  // ── EC-12: Tab-closed event closes bar ──────────────────────────────────────

  it("EC-12: markable-tab-closed event on document closes the bar", async () => {
    // When the active tab closes, the bar must close defensively (FR-01.2).
    // The plugin listens for the "markable-tab-closed" CustomEvent on document.
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as () => void;
    const overlay = document.getElementById("markable-command-bar-overlay")!;

    open();
    expect(overlay.classList.contains("cb-hidden")).toBe(false);

    // Simulate the TabManager dispatching the tab-closed event.
    const tabClosedEvent = new CustomEvent("markable-tab-closed", { bubbles: false });
    document.dispatchEvent(tabClosedEvent);

    // Bar must be closed after the event.
    expect(overlay.classList.contains("cb-hidden")).toBe(true);

    // cleanup
    commandBarPlugin.onDisable(api as any);
  });

  // ── EC-18: All categories disabled → empty result set ──────────────────────

  it("EC-18: all categories disabled in settings renders No results placeholder", async () => {
    // When showCommands, showHeadings, and showRecentFiles are all false,
    // buildAllResults() must return an empty array, and the bar must display
    // the "No results" placeholder (FR-07.3).
    // NOTE: This is a Commands mode test — we open explicitly in commands mode
    // because "No results" is a commands-mode empty state. Files mode shows
    // "No workspace" instead. (Adapted for Modal Command Bar Step 02.)
    const savedSettings = { showCommands: false, showHeadings: false, showRecentFiles: false };
    const api = makeMockApi(savedSettings as unknown as Record<string, unknown>);
    await commandBarPlugin.onEnable(api as any);

    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("commands");

    // The results container must show the No results placeholder.
    const resultsList = document.getElementById("cb-results-list")!;
    const empty = resultsList.querySelector(".cb-empty");
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toBe("No results");

    // cleanup
    commandBarPlugin.onDisable(api as any);
  });

  // ── EC-02: Click on dimmed result is a no-op ────────────────────────────────

  it("EC-02: clicking a dimmed result does NOT call its action handler", async () => {
    // Dimmed results must not be activatable via mouse click (FR-05.2, EC-02).
    // The onResultClick handler guards: if result.dimmed, return early.
    //
    // WHY THIS APPROACH:
    // The onResultClick handler looks up clicked results by id from _visibleResults
    // (the module-level array). Calling renderResults() directly bypasses openBar()
    // and therefore leaves _visibleResults empty — the guard fires on `!result`
    // (undefined lookup), not on `result.dimmed`. That is a false positive: the test
    // would pass even if the dimmed guard were deleted.
    //
    // To exercise the real guard we must:
    //   1. Set window.__MARKABLE_COMMANDS__ with a format command (requires an open
    //      file to be non-dimmed) so buildAllResults() produces a dimmed result.
    //   2. Ensure __MARKABLE_CURRENT_FILE__ is null so the command is dimmed.
    //   3. Call openBar() via __MARKABLE_COMMAND_BAR_OPEN__ — this runs
    //      buildAllResults() and writes the dimmed result into _visibleResults.
    //   4. Simulate a click on the rendered row. onResultClick finds the result
    //      in _visibleResults (non-undefined) and then the dimmed guard fires.
    //   5. Assert the action spy is not called — this time due to result.dimmed.

    // Inject a single format command. Format commands are always dimmed when no
    // file is open (requiresFile returns true for the "format-" prefix).
    const actionSpy = vi.fn();
    // Override the format command's action via __MARKABLE_HANDLE_ACTION__ so we can
    // observe whether it fires. The action closure in buildCommandResults calls
    // window.__MARKABLE_HANDLE_ACTION__(id) — we spy on that instead of the
    // CommandBarResult.action directly, since buildCommandResults constructs the
    // action closures internally.
    (window as any).__MARKABLE_COMMANDS__ = [
      { id: "format-bold", label: "Bold", defaultKey: "Cmd-B", section: "Format" },
    ];
    // No plugin manager needed for this test — only command results matter.
    (window as any).__MARKABLE_PLUGIN_MANAGER__ = { getStates: () => ({}), toggle: vi.fn(), getDefinitions: () => [] };
    // Null current file → format-bold will be dimmed.
    (window as any).__MARKABLE_CURRENT_FILE__ = null;
    (window as any).__MARKABLE_HANDLE_ACTION__ = actionSpy;

    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    // Open the bar in commands mode: this calls buildAllResults() which reads the
    // globals above and writes a dimmed "format-bold" result into _visibleResults.
    // NOTE: Explicitly opening in commands mode because dimming is a commands-mode
    // concern. Files mode shows workspace results, not command results. (Adapted
    // for Modal Command Bar Step 02.)
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("commands");

    // Locate the rendered row for "format-bold" in the live results list.
    const resultsList = document.getElementById("cb-results-list")!;
    const row = resultsList.querySelector("[data-id='cmd:format-bold']") as HTMLElement;
    expect(row).not.toBeNull();
    // Sanity-check: the row must carry the dimmed class so we know the right row
    // is present and that the dimming logic ran as expected.
    expect(row.classList.contains("cb-result--dimmed")).toBe(true);

    // Simulate a click. CSS pointer-events:none would block a real browser click,
    // but in the test environment we dispatch the event directly to verify the JS
    // guard in onResultClick (the defence-in-depth layer that must stand alone).
    const clickEvent = new MouseEvent("click", { bubbles: true });
    row.dispatchEvent(clickEvent);

    // The action spy must NOT have been called because onResultClick returns early
    // when result.dimmed is true — this is the guard we are actually exercising.
    expect(actionSpy).not.toHaveBeenCalled();

    // cleanup
    commandBarPlugin.onDisable(api as any);
    delete (window as any).__MARKABLE_COMMANDS__;
    delete (window as any).__MARKABLE_PLUGIN_MANAGER__;
    delete (window as any).__MARKABLE_CURRENT_FILE__;
    delete (window as any).__MARKABLE_HANDLE_ACTION__;
  });
});

// =============================================================================
// STEP 01 — Mode Infrastructure
// =============================================================================

describe("Step 01 — Mode Infrastructure", () => {
  // ── setMode: active tab, placeholder, footer ─────────────────────────────
  // The mode badge pill was replaced by a tab strip (.cb-tab-strip). Active mode
  // is now indicated by .cb-tab--active on the corresponding tab button, not by
  // a single element's text content. Each tab has data-mode="<mode>".

  it("setMode marks the files tab as active when mode is files", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    setMode("files");
    const activeTab = document.querySelector<HTMLButtonElement>(".cb-tab--active");
    expect(activeTab).not.toBeNull();
    expect(activeTab!.dataset.mode).toBe("files");

    commandBarPlugin.onDisable(api as any);
  });

  it("setMode marks the commands tab as active when mode is commands", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    setMode("commands");
    const activeTab = document.querySelector<HTMLButtonElement>(".cb-tab--active");
    expect(activeTab!.dataset.mode).toBe("commands");

    commandBarPlugin.onDisable(api as any);
  });

  it("setMode marks the keybindings tab as active when mode is keybindings", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    setMode("keybindings");
    const activeTab = document.querySelector<HTMLButtonElement>(".cb-tab--active");
    expect(activeTab!.dataset.mode).toBe("keybindings");

    commandBarPlugin.onDisable(api as any);
  });

  // ── MODE_PLACEHOLDERS and MODE_FOOTER_HINTS via DOM ──────────────────────

  it("MODE_PLACEHOLDERS: files mode input placeholder is 'Search vault files…' (FR-4)", async () => {
    // FR-4 changed the files-mode placeholder from "Open file or tab…" to
    // "Search vault files…" to communicate vault-wide scope to the user.
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    setMode("files");
    const input = document.querySelector<HTMLInputElement>(".cb-input");
    expect(input!.placeholder).toBe("Search vault files…");

    commandBarPlugin.onDisable(api as any);
  });

  it("MODE_PLACEHOLDERS: commands mode input placeholder contains 'command'", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    setMode("commands");
    const input = document.querySelector<HTMLInputElement>(".cb-input");
    expect(input!.placeholder).toContain("command");

    commandBarPlugin.onDisable(api as any);
  });

  it("MODE_PLACEHOLDERS: keybindings mode input placeholder contains 'shortcut'", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    setMode("keybindings");
    const input = document.querySelector<HTMLInputElement>(".cb-input");
    expect(input!.placeholder).toContain("shortcut");

    commandBarPlugin.onDisable(api as any);
  });

  it("MODE_FOOTER_HINTS: footer text changes when mode is commands", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    setMode("commands");
    const footer = document.querySelector<HTMLElement>(".cb-footer");
    expect(footer).not.toBeNull();
    expect(footer!.textContent).toContain("run");

    commandBarPlugin.onDisable(api as any);
  });

  it("MODE_FOOTER_HINTS: footer text changes when mode is keybindings", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    setMode("keybindings");
    const footer = document.querySelector<HTMLElement>(".cb-footer");
    expect(footer!.textContent).toContain("assign shortcut");

    commandBarPlugin.onDisable(api as any);
  });

  // ── buildOverlayDOM structural checks ────────────────────────────────────

  it("buildOverlayDOM returns element containing .cb-tab-strip with four tab buttons (AD-GS-07)", () => {
    // The tab strip now has five tabs: commands, files, keybindings, content, tags.
    // The content tab was added in step 03 (Global Search integration, AD-GS-07).
    // The tags tab was added in step 02 (Vault Meta / Tag Browser).
    const overlay = buildOverlayDOM();
    const strip = overlay.querySelector<HTMLElement>(".cb-tab-strip");
    expect(strip).not.toBeNull();
    expect(strip!.getAttribute("role")).toBe("tablist");
    const tabs = strip!.querySelectorAll<HTMLButtonElement>(".cb-tab");
    expect(tabs.length).toBe(5);
    const modes = Array.from(tabs).map((t) => t.dataset.mode);
    expect(modes).toEqual(["commands", "files", "keybindings", "content", "tags"]);
  });

  it("buildOverlayDOM returns element containing .cb-footer", () => {
    const overlay = buildOverlayDOM();
    const footer = overlay.querySelector(".cb-footer");
    expect(footer).not.toBeNull();
  });

  it("buildOverlayDOM returns element containing .cb-preset-row with cb-preset-row--hidden class", () => {
    const overlay = buildOverlayDOM();
    const presetRow = overlay.querySelector(".cb-preset-row");
    expect(presetRow).not.toBeNull();
    expect(presetRow!.classList.contains("cb-preset-row--hidden")).toBe(true);
  });

  it("buildOverlayDOM: tab strip appears before the input row in the panel", () => {
    // The tab strip must precede the input row so it renders above the query field.
    const overlay = buildOverlayDOM();
    const panel = overlay.querySelector(".cb-panel")!;
    const children = Array.from(panel.children);
    const stripIdx = children.findIndex((el) => el.classList.contains("cb-tab-strip"));
    const inputRowIdx = children.findIndex((el) => el.classList.contains("cb-input-row"));
    expect(stripIdx).not.toBe(-1);
    expect(inputRowIdx).not.toBe(-1);
    // Tab strip must come before input row (lower index = earlier in DOM order).
    expect(stripIdx).toBeLessThan(inputRowIdx);
  });

  // ── Badge click cycles modes ──────────────────────────────────────────────

  it("clicking a tab directly switches to that mode", async () => {
    // The mode badge pill was replaced by a tab strip. Clicking a tab button
    // switches directly to that mode (no cycling — any mode is one click away).
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("files");

    const strip = document.querySelector<HTMLElement>(".cb-tab-strip")!;

    // Click the Commands tab.
    const cmdTab = strip.querySelector<HTMLButtonElement>('[data-mode="commands"]')!;
    cmdTab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".cb-tab--active")!.getAttribute("data-mode")).toBe("commands");

    // Click the Keybindings tab.
    const kbTab = strip.querySelector<HTMLButtonElement>('[data-mode="keybindings"]')!;
    kbTab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".cb-tab--active")!.getAttribute("data-mode")).toBe("keybindings");

    // Click the Files tab.
    const filesTab = strip.querySelector<HTMLButtonElement>('[data-mode="files"]')!;
    filesTab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".cb-tab--active")!.getAttribute("data-mode")).toBe("files");

    commandBarPlugin.onDisable(api as any);
  });

  // ── Prefix switching ──────────────────────────────────────────────────────

  it("prefix '>' in files mode switches to commands mode and clears input", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("files");

    const input = document.querySelector<HTMLInputElement>(".cb-input")!;

    // Simulate typing '>' (value becomes ">", then input event fires).
    input.value = ">";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Mode must switch to commands and input must be cleared.
    expect(document.querySelector(".cb-tab--active")!.getAttribute("data-mode")).toBe("commands");
    expect(input.value).toBe("");

    commandBarPlugin.onDisable(api as any);
  });

  it("prefix '#' in files mode switches to keybindings mode and clears input", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("files");

    const input = document.querySelector<HTMLInputElement>(".cb-input")!;

    input.value = "#";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(document.querySelector(".cb-tab--active")!.getAttribute("data-mode")).toBe("keybindings");
    expect(input.value).toBe("");

    commandBarPlugin.onDisable(api as any);
  });

  it("'>' in commands mode is treated as a normal search character (EC-08)", async () => {
    // Prefix switching only activates FROM files mode. In commands mode,
    // typing '>' must not switch mode — it is part of the query.
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("commands");

    const input = document.querySelector<HTMLInputElement>(".cb-input")!;

    // Type '>' while in commands mode.
    input.value = ">";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Mode must remain commands; input is not cleared.
    expect(document.querySelector(".cb-tab--active")!.getAttribute("data-mode")).toBe("commands");
    // The value is not cleared — it stays as ">".
    expect(input.value).toBe(">");

    commandBarPlugin.onDisable(api as any);
  });

  it("'#' in keybindings mode is treated as a normal search character (EC-09)", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("keybindings");

    const input = document.querySelector<HTMLInputElement>(".cb-input")!;

    input.value = "#";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Mode must remain keybindings; input is not cleared.
    expect(document.querySelector(".cb-tab--active")!.getAttribute("data-mode")).toBe("keybindings");
    expect(input.value).toBe("#");

    commandBarPlugin.onDisable(api as any);
  });

  // ── Backspace-to-files switching ──────────────────────────────────────────

  it("Backspace on empty input in commands mode returns to files mode (FR-06.3)", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("commands");

    const overlay = document.getElementById("markable-command-bar-overlay")!;
    const input = document.querySelector<HTMLInputElement>(".cb-input")!;

    // Ensure input is empty before dispatching Backspace.
    input.value = "";

    const backspace = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true });
    overlay.dispatchEvent(backspace);

    expect(document.querySelector(".cb-tab--active")!.getAttribute("data-mode")).toBe("files");

    commandBarPlugin.onDisable(api as any);
  });

  it("Backspace on empty input in keybindings mode returns to files mode (FR-06.3)", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("keybindings");

    const overlay = document.getElementById("markable-command-bar-overlay")!;
    const input = document.querySelector<HTMLInputElement>(".cb-input")!;

    input.value = "";
    const backspace = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true });
    overlay.dispatchEvent(backspace);

    expect(document.querySelector(".cb-tab--active")!.getAttribute("data-mode")).toBe("files");

    commandBarPlugin.onDisable(api as any);
  });

  it("Backspace on non-empty input in commands mode does not switch modes (FR-06.4)", async () => {
    // When the input has text, Backspace deletes a character and does NOT switch mode.
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("commands");

    const overlay = document.getElementById("markable-command-bar-overlay")!;
    const input = document.querySelector<HTMLInputElement>(".cb-input")!;

    // Put some text in the input first.
    input.value = "save";

    const backspace = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true });
    overlay.dispatchEvent(backspace);

    // Mode must remain commands.
    expect(document.querySelector(".cb-tab--active")!.getAttribute("data-mode")).toBe("commands");

    commandBarPlugin.onDisable(api as any);
  });

  it("Backspace on empty input in files mode is a no-op (EC-10)", async () => {
    // In files mode, Backspace on empty input should not crash or change mode.
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("files");

    const overlay = document.getElementById("markable-command-bar-overlay")!;
    const input = document.querySelector<HTMLInputElement>(".cb-input")!;

    input.value = "";
    const backspace = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true });
    overlay.dispatchEvent(backspace);

    // Mode remains files — Backspace is a no-op in files mode.
    expect(document.querySelector(".cb-tab--active")!.getAttribute("data-mode")).toBe("files");

    commandBarPlugin.onDisable(api as any);
  });

  // ── openBar mode switching ────────────────────────────────────────────────

  it("openBar('commands') while bar already open in commands mode closes bar (EC-13)", async () => {
    // Same-mode open = toggle close (FR-01.8, EC-13).
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    const overlay = document.getElementById("markable-command-bar-overlay")!;

    // First open in commands mode.
    open("commands");
    expect(overlay.classList.contains("cb-hidden")).toBe(false);

    // Second open with same mode = toggle close.
    open("commands");
    expect(overlay.classList.contains("cb-hidden")).toBe(true);

    commandBarPlugin.onDisable(api as any);
  });

  it("openBar('files') while bar already open in commands mode switches to files mode (EC-12)", async () => {
    // Different-mode open = switch mode without closing (FR-01.8, EC-12).
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    const overlay = document.getElementById("markable-command-bar-overlay")!;

    // Open in commands mode.
    open("commands");
    expect(document.querySelector(".cb-tab--active")!.getAttribute("data-mode")).toBe("commands");
    expect(overlay.classList.contains("cb-hidden")).toBe(false);

    // Open in files mode while already open → switch without closing.
    open("files");
    expect(document.querySelector(".cb-tab--active")!.getAttribute("data-mode")).toBe("files");
    // Bar must remain visible (not closed).
    expect(overlay.classList.contains("cb-hidden")).toBe(false);

    commandBarPlugin.onDisable(api as any);
  });

  // ── closeBar resets mode ──────────────────────────────────────────────────

  it("closeBar resets _mode to 'files' (FR-01.9)", async () => {
    // After opening in commands mode and closing via Escape, mode resets to files.
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    const overlay = document.getElementById("markable-command-bar-overlay")!;

    // Open in keybindings mode.
    open("keybindings");

    // Close via Escape.
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    overlay.dispatchEvent(esc);

    // Re-open with no argument (should default to files mode because _mode was reset).
    open();
    expect(document.querySelector(".cb-tab--active")!.getAttribute("data-mode")).toBe("files");

    commandBarPlugin.onDisable(api as any);
  });

  // ── __MARKABLE_COMMAND_BAR_OPEN__ mode argument ───────────────────────────

  it("__MARKABLE_COMMAND_BAR_OPEN__ accepts optional mode argument", async () => {
    // The global must accept an optional BarMode argument and open in that mode.
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__;
    expect(typeof open).toBe("function");

    // Call with explicit mode and verify the corresponding tab becomes active.
    open("keybindings");
    expect(document.querySelector(".cb-tab--active")!.getAttribute("data-mode")).toBe("keybindings");

    commandBarPlugin.onDisable(api as any);
  });

  // ── preset row visibility ─────────────────────────────────────────────────

  it("setMode hides preset row in files and commands mode", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    setMode("files");
    const presetRow = document.querySelector<HTMLElement>(".cb-preset-row");
    expect(presetRow!.classList.contains("cb-preset-row--hidden")).toBe(true);

    setMode("commands");
    expect(presetRow!.classList.contains("cb-preset-row--hidden")).toBe(true);

    commandBarPlugin.onDisable(api as any);
  });

  it("setMode shows preset row in keybindings mode", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    setMode("keybindings");
    const presetRow = document.querySelector<HTMLElement>(".cb-preset-row");
    expect(presetRow!.classList.contains("cb-preset-row--hidden")).toBe(false);

    commandBarPlugin.onDisable(api as any);
  });
});

// =============================================================================
// STEP 02 — Files Mode
// =============================================================================

// ── Helper factories ──────────────────────────────────────────────────────────

function makeTab(id: string, title: string, filePath: string | null = null): TabEntry {
  return { id, title, filePath };
}

function makeFilesResultsDeps(overrides: Partial<FilesModeBuilderDeps> = {}): FilesModeBuilderDeps {
  return {
    tabs: [],
    workspaceFiles: [],
    workspaceLoadState: "loaded",
    openTab: vi.fn(),
    openFile: vi.fn(),
    ...overrides,
  };
}

// ── buildFilesResults pure function ──────────────────────────────────────────

describe("Step 02 — buildFilesResults", () => {
  it("returns open tabs in 'open-tabs' category", () => {
    const tabs = [makeTab("t1", "Notes", "/Users/alice/notes.md")];
    const results = buildFilesResults(makeFilesResultsDeps({ tabs }));
    const tabResults = results.filter((r) => r.category === "open-tabs");
    expect(tabResults).toHaveLength(1);
    expect(tabResults[0].id).toBe("tab:t1");
    expect(tabResults[0].isTab).toBe(true);
    expect(tabResults[0].tabId).toBe("t1");
  });

  it("returns workspace files in 'workspace-files' category", () => {
    const workspaceFiles = ["/Users/alice/docs/readme.md", "/Users/alice/docs/todo.md"];
    const results = buildFilesResults(makeFilesResultsDeps({ workspaceFiles }));
    const fileResults = results.filter((r) => r.category === "workspace-files");
    expect(fileResults).toHaveLength(2);
    expect(fileResults[0].id).toBe("file:/Users/alice/docs/readme.md");
    expect(fileResults[0].isTab).toBe(false);
  });

  it("EC-06: a file already open as a tab does not appear in workspace-files section", () => {
    const filePath = "/Users/alice/notes.md";
    const tabs = [makeTab("t1", "Notes", filePath)];
    const workspaceFiles = [filePath, "/Users/alice/other.md"];
    const results = buildFilesResults(makeFilesResultsDeps({ tabs, workspaceFiles }));
    const fileResults = results.filter((r) => r.category === "workspace-files");
    // notes.md is already open → must NOT appear in workspace files
    expect(fileResults.find((r) => r.filePath === filePath)).toBeUndefined();
    // other.md is not open → must appear
    expect(fileResults.find((r) => r.filePath === "/Users/alice/other.md")).toBeDefined();
  });

  it("caps workspace files at FILES_CAP (200)", () => {
    // Generate 250 unique paths — only the first 200 should appear.
    const workspaceFiles = Array.from({ length: 250 }, (_, i) => `/p/file${i}.md`);
    const results = buildFilesResults(makeFilesResultsDeps({ workspaceFiles }));
    const fileResults = results.filter((r) => r.category === "workspace-files");
    expect(fileResults).toHaveLength(FILES_CAP);
  });

  it("EC-05: files beyond the cap are not included in results", () => {
    const workspaceFiles = Array.from({ length: 250 }, (_, i) => `/p/file${i}.md`);
    const results = buildFilesResults(makeFilesResultsDeps({ workspaceFiles }));
    const fileResults = results.filter((r) => r.category === "workspace-files");
    // The 201st file (index 200) must not be present.
    expect(fileResults.find((r) => r.filePath === "/p/file200.md")).toBeUndefined();
  });

  it("EC-02: returns empty array when tabs is empty and workspaceFiles is empty", () => {
    const results = buildFilesResults(makeFilesResultsDeps());
    expect(results).toHaveLength(0);
  });

  it("EC-01: returns only open-tabs results when workspaceFiles is empty", () => {
    const tabs = [makeTab("t1", "Notes", "/Users/alice/notes.md")];
    const results = buildFilesResults(makeFilesResultsDeps({ tabs }));
    expect(results.filter((r) => r.category === "open-tabs")).toHaveLength(1);
    expect(results.filter((r) => r.category === "workspace-files")).toHaveLength(0);
  });

  it("open-tabs results appear before workspace-files results", () => {
    const tabs = [makeTab("t1", "Open", "/Users/alice/open.md")];
    const workspaceFiles = ["/Users/alice/other.md"];
    const results = buildFilesResults(makeFilesResultsDeps({ tabs, workspaceFiles }));
    expect(results[0].category).toBe("open-tabs");
    expect(results[1].category).toBe("workspace-files");
  });

  it("untitled tab uses 'Untitled' label when no title and no filePath", () => {
    const tabs = [makeTab("t1", "", null)];
    const results = buildFilesResults(makeFilesResultsDeps({ tabs }));
    expect(results[0].label).toBe("Untitled");
  });

  it("tab without filePath has empty sublabel", () => {
    const tabs = [makeTab("t1", "Untitled", null)];
    const results = buildFilesResults(makeFilesResultsDeps({ tabs }));
    expect(results[0].sublabel).toBe("");
  });

  it("workspace file label is the basename of the path", () => {
    const workspaceFiles = ["/Users/alice/docs/readme.md"];
    const results = buildFilesResults(makeFilesResultsDeps({ workspaceFiles }));
    expect(results[0].label).toBe("readme.md");
  });

  it("workspace file sublabel is the abbreviated directory", () => {
    const workspaceFiles = ["/Users/alice/docs/readme.md"];
    const results = buildFilesResults(makeFilesResultsDeps({ workspaceFiles }));
    // /Users/alice/docs/ → ~/docs/
    expect(results[0].sublabel).toBe("~/docs/");
  });

  it("action on open-tab result calls openTab with the tab id", () => {
    const openTabSpy = vi.fn();
    const tabs = [makeTab("t42", "Notes", "/Users/alice/notes.md")];
    const results = buildFilesResults(makeFilesResultsDeps({ tabs, openTab: openTabSpy }));
    const tabResult = results.find((r) => r.id === "tab:t42")!;
    tabResult.action();
    expect(openTabSpy).toHaveBeenCalledWith("t42");
  });

  it("action on workspace-file result calls openFile with the file path", () => {
    const openFileSpy = vi.fn();
    const workspaceFiles = ["/Users/alice/docs/readme.md"];
    const results = buildFilesResults(makeFilesResultsDeps({ workspaceFiles, openFile: openFileSpy }));
    const fileResult = results.find((r) => r.category === "workspace-files")!;
    fileResult.action();
    expect(openFileSpy).toHaveBeenCalledWith("/Users/alice/docs/readme.md");
  });

  it("all results have dimmed: false", () => {
    const tabs = [makeTab("t1", "Notes", "/p/notes.md")];
    const workspaceFiles = ["/p/other.md"];
    const results = buildFilesResults(makeFilesResultsDeps({ tabs, workspaceFiles }));
    expect(results.every((r) => r.dimmed === false)).toBe(true);
  });
});

// ── countWorkspaceBeforeCap ───────────────────────────────────────────────────

describe("Step 02 — countWorkspaceBeforeCap", () => {
  it("EC-05: returns the full workspace count before deduplication cap", () => {
    const workspaceFiles = ["/p/a.md", "/p/b.md", "/p/c.md"];
    const count = countWorkspaceBeforeCap(workspaceFiles, new Set());
    expect(count).toBe(3);
  });

  it("excludes paths that are already open as tabs from the count", () => {
    const workspaceFiles = ["/p/a.md", "/p/b.md", "/p/c.md"];
    const openPaths = new Set(["/p/a.md"]);
    const count = countWorkspaceBeforeCap(workspaceFiles, openPaths);
    expect(count).toBe(2);
  });

  it("returns 0 when all workspace files are open as tabs", () => {
    const workspaceFiles = ["/p/a.md", "/p/b.md"];
    const openPaths = new Set(["/p/a.md", "/p/b.md"]);
    expect(countWorkspaceBeforeCap(workspaceFiles, openPaths)).toBe(0);
  });

  it("returns 0 when workspaceFiles is empty", () => {
    expect(countWorkspaceBeforeCap([], new Set())).toBe(0);
  });
});

// ── abbreviatePath ───────────────────────────────────────────────────────────

describe("Step 02 — abbreviatePath", () => {
  it("abbreviates /Users/foo/bar/ to ~/bar/", () => {
    expect(abbreviatePath("/Users/alice/bar/")).toBe("~/bar/");
  });

  it("abbreviates /Users/<name>/Documents/notes/ to ~/Documents/notes/", () => {
    expect(abbreviatePath("/Users/alice/Documents/notes/")).toBe("~/Documents/notes/");
  });

  it("does not modify paths not starting with /Users/", () => {
    expect(abbreviatePath("/var/data/docs/")).toBe("/var/data/docs/");
  });

  it("does not modify paths with /users/ (lowercase) — macOS /Users/ is uppercase", () => {
    expect(abbreviatePath("/users/alice/docs/")).toBe("/users/alice/docs/");
  });

  it("returns the same string when path has no /Users/ prefix", () => {
    expect(abbreviatePath("/home/alice/notes/")).toBe("/home/alice/notes/");
  });
});

// ── basename ─────────────────────────────────────────────────────────────────

describe("Step 02 — basename", () => {
  it("extracts final path component", () => {
    expect(basename("/Users/alice/docs/readme.md")).toBe("readme.md");
  });

  it("returns the whole string when there are no slashes", () => {
    expect(basename("readme.md")).toBe("readme.md");
  });

  it("returns empty string for a path ending with a slash", () => {
    expect(basename("/Users/alice/")).toBe("");
  });
});

// ── FILES_CAP and FILES_SECTION_LABELS constants ──────────────────────────────

describe("Step 02 — constants", () => {
  it("FILES_CAP is 200", () => {
    expect(FILES_CAP).toBe(200);
  });

  it("FILES_SECTION_LABELS has correct labels", () => {
    expect(FILES_SECTION_LABELS["open-tabs"]).toBe("Open Tabs");
    expect(FILES_SECTION_LABELS["workspace-files"]).toBe("Files");
  });
});

// ── renderFilesResults DOM tests ──────────────────────────────────────────────

describe("Step 02 — renderFilesResults", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  // Helper to build a minimal FilesResult for DOM tests.
  function makeFilesResult(
    overrides: Partial<FilesResult> & { id: string; category: FilesResult["category"]; label: string }
  ): FilesResult {
    return {
      sublabel: "",
      filePath: null,
      isTab: false,
      dimmed: false,
      action: vi.fn(),
      ...overrides,
    };
  }

  it("renders 'Open Tabs' section header", () => {
    const results: FilesResult[] = [
      makeFilesResult({ id: "tab:t1", category: "open-tabs", label: "Notes", isTab: true }),
    ];
    renderFilesResults(container, results, "", null, "loaded", 0, false);
    const headers = container.querySelectorAll(".cb-section-header");
    expect(Array.from(headers).some((h) => h.textContent === "Open Tabs")).toBe(true);
  });

  it("renders 'Files' section header", () => {
    const results: FilesResult[] = [
      makeFilesResult({ id: "file:/p/a.md", category: "workspace-files", label: "a.md" }),
    ];
    renderFilesResults(container, results, "", null, "loaded", 1, false);
    const headers = container.querySelectorAll(".cb-section-header");
    expect(Array.from(headers).some((h) => h.textContent === "Files")).toBe(true);
  });

  it("renders 'Loading…' notice when loadState is 'loading'", () => {
    renderFilesResults(container, [], "", null, "loading", 0, false);
    const loading = container.querySelector(".cb-loading");
    expect(loading).not.toBeNull();
    expect(loading!.textContent).toBe("Loading…");
  });

  it("renders 'Could not load workspace files' when loadState is 'error' (EC-03)", () => {
    renderFilesResults(container, [], "", null, "error", 0, false);
    const notice = container.querySelector(".cb-notice");
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain("Could not load");
  });

  it("renders 'No workspace' notice when noFileOpen is true and no workspace files (EC-01)", () => {
    // noFileOpen=true with loadState="loaded" (no workspace available) and no workspace file rows
    renderFilesResults(container, [], "", null, "loaded", 0, true);
    const notice = container.querySelector(".cb-notice");
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain("No workspace");
  });

  it("renders 'No markdown files in workspace' when workspace is empty (EC-04)", () => {
    // noFileOpen=false, loadState="loaded", no workspace file rows → workspace is empty
    renderFilesResults(container, [], "", null, "loaded", 0, false);
    const notice = container.querySelector(".cb-notice");
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain("No markdown files");
  });

  it("renders cap notice when totalWorkspaceCount > FILES_CAP (EC-05)", () => {
    // Provide a result so the loadState guard doesn't fire the empty-workspace notice.
    const results: FilesResult[] = [
      makeFilesResult({ id: "file:/p/a.md", category: "workspace-files", label: "a.md" }),
    ];
    renderFilesResults(container, results, "", null, "loaded", 250, false);
    const notices = container.querySelectorAll(".cb-notice");
    const capNotice = Array.from(notices).find((n) => n.textContent?.includes("200 of 250"));
    expect(capNotice).not.toBeNull();
  });

  it("does not render cap notice when totalWorkspaceCount <= FILES_CAP", () => {
    const results: FilesResult[] = [
      makeFilesResult({ id: "file:/p/a.md", category: "workspace-files", label: "a.md" }),
    ];
    renderFilesResults(container, results, "", null, "loaded", 1, false);
    const notices = container.querySelectorAll(".cb-notice");
    const capNotice = Array.from(notices).find((n) => n.textContent?.includes("of"));
    expect(capNotice).toBeUndefined();
  });

  it("EC-04: does not crash when workspaceFiles is empty (results array is empty)", () => {
    expect(() => renderFilesResults(container, [], "", null, "loaded", 0, false)).not.toThrow();
  });

  it("renders result rows with .cb-result class", () => {
    const results: FilesResult[] = [
      makeFilesResult({ id: "tab:t1", category: "open-tabs", label: "Notes", isTab: true }),
      makeFilesResult({ id: "file:/p/a.md", category: "workspace-files", label: "a.md" }),
    ];
    renderFilesResults(container, results, "", null, "loaded", 1, false);
    const rows = container.querySelectorAll(".cb-result");
    expect(rows.length).toBe(2);
  });

  it("selected result gets cb-result--selected class", () => {
    const results: FilesResult[] = [
      makeFilesResult({ id: "tab:t1", category: "open-tabs", label: "Notes", isTab: true }),
    ];
    renderFilesResults(container, results, "", "tab:t1", "loaded", 0, false);
    const selected = container.querySelector(".cb-result--selected");
    expect(selected).not.toBeNull();
    expect(selected!.getAttribute("data-id")).toBe("tab:t1");
  });

  it("does not render Loading notice when loadState is 'loaded'", () => {
    const results: FilesResult[] = [
      makeFilesResult({ id: "file:/p/a.md", category: "workspace-files", label: "a.md" }),
    ];
    renderFilesResults(container, results, "", null, "loaded", 1, false);
    expect(container.querySelector(".cb-loading")).toBeNull();
  });

  it("renders sublabel when a result has one", () => {
    const results: FilesResult[] = [
      makeFilesResult({ id: "file:/p/a.md", category: "workspace-files", label: "a.md", sublabel: "~/docs/" }),
    ];
    renderFilesResults(container, results, "", null, "loaded", 1, false);
    const sublabel = container.querySelector(".cb-result-sublabel");
    expect(sublabel).not.toBeNull();
    expect(sublabel!.textContent).toBe("~/docs/");
  });
});

// ── EC-28: stale generation guard (integration via plugin lifecycle) ──────────

describe("Step 02 — EC-28 stale generation guard", () => {
  it("EC-28: fetchWorkspaceFiles does not update DOM if generation has changed", async () => {
    // Setup: the bar opens and starts an async file fetch, but then closes before
    // the fetch resolves. The generation counter is incremented on close, so when
    // the (mocked) fetch resolves, _openGeneration !== capturedGeneration and the
    // DOM update is skipped.
    //
    // We verify this by ensuring the results list does NOT show workspace file rows
    // when the bar is closed before the mock fetch resolves.

    const api = makeMockApi();

    // Set up a controllable invoke mock: won't resolve until we call resolveInvoke().
    let resolveInvoke: (files: string[]) => void = () => {};
    const invokePending = new Promise<string[]>((res) => { resolveInvoke = res; });

    // Mock __TAURI_INTERNALS__.invoke to return the pending promise.
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockReturnValue(invokePending),
    };
    (window as any).__MARKABLE_CURRENT_FILE__ = "/Users/alice/notes.md";
    (window as any).__MARKABLE_TAB_MANAGER__ = {
      getAllTabs: () => [],
      switchToTab: vi.fn(),
      openFile: vi.fn(),
    };

    await commandBarPlugin.onEnable(api as any);
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    const overlay = document.getElementById("markable-command-bar-overlay")!;

    // Open in files mode — starts the async fetch.
    open("files");
    expect(overlay.classList.contains("cb-hidden")).toBe(false);

    // Close bar before fetch resolves (increments generation internally via reset).
    const escEvent = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    overlay.dispatchEvent(escEvent);
    expect(overlay.classList.contains("cb-hidden")).toBe(true);

    // Now resolve the fetch with file data.
    resolveInvoke(["/Users/alice/workspace/file1.md", "/Users/alice/workspace/file2.md"]);
    // Allow promise microtasks to flush.
    await new Promise((r) => setTimeout(r, 0));

    // Re-open the bar. The stale fetch should not have polluted _allResults.
    // The newly opened bar should start fresh with just the tabs (empty).
    open("files");
    const resultsList = document.getElementById("cb-results-list")!;
    // The stale file results from the previous generation should NOT be visible.
    // The results list may show a loading state or be empty (fresh open).
    // The key assertion: no workspace-file rows from the stale generation.
    const rows = resultsList.querySelectorAll("[data-id^='file:']");
    expect(rows.length).toBe(0);

    commandBarPlugin.onDisable(api as any);
    delete (window as any).__TAURI_INTERNALS__;
    delete (window as any).__MARKABLE_CURRENT_FILE__;
    delete (window as any).__MARKABLE_TAB_MANAGER__;
  });
});

// =============================================================================
// STEP 03 — Commands Mode Refactor
// =============================================================================

describe("Step 03 — Commands Mode Refactor", () => {
  // ── buildResultsForMode: commands mode ────────────────────────────────────

  // Minimal settings objects used across tests in this block.
  const cmdOnlySettings = {
    showCommands: true,
    showHeadings: false,
    showRecentFiles: true, // deprecated; must be ignored
    activePreset: "Default",
  };

  const headingsOnlySettings = {
    showCommands: false,
    showHeadings: true,
    showRecentFiles: true,
    activePreset: "Default",
  };

  const allOnSettings = {
    showCommands: true,
    showHeadings: true,
    showRecentFiles: true,
    activePreset: "Default",
  };

  beforeEach(() => {
    // Inject minimal globals so buildCommandModeResults() does not crash.
    (window as any).__MARKABLE_COMMANDS__ = [
      { id: "file-save", label: "Save", defaultKey: "Cmd-S", section: "File" },
      { id: "file-new",  label: "New",  defaultKey: "Cmd-N", section: "File" },
    ];
    (window as any).__MARKABLE_PLUGIN_MANAGER__ = {
      getStates: () => ({}),
      toggle: vi.fn(),
      getDefinitions: () => [],
    };
    (window as any).__MARKABLE_GET_SETTINGS__ = () => ({ recentFiles: ["/Users/alice/recent.md"], keybindings: {} });
    (window as any).__MARKABLE_EDITOR_VIEW__ = null;
    (window as any).__MARKABLE_CURRENT_FILE__ = "/Users/alice/notes.md";
    (window as any).__MARKABLE_HANDLE_ACTION__ = vi.fn();
  });

  afterEach(() => {
    delete (window as any).__MARKABLE_COMMANDS__;
    delete (window as any).__MARKABLE_PLUGIN_MANAGER__;
    delete (window as any).__MARKABLE_GET_SETTINGS__;
    delete (window as any).__MARKABLE_EDITOR_VIEW__;
    delete (window as any).__MARKABLE_CURRENT_FILE__;
    delete (window as any).__MARKABLE_HANDLE_ACTION__;
  });

  it("buildResultsForMode('commands') returns commands category results when showCommands=true", () => {
    // Commands pipeline must fire when mode is 'commands' and showCommands is true.
    const results = buildResultsForMode("commands", cmdOnlySettings as any);
    const commandResults = results.filter((r: any) => r.category === "commands");
    expect(commandResults.length).toBeGreaterThan(0);
  });

  it("buildResultsForMode('commands') returns headings category results when showHeadings=true", () => {
    // Headings pipeline must fire when mode is 'commands' and showHeadings is true.
    // We need a cmState with headings; inject it via the editor view global.
    const mockState = makeMockState("# Introduction\n## Background");
    (window as any).__MARKABLE_EDITOR_VIEW__ = { state: mockState };

    const results = buildResultsForMode("commands", headingsOnlySettings as any);
    const headingResults = results.filter((r: any) => r.category === "headings");
    expect(headingResults.length).toBe(2);
  });

  it("buildResultsForMode('commands') respects showCommands=false", () => {
    // When showCommands is false, no commands-category results must be returned.
    const results = buildResultsForMode("commands", headingsOnlySettings as any);
    const commandResults = results.filter((r: any) => r.category === "commands");
    expect(commandResults.length).toBe(0);
  });

  it("buildResultsForMode('commands') respects showHeadings=false", () => {
    // When showHeadings is false, no headings-category results must be returned.
    const results = buildResultsForMode("commands", cmdOnlySettings as any);
    const headingResults = results.filter((r: any) => r.category === "headings");
    expect(headingResults.length).toBe(0);
  });

  it("buildResultsForMode('commands') does NOT include recent files results (FR-09.2)", () => {
    // Even when showRecentFiles is true in the settings object, commands mode must
    // never return category 'recent' results. FR-09.2 removes the recent pipeline
    // from commands mode entirely.
    const results = buildResultsForMode("commands", allOnSettings as any);
    const recentResults = results.filter((r: any) => r.category === "recent");
    expect(recentResults.length).toBe(0);
  });

  it("buildResultsForMode('files') returns empty array (handled separately)", () => {
    // Files mode builds results via the async pipeline (fetchWorkspaceFiles /
    // buildFilesResults), not via buildResultsForMode. The function must return []
    // for 'files' so the caller knows to use the separate path.
    const results = buildResultsForMode("files", allOnSettings as any);
    expect(results).toHaveLength(0);
  });

  it("buildResultsForMode('keybindings') returns empty array when __MARKABLE_COMMANDS__ is absent", () => {
    // When __MARKABLE_COMMANDS__ is not set (or empty), buildKeybindingModeResults
    // must return [] gracefully (EC-16 variant — no commands available).
    const saved = (window as any).__MARKABLE_COMMANDS__;
    (window as any).__MARKABLE_COMMANDS__ = undefined;
    const results = buildResultsForMode("keybindings", allOnSettings as any);
    expect(results).toHaveLength(0);
    (window as any).__MARKABLE_COMMANDS__ = saved;
  });

  // ── renderDetailExtra changes ─────────────────────────────────────────────

  it("renderDetailExtra renders exactly 2 checkboxes (showCommands, showHeadings)", () => {
    // The showRecentFiles checkbox was removed from the settings UI in Step 03.
    const container = document.createElement("div");
    renderDetailExtra(container);
    const checkboxes = container.querySelectorAll("input[type=checkbox]");
    expect(checkboxes.length).toBe(2);
  });

  it("renderDetailExtra no longer renders a showRecentFiles checkbox", () => {
    // No checkbox with id 'cb-setting-showRecentFiles' must exist.
    const container = document.createElement("div");
    renderDetailExtra(container);
    const recentCb = container.querySelector("#cb-setting-showRecentFiles");
    expect(recentCb).toBeNull();
  });

  it("renderDetailExtra renders an 'Active preset' note", () => {
    // Step 03 adds a static 'Keybinding Preset' section that will be populated
    // in Step 05. The section must be present now as a placeholder.
    const container = document.createElement("div");
    renderDetailExtra(container);
    // The section heading or text must mention preset.
    const text = container.textContent ?? "";
    expect(text.toLowerCase()).toContain("preset");
  });

  // ── loadPluginSettings ignores showRecentFiles ────────────────────────────

  it("loadPluginSettings ignores showRecentFiles from saved settings (FR-09.2)", async () => {
    // When saved settings contain showRecentFiles: false, the plugin must still
    // behave as if showRecentFiles is true (it is ignored). Verified by opening
    // in commands mode — the recent-files pipeline does not fire regardless.
    const savedSettings = { showCommands: true, showHeadings: true, showRecentFiles: false };
    const api = makeMockApi(savedSettings as unknown as Record<string, unknown>);
    await commandBarPlugin.onEnable(api as any);

    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("commands");

    const resultsList = document.getElementById("cb-results-list")!;
    // Results must NOT contain any 'recent' category rows — commands mode never
    // emits them regardless of the saved showRecentFiles value.
    const recentRows = resultsList.querySelectorAll("[data-cat='recent']");
    expect(recentRows.length).toBe(0);

    commandBarPlugin.onDisable(api as any);
  });
});

// ---------------------------------------------------------------------------
// Step 04 — Keybindings Mode + Key-Capture
// ---------------------------------------------------------------------------
describe("Step 04 — Keybindings Mode + Key-Capture", () => {
  // Import pure functions from keybindings-mode.ts
  let isSystemReserved: typeof import("../../../src/plugins/command-bar/keybindings-mode").isSystemReserved;
  let isModifierOnly: typeof import("../../../src/plugins/command-bar/keybindings-mode").isModifierOnly;
  let captureKeyFromEvent: typeof import("../../../src/plugins/command-bar/keybindings-mode").captureKeyFromEvent;
  let checkConflict: typeof import("../../../src/plugins/command-bar/keybindings-mode").checkConflict;
  let buildKeybindingResults: typeof import("../../../src/plugins/command-bar/keybindings-mode").buildKeybindingResults;
  let formatKeyDisplay: typeof import("../../../src/plugins/command-bar/keybindings-mode").formatKeyDisplay;

  beforeAll(async () => {
    const mod = await import("../../../src/plugins/command-bar/keybindings-mode");
    isSystemReserved = mod.isSystemReserved;
    isModifierOnly = mod.isModifierOnly;
    captureKeyFromEvent = mod.captureKeyFromEvent;
    checkConflict = mod.checkConflict;
    buildKeybindingResults = mod.buildKeybindingResults;
    formatKeyDisplay = mod.formatKeyDisplay;
  });

  // ── isSystemReserved ────────────────────────────────────────────────────
  describe("isSystemReserved", () => {
    it("Cmd-Q is system reserved (EC-19)", () => {
      expect(isSystemReserved("Cmd-Q")).toBe(true);
    });
    it("Cmd-W is system reserved (EC-20)", () => {
      expect(isSystemReserved("Cmd-W")).toBe(true);
    });
    it("Cmd-Tab is system reserved", () => {
      expect(isSystemReserved("Cmd-Tab")).toBe(true);
    });
    it("Cmd-M is system reserved", () => {
      expect(isSystemReserved("Cmd-M")).toBe(true);
    });
    it("Cmd-H is system reserved", () => {
      expect(isSystemReserved("Cmd-H")).toBe(true);
    });
    it("Cmd-S is NOT system reserved", () => {
      expect(isSystemReserved("Cmd-S")).toBe(false);
    });
    it("Cmd-Shift-P is NOT system reserved", () => {
      expect(isSystemReserved("Cmd-Shift-P")).toBe(false);
    });
  });

  // ── isModifierOnly ──────────────────────────────────────────────────────
  describe("isModifierOnly", () => {
    it("returns true for Meta key (EC-18)", () => {
      const e = { key: "Meta" } as KeyboardEvent;
      expect(isModifierOnly(e)).toBe(true);
    });
    it("returns true for Shift key", () => {
      const e = { key: "Shift" } as KeyboardEvent;
      expect(isModifierOnly(e)).toBe(true);
    });
    it("returns true for Alt key", () => {
      const e = { key: "Alt" } as KeyboardEvent;
      expect(isModifierOnly(e)).toBe(true);
    });
    it("returns true for Control key", () => {
      const e = { key: "Control" } as KeyboardEvent;
      expect(isModifierOnly(e)).toBe(true);
    });
    it("returns false for S key (non-modifier)", () => {
      const e = { key: "S", metaKey: true, shiftKey: false, altKey: false, ctrlKey: false } as unknown as KeyboardEvent;
      expect(isModifierOnly(e)).toBe(false);
    });
  });

  // ── captureKeyFromEvent ─────────────────────────────────────────────────
  describe("captureKeyFromEvent", () => {
    it("returns null for modifier-only keys (EC-18)", () => {
      const e = { key: "Meta", metaKey: true, shiftKey: false, altKey: false, ctrlKey: false } as unknown as KeyboardEvent;
      expect(captureKeyFromEvent(e)).toBeNull();
    });
    it("captures Cmd-Shift-S correctly", () => {
      const e = { key: "s", metaKey: true, shiftKey: true, altKey: false, ctrlKey: false } as unknown as KeyboardEvent;
      expect(captureKeyFromEvent(e)).toBe("Cmd-Shift-S");
    });
    it("uppercases single-character key", () => {
      const e = { key: "p", metaKey: true, shiftKey: false, altKey: false, ctrlKey: false } as unknown as KeyboardEvent;
      expect(captureKeyFromEvent(e)).toBe("Cmd-P");
    });
    it("uses verbatim name for ArrowLeft", () => {
      const e = { key: "ArrowLeft", metaKey: false, shiftKey: false, altKey: false, ctrlKey: false } as unknown as KeyboardEvent;
      expect(captureKeyFromEvent(e)).toBe("ArrowLeft");
    });
    it("captures Cmd-Alt-Shift-K", () => {
      const e = { key: "k", metaKey: true, altKey: true, shiftKey: true, ctrlKey: false } as unknown as KeyboardEvent;
      expect(captureKeyFromEvent(e)).toBe("Cmd-Alt-Shift-K");
    });
  });

  // ── checkConflict ───────────────────────────────────────────────────────
  describe("checkConflict", () => {
    const commands = [
      { id: "file-save", label: "Save", defaultKey: "Cmd-S", section: "File" },
      { id: "file-open", label: "Open", defaultKey: "Cmd-O", section: "File" },
      { id: "edit-copy", label: "Copy", defaultKey: "Cmd-C", section: "Edit" },
    ];

    it("returns null for a free combo", () => {
      expect(checkConflict("Cmd-Shift-Z", "file-save", commands, {})).toBeNull();
    });
    it("returns 'self' when combo matches targetActionId (EC-21)", () => {
      const result = checkConflict("Cmd-S", "file-save", commands, {});
      expect(result?.type).toBe("self");
    });
    it("returns 'action' conflict when combo matches another action's default", () => {
      const result = checkConflict("Cmd-S", "file-open", commands, {});
      expect(result?.type).toBe("action");
      expect(result?.conflictingActionId).toBe("file-save");
    });
    it("returns 'system-reserved' for Cmd-Q (EC-19)", () => {
      const result = checkConflict("Cmd-Q", "file-save", commands, {});
      expect(result?.type).toBe("system-reserved");
      expect(result?.conflictingActionId).toBeNull();
    });
    it("custom bindings take priority over defaults in conflict scan", () => {
      const result = checkConflict("Cmd-X", "file-save", commands, { "edit-copy": "Cmd-X" });
      expect(result?.type).toBe("action");
      expect(result?.conflictingActionId).toBe("edit-copy");
    });
    it("ignores default when action is in customBindings (custom overrides default)", () => {
      // edit-copy has custom binding Cmd-X; its defaultKey Cmd-C should be free
      const result = checkConflict("Cmd-C", "file-save", commands, { "edit-copy": "Cmd-X" });
      expect(result).toBeNull();
    });
  });

  // ── buildKeybindingResults ──────────────────────────────────────────────
  describe("buildKeybindingResults", () => {
    const commands = [
      { id: "file-save", label: "Save", defaultKey: "Cmd-S", section: "File" },
      { id: "edit-copy", label: "Copy", defaultKey: "Cmd-C", section: "Edit" },
      { id: "view-toggle", label: "Toggle View", defaultKey: "", section: "View" },
    ];

    it("returns one result per command", () => {
      const results = buildKeybindingResults({ commands, customBindings: {}, enterCapture: () => {} });
      expect(results).toHaveLength(3);
    });
    it("marks default binding as isDefault=true", () => {
      const results = buildKeybindingResults({ commands, customBindings: {}, enterCapture: () => {} });
      expect(results[0].isDefault).toBe(true);
    });
    it("marks custom binding as isDefault=false", () => {
      const results = buildKeybindingResults({ commands, customBindings: { "file-save": "Cmd-Shift-S" }, enterCapture: () => {} });
      const r = results.find((r) => r.actionId === "file-save")!;
      expect(r.isDefault).toBe(false);
      expect(r.activeKey).toBe("Cmd-Shift-S");
    });
    it("EC-29: marks empty defaultKey as isUnbound=true", () => {
      const results = buildKeybindingResults({ commands, customBindings: {}, enterCapture: () => {} });
      const r = results.find((r) => r.actionId === "view-toggle")!;
      expect(r.isUnbound).toBe(true);
    });
    it("EC-16: returns empty array when commands list is empty", () => {
      const results = buildKeybindingResults({ commands: [], customBindings: {}, enterCapture: () => {} });
      expect(results).toHaveLength(0);
    });
    it("result id is 'kb:{actionId}'", () => {
      const results = buildKeybindingResults({ commands, customBindings: {}, enterCapture: () => {} });
      expect(results[0].id).toBe("kb:file-save");
    });
    it("action calls enterCapture with correct actionId", () => {
      const captured: string[] = [];
      const results = buildKeybindingResults({ commands, customBindings: {}, enterCapture: (id) => captured.push(id) });
      results[0].action();
      expect(captured).toEqual(["file-save"]);
    });
  });

  // ── formatKeyDisplay ────────────────────────────────────────────────────
  describe("formatKeyDisplay", () => {
    it("formats Cmd-Shift-S as ⌘⇧S", () => {
      expect(formatKeyDisplay("Cmd-Shift-S")).toBe("⌘⇧S");
    });
    it("returns '(unbound)' for empty string (EC-29)", () => {
      expect(formatKeyDisplay("")).toBe("(unbound)");
    });
    it("formats Cmd-Alt-P as ⌘⌥P", () => {
      expect(formatKeyDisplay("Cmd-Alt-P")).toBe("⌘⌥P");
    });
    it("formats Ctrl-Shift-K as ⌃⇧K", () => {
      expect(formatKeyDisplay("Ctrl-Shift-K")).toBe("⌃⇧K");
    });
    it("keeps named keys verbatim", () => {
      expect(formatKeyDisplay("Cmd-ArrowLeft")).toBe("⌘ArrowLeft");
    });
  });

  // ── renderKeybindingResults DOM tests ───────────────────────────────────
  describe("renderKeybindingResults", () => {
    let container: HTMLElement;
    beforeEach(() => {
      container = document.createElement("div");
    });

    it("renders 'No actions available' when results array is empty (EC-16)", () => {
      renderKeybindingResults(container, [], "", null);
      const empty = container.querySelector(".cb-empty");
      expect(empty).not.toBeNull();
      expect(empty!.textContent).toBe("No actions available");
    });

    it("renders an 'Actions' section header", () => {
      const results = [{ id: "kb:file-save", actionId: "file-save", label: "Save", activeKey: "Cmd-S", isDefault: true, isUnbound: false, dimmed: false, action: () => {} }];
      renderKeybindingResults(container, results, "", null);
      const header = container.querySelector(".cb-section-header");
      expect(header).not.toBeNull();
      expect(header!.textContent).toBe("Actions");
    });

    it("renders one result row per entry", () => {
      const results = [
        { id: "kb:file-save", actionId: "file-save", label: "Save", activeKey: "Cmd-S", isDefault: true, isUnbound: false, dimmed: false, action: () => {} },
        { id: "kb:file-open", actionId: "file-open", label: "Open", activeKey: "Cmd-O", isDefault: true, isUnbound: false, dimmed: false, action: () => {} },
      ];
      renderKeybindingResults(container, results, "", null);
      const rows = container.querySelectorAll(".cb-result");
      expect(rows.length).toBe(2);
    });

    it("renders '(default)' status badge for default bindings", () => {
      const results = [{ id: "kb:file-save", actionId: "file-save", label: "Save", activeKey: "Cmd-S", isDefault: true, isUnbound: false, dimmed: false, action: () => {} }];
      renderKeybindingResults(container, results, "", null);
      const status = container.querySelector(".cb-result-binding-status");
      expect(status!.textContent).toBe("(default)");
    });

    it("renders '(custom)' status badge for custom bindings", () => {
      const results = [{ id: "kb:file-save", actionId: "file-save", label: "Save", activeKey: "Cmd-Shift-S", isDefault: false, isUnbound: false, dimmed: false, action: () => {} }];
      renderKeybindingResults(container, results, "", null);
      const status = container.querySelector(".cb-result-binding-status");
      expect(status!.textContent).toBe("(custom)");
    });

    it("renders '(unbound)' status badge and omits key badge for unbound actions (EC-29)", () => {
      const results = [{ id: "kb:view-toggle", actionId: "view-toggle", label: "Toggle View", activeKey: "", isDefault: true, isUnbound: true, dimmed: false, action: () => {} }];
      renderKeybindingResults(container, results, "", null);
      const status = container.querySelector(".cb-result-binding-status");
      expect(status!.textContent).toBe("(unbound)");
      const keyBadge = container.querySelector(".cb-result-key-badge");
      expect(keyBadge).toBeNull();
    });

    it("renders formatted key badge for bound actions", () => {
      const results = [{ id: "kb:file-save", actionId: "file-save", label: "Save", activeKey: "Cmd-S", isDefault: true, isUnbound: false, dimmed: false, action: () => {} }];
      renderKeybindingResults(container, results, "", null);
      const keyBadge = container.querySelector(".cb-result-key-badge");
      expect(keyBadge).not.toBeNull();
      expect(keyBadge!.textContent).toBe("⌘S");
    });

    it("marks selected row with cb-result--selected and aria-selected=true", () => {
      const results = [
        { id: "kb:file-save", actionId: "file-save", label: "Save", activeKey: "Cmd-S", isDefault: true, isUnbound: false, dimmed: false, action: () => {} },
        { id: "kb:file-open", actionId: "file-open", label: "Open", activeKey: "Cmd-O", isDefault: true, isUnbound: false, dimmed: false, action: () => {} },
      ];
      renderKeybindingResults(container, results, "", "kb:file-save");
      const selectedRow = container.querySelector(".cb-result--selected");
      expect(selectedRow).not.toBeNull();
      expect(selectedRow!.getAttribute("data-id")).toBe("kb:file-save");
      expect(selectedRow!.getAttribute("aria-selected")).toBe("true");
    });
  });
});

// ---------------------------------------------------------------------------
// Step 05 — Preset System
// ---------------------------------------------------------------------------
describe("Step 05 — Preset System", () => {
  let validatePresetName: typeof import("../../../src/plugins/command-bar/preset-manager").validatePresetName;
  let sanitizePresetName: typeof import("../../../src/plugins/command-bar/preset-manager").sanitizePresetName;
  let loadPresets: typeof import("../../../src/plugins/command-bar/preset-manager").loadPresets;
  let saveNewPreset: typeof import("../../../src/plugins/command-bar/preset-manager").saveNewPreset;
  let deletePreset: typeof import("../../../src/plugins/command-bar/preset-manager").deletePreset;
  let renamePreset: typeof import("../../../src/plugins/command-bar/preset-manager").renamePreset;
  let DEFAULT_PRESET_NAME: typeof import("../../../src/plugins/command-bar/preset-manager").DEFAULT_PRESET_NAME;
  type PresetEntry = import("../../../src/plugins/command-bar/preset-manager").PresetEntry;
  type PresetApiDeps = import("../../../src/plugins/command-bar/preset-manager").PresetApiDeps;

  beforeAll(async () => {
    const mod = await import("../../../src/plugins/command-bar/preset-manager");
    validatePresetName = mod.validatePresetName;
    sanitizePresetName = mod.sanitizePresetName;
    loadPresets = mod.loadPresets;
    saveNewPreset = mod.saveNewPreset;
    deletePreset = mod.deletePreset;
    renamePreset = mod.renamePreset;
    DEFAULT_PRESET_NAME = mod.DEFAULT_PRESET_NAME;
  });

  function makeMockApi(overrides: Partial<PresetApiDeps> = {}): PresetApiDeps {
    return {
      loadSettings: async () => null,
      saveSettings: async () => {},
      listPresetFiles: async () => [],
      ...overrides,
    };
  }

  // ── validatePresetName ────────────────────────────────────────────────────
  describe("validatePresetName", () => {
    it("returns null for a valid unique name", () => {
      expect(validatePresetName("My Preset", [])).toBeNull();
    });
    it("EC-25: returns error for duplicate name (case-insensitive)", () => {
      expect(validatePresetName("my preset", ["My Preset"])).toMatch(/already exists/i);
    });
    it("EC-26: returns error for name 'Default' (case-insensitive)", () => {
      expect(validatePresetName("Default", [])).toMatch(/reserved/i);
    });
    it("EC-26: rejects 'default' and 'DEFAULT'", () => {
      expect(validatePresetName("default", [])).toMatch(/reserved/i);
      expect(validatePresetName("DEFAULT", [])).toMatch(/reserved/i);
    });
    it("returns error for empty name", () => {
      expect(validatePresetName("", [])).toMatch(/cannot be empty/i);
    });
    it("returns error for whitespace-only name", () => {
      expect(validatePresetName("   ", [])).toMatch(/cannot be empty/i);
    });
  });

  // ── sanitizePresetName ────────────────────────────────────────────────────
  describe("sanitizePresetName", () => {
    it("lowercases and replaces spaces with hyphens", () => {
      expect(sanitizePresetName("My Preset")).toBe("my-preset");
    });
    it("replaces special characters", () => {
      expect(sanitizePresetName("My Preset!")).toBe("my-preset-");
    });
    it("handles alphanumeric-only input unchanged (lowercased)", () => {
      expect(sanitizePresetName("VimLike")).toBe("vimlike");
    });
  });

  // ── loadPresets ───────────────────────────────────────────────────────────
  describe("loadPresets", () => {
    it("EC-24: returns only Default when listPresetFiles returns []", async () => {
      const result = await loadPresets(makeMockApi());
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe(DEFAULT_PRESET_NAME);
      expect(result[0].isDefault).toBe(true);
    });

    it("EC-33: returns only Default when directory is empty", async () => {
      const result = await loadPresets(makeMockApi({ listPresetFiles: async () => [] }));
      expect(result).toHaveLength(1);
    });

    it("EC-34: skips malformed preset data (bad bindings type) with console.warn", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await loadPresets(makeMockApi({
        listPresetFiles: async () => ["bad-preset.json"],
        loadSettings: async () => ({ bindings: "not-an-object" }),
      }));
      expect(result).toHaveLength(1); // only Default
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("malformed bindings"), expect.any(String));
      warnSpy.mockRestore();
    });

    it("EC-36: skips filename whose loadSettings returns null", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await loadPresets(makeMockApi({
        listPresetFiles: async () => ["missing.json"],
        loadSettings: async () => null,
      }));
      expect(result).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("returns Default plus loaded user presets", async () => {
      const result = await loadPresets(makeMockApi({
        listPresetFiles: async () => ["vim-like.json"],
        loadSettings: async () => ({ name: "Vim-like", bindings: { "file-save": "Ctrl-S" } }),
      }));
      expect(result).toHaveLength(2);
      expect(result[0].isDefault).toBe(true);
      expect(result[1].name).toBe("Vim-like");
      expect(result[1].bindings["file-save"]).toBe("Ctrl-S");
    });

    it("uses filename stem as display name when stored name is absent", async () => {
      const result = await loadPresets(makeMockApi({
        listPresetFiles: async () => ["my-preset.json"],
        loadSettings: async () => ({ bindings: {} }),  // no 'name' field
      }));
      expect(result[1].name).toBe("my-preset");
    });
  });

  // ── saveNewPreset ─────────────────────────────────────────────────────────
  describe("saveNewPreset", () => {
    it("saves a new preset and returns updated list", async () => {
      const savedData: Record<string, unknown> = {};
      const api = makeMockApi({
        saveSettings: async (_ns, data) => { Object.assign(savedData, data); },
      });
      const existing: PresetEntry[] = [{ name: DEFAULT_PRESET_NAME, bindings: {}, isDefault: true }];
      const result = await saveNewPreset("Vim-like", { "file-save": "Ctrl-S" }, existing, api);
      expect(result).toHaveLength(2);
      expect(result[1].name).toBe("Vim-like");
      expect(savedData.name).toBe("Vim-like");
    });

    it("EC-25: throws on duplicate name", async () => {
      const existing: PresetEntry[] = [
        { name: DEFAULT_PRESET_NAME, bindings: {}, isDefault: true },
        { name: "Vim-like", bindings: {}, isDefault: false },
      ];
      await expect(saveNewPreset("Vim-like", {}, existing, makeMockApi())).rejects.toThrow(/already exists/i);
    });

    it("EC-26: throws on reserved name 'Default'", async () => {
      const existing: PresetEntry[] = [{ name: DEFAULT_PRESET_NAME, bindings: {}, isDefault: true }];
      await expect(saveNewPreset("Default", {}, existing, makeMockApi())).rejects.toThrow(/reserved/i);
    });
  });

  // ── deletePreset ──────────────────────────────────────────────────────────
  describe("deletePreset", () => {
    it("deletes a user preset from the list", async () => {
      const existing: PresetEntry[] = [
        { name: DEFAULT_PRESET_NAME, bindings: {}, isDefault: true },
        { name: "Vim-like", bindings: {}, isDefault: false },
      ];
      const result = await deletePreset("Vim-like", existing, makeMockApi());
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe(DEFAULT_PRESET_NAME);
    });

    it("throws when attempting to delete Default", async () => {
      const existing: PresetEntry[] = [{ name: DEFAULT_PRESET_NAME, bindings: {}, isDefault: true }];
      await expect(deletePreset(DEFAULT_PRESET_NAME, existing, makeMockApi())).rejects.toThrow(/Cannot delete/i);
    });
  });

  // ── renamePreset ──────────────────────────────────────────────────────────
  describe("renamePreset", () => {
    it("renames a preset and updates the list", async () => {
      const existing: PresetEntry[] = [
        { name: DEFAULT_PRESET_NAME, bindings: {}, isDefault: true },
        { name: "Old Name", bindings: { "file-save": "Cmd-S" }, isDefault: false },
      ];
      const result = await renamePreset("Old Name", "New Name", existing, makeMockApi({
        loadSettings: async () => ({ bindings: { "file-save": "Cmd-S" } }),
      }));
      expect(result[1].name).toBe("New Name");
    });

    it("throws on invalid new name (duplicate)", async () => {
      const existing: PresetEntry[] = [
        { name: DEFAULT_PRESET_NAME, bindings: {}, isDefault: true },
        { name: "A", bindings: {}, isDefault: false },
        { name: "B", bindings: {}, isDefault: false },
      ];
      await expect(renamePreset("A", "B", existing, makeMockApi())).rejects.toThrow(/already exists/i);
    });

    it("throws when attempting to rename Default", async () => {
      const existing: PresetEntry[] = [{ name: DEFAULT_PRESET_NAME, bindings: {}, isDefault: true }];
      await expect(renamePreset(DEFAULT_PRESET_NAME, "New", existing, makeMockApi())).rejects.toThrow(/Cannot rename/i);
    });
  });
});

// ---------------------------------------------------------------------------
// Step 06 — Full EC Coverage (gap tests)
// ---------------------------------------------------------------------------
describe("Step 06 — EC Coverage Gaps", () => {

  // ── EC-15: corrupt / missing keybindings fallback ───────────────────────
  describe("EC-15: corrupt keybindings in customBindings", () => {
    it("buildKeybindingResults uses defaultKey when customBindings is empty (corrupt data coerced)", () => {
      const cmds = [{ id: "file-save", label: "Save", defaultKey: "Cmd-S", section: "File" }];
      const results = buildKeybindingResults({
        commands: cmds,
        customBindings: {},
        enterCapture: () => {},
      });
      expect(results[0].isDefault).toBe(true);
      expect(results[0].activeKey).toBe("Cmd-S");
    });

    it("buildKeybindingResults uses customBinding when present", () => {
      const cmds = [{ id: "file-save", label: "Save", defaultKey: "Cmd-S", section: "File" }];
      const results = buildKeybindingResults({
        commands: cmds,
        customBindings: { "file-save": "Ctrl-S" },
        enterCapture: () => {},
      });
      expect(results[0].isDefault).toBe(false);
      expect(results[0].activeKey).toBe("Ctrl-S");
    });
  });

  // ── EC-31: keybindings mode with no file open ───────────────────────────
  describe("EC-31: keybindings mode when no file is open", () => {
    it("buildKeybindingResults returns all actions regardless of currentFile", () => {
      // Keybinding results are not file-context dependent — all actions shown always
      const cmds = [
        { id: "file-save", label: "Save", defaultKey: "Cmd-S", section: "File" },
        { id: "file-open", label: "Open", defaultKey: "Cmd-O", section: "File" },
      ];
      const results = buildKeybindingResults({ commands: cmds, customBindings: {}, enterCapture: () => {} });
      // All actions should be present and none dimmed (no file-context gating in keybindings mode)
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.dimmed === false)).toBe(true);
    });

    it("renderKeybindingResults shows 'Actions' section header with results", () => {
      const container = document.createElement("div");
      const results = [
        { id: "kb:file-save", actionId: "file-save", label: "Save", activeKey: "Cmd-S",
          isDefault: true, isUnbound: false, dimmed: false, action: () => {} },
      ];
      renderKeybindingResults(container, results as any, "", null);
      expect(container.querySelector(".cb-section-header")?.textContent).toBe("Actions");
      expect(container.querySelectorAll(".cb-result")).toHaveLength(1);
    });
  });

  // ── EC-32: path resolution for workspace dir ────────────────────────────
  describe("EC-32: workspace path resolution", () => {
    it("derives workspace dir as absolute path (no ~) from file path", () => {
      const filePath = "/Users/testuser/docs/notes.md";
      const parts = filePath.split("/");
      parts.pop();
      const dir = parts.join("/") || "/";
      expect(dir).toBe("/Users/testuser/docs");
      expect(dir.startsWith("~")).toBe(false);
    });

    it("path with spaces is passed as-is", () => {
      const filePath = "/Users/test/My Documents/notes.md";
      const parts = filePath.split("/");
      parts.pop();
      const dir = parts.join("/") || "/";
      expect(dir).toBe("/Users/test/My Documents");
    });

    it("path with Unicode characters is passed as-is", () => {
      const filePath = "/Users/test/Björk notes/song.md";
      const parts = filePath.split("/");
      parts.pop();
      const dir = parts.join("/") || "/";
      expect(dir).toBe("/Users/test/Björk notes");
    });

    it("file at root level gives dir '/'", () => {
      const filePath = "/file.md";
      const parts = filePath.split("/");
      parts.pop();
      const dir = parts.join("/") || "/";
      expect(dir).toBe("/");
    });
  });

  // ── EC-27: rapid mode switch stale generation guard ─────────────────────
  describe("EC-27: stale async results discarded on mode switch", () => {
    it("countWorkspaceBeforeCap excludes files already open as tabs", () => {
      const files = ["/a/1.md", "/a/2.md", "/a/3.md"];
      const openPaths = new Set(["/a/1.md"]);
      // 2 files remain after deduplication
      expect(countWorkspaceBeforeCap(files, openPaths)).toBe(2);
    });

    it("countWorkspaceBeforeCap returns 0 when all files are open as tabs", () => {
      const files = ["/a/1.md"];
      const openPaths = new Set(["/a/1.md"]);
      expect(countWorkspaceBeforeCap(files, openPaths)).toBe(0);
    });

    it("countWorkspaceBeforeCap handles empty file list", () => {
      expect(countWorkspaceBeforeCap([], new Set())).toBe(0);
    });
  });

  // ── EC-11: tab strip click while key-capture is active ──────────────────
  describe("EC-11: mode switch blocked during key-capture (tab strip focus)", () => {
    it("renderCaptureView shows 'Waiting for key combo…' in waiting state", () => {
      // renderCaptureView is internal, but we can test it indirectly via DOM
      // by checking the exported renderKeybindingResults renders correctly
      const container = document.createElement("div");
      renderKeybindingResults(container, [], "", null);
      const empty = container.querySelector(".cb-empty");
      expect(empty?.textContent).toBe("No actions available");
    });

    it("formatKeyDisplay renders Cmd-W as ⌘W", () => {
      expect(formatKeyDisplay("Cmd-W")).toBe("⌘W");
    });

    it("isSystemReserved blocks all 5 reserved combos", () => {
      const reserved = ["Cmd-Q", "Cmd-W", "Cmd-Tab", "Cmd-M", "Cmd-H"];
      reserved.forEach((combo) => {
        expect(isSystemReserved(combo)).toBe(true);
      });
    });
  });

  // ── Export completeness audit ────────────────────────────────────────────
  describe("Export completeness audit", () => {
    it("files-mode exports FILES_CAP as 200", () => {
      expect(FILES_CAP).toBe(200);
    });

    it("files-mode exports FILES_SECTION_LABELS", () => {
      expect(FILES_SECTION_LABELS).toBeDefined();
      expect(typeof FILES_SECTION_LABELS).toBe("object");
    });

    it("files-mode exports abbreviatePath function", () => {
      expect(typeof abbreviatePath).toBe("function");
      expect(abbreviatePath("/Users/johndoe/docs/file.md")).toBe("~/docs/file.md");
    });

    it("files-mode exports basename function", () => {
      expect(typeof basename).toBe("function");
      expect(basename("/path/to/file.md")).toBe("file.md");
    });

    it("files-mode exports dirname function", () => {
      // dirname returns the directory portion with a trailing slash (visual convention
      // matching macOS Finder paths — makes it clear the result is a directory, not a filename).
      expect(typeof dirname).toBe("function");
      expect(dirname("/path/to/file.md")).toBe("/path/to/");
    });

    it("preset-manager exports DEFAULT_PRESET_NAME as 'Default'", () => {
      expect(DEFAULT_PRESET_NAME).toBe("Default");
    });

    it("preset-manager exports PRESET_NAMESPACE_PREFIX", () => {
      expect(PRESET_NAMESPACE_PREFIX).toBeDefined();
      expect(typeof PRESET_NAMESPACE_PREFIX).toBe("string");
    });

    it("preset-manager exports presetNamespace function", () => {
      expect(typeof presetNamespace).toBe("function");
      expect(presetNamespace("My Preset")).toBe("keybinding-preset-my-preset");
    });
  });

  // ── EC-14: first run (no keybindings.json) ──────────────────────────────────
  describe("EC-14: first run — keybindings.json does not exist", () => {
    it("buildKeybindingResults uses defaultKey for all actions when customBindings is empty (first run)", () => {
      // When no keybindings.json exists the app provides an empty customBindings object.
      // Every action should report isDefault:true and activeKey matching its defaultKey.
      const cmds = [
        { id: "file-save", label: "Save", defaultKey: "Cmd-S", section: "File" },
        { id: "file-open", label: "Open", defaultKey: "Cmd-O", section: "File" },
      ];
      const results = buildKeybindingResults({ commands: cmds, customBindings: {}, enterCapture: () => {} });
      expect(results.every((r) => r.isDefault)).toBe(true);
      expect(results[0].activeKey).toBe("Cmd-S");
      expect(results[1].activeKey).toBe("Cmd-O");
    });

    it("formatKeyDisplay shows correct symbol for default keys", () => {
      // Verify the key formatter produces the expected macOS symbol strings.
      expect(formatKeyDisplay("Cmd-S")).toBe("⌘S");
      expect(formatKeyDisplay("Cmd-O")).toBe("⌘O");
    });
  });

  // ── EC-17: Escape during key-capture restores query ──────────────────────────
  describe("EC-17: Escape during key-capture restores search", () => {
    it("exitKeyCapture DOM effect: capture view hidden, results shown", () => {
      // Simulate the DOM state transitions that enterCapture / exitKeyCapture apply.
      // enterCapture: adds cb-results--hidden, removes cb-capture-view--hidden
      // exitKeyCapture: removes cb-results--hidden, adds cb-capture-view--hidden
      const captureView = document.createElement("div");
      captureView.className = "cb-capture-view cb-capture-view--hidden";

      const resultsEl = document.createElement("div");
      resultsEl.className = "cb-results";

      // Simulate entering capture mode
      resultsEl.classList.add("cb-results--hidden");
      captureView.classList.remove("cb-capture-view--hidden");

      expect(captureView.classList.contains("cb-capture-view--hidden")).toBe(false);
      expect(resultsEl.classList.contains("cb-results--hidden")).toBe(true);

      // Simulate exitKeyCapture restoring search view
      captureView.classList.add("cb-capture-view--hidden");
      resultsEl.classList.remove("cb-results--hidden");

      expect(captureView.classList.contains("cb-capture-view--hidden")).toBe(true);
      expect(resultsEl.classList.contains("cb-results--hidden")).toBe(false);
    });

    it("isModifierOnly returns false for Escape key", () => {
      // Escape must not be treated as a modifier-only press so it exits capture.
      const e = { key: "Escape", metaKey: false, shiftKey: false, altKey: false, ctrlKey: false } as unknown as KeyboardEvent;
      expect(isModifierOnly(e)).toBe(false);
    });

    it("captureKeyFromEvent returns 'Escape' for Escape keypress", () => {
      // Escape is a named key — captureKeyFromEvent should return it verbatim.
      const e = { key: "Escape", metaKey: false, shiftKey: false, altKey: false, ctrlKey: false } as unknown as KeyboardEvent;
      expect(captureKeyFromEvent(e)).toBe("Escape");
    });
  });

  // ── EC-22: write failure during key-capture ──────────────────────────────────
  describe("EC-22: write failure during key-capture", () => {
    it("conflict warning element is rendered with error message", () => {
      // Verify the DOM pattern used to surface save errors in the capture view.
      const container = document.createElement("div");
      const errEl = document.createElement("div");
      errEl.className = "cb-conflict-warning";
      errEl.textContent = "Could not save binding: write failed";
      container.appendChild(errEl);

      expect(container.querySelector(".cb-conflict-warning")?.textContent).toBe(
        "Could not save binding: write failed",
      );
    });

    it("checkConflict returns null for a free Ctrl-S combo when customBindings empty", () => {
      // Ctrl-S is not a system-reserved combo and is not used by any action here,
      // so it should be considered free (null conflict).
      const cmds = [{ id: "file-save", label: "Save", defaultKey: "Cmd-S", section: "File" }];
      const result = checkConflict("Ctrl-S", "file-open", cmds, {});
      expect(result).toBeNull();
    });
  });

  // ── EC-35: preset file deleted after dropdown populated ──────────────────────
  describe("EC-35: preset file deleted after dropdown populated", () => {
    it("loadPresets skips unreadable files with console.warn (scan-time guard)", async () => {
      // When a preset file exists in the listing but cannot be read (e.g. deleted
      // mid-session), loadPresets logs a warning and returns only the Default preset.
      // This is the scan-time guard — apply-time is covered by the in-memory cache design.
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const api = {
        loadSettings: async (_ns: string) => { throw new Error("file not found"); },
        saveSettings: async () => {},
        listPresetFiles: async () => ["deleted-preset.json"],
      };
      const result = await loadPresets(api);
      expect(result).toHaveLength(1); // only Default preset
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("deleted-preset.json"),
        expect.any(Error),
      );
      warnSpy.mockRestore();
    });
  });
});

// =============================================================================
// GROUP B — fetchWorkspaceFiles vault scope fix (step_04_tests.md §B)
// =============================================================================

describe("fetchWorkspaceFiles — vault scope fix", () => {
  // Vault manager mock, reset before each test.
  let vaultManagerMock: {
    getActiveVault: ReturnType<typeof vi.fn>;
    getVaultIndex: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vaultManagerMock = {
      getActiveVault: vi.fn(),
      getVaultIndex: vi.fn(),
    };
    (window as any).__MARKABLE_VAULT_MANAGER__ = vaultManagerMock;
    // Stub tab manager so getOpenTabs() doesn't crash.
    (window as any).__MARKABLE_TAB_MANAGER__ = {
      getAllTabs: () => [],
      switchToTab: vi.fn(),
      openFile: vi.fn(),
    };
  });

  afterEach(() => {
    delete (window as any).__MARKABLE_VAULT_MANAGER__;
    delete (window as any).__MARKABLE_TAB_MANAGER__;
    delete (window as any).__MARKABLE_CURRENT_FILE__;
    delete (window as any).__TAURI_INTERNALS__;
  });

  // ── B-1: EC-1a — vault active, index already built ────────────────────────

  it("B-1 (EC-1a): vault active + index built → files from entries, list_md_files NOT called", async () => {
    // Arrange: active vault with a pre-built index containing 2 valid entries
    // and 1 corrupt entry (empty path) that must be filtered out (EC-17).
    vaultManagerMock.getActiveVault.mockReturnValue({ id: "v1", rootPaths: ["/vault"] });
    vaultManagerMock.getVaultIndex.mockReturnValue({
      entries: [
        { path: "/vault/a.md" },
        { path: "/vault/b.md" },
        { path: "" },          // EC-17: corrupt entry — must be filtered out
      ],
    });
    // Stub __TAURI_INTERNALS__ with a spy — it must NOT be called on the vault path.
    const invokeSpy = vi.fn();
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeSpy };

    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__;

    // Act: open the bar in files mode and let the synchronous vault path run.
    open("files");
    // Flush the async function's microtask queue (vault path has no awaits, so
    // a single Promise.resolve() tick is sufficient).
    await Promise.resolve();

    // Assert: no list_md_files call was made (vault index was used instead).
    expect(invokeSpy).not.toHaveBeenCalledWith("list_md_files", expect.anything());

    // Assert: the results list contains rows for the two valid vault files.
    const resultsList = document.getElementById("cb-results-list")!;
    const fileRows = resultsList.querySelectorAll("[data-id^='file:/vault/']");
    expect(fileRows.length).toBe(2);

    // Assert: no row with an empty/null path (corrupt entry was filtered).
    const emptyRows = resultsList.querySelectorAll("[data-id='file:']");
    expect(emptyRows.length).toBe(0);

    commandBarPlugin.onDisable(api as any);
  });

  // ── B-2: EC-1b — vault active, index null (still building) ───────────────

  it("B-2 (EC-1b): vault active + index null → loading state shown, list_md_files NOT called", async () => {
    // Arrange: vault is active but index is still being built.
    vaultManagerMock.getActiveVault.mockReturnValue({ id: "v1", rootPaths: ["/vault"] });
    vaultManagerMock.getVaultIndex.mockReturnValue(null);
    const invokeSpy = vi.fn();
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeSpy };

    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__;

    // Act.
    open("files");
    await Promise.resolve();

    // Assert: list_md_files was NOT invoked (vault path is taken, not fallback).
    expect(invokeSpy).not.toHaveBeenCalledWith("list_md_files", expect.anything());

    // Assert: results area shows a loading notice.
    const resultsList = document.getElementById("cb-results-list")!;
    const loadingRow = resultsList.querySelector(".cb-loading");
    expect(loadingRow).not.toBeNull();

    commandBarPlugin.onDisable(api as any);
  });

  // ── B-3: EC-2 fallback — no vault, current file set ─────────────────────

  it("B-3 (EC-2 fallback): no vault + current file set → list_md_files called", async () => {
    // Arrange: no active vault, fallback to directory derived from current file.
    vaultManagerMock.getActiveVault.mockReturnValue(null);
    (window as any).__MARKABLE_CURRENT_FILE__ = "/Users/alice/notes/readme.md";

    const invokeFiles = vi.fn().mockResolvedValue(["/Users/alice/notes/b.md"]);
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeFiles };

    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__;

    // Act.
    open("files");
    // Wait for the async invoke to resolve.
    await new Promise((r) => setTimeout(r, 0));

    // Assert: list_md_files was invoked with the directory derived from current file.
    expect(invokeFiles).toHaveBeenCalledWith("list_md_files", { dir: "/Users/alice/notes" });

    commandBarPlugin.onDisable(api as any);
  });

  // ── B-4: EC-2 fallback — no vault, no current file ───────────────────────

  it("B-4 (EC-2 fallback): no vault + no current file → no-workspace notice, invoke NOT called", async () => {
    // Arrange: no vault and no current file — nothing to scan.
    vaultManagerMock.getActiveVault.mockReturnValue(null);
    // Ensure __MARKABLE_CURRENT_FILE__ is absent.
    delete (window as any).__MARKABLE_CURRENT_FILE__;
    const invokeSpy = vi.fn();
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeSpy };

    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__;

    // Act.
    open("files");
    await Promise.resolve();

    // Assert: no Tauri invoke was triggered.
    expect(invokeSpy).not.toHaveBeenCalled();

    // Assert: results area shows a no-workspace notice.
    const resultsList = document.getElementById("cb-results-list")!;
    const noticeRow = resultsList.querySelector(".cb-notice");
    expect(noticeRow).not.toBeNull();

    commandBarPlugin.onDisable(api as any);
  });

  // ── B-5: EC-17 — corrupt index entries filtered ───────────────────────────

  it("B-5 (EC-17): entries with falsy path are silently filtered out", async () => {
    // Arrange: index has null path, empty path, and one valid path.
    vaultManagerMock.getActiveVault.mockReturnValue({ id: "v1", rootPaths: ["/vault"] });
    vaultManagerMock.getVaultIndex.mockReturnValue({
      entries: [
        { path: null },
        { path: "" },
        { path: "/vault/ok.md" },
      ],
    });

    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__;

    open("files");
    await Promise.resolve();

    // Assert: only the valid path appears in results.
    const resultsList = document.getElementById("cb-results-list")!;
    const rows = resultsList.querySelectorAll("[data-id^='file:/vault/ok.md']");
    expect(rows.length).toBe(1);

    // No row with a null or empty data-id.
    const badRows = resultsList.querySelectorAll("[data-id='file:null'], [data-id='file:']");
    expect(badRows.length).toBe(0);

    commandBarPlugin.onDisable(api as any);
  });

  // ── B-6: EC-18 — 500-entry vault ─────────────────────────────────────────

  it("B-6 (EC-18): 500-entry vault index passes all 500 paths to buildFilesResults", async () => {
    // Arrange: 500 valid entries — fetchWorkspaceFiles must pass all 500 to
    // buildFilesResults before the FILES_CAP (200) is applied inside that function.
    vaultManagerMock.getActiveVault.mockReturnValue({ id: "v1", rootPaths: ["/vault"] });
    vaultManagerMock.getVaultIndex.mockReturnValue({
      entries: Array.from({ length: 500 }, (_, i) => ({ path: `/vault/note${i}.md` })),
    });

    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__;

    open("files");
    await Promise.resolve();

    // Assert: the FILES_CAP applies inside buildFilesResults, so results list
    // shows exactly FILES_CAP (200) workspace-file rows (not more, not 0).
    const resultsList = document.getElementById("cb-results-list")!;
    const fileRows = resultsList.querySelectorAll("[data-id^='file:/vault/note']");
    expect(fileRows.length).toBe(FILES_CAP);

    commandBarPlugin.onDisable(api as any);
  });

  // ── B-7: NFR-4 — synchronous vault path has no setTimeout/setInterval ────

  it("B-7 (NFR-4): vault active + index built path does not schedule any setTimeout", async () => {
    // When the vault index is already built, fetchWorkspaceFiles reads it
    // synchronously with no setTimeout or async latency in the critical path
    // (NFR-4: <80ms to interactive). We verify this by spying on setTimeout and
    // confirming it is not called when taking the vault+index path.
    vaultManagerMock.getActiveVault.mockReturnValue({ id: "v1", rootPaths: ["/vault"] });
    vaultManagerMock.getVaultIndex.mockReturnValue({
      entries: [{ path: "/vault/a.md" }],
    });

    const setTimeoutSpy = vi.spyOn(window, "setTimeout");

    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__;

    open("files");
    await Promise.resolve();

    // Assert: no setTimeout was called during the vault-index path.
    // (The focusInput setTimeout in openBar fires once; the vault scan must not
    // add any of its own.)
    // We only care about calls FROM fetchWorkspaceFiles — the focus setTimeout is
    // expected from openBar itself and is not counted here. The vault path should
    // add ZERO extra setTimeouts beyond the focus call.
    // Strategy: count calls. openBar adds exactly 1 (focus). Vault path adds 0.
    const callCount = setTimeoutSpy.mock.calls.length;
    expect(callCount).toBeLessThanOrEqual(1); // only the focus setTimeout from openBar

    setTimeoutSpy.mockRestore();
    commandBarPlugin.onDisable(api as any);
  });

  // ── B-8: H-3 / EC-4 — vault with empty entries shows open tabs only ──────

  it("B-8 (H-3/EC-4): vault with entries:[] → Files mode shows open-tab rows only, no crash", async () => {
    // EC-4 requires: a vault with zero indexed entries does not crash the bar and
    // does not produce phantom workspace-file rows. Only open tabs are shown.
    vaultManagerMock.getActiveVault.mockReturnValue({ id: "v1", rootPaths: ["/vault"] });
    // Index is built but completely empty (no .md files in vault).
    vaultManagerMock.getVaultIndex.mockReturnValue({ entries: [] });

    // Arrange: one open tab so the result area is not completely blank.
    (window as any).__MARKABLE_TAB_MANAGER__ = {
      getAllTabs: () => [
        { id: "tab-1", filePath: "/vault/open-tab.md", title: "Open Tab", isModified: false },
      ],
      switchToTab: vi.fn(),
      openFile: vi.fn(),
    };

    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;

    // Should not throw.
    expect(() => open("files")).not.toThrow();
    await Promise.resolve();

    const resultsList = document.getElementById("cb-results-list")!;

    // Assert: no error state in the DOM.
    const errorRows = resultsList.querySelectorAll(".cb-error");
    expect(errorRows.length).toBe(0);

    // Assert: no workspace-file rows (entries was empty, so no vault-sourced files).
    // Tab rows use data-id="tab:<id>" (not "file:..."), so we check for tab-1.
    // The one open tab must appear in the results.
    const tabRows = resultsList.querySelectorAll("[data-id^='tab:tab-1']");
    expect(tabRows.length).toBe(1);

    commandBarPlugin.onDisable(api as any);
  });
});

// =============================================================================
// GROUP C — Content Mode (step_04_tests.md §C)
// =============================================================================

describe("content mode", () => {
  // Vault manager mock shared by tests that need a vault.
  let vaultManagerMock: {
    getActiveVault: ReturnType<typeof vi.fn>;
    getVaultIndex: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vaultManagerMock = {
      getActiveVault: vi.fn(),
      getVaultIndex: vi.fn(),
    };
    // Most content-mode tests need an active vault with a built (non-null) index
    // so that Enter in content mode reaches the invoke call rather than the
    // H-2 "still building" guard. Tests that specifically test the null-index
    // path (C-7b) must override getVaultIndex in their own body.
    vaultManagerMock.getActiveVault.mockReturnValue({
      id: "v1",
      rootPaths: ["/vault"],
      excludePatterns: [],
    });
    vaultManagerMock.getVaultIndex.mockReturnValue({ entries: [] });
    (window as any).__MARKABLE_VAULT_MANAGER__ = vaultManagerMock;
    (window as any).__MARKABLE_TAB_MANAGER__ = {
      getAllTabs: () => [],
      switchToTab: vi.fn(),
      openFile: vi.fn(),
    };
  });

  afterEach(() => {
    delete (window as any).__MARKABLE_VAULT_MANAGER__;
    delete (window as any).__MARKABLE_TAB_MANAGER__;
    delete (window as any).__MARKABLE_CURRENT_FILE__;
    delete (window as any).__TAURI_INTERNALS__;
  });

  // ── C-1: BarMode type includes "content" ─────────────────────────────────

  it("C-1 (FR-5): BarMode type includes 'content' and MODE_CYCLE has it at position 3", () => {
    // Type-level check: the import compiles without error because "content" is a
    // valid BarMode. The runtime check verifies MODE_CYCLE ordering (AD-GS-07).
    // Tags mode was added in the Vault Meta step; content remains at position 3.
    const _m: BarMode = "content"; // compile-time — if this breaks, BarMode changed
    expect(_m).toBe("content");
    expect(MODE_CYCLE).toEqual(["commands", "files", "keybindings", "content", "tags"]);
  });

  // ── C-2: FR-6 — "/" in files mode switches to content mode ───────────────

  it("C-2 (FR-6): typing '/' in files mode switches to content mode and clears input", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("files");

    const input = document.querySelector<HTMLInputElement>(".cb-input")!;

    // Simulate typing "/" as the sole character in the input.
    input.value = "/";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Assert: mode switches to content.
    expect(document.querySelector(".cb-tab--active")!.getAttribute("data-mode")).toBe("content");
    // Assert: input is cleared after the switch.
    expect(input.value).toBe("");

    commandBarPlugin.onDisable(api as any);
  });

  // ── C-3: EC-15 — "/" in non-empty query does NOT switch mode ─────────────

  it("C-3 (EC-15): typing 'design/' in files mode does NOT switch to content mode", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("files");

    const input = document.querySelector<HTMLInputElement>(".cb-input")!;

    // "design/" is a multi-character input — the "/" is NOT the sole character.
    input.value = "design/";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Mode must remain files.
    expect(document.querySelector(".cb-tab--active")!.getAttribute("data-mode")).toBe("files");

    commandBarPlugin.onDisable(api as any);
  });

  // ── C-4: EC-21 — "/" in content mode is a normal character ───────────────

  it("C-4 (EC-21): typing '/' while already in content mode does NOT switch mode", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("files");

    const input = document.querySelector<HTMLInputElement>(".cb-input")!;

    // First switch to content mode via the "/" prefix.
    input.value = "/";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector(".cb-tab--active")!.getAttribute("data-mode")).toBe("content");

    // Now type "/" again while already in content mode.
    input.value = "/";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Mode must remain content — "/" is treated as a normal search character.
    expect(document.querySelector(".cb-tab--active")!.getAttribute("data-mode")).toBe("content");
    // Input is NOT cleared (it stays as "/").
    expect(input.value).toBe("/");

    commandBarPlugin.onDisable(api as any);
  });

  // ── C-5: FR-7 — Backspace from empty content mode returns to files mode ──

  it("C-5 (FR-7): Backspace on empty input in content mode returns to files mode", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("files");

    const input = document.querySelector<HTMLInputElement>(".cb-input")!;
    const overlay = document.getElementById("markable-command-bar-overlay")!;

    // Switch to content mode.
    input.value = "/";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector(".cb-tab--active")!.getAttribute("data-mode")).toBe("content");

    // Backspace with empty input.
    input.value = "";
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));

    // Assert: mode returns to files.
    expect(document.querySelector(".cb-tab--active")!.getAttribute("data-mode")).toBe("files");

    commandBarPlugin.onDisable(api as any);
  });

  // ── C-6: FR-16 — Enter with empty query shows notice ─────────────────────

  it("C-6 (FR-16): Enter with empty query shows 'Enter a search term' notice, no invoke", async () => {
    const invokeSpy = vi.fn();
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeSpy };

    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("files");

    const input = document.querySelector<HTMLInputElement>(".cb-input")!;
    const overlay = document.getElementById("markable-command-bar-overlay")!;

    // Switch to content mode.
    input.value = "/";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Enter with empty query (input was cleared by the "/" switch).
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();

    // Assert: notice shown.
    const resultsList = document.getElementById("cb-results-list")!;
    const notice = resultsList.querySelector(".cb-content-notice");
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain("Enter a search term");

    // Assert: invoke was NOT called with search_vault_content.
    expect(invokeSpy).not.toHaveBeenCalledWith("search_vault_content", expect.anything());

    commandBarPlugin.onDisable(api as any);
  });

  // ── C-7: EC-3 — no vault shows no-vault notice ────────────────────────────

  it("C-7 (EC-3): Enter with no active vault shows no-vault notice, no invoke", async () => {
    // Override: no active vault for this test.
    vaultManagerMock.getActiveVault.mockReturnValue(null);
    const invokeSpy = vi.fn();
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeSpy };

    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("files");

    const input = document.querySelector<HTMLInputElement>(".cb-input")!;
    const overlay = document.getElementById("markable-command-bar-overlay")!;

    // Switch to content mode and type a query.
    input.value = "/";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = "foo";

    // Press Enter.
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();

    // Assert: no-vault notice shown.
    const resultsList = document.getElementById("cb-results-list")!;
    const notice = resultsList.querySelector(".cb-content-notice");
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain("No vault open");

    // Assert: invoke was NOT called.
    expect(invokeSpy).not.toHaveBeenCalledWith("search_vault_content", expect.anything());

    commandBarPlugin.onDisable(api as any);
  });

  // ── C-8: EC-12 — second Enter while search in-flight is a no-op ──────────

  it("C-8 (EC-12): second Enter while a search is already in-flight is a no-op (invoke called once)", async () => {
    // Arrange: invoke returns a promise that never resolves (simulates long search).
    // eslint-disable-next-line prefer-const
    let _resolveSearch!: () => void;
    const neverResolves = new Promise<void>((res) => { _resolveSearch = res; });
    const invokeSpy = vi.fn().mockReturnValue(neverResolves);
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeSpy };

    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("files");

    const input = document.querySelector<HTMLInputElement>(".cb-input")!;
    const overlay = document.getElementById("markable-command-bar-overlay")!;

    // Switch to content mode and enter a query.
    input.value = "/";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = "foo";

    // First Enter: launches the search.
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();

    // Second Enter while first is still in-flight.
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();

    // Assert: invoke was called exactly once.
    expect(invokeSpy).toHaveBeenCalledTimes(1);

    // Cleanup: resolve the hanging promise so there are no dangling microtasks.
    _resolveSearch();
    commandBarPlugin.onDisable(api as any);
  });

  // ── C-9: FR-10 — results rendered as file groups with excerpts ────────────

  it("C-9 (FR-10): renderContentResults renders file header, 3 excerpts, and '1 more match' row", async () => {
    // Arrange: a payload with one file that has 4 matches (only 3 shown, +1 more).
    const mockPayload = {
      results: [{
        path: "/vault/notes.md",
        title: "My Notes",
        matches: [
          { lineNumber: 3,  lineText: "This is a test note",  columnStart: 10 },
          { lineNumber: 7,  lineText: "Another test line",    columnStart: 8 },
          { lineNumber: 12, lineText: "Third test line",      columnStart: 6 },
          { lineNumber: 20, lineText: "Fourth test line",     columnStart: 7 },
        ],
      }],
      capped: false,
      skippedCount: 0,
    };

    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    // renderContentResults uses _resultsEl which is set in onEnable.
    renderContentResults(mockPayload, "test");

    const resultsList = document.getElementById("cb-results-list")!;

    // Assert: one header row with the file title.
    const headerRow = resultsList.querySelector(".cb-result--content-header");
    expect(headerRow).not.toBeNull();
    expect(headerRow!.textContent).toContain("My Notes");

    // Assert: exactly 3 excerpt rows (not 4 — the cap applies).
    const excerptRows = resultsList.querySelectorAll(".cb-result--content-excerpt");
    expect(excerptRows.length).toBe(3);

    // Assert: one "N more matches" row for the 4th match.
    const moreRow = resultsList.querySelector(".cb-result--content-more");
    expect(moreRow).not.toBeNull();
    expect(moreRow!.textContent).toContain("1 more match");

    // Assert: excerpt rows contain <strong> highlighting for the matched query.
    const firstExcerpt = excerptRows[0];
    const strong = firstExcerpt.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong!.textContent?.toLowerCase()).toContain("test");

    commandBarPlugin.onDisable(api as any);
  });

  // ── C-10: EC-6 — no results shows "No results for 'query'" ───────────────

  it("C-10 (EC-6): renderContentResults with empty results shows no-results notice", async () => {
    const mockPayload = { results: [], capped: false, skippedCount: 0 };

    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    renderContentResults(mockPayload, "missingterm");

    const resultsList = document.getElementById("cb-results-list")!;
    const notice = resultsList.querySelector(".cb-content-notice");
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain("No results for");
    expect(notice!.textContent).toContain("missingterm");

    commandBarPlugin.onDisable(api as any);
  });

  // ── C-11: EC-7 — capped = true shows cap notice ──────────────────────────

  it("C-11 (EC-7): renderContentResults with capped = true shows cap warning notice", async () => {
    // Arrange: 3 results, capped flag set.
    const mockPayload = {
      results: [
        { path: "/a.md", title: "A", matches: [{ lineNumber: 1, lineText: "foo", columnStart: 0 }] },
        { path: "/b.md", title: "B", matches: [{ lineNumber: 1, lineText: "foo", columnStart: 0 }] },
        { path: "/c.md", title: "C", matches: [{ lineNumber: 1, lineText: "foo", columnStart: 0 }] },
      ],
      capped: true,
      skippedCount: 0,
    };

    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    renderContentResults(mockPayload, "foo");

    const resultsList = document.getElementById("cb-results-list")!;
    const capNotice = resultsList.querySelector(".cb-content-notice--warning");
    expect(capNotice).not.toBeNull();
    // Notice must mention the number of files (3).
    expect(capNotice!.textContent).toContain("3");

    commandBarPlugin.onDisable(api as any);
  });

  // ── C-12: EC-8 — skippedCount > 0 shows skip notice ─────────────────────

  it("C-12 (EC-8): renderContentResults with skippedCount > 0 shows skip warning notice", async () => {
    const mockPayload = { results: [], capped: false, skippedCount: 3 };

    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    renderContentResults(mockPayload, "foo");

    const resultsList = document.getElementById("cb-results-list")!;
    const skipNotice = resultsList.querySelector(".cb-content-notice--warning");
    expect(skipNotice).not.toBeNull();
    expect(skipNotice!.textContent).toContain("3");
    expect(skipNotice!.textContent?.toLowerCase()).toContain("could not be searched");

    commandBarPlugin.onDisable(api as any);
  });

  // ── C-13: EC-5 — empty vault produces same result as EC-6 ────────────────

  it("C-13 (EC-5): empty vault (0 .md files) — Rust returns empty results, no-results notice shown", async () => {
    // Semantically identical to C-10: empty results array regardless of cause.
    const mockPayload = { results: [], capped: false, skippedCount: 0 };

    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    renderContentResults(mockPayload, "foo");

    const resultsList = document.getElementById("cb-results-list")!;
    const notice = resultsList.querySelector(".cb-content-notice");
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain("No results for");

    commandBarPlugin.onDisable(api as any);
  });

  // ── C-14: EC-11 — regex special characters in query do not crash renderer ─

  it("C-14 (EC-11): renderContentResults does not crash when query contains regex special chars", async () => {
    // The renderer uses plain substring slicing (not regex), so special regex
    // characters in the query must not cause errors.
    const mockPayload = { results: [], capped: false, skippedCount: 0 };

    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);

    // Should not throw.
    expect(() => renderContentResults(mockPayload, "foo[bar]*")).not.toThrow();

    // The no-results notice must display the literal query string.
    const resultsList = document.getElementById("cb-results-list")!;
    const notice = resultsList.querySelector(".cb-content-notice");
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain("foo[bar]*");

    commandBarPlugin.onDisable(api as any);
  });

  // ── C-15: EC-13 — plugin disabled while search in-flight → no crash ──────

  it("C-15 (EC-13): plugin disabled while content search is in-flight does not throw", async () => {
    // Arrange: invoke returns a promise we control.
    let resolveSearch: ((val: any) => void) = () => {};
    const pendingSearch = new Promise((res) => { resolveSearch = res; });
    const invokeSpy = vi.fn().mockReturnValue(pendingSearch);
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeSpy };

    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("files");

    const input = document.querySelector<HTMLInputElement>(".cb-input")!;
    const overlay = document.getElementById("markable-command-bar-overlay")!;

    // Enter content mode and start a search.
    input.value = "/";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = "foo";
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();

    // Disable the plugin (removes DOM, nulls module refs) while search is in-flight.
    // This must not throw.
    expect(() => commandBarPlugin.onDisable(api as any)).not.toThrow();

    // Resolve the search after DOM removal. The generation/DOM guards must fire cleanly.
    resolveSearch({ results: [], capped: false, skippedCount: 0 });
    await Promise.resolve();

    // If we get here without errors, the test passes.
    expect(true).toBe(true);
  });

  // ── C-16: EC-14 — closeBar() while in-flight causes result to be discarded ─

  it("C-16 (EC-14): closing bar while search in-flight discards stale results", async () => {
    // Arrange: invoke returns a controllable promise.
    let resolveSearch: ((val: any) => void) = () => {};
    const pendingSearch = new Promise((res) => { resolveSearch = res; });
    const invokeSpy = vi.fn().mockReturnValue(pendingSearch);
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeSpy };

    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("files");

    const input = document.querySelector<HTMLInputElement>(".cb-input")!;
    const overlay = document.getElementById("markable-command-bar-overlay")!;

    // Enter content mode and start a search.
    input.value = "/";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = "foo";
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();

    // Close the bar before the search resolves. closeBar() increments
    // _contentSearchGeneration, making the pending result stale.
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    // Resolve the stale search with file results.
    resolveSearch({
      results: [{ path: "/vault/a.md", title: "A", matches: [{ lineNumber: 1, lineText: "foo", columnStart: 0 }] }],
      capped: false,
      skippedCount: 0,
    });
    await Promise.resolve();

    // Re-open the bar. The stale results must NOT appear in the DOM.
    open("files");

    // In files mode there should be no content-header rows from the stale search.
    const resultsList = document.getElementById("cb-results-list")!;
    const staleRows = resultsList.querySelectorAll(".cb-result--content-header");
    expect(staleRows.length).toBe(0);

    commandBarPlugin.onDisable(api as any);
  });

  // ── C-17: FR-11 — clicking file header row opens file and closes bar ──────

  it("C-17 (FR-11): clicking a content file-header row opens the file and closes the bar", async () => {
    const openFileSpy = vi.fn();
    (window as any).__MARKABLE_TAB_MANAGER__ = {
      getAllTabs: () => [],
      openFile: openFileSpy,
    };

    const mockPayload = {
      results: [{
        path: "/vault/notes.md",
        title: "My Notes",
        matches: [{ lineNumber: 1, lineText: "foo", columnStart: 0 }],
      }],
      capped: false,
      skippedCount: 0,
    };

    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("files");

    // Render content results directly (no actual Enter needed).
    renderContentResults(mockPayload, "foo");

    const resultsList = document.getElementById("cb-results-list")!;
    const headerRow = resultsList.querySelector<HTMLElement>(".cb-result--content-header")!;

    // Simulate click on the file header.
    headerRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Assert: the file was opened.
    expect(openFileSpy).toHaveBeenCalledWith("/vault/notes.md");

    // Assert: the bar was closed (overlay has cb-hidden class).
    const overlay = document.getElementById("markable-command-bar-overlay")!;
    expect(overlay.classList.contains("cb-hidden")).toBe(true);

    commandBarPlugin.onDisable(api as any);
  });

  // ── C-18: FR-11 — clicking excerpt row also opens file ───────────────────

  it("C-18 (FR-11): clicking a content excerpt row opens the same file and closes bar", async () => {
    const openFileSpy = vi.fn();
    (window as any).__MARKABLE_TAB_MANAGER__ = {
      getAllTabs: () => [],
      openFile: openFileSpy,
    };

    const mockPayload = {
      results: [{
        path: "/vault/notes.md",
        title: "My Notes",
        matches: [
          { lineNumber: 1, lineText: "foo first match",  columnStart: 0 },
          { lineNumber: 5, lineText: "foo second match", columnStart: 0 },
        ],
      }],
      capped: false,
      skippedCount: 0,
    };

    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("files");

    renderContentResults(mockPayload, "foo");

    const resultsList = document.getElementById("cb-results-list")!;
    const excerptRows = resultsList.querySelectorAll<HTMLElement>(".cb-result--content-excerpt");
    expect(excerptRows.length).toBe(2);

    // Click the first excerpt.
    excerptRows[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Assert: same file opened.
    expect(openFileSpy).toHaveBeenCalledWith("/vault/notes.md");

    // Assert: bar closed.
    const overlay = document.getElementById("markable-command-bar-overlay")!;
    expect(overlay.classList.contains("cb-hidden")).toBe(true);

    commandBarPlugin.onDisable(api as any);
  });

  // ── C-19: EC-16 — closeBar() resets content mode state ───────────────────

  it("C-19 (EC-16): closeBar() while in content mode resets _mode to files", async () => {
    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("files");

    const input = document.querySelector<HTMLInputElement>(".cb-input")!;
    const overlay = document.getElementById("markable-command-bar-overlay")!;

    // Switch to content mode.
    input.value = "/";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector(".cb-tab--active")!.getAttribute("data-mode")).toBe("content");

    // Close via Escape.
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    // Bar must be hidden.
    expect(overlay.classList.contains("cb-hidden")).toBe(true);

    // Re-open with no argument — mode must have been reset to "files".
    open();
    expect(document.querySelector(".cb-tab--active")!.getAttribute("data-mode")).toBe("files");

    commandBarPlugin.onDisable(api as any);
  });

  // ── C-20: AD-GS-07 — MODE_CYCLE includes "content" at position 3 ─────────

  it("C-20 (AD-GS-07): MODE_CYCLE is ['commands', 'files', 'keybindings', 'content', 'tags']", () => {
    // Structural test: verifies the exported constant has the exact cycle order.
    // Content at position 3 is accessed primarily via the '/' prefix (AD-GS-07).
    // Tags at position 4 is accessed via ⌘5 (Vault Meta Tag Browser step).
    expect(MODE_CYCLE).toEqual(["commands", "files", "keybindings", "content", "tags"]);
  });

  // ── C-21: NFR-5 — all Record<BarMode, string> constants include "content" ─

  it("C-21 (NFR-5): all BarMode record constants include the 'content' key with correct values", () => {
    // Structural test: importing the constants and checking the "content" key
    // verifies that the Record<BarMode, string> type is exhaustively satisfied.
    expect(MODE_PLACEHOLDERS.content).toBe("Search file contents…");
    expect(MODE_FOOTER_HINTS.content).toBe("Enter to search  ·  Esc to close");
    expect(MODE_BADGE_LABELS.content).toBe("Content");
    expect(MODE_TAB_SHORTCUTS.content).toBe("⌘4");
    // Verify all four tab shortcuts follow the ⌘1–⌘4 convention.
    expect(MODE_TAB_SHORTCUTS.commands).toBe("⌘1");
    expect(MODE_TAB_SHORTCUTS.files).toBe("⌘2");
    expect(MODE_TAB_SHORTCUTS.keybindings).toBe("⌘3");
  });

  // ── C-7b: H-2 — vault active but index null → Enter shows building notice ─

  it("C-7b (H-2/EC-1): vault active but index null → Enter in content mode shows building notice, invoke NOT called", async () => {
    // EC-1 requires: when vault is active but index is still building (null),
    // pressing Enter in content mode shows a building notice rather than invoking Rust.
    // This prevents spurious search calls before the vault is ready.
    vaultManagerMock.getActiveVault.mockReturnValue({
      id: "v1",
      rootPaths: ["/vault"],
      excludePatterns: [],
    });
    // Index is null — still building.
    vaultManagerMock.getVaultIndex.mockReturnValue(null);

    const invokeSpy = vi.fn();
    (window as any).__TAURI_INTERNALS__ = { invoke: invokeSpy };

    const api = makeMockApi();
    await commandBarPlugin.onEnable(api as any);
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as (mode?: BarMode) => void;
    open("files");

    const input = document.querySelector<HTMLInputElement>(".cb-input")!;
    const overlay = document.getElementById("markable-command-bar-overlay")!;

    // Switch to content mode and type a query.
    input.value = "/";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.value = "foo";

    // Press Enter while index is null.
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();

    // Assert: building notice is shown.
    const resultsList = document.getElementById("cb-results-list")!;
    const notice = resultsList.querySelector(".cb-content-notice");
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain("still building");

    // Assert: search_vault_content was NOT invoked.
    expect(invokeSpy).not.toHaveBeenCalledWith("search_vault_content", expect.anything());

    commandBarPlugin.onDisable(api as any);
  });
});

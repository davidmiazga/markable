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

import { describe, it, expect, beforeEach, vi } from "vitest";

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
  it("renders exactly three checkboxes", () => {
    const container = document.createElement("div");
    renderDetailExtra(container);
    const checkboxes = container.querySelectorAll("input[type=checkbox]");
    expect(checkboxes.length).toBe(3);
  });

  it("all three checkboxes are checked by default (defaults: true)", () => {
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
    expect(labels.length).toBe(3);
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
    const savedSettings = { showCommands: false, showHeadings: false, showRecentFiles: false };
    const api = makeMockApi(savedSettings as unknown as Record<string, unknown>);
    await commandBarPlugin.onEnable(api as any);

    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as () => void;
    open();

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

    // Open the bar: this calls buildAllResults() which reads the globals above and
    // writes a dimmed "format-bold" result into _visibleResults.
    const open = (window as any).__MARKABLE_COMMAND_BAR_OPEN__ as () => void;
    open();

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

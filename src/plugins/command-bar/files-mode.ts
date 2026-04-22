/**
 * files-mode.ts — Pure builder functions for the Files mode of the Command Bar.
 *
 * This module contains only pure functions: no window globals, no DOM access.
 * All external dependencies (tabs list, file list, action callbacks) are passed
 * in via the FilesModeBuilderDeps injection bag. This design keeps every function
 * unit-testable in isolation without a browser environment.
 *
 * Bundled inline into command-bar.plugin.ts by Rollup (identical to fuzzy-ranker.ts).
 * It does NOT produce a separate IIFE bundle.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * A tab entry from __MARKABLE_TAB_MANAGER__.getAllTabs().
 * Typed minimally — only the fields the Files mode needs are declared here.
 */
export interface TabEntry {
  id: string;
  filePath: string | null;
  title: string;
}

/**
 * Dependency injection bag for buildFilesResults().
 *
 * Callers must supply the raw data and action callbacks so that buildFilesResults
 * remains a pure function with no window global access. This separation makes the
 * function trivially testable: no mocking of globals needed, just pass plain objects.
 */
export interface FilesModeBuilderDeps {
  /** All currently open tabs from __MARKABLE_TAB_MANAGER__.getAllTabs(). */
  tabs: TabEntry[];
  /** Absolute paths returned by list_md_files invoke; empty during loading or on error. */
  workspaceFiles: string[];
  /** Current load phase — controls which notice rows are shown. */
  workspaceLoadState: "loading" | "loaded" | "error" | "no-workspace";
  /** Error message string when workspaceLoadState === "error" (optional). */
  workspaceError?: string;
  /** Called when the user activates an open-tab result. Receives the tab id. */
  openTab: (tabId: string) => void;
  /** Called when the user activates a workspace-file result. Receives absolute path. */
  openFile: (path: string) => void;
}

/**
 * The two section categories in the Files mode results list.
 *
 * "open-tabs"       — currently open editor tabs (always shown immediately)
 * "workspace-files" — .md files found in the workspace directory (loaded async)
 */
export type FilesResultCategory = "open-tabs" | "workspace-files";

/**
 * A single row in the Files mode results list.
 *
 * Structurally similar to CommandBarResult but uses FilesResultCategory and adds
 * isTab / tabId fields. The `action` closure is captured at build time and is called
 * when the user activates the row (the bar closes before the action fires).
 */
export interface FilesResult {
  id: string;
  category: FilesResultCategory;
  /** Filename (basename) shown as the primary label. */
  label: string;
  /** Abbreviated directory path shown as secondary text beneath the label. */
  sublabel: string;
  filePath: string | null;
  /** True when this row represents an already-open tab (distinguishes tab vs file rows). */
  isTab: boolean;
  /** Tab id — only present when isTab is true. Used by the action closure. */
  tabId?: string;
  /** True when this result should be rendered greyed-out and non-interactive. */
  dimmed: boolean;
  /** Called on activation; bar is already closed before this fires. */
  action: () => void;
  /** Character positions in `label` that matched the query (set by caller for highlighting). */
  _matchPositions?: number[];
}

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * Maximum number of workspace files shown in the Files section.
 *
 * Cap prevents the results list from becoming unusably long when the workspace
 * contains hundreds of markdown files. A notice row is appended when the total
 * deduplicated count exceeds this value (EC-05). The user can type to filter.
 */
export const FILES_CAP = 200;

/**
 * Section header labels rendered above each group in the Files mode results list.
 * Keyed by FilesResultCategory so the renderer can look up the label without a switch.
 */
export const FILES_SECTION_LABELS: Record<FilesResultCategory, string> = {
  "open-tabs":       "Open Tabs",
  "workspace-files": "Files",
};

// ── Pure helper functions ──────────────────────────────────────────────────────

/**
 * Abbreviate an absolute path for display by replacing the macOS home-directory
 * prefix with "~/".
 *
 * Example: /Users/alice/Documents/notes/ → ~/Documents/notes/
 *
 * Why the regex:
 *   /^\/Users\/[^/]+\// matches the literal "/Users/", then any username
 *   (one or more non-slash characters), then another "/". The replacement "~/"
 *   preserves the rest of the path unchanged.
 *
 * Paths that do not start with /Users/<name>/ are returned unchanged (e.g.
 * /var/data/docs/ on Linux or Windows paths).
 *
 * @param fullPath - An absolute directory path (may or may not end with "/").
 * @returns The abbreviated path string.
 */
export function abbreviatePath(fullPath: string): string {
  return fullPath.replace(/^\/Users\/[^/]+\//, "~/");
}

/**
 * Extract the basename (final path component) from an absolute path.
 *
 * Handles the edge case where the path has no slash by returning the whole string
 * (via the `?? path` nullish coalescing fallback on the `.pop()` result).
 *
 * @param path - An absolute file path string.
 * @returns The filename portion without leading directory components.
 */
export function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Extract the directory portion of a path, including the trailing slash.
 *
 * Example: /Users/alice/notes/readme.md → /Users/alice/notes/
 *
 * Why include the trailing slash: the sublabel column in the results list
 * displays directory paths, and the trailing slash makes it clear this is a
 * directory, not a filename (visual convention matching macOS Finder paths).
 *
 * @param path - An absolute file path.
 * @returns The directory portion with a trailing slash.
 */
export function dirname(path: string): string {
  const base = basename(path);
  return path.slice(0, path.length - base.length);
}

// ── Main builder ───────────────────────────────────────────────────────────────

/**
 * Build the complete Files mode result set from tabs and workspace files.
 *
 * Algorithm (two-phase):
 *   Phase 1 (Open Tabs): one result per open tab, always using the tab's title
 *   or basename. Tabs without a filePath (untitled) get an empty sublabel.
 *
 *   Phase 2 (Workspace Files): workspace files are deduplicated against open tab
 *   paths (EC-06) so that a file that is already open as a tab does not appear
 *   again in the Files section. The deduplicated list is capped at FILES_CAP (EC-05)
 *   before building results — the cap operates on absolute paths before construction
 *   so the notice row count (via countWorkspaceBeforeCap) is accurate.
 *
 * The caller is responsible for rendering section headers and notice rows. This
 * function only builds the data rows; it does not touch the DOM.
 *
 * @param deps - Injected tabs list, file list, load state, and action callbacks.
 * @returns FilesResult[] with open-tabs results first, then workspace-files results.
 */
export function buildFilesResults(deps: FilesModeBuilderDeps): FilesResult[] {
  const { tabs, workspaceFiles, openTab, openFile } = deps;
  const results: FilesResult[] = [];

  // Build a set of file paths already represented by open tabs.
  // Used in Phase 2 to skip files that would duplicate an open tab entry.
  const openPaths = new Set<string>(
    tabs.flatMap((t) => (t.filePath ? [t.filePath] : []))
  );

  // ── Phase 1: Open Tabs section ──────────────────────────────────────────────
  for (const tab of tabs) {
    // Use the tab's title if available; fall back to the file's basename, then
    // "Untitled" for tabs that have neither a title nor a file path.
    const label = tab.title || basename(tab.filePath ?? "") || "Untitled";
    const sublabel = tab.filePath ? abbreviatePath(dirname(tab.filePath)) : "";

    // Capture tabId in a local const so the closure below does not close over
    // the loop variable `tab` (which would always reference the last iteration).
    const tabId = tab.id;
    results.push({
      id: `tab:${tab.id}`,
      category: "open-tabs",
      label,
      sublabel,
      filePath: tab.filePath,
      isTab: true,
      tabId,
      dimmed: false,
      action: () => openTab(tabId),
    });
  }

  // ── Phase 2: Workspace Files section (deduplicated, capped) ────────────────
  // Filter out paths already open as tabs (EC-06), then cap the remaining list.
  const dedupedFiles = workspaceFiles.filter((p) => !openPaths.has(p));
  const cappedFiles = dedupedFiles.slice(0, FILES_CAP);

  for (const filePath of cappedFiles) {
    const label = basename(filePath);
    const sublabel = abbreviatePath(dirname(filePath));

    // Capture filePath in a local const for the same closure-hygiene reason
    // as tabId above.
    const fp = filePath;
    results.push({
      id: `file:${filePath}`,
      category: "workspace-files",
      label,
      sublabel,
      filePath,
      isTab: false,
      dimmed: false,
      action: () => openFile(fp),
    });
  }

  return results;
}

/**
 * Count workspace files that would appear in the Files section before the cap.
 *
 * This is the deduplicated count (open tab paths excluded) — it accurately
 * represents how many files exist in total when the cap notice is shown (EC-05).
 * The notice reads "Showing 200 of N files — type to filter" where N is this value.
 *
 * @param workspaceFiles  - Raw absolute paths from list_md_files.
 * @param openTabPaths    - Set of file paths already represented by open tabs.
 * @returns The number of workspace files after deduplication (may exceed FILES_CAP).
 */
export function countWorkspaceBeforeCap(
  workspaceFiles: string[],
  openTabPaths: Set<string>,
): number {
  return workspaceFiles.filter((p) => !openTabPaths.has(p)).length;
}

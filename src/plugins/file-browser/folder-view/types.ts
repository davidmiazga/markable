/**
 * types.ts — Pure TypeScript type definitions for the Folder View feature.
 *
 * These types are consumed by parser.ts, detection.ts, tab.ts, renderer.ts,
 * and fallback.ts. No runtime logic lives here — only structural contracts.
 *
 * @module folder-view/types
 */

// ── Front-matter field types ──────────────────────────────────────────────────

/** Allowed sort order values for the card grid. */
export type FolderSortOrder = "name-asc" | "name-desc" | "modified-asc" | "modified-desc";

/**
 * Parsed YAML front-matter of a _folder.md file.
 *
 * All fields are optional at the parsing level; defaults are applied
 * in parseFolderMd() before returning the FolderViewConfig.
 *
 * The `show-modified` field uses a hyphenated key because that is the exact
 * YAML key name from the spec (FR-10). It is stored as a string at parse time
 * then converted to boolean during default-application.
 */
export interface FolderMdFrontMatter {
  layout?: string;
  title?: string;
  sort?: string;
  columns?: string | number;
  "show-modified"?: string | boolean;
}

/**
 * Validated, defaulted configuration for one Folder View tab.
 *
 * Produced by parseFolderMd(); consumed by the layout renderer (FR-18).
 * All fields are guaranteed to be present and within valid ranges after parsing.
 */
export interface FolderViewConfig {
  /**
   * The layout identifier, lowercased.
   * Empty string means the layout field was absent or invalid —
   * triggers the FR-12 graceful fallback.
   */
  layout: string;
  /** Display title for the tab. Defaults to folder's last path segment. */
  title: string;
  /** Sort order applied to both subfolder and file sections. Default: "name-asc". */
  sort: FolderSortOrder;
  /** Number of columns in the card grid, clamped to [2, 6]. Default: 3. */
  columns: number;
  /** Whether to show the modified date on file cards. Default: true. */
  showModified: boolean;
  /** Markdown body below the closing --- of the YAML block. May be empty string. */
  body: string;
}

// ── Card types ─────────────────────────────────────────────────────────────────

/**
 * One entry in the rendered card grid — either a subfolder or a file.
 *
 * Built from VaultIndex.entries / VaultIndex.directories / VaultIndex.nonMdFiles
 * by collectChildren() in tab.ts.
 */
export interface FolderCard {
  /** Absolute path of the entry. */
  path: string;
  /**
   * Display name.
   * For .md files: the filename stem (no extension).
   * For all other files: the full basename including extension.
   * For directories: the directory name.
   */
  name: string;
  /** "directory" or "file". */
  kind: "directory" | "file";
  /** File extension with leading dot (e.g. ".pdf"). Empty string for directories. */
  ext: string;
  /** Last modified timestamp in Unix milliseconds. 0 when unknown. */
  modified: number;
  /**
   * True when this subfolder itself has a _folder.md file.
   * Used by EC-09 / FR-21: clicking a subfolder card with hasFolderView=true
   * opens that subfolder's Folder View tab in addition to expanding the tree.
   */
  hasFolderView?: boolean;
}

// ── Renderer interface ─────────────────────────────────────────────────────────

/**
 * Contract for a folder layout renderer.
 *
 * v1 registers exactly one: "folder-cards" → renderFolderCards (renderer.ts).
 *
 * Adding a new layout in a future task requires only adding one entry to the
 * LAYOUT_RENDERERS Record in tab.ts (FR-28). The renderer receives the fully
 * validated FolderViewConfig, the pre-collected list of FolderCards, the DOM
 * container to render into, and the absolute folder path for click handlers.
 *
 * @param config     - Validated configuration from parseFolderMd().
 * @param cards      - Immediate children collected by collectChildren().
 * @param container  - The #custom-tab-host element to render into.
 * @param folderPath - Absolute path of the folder being rendered.
 */
export type FolderLayoutRenderer = (
  config: FolderViewConfig,
  cards: FolderCard[],
  container: HTMLElement,
  folderPath: string,
) => void;

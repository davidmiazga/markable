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

/** Layout mode for the card grid. */
export type FolderLayoutMode = "grid" | "flex";

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
  "card-width"?: string | number;
  "layout-mode"?: string;
  "show-modified"?: string | boolean;
  "aspect-ratio"?: string;
  fit?: string;
  "min-height"?: string | number;
  "max-height"?: string | number;
  /** "false" hides the card name label. */
  "show-name"?: string;
  /** FVB-04: "none" hides the preview rectangle. */
  "card-preview"?: string;
  /** FVB-06: "false" strips file extensions from card labels. */
  "show-extensions"?: string;
  /** FVB-07: "false" hides the Folders section entirely. */
  "show-folders"?: string;
  /** FVB-07: "false" hides the Files section entirely. */
  "show-files"?: string;
  /** FVB-08: renames the Folders section heading. */
  "folders-title"?: string;
  /** FVB-08: adds / renames the Files section heading. */
  "files-title"?: string;
  /** FVB-01: "true" shows up to 3 tag chips below the card name. */
  "show-tags"?: string;
  /** FVB-09: "true" shows item count on subfolder cards. */
  "show-count"?: string;
  /** FVB-05: list of filenames to exclude from the card grid. */
  exclude?: string[];
  /** "false" constrains the view to the editor content-area max-width. Default: "true" (full width). */
  "content-area-override"?: string;
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
  /**
   * Minimum card width in pixels used in the responsive layout.
   * Clamped to [40, 600]. Default: 160.
   */
  cardWidth: number;
  /** Whether to use a fixed-column grid or a fluid flex-wrap layout. Default: "grid". */
  layoutMode: FolderLayoutMode;
  /** Whether to show the modified date on file cards. Default: true. */
  showModified: boolean;
  /** Markdown body below the closing --- of the YAML block. May be empty string. */
  body: string;
  /**
   * CSS aspect-ratio value for the preview rectangle, e.g. "1/1", "16/9".
   * The special value "original" removes the fixed-ratio constraint.
   * Default: "1/1".
   */
  aspectRatio: string;
  /**
   * CSS background-size value applied to image previews, e.g. "cover",
   * "contain", "80% auto". Ignored when aspectRatio is "original".
   * Default: "cover".
   */
  fit: string;
  /** Minimum preview rectangle height in pixels. Default: 40. */
  minHeight: number;
  /** Maximum preview rectangle height in pixels. Default: 200. */
  maxHeight: number;
  /** Whether to show the card name label. Default: true. */
  showName: boolean;
  /** Whether to render the preview rectangle on cards. Default: true. FVB-04 */
  showPreview: boolean;
  /** Whether to show file extensions on card labels. Default: true. FVB-06 */
  showExtensions: boolean;
  /** Whether to render the Folders section. Default: true. FVB-07 */
  showFolders: boolean;
  /** Whether to render the Files section. Default: true. FVB-07 */
  showFiles: boolean;
  /** Section heading for the Folders section. Default: "Folders". FVB-08 */
  foldersTitle: string;
  /** Section heading for the Files section. Empty string = no heading. Default: "". FVB-08 */
  filesTitle: string;
  /** Whether to show tag chips below card names. Default: false. FVB-01 */
  showTags: boolean;
  /** Whether to show item count on subfolder cards. Default: false. FVB-09 */
  showCount: boolean;
  /** Filenames to exclude from the card grid. Default: []. FVB-05 */
  exclude: string[];
  /** When false, the view respects the editor content-area max-width (--settings-content-max-width). Default: true (full width). */
  contentAreaOverride: boolean;
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
  /** YAML tags from front matter. Present for .md files only. FVB-01 */
  tags?: string[];
  /** Number of immediate children (files + dirs). Present for directories only. FVB-09 */
  childCount?: number;
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

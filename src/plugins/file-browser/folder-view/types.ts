/**
 * types.ts — Pure TypeScript type definitions for the Folder View feature.
 *
 * These types are consumed by parser.ts, detection.ts, tab.ts, renderer.ts,
 * table-renderer.ts, and fallback.ts. No runtime logic lives here — only
 * structural contracts.
 *
 * @module folder-view/types
 */

// Type-only imports for BulkContext — these are erased at emit time and safe
// for an IIFE bundle because they carry no runtime module reference.
import type { SelectionState } from "./bulk-selection";
import type { ToolbarRefs } from "./bulk-toolbar";

// ── Front-matter field types ──────────────────────────────────────────────────

/** Built-in sort orders for the card grid and table.
 * `author-asc` / `author-desc` are Bookshelf-only sort modes that read
 * `card.meta.author` (populated by `enrichBookshelfMeta`) with a fallback
 * chain to `card.meta.title` then `card.name` when author is missing.
 * `manual` preserves the order in `FolderViewConfig.order` (file paths,
 * persisted by drag/drop). When `manual` is set without an `order`, the
 * renderer falls back to `name-asc`. */
export type BuiltinSortOrder =
  | "name-asc"
  | "name-desc"
  | "modified-asc"
  | "modified-desc"
  | "author-asc"
  | "author-desc"
  | "manual";

/**
 * Sort order for a Folder View section.
 *
 * Includes the four built-in orders plus any arbitrary string, which is
 * interpreted as an extra-field key for the folder-table layout (FR-08).
 */
export type FolderSortOrder = BuiltinSortOrder | string;

/** Layout mode for the card grid. */
export type FolderLayoutMode = "grid" | "flex";

/**
 * One declared extra YAML frontmatter column for the folder-table layout.
 *
 * Produced by parseFolderMd() from the extra-fields sequence in _folder.md.
 * Consumed by table-renderer.ts to add sortable columns.
 */
export interface ExtraField {
  /** The YAML frontmatter key to read from child files. */
  key: string;
  /** Column header label shown in the table. */
  label: string;
}

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
  /** Relative path to a cover image displayed as a full-width banner above the description. */
  cover?: string;
  /** Emoji character or relative path to an icon image displayed above the description. */
  icon?: string;
  /**
   * Raw YAML value for the extra-fields sequence (string[] or object[]).
   * Extracted before normalizeFm() and processed into ExtraField[] by parseFolderMd().
   */
  "extra-fields"?: unknown;
  /**
   * Raw YAML value for the fields: sequence.
   * Extracted by extractFieldsRaw() in parser.ts.
   */
  "fields"?: unknown;
  /** YAML frontmatter key used to group columns in the folder-kanban layout. */
  "kanban-field"?: string;
  /** Raw YAML value for the kanban-order: sequence (string[] after parsing). */
  "kanban-order"?: unknown;
  /** Raw YAML value for the order: sequence (file paths after parsing).
   * Drives `manual` sort mode. */
  "order"?: unknown;
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
  /**
   * Declared extra frontmatter columns for the folder-table layout.
   * Default: []. Present for all layouts; ignored outside folder-table.
   */
  extraFields: ExtraField[];
  /**
   * Ordered list of column identifiers from the fields: YAML sequence.
   * null when fields: is absent or empty — triggers legacy flag-based column logic.
   * When non-null, supersedes showModified, showExtensions, showTags, showCount,
   * and extraFields for the purposes of column rendering in table-renderer.ts.
   */
  fields: string[] | null;
  /** Show a rendered preview pane above the card grid / table. Default: false. */
  previewPane: boolean;
  /** CSS height value for the preview pane (e.g. "60%"). Default: "60%". */
  previewHeight: string;
  /** Relative path to a cover image for the page header. Absent when not declared. */
  cover?: string;
  /** Emoji or relative path to a page icon displayed above the description. Absent when not declared. */
  icon?: string;
  /** YAML frontmatter key used to group columns in the folder-kanban layout (e.g. "status"). */
  kanbanField?: string;
  /** Explicit column order for folder-kanban. Alphabetical when absent. */
  kanbanOrder?: string[];
  /**
   * Explicit per-file order for the card grid (and other layouts in later phases).
   * List of file paths, matched against `FolderCard.path` by the renderer.
   * Set by drag/drop; persisted via `order:` in the `\`\`\`select` fence body
   * or `_folder.md` frontmatter. Effective only when `sort === "manual"`.
   * Unknown entries are silently dropped at render time (handles deleted/
   * renamed files); files not in the list keep their natural order at the tail.
   */
  order?: string[];
  /**
   * Chosen sub-variant of the current display (e.g. "simple-list" under table).
   * Resolved via display-options.ts; absent means "use the display's defaultOption".
   */
  displayOption?: string;
  /**
   * YAML frontmatter key used to group items into shelves (Bookshelf display).
   * Absent means a single ungrouped collection.
   */
  groupBy?: string;
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
  /**
   * Frontmatter values keyed by ExtraField.key.
   * Set by the enrichment phase in renderFolderViewTabAsync().
   * Present only for .md file cards after enrichment, and for all cards
   * when extraFields is non-empty (non-.md and directory cards get {}).
   * Absent when extraFields is empty (no enrichment phase runs).
   */
  meta?: Record<string, string>;
}

// ── Bulk context ───────────────────────────────────────────────────────────────

/**
 * Bulk-selection wiring passed from renderFolderViewTabAsync (tab.ts) to both
 * layout renderers as the optional fifth argument. Created once per render call
 * and shared across all sections in both renderers.
 *
 * selectionState — Mutable shared selection: paths + kindMap.
 * toolbarRefs    — Live DOM references for the toolbar; already attached to the
 *                  renderer's host before any sections are appended.
 * syncToolbar    — Closure: calls updateToolbar(toolbarRefs, selectionState).
 *                  Each row/card checkbox change must call this.
 * onMove         — Async callback invoked by toolbar Confirm Move.
 * onDelete       — Async callback invoked by toolbar Confirm Delete.
 * onYaml         — Async callback invoked by toolbar Apply YAML.
 */
export interface BulkContext {
  selectionState: SelectionState;
  toolbarRefs: ToolbarRefs;
  syncToolbar: () => void;
  onMove:   (destDir: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onYaml:   (op: "add" | "remove", key: string, value: string) => Promise<void>;
}

// ── Renderer interface ─────────────────────────────────────────────────────────

/**
 * Contract for a folder layout renderer.
 *
 * v1 registers two layouts: "folder-cards" → renderFolderCards (renderer.ts)
 * and "folder-table" → renderFolderTable (table-renderer.ts).
 *
 * Adding a new layout in a future task requires only adding one entry to the
 * LAYOUT_RENDERERS Record in tab.ts (FR-28). The renderer receives the fully
 * validated FolderViewConfig, the pre-collected list of FolderCards, the DOM
 * container to render into, the absolute folder path for click handlers, and
 * an optional BulkContext for shared selection state.
 *
 * The fifth parameter is optional (context?) so all existing callers —
 * including tests that invoke the renderer without a bulk context — continue
 * to compile with zero changes. Renderers that do not need bulk support may
 * simply ignore it.
 *
 * @param config     - Validated configuration from parseFolderMd().
 * @param cards      - Immediate children collected by collectChildren().
 * @param container  - The #custom-tab-host element to render into.
 * @param folderPath - Absolute path of the folder being rendered.
 * @param context    - Optional bulk-selection wiring from tab.ts.
 */
export type FolderLayoutRenderer = (
  config: FolderViewConfig,
  cards: FolderCard[],
  container: HTMLElement,
  folderPath: string,
  context?: BulkContext,
) => void;

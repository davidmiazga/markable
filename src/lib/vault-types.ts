/**
 * vault-types.ts
 *
 * All shared TypeScript interfaces for the PKM vault system.
 *
 * These types are used by vault-manager.ts, index-parser.ts, and the
 * File Browser / Knowledge Graph plugin modules. Keeping them in a
 * dedicated file avoids circular imports between those consumers.
 *
 * Design notes:
 * - VaultEntry is the user-facing record stored in settings.json.
 * - VaultIndex / VaultIndexEntry are the in-memory and on-disk
 *   representations of the per-vault file index.
 * - FileEntry is the lightweight struct returned by list_vault_files
 *   (no content parsing, used for incremental staleness checks).
 * - VaultFileChangedEvent is the shape emitted by the Rust notify watcher
 *   over the Tauri event bus, and consumed by vault-manager's event handlers.
 */

// ────────────────────────────────────────────────────────────────────────────
// Vault configuration
// ────────────────────────────────────────────────────────────────────────────

/**
 * A named, bounded collection of file paths that forms the indexing scope
 * for the File Browser and Knowledge Graph features.
 *
 * Stored as elements of the `vaults` array in settings.json.
 * The `id` field is a UUID v4 generated at creation time and is immutable.
 */
export interface VaultEntry {
  /** UUID v4 — generated at creation, never changed. */
  id: string;
  /** Human-readable display name; 1–100 characters. */
  name: string;
  /** One or more absolute paths that define the vault's scope. */
  rootPaths: string[];
  /** ISO 8601 datetime when this vault was created. */
  created: string;
  /** ISO 8601 datetime updated each time the vault is activated. */
  lastOpened: string;
  /** Glob patterns for paths to exclude during index build (e.g. "node_modules", ".git"). */
  excludePatterns: string[];
  /**
   * Soft cap on the number of indexed files.
   * When the index build reaches this count, capped=true is set and building stops.
   * Default: 500. Values above 500 trigger a UI performance warning.
   */
  maxIndexSize: number;
  /**
   * Extension point for vault icon rendering.
   * When set, the File Browser maps this to a CSS class via getVaultIconClass().
   * Absent = use the default vault icon.
   */
  iconId?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Index structures
// ────────────────────────────────────────────────────────────────────────────

/**
 * Single file record in a vault index.
 *
 * Persisted to vault-index/{vaultId}.json and held in-memory by vault-manager.
 * The `modified` field (unix ms) is used by isStale() to detect when a file
 * has changed since the index was last built.
 */
export interface VaultIndexEntry {
  /** Absolute path to the file on disk. */
  path: string;
  /** Filename without extension (used as the wiki-link stem). */
  name: string;
  /** Last-modified timestamp in milliseconds since epoch. */
  modified: number;
  /** File size in bytes. */
  size: number;
  /**
   * Display title: the value of the `title:` front matter field if present,
   * otherwise the first `# H1` heading, otherwise the filename stem.
   */
  title: string;
  /** Tags extracted from the `tags:` YAML front matter field. */
  tags: string[];
  /**
   * Wiki-link targets as extracted stems (without brackets and without pipe-text).
   * Example: `[[Notes/foo|My Note]]` → `"Notes/foo"`.
   * NOT resolved to absolute paths — resolution happens at render time.
   */
  outboundLinks: string[];
}

/**
 * Lightweight record for a non-Markdown file (image, PDF, etc.) found during
 * the vault walk. Used by the File Browser to display the full vault contents.
 */
export interface NonMdFile {
  /** Absolute path to the file. */
  path: string;
  /** Filename with extension (e.g. "photo.png"). */
  name: string;
}

/**
 * The complete index for one vault.
 *
 * Persisted to app_data_dir/vault-index/{vaultId}.json after every build
 * and loaded back on vault activation. When corrupted, vault-manager
 * silently rebuilds from scratch (EC-06).
 */
export interface VaultIndex {
  /** The id of the vault this index belongs to. */
  vaultId: string;
  /** Unix timestamp (ms) when this index was built. */
  builtAt: number;
  /** All indexed .md file entries. */
  entries: VaultIndexEntry[];
  /** Total .md files found before the cap was applied. */
  totalFilesFound: number;
  /** Number of files skipped due to permissions or read errors. */
  skippedCount: number;
  /** True if totalFilesFound exceeded maxIndexSize. */
  capped: boolean;
  /** All non-Markdown files found during the walk (images, PDFs, etc.). */
  nonMdFiles?: NonMdFile[];
  /** All subdirectory paths found during the walk, including empty directories. */
  directories?: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// File listing (lightweight — no content parsing)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Lightweight file record returned by list_vault_files.
 * Used for incremental staleness checking: compare stored `modified`
 * vs current `modified` to decide whether to re-parse a file.
 */
export interface FileEntry {
  /** Absolute path. */
  path: string;
  /** Filename (with extension). */
  name: string;
  /** Last-modified timestamp in milliseconds since epoch. */
  modified: number;
  /** File size in bytes. */
  size: number;
  /** True for directories, false for regular files. */
  isDirectory: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Path validation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Per-path result from validate_vault_paths.
 * The Rust command never returns Err — all error information is embedded here
 * so the frontend can show inline validation errors per path (EC-01, EC-02).
 */
export interface PathValidationResult {
  /** The path that was validated (echoed back for correlation). */
  path: string;
  /** True if the path exists on disk. */
  exists: boolean;
  /** True if the path is a directory (false if file or missing). */
  isDirectory: boolean;
  /** True if the directory is readable (i.e. a read_dir() succeeded). */
  readable: boolean;
  /** Human-readable error string when exists=false or readable=false. */
  error?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Link update result
// ────────────────────────────────────────────────────────────────────────────

/**
 * Result of a batch wiki-link rename operation (Phase 2b).
 * Each element of `updated` was atomically rewritten; each element of
 * `failed` could not be written (permissions, lock, etc.).
 */
export interface UpdateLinksResult {
  /** Paths successfully updated (atomic temp-file-swap). */
  updated: string[];
  /** Paths that could not be updated, with the error message. */
  failed: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// File-system change events (used by fs watcher in Phase 2b)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Payload emitted by the Rust notify watcher over the Tauri event bus
 * (`vault-file-changed` event). Consumed by vault-manager's incremental
 * index update handler.
 *
 * The watcher is debounced 500ms on the Rust side to prevent storm events
 * from git checkouts or large saves (NFR-06).
 */
export interface VaultFileChangedEvent {
  /** The vault this event belongs to. */
  vaultId: string;
  /** Type of change detected. */
  eventType: "created" | "modified" | "renamed" | "deleted";
  /** Absolute path of the affected file. */
  path: string;
  /** New path — only present for "renamed" events. */
  newPath?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Event callback types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Callback signature for vault switch events.
 * Receives the newly active VaultEntry, or null when the active vault
 * was deleted and no replacement exists.
 */
export type VaultChangedCallback = (vault: VaultEntry | null) => void;

/**
 * Callback signature for incremental index update events.
 * The File Browser and Knowledge Graph plugins subscribe to this to
 * incrementally update their rendered views without a full rebuild.
 */
export type IndexUpdatedCallback = (event: VaultFileChangedEvent) => void;

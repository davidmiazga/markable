/**
 * tab-types.ts — Shared type definitions for the multi-document tab system.
 *
 * Defines the data shape of a single open tab (TabEntry), the contract
 * that every renderer must fulfill (ITabRenderer), and the soft-warning
 * threshold constant. No imports from outside src/tabs/ are needed here.
 */

/**
 * Discriminant for a tab's content kind.
 *
 * "editor" — a Markdown document managed by the shared CodeMirror 6 EditorView.
 * "media"  — an image, PDF, or other non-text asset rendered in #media-viewer.
 *
 * All tabs created before this field was added default to "editor". No
 * migration is required because session restore only persists editor tabs.
 */
export type TabKind = "editor" | "media";

/**
 * All data needed to represent one open document tab.
 *
 * Each TabEntry is the single source of truth for a document: its file path,
 * display title, dirty state, and the raw document text captured the last time
 * the user navigated away from the tab.
 *
 * Tab switching is implemented as a dispatch transaction that replaces the
 * document text in the shared EditorView rather than swapping EditorState
 * objects. This preserves all CM6 extensions, compartments, and plugin state
 * across switches (the extensions live on the EditorView, not on the doc).
 * Per-tab undo history is not preserved — undo history is shared across tabs.
 */
export interface TabEntry {
  /** Unique identifier, generated with crypto.randomUUID(). */
  id: string;

  /**
   * Discriminates between a Markdown editor tab and a media-file viewer tab.
   * Defaults to "editor" for all tabs created before this field existed.
   */
  kind: TabKind;

  /**
   * Absolute file path, or null when the document has never been saved
   * (the "Untitled" state).
   */
  filePath: string | null;

  /**
   * Display name shown in tab labels and the title bar.
   * Derived from filePath (extension stripped), or "Untitled" when filePath is null.
   */
  title: string;

  /**
   * True when the document has unsaved changes.
   * Triggers the bullet indicator in the title bar and tab label.
   */
  isDirty: boolean;

  /**
   * The document text captured the last time the user navigated away from
   * this tab (or the initial content on open). Restored on tab activation
   * via a dispatch transaction that replaces the EditorView's doc.
   */
  doc: string;

  /**
   * The value of editorView.scrollDOM.scrollTop at the moment the user
   * last navigated away from this tab. Restored on tab activation so the
   * scroll position does not reset to the top.
   */
  scrollTop: number;

  /**
   * True when the tab is pinned. Pinned tabs sort to the front of the tab list
   * and are skipped by closeOtherTabs() and closeAllTabs(). Closing a pinned
   * tab auto-unpins it first rather than blocking the close.
   */
  pinned?: boolean;
}

/**
 * Contract every tab-strip renderer must implement.
 *
 * TabManager keeps exactly one active ITabRenderer at a time and swaps it
 * when the user changes the tab mode (minimal / regular / vertical). The
 * three lifecycle methods correspond to three lifecycle events:
 *
 *   mount()   — one-time setup: create DOM, attach listeners, first paint
 *   update()  — called after every state change (open/close/activate/dirty)
 *   destroy() — teardown: remove all DOM and event listeners
 *
 * Renderers must not hold strong references to TabEntry objects beyond the
 * scope of a single update() call; they receive the full tabs array each time
 * so they can diff or replace as needed.
 */
export interface ITabRenderer {
  /**
   * Build all DOM inside container and attach event listeners.
   *
   * Called once per renderer lifetime: at mode activation or app startup.
   * The container is always #tab-strip for horizontal modes, or a freshly
   * created element inserted into #app-row for vertical mode.
   *
   * @param container    The element that owns the renderer's DOM subtree.
   * @param tabs         Current tab array (snapshot, not a live reference).
   * @param activeIndex  Index of the currently active tab in the tabs array.
   */
  mount(container: HTMLElement, tabs: TabEntry[], activeIndex: number): void;

  /**
   * Re-render after any state change (tab open, close, activate, dirty toggle).
   *
   * Implementations may diff or fully replace innerHTML — correctness matters
   * more than micro-optimisation at this stage.
   *
   * @param tabs         Current tab array (snapshot, not a live reference).
   * @param activeIndex  Index of the currently active tab in the tabs array.
   */
  update(tabs: TabEntry[], activeIndex: number): void;

  /**
   * Tear down all DOM nodes added by mount() and remove all event listeners.
   *
   * Called before a mode switch or app teardown. After destroy() returns the
   * container element must be empty and ready for the next renderer.
   */
  destroy(): void;
}

/**
 * The number of open tabs at which the UI should show a soft visual warning.
 *
 * OD-4: The value 30 was confirmed during architecture review. Changing it
 * here is the only place needed — TabManager and the soft-warning renderer
 * both import this constant rather than repeating the magic number.
 *
 * No hard cap is enforced; users can open as many tabs as they like.
 */
export const TAB_SOFT_WARNING_THRESHOLD = 30;

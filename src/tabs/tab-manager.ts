/**
 * tab-manager.ts — TabManager singleton: the central hub for the
 * multi-document tab system.
 *
 * Responsibilities:
 *   - Owns the canonical list of open tabs (TabEntry[]) and the active index.
 *   - Applies tab state to the shared EditorView via setState() — never by
 *     creating a second EditorView.
 *   - Delegates all rendering to an ITabRenderer (swapped on mode change).
 *   - Persists session (open file paths + scroll positions) and tab mode
 *     through the existing settings raw-JSON pass-through.
 *
 * Invariants (must not be broken across later steps):
 *   1. One EditorView for the app lifetime. Tab switching calls setState().
 *   2. TabManager is a singleton — only one instance per process.
 *   3. Tab data lives in MarkableSettings — no separate file.
 *   4. TabManager never touches the PluginManager or MarkablePluginAPI.
 *
 * Step-01 status: full logic present; renderer is null until step_02 wires
 * the renderers. tabManager.init() is not yet called from main.ts (step_07).
 */

// EditorView is imported as a value (not just a type) because openContentTab()
// references EditorView.editable.of() at runtime to lock read-only content tabs.
import { EditorView } from "@codemirror/view";
import type { TabEntry, ITabRenderer } from "./tab-types";
import { readFile, writeFile, saveFileDialog } from "../lib/bridge";
import { extractH1, h1ToFilename } from "../plugins/auto-title/auto-title-helpers";
import { getCurrentSettings, updateSettings, addRecentFile } from "../lib/settings";
import { setLivePreviewFilePath, setViewMode } from "../editor/live-preview";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { convertFileSrc } from "@tauri-apps/api/core";
// editableCompartment is used by openContentTab() to set read-only mode for
// help file tabs. Imported from extensions — TabManager is not a plugin and
// is explicitly allowed to access editor internals directly.
import { editableCompartment } from "../editor/extensions";
// toggleSide is imported from the internal module (not the public facade) because
// TabManager is not a plugin — it is allowed to reference sidebar internals directly.
import { toggleSide } from "../sidebar/sidebar-manager";
// MinimalTabBar is the default renderer (step_02). RegularTabBar added in
// step_03. VerticalTabStrip added in step_04.
import { MinimalTabBar } from "./renderers/minimal-tab-bar";
import { RegularTabBar } from "./renderers/regular-tab-bar";
import { VerticalTabStrip } from "./renderers/vertical-tab-strip";

export class TabManager {
  // ── Private state ────────────────────────────────────────────────────────────

  /** The ordered list of open documents. Index 0 is the leftmost tab. */
  private tabs: TabEntry[] = [];

  /** Index into this.tabs pointing at the currently visible document. */
  private activeIndex: number = 0;

  /**
   * The single shared EditorView. Set once in init().
   * Using null (not undefined) so the "not yet initialised" case is
   * explicit and null-checks are uniform throughout the class.
   */
  private editorView: EditorView | null = null;

  /**
   * The active renderer. Null until init() completes (step_01) or until
   * a renderer is wired (step_02+). Swapped by setMode().
   */
  private renderer: ITabRenderer | null = null;

  /** The #tab-strip DOM element, looked up once in init(). */
  private tabStripEl: HTMLElement | null = null;

  /**
   * Current tab display mode.
   * "minimal"  — small dot/pill strip (default).
   * "regular"  — filename tabs with close buttons.
   * "vertical" — full-height panel replacing the left sidebar.
   */
  private mode: "minimal" | "regular" | "vertical" = "minimal";

  /**
   * True when THIS TabManager call hid #sidebar-left on entering vertical mode.
   * Used to avoid wrongly restoring a sidebar that was already closed before
   * vertical mode was activated (EC-10 / EC-11).
   */
  private _hidSidebarForVertical = false;

  /** The #editor DOM element, stored in init() for fast access in _applyActiveTab. */
  private editorContainer: HTMLElement | null = null;

  /** The #media-viewer DOM element injected by init(). Never removed from DOM. */
  private mediaViewerEl: HTMLElement | null = null;

  /**
   * The #custom-tab-host DOM element, located in init().
   * Unlike #media-viewer (which is injected by init()), this element is
   * static HTML declared in index.html (FR-03). Never removed from DOM.
   */
  private customTabHostEl: HTMLElement | null = null;

  // ── Lifecycle ─────────────────────────────────────────────────────────────────

  /**
   * Initialise the TabManager. Must be called once from main.ts after the
   * DOM is ready and the EditorView has been created.
   *
   * Order of operations:
   *   1. Store the EditorView reference.
   *   2. Locate #tab-strip (programming error if absent — step_02 must add it).
   *   3. Read persisted settings (tabMode, openFiles, activeTabIndex).
   *   4. Restore session tabs, skipping any files that can no longer be read.
   *   5. Ensure at least one tab exists (untitled fallback).
   *   6. Clamp the persisted activeIndex to the valid range.
   *   7. Wire the renderer (no-op in step_01; renderers arrive in step_02–04).
   *   8. Apply the active tab to the EditorView.
   *
   * @param editorView  The application's single shared EditorView instance.
   */
  async init(editorView: EditorView): Promise<void> {
    this.editorView = editorView;

    // Step 2: locate the permanent tab-strip container and the #editor container.
    // Its absence means index.html has not been updated (step_02 prerequisite).
    this.tabStripEl = document.getElementById("tab-strip");
    // Store the #editor container for fast access by _applyActiveTab.
    this.editorContainer = document.getElementById("editor");
    if (!this.tabStripEl) {
      console.error(
        "TabManager.init: #tab-strip element not found in DOM. " +
        "Ensure index.html has been updated per step_02_minimal_tab_bar.md."
      );
      return;
    }

    // Step 3: read persisted tab settings.
    const settings = getCurrentSettings();
    const tabMode = settings.tabMode ?? "minimal";
    const openFiles = settings.openFiles ?? [];
    const rawActiveIndex = settings.activeTabIndex ?? 0;

    this.mode = tabMode;

    // Step 4–5: session restore.
    // Attempt to load each saved file. Files that fail (missing, permission
    // denied, etc.) are silently skipped so a stale session does not block
    // the app from opening (EC-1, EC-6).
    for (const entry of openFiles) {
      const result = await readFile(entry.filePath);
      if (!result.ok) {
        // Silent skip: the file might have been moved/deleted since last session.
        continue;
      }
      this.tabs.push({
        id: crypto.randomUUID(),
        kind: "editor",
        filePath: entry.filePath,
        title: this._titleFromPath(entry.filePath),
        isDirty: false,
        doc: result.value,
        scrollTop: entry.scrollTop,
        pinned: entry.pinned ?? false,
      });
    }

    // Sort pinned tabs to the front after all tabs are restored.
    this._sortPinnedTabsToFront();

    // Step 5 fallback: if no tabs were successfully restored, open an untitled
    // tab so the editor is never left empty (FR-6.5).
    // Exception: when a vault is active, the file browser leads the experience —
    // stay at 0 tabs so the sidebar and file browser are the entry point.
    // Read from settings directly (not vault manager global) because vault init
    // may not have completed yet at this point in the startup sequence.
    const hasActiveVault = this._settingsHaveActiveVault();
    if (this.tabs.length === 0 && !hasActiveVault) {
      this.tabs.push(this._createUntitledTab());
    }

    // Step 6: clamp the saved activeTabIndex to a valid range.
    // Out-of-range values (e.g. after removing files between sessions) default
    // to the last tab rather than crashing (FR-6.6).
    // When 0 tabs (vault-active startup), use -1 to signal "no active tab".
    this.activeIndex =
      this.tabs.length === 0
        ? -1
        : Math.max(0, Math.min(rawActiveIndex, this.tabs.length - 1));

    // Step 7: renderer instantiation.
    // _instantiateRenderer() creates the appropriate renderer for this.mode and
    // calls renderer.mount(). MinimalTabBar (step_02), RegularTabBar (step_03),
    // and VerticalTabStrip (step_04) are all available.
    this._instantiateRenderer();
    if (this.renderer && this.tabStripEl) {
      this.renderer.mount(this.tabStripEl, this.tabs, this.activeIndex);
    }

    // Step 8: apply active tab to the EditorView.
    this._applyActiveTab();

    // Inject #media-viewer as a sibling to .cm-editor inside #editor.
    // Created once for the app lifetime; hidden by default via CSS.
    if (this.editorContainer) {
      const mv = document.createElement("div");
      mv.id = "media-viewer";
      this.editorContainer.appendChild(mv);
      this.mediaViewerEl = mv;
    }

    // Locate #custom-tab-host (must exist in index.html — FR-03).
    // Unlike #media-viewer which is created by init(), this element is static HTML.
    this.customTabHostEl = document.getElementById("custom-tab-host");
    if (!this.customTabHostEl) {
      console.error(
        "TabManager.init: #custom-tab-host element not found in DOM. " +
        "Ensure index.html has been updated per step_01_custom-render-tab.md."
      );
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  /**
   * Derives a user-friendly display title from a file path.
   *
   * Rules:
   *   - null path  → "Untitled"
   *   - "/a/b/doc.md" → "doc"  (last path component, extension stripped)
   *   - "/a/README"  → "README" (no extension → return name as-is)
   *   - Extension stripping removes only the last dot segment, so
   *     "archive.tar.gz" → "archive.tar".
   *
   * @param filePath  Absolute file path, or null for an unsaved document.
   * @returns  Display title string — never empty.
   */
  private _titleFromPath(filePath: string | null): string {
    if (!filePath) return "Untitled";
    // Take the last path segment (works on both Unix and Windows paths stored
    // as Unix-style strings on macOS, which is the only supported platform).
    const name = filePath.split("/").pop() ?? filePath;
    const dotIdx = name.lastIndexOf(".");
    // dotIdx === 0 means a dotfile like ".bashrc" — keep the full name.
    return dotIdx > 0 ? name.slice(0, dotIdx) : name;
  }

  /**
   * Returns the full filename (including extension) from an absolute path.
   *
   * Used for media tab titles where the extension is part of the identity
   * (e.g. "photo.jpg" rather than "photo").
   *
   * @param filePath  Absolute file path.
   * @returns  The last path component with extension, never empty.
   */
  private _basenameFromPath(filePath: string): string {
    return filePath.split("/").pop() ?? filePath;
  }

  /**
   * Returns true when the user has a vault configured and active in settings.
   *
   * Reads from settings directly rather than the vault-manager global because
   * this method is called during init(), before vault-manager.init() has
   * necessarily completed (vault init is non-blocking in main.ts).
   */
  private _settingsHaveActiveVault(): boolean {
    const settings = getCurrentSettings();
    const activeId = settings.activeVaultId;
    if (!activeId) return false;
    return (settings.vaults ?? []).some((v) => v.id === activeId);
  }

  /**
   * Creates a fresh untitled TabEntry with an empty document.
   *
   * Used by openNewTab() and as the fallback in init() when session restore
   * produces zero tabs.
   *
   * @returns  A new TabEntry with a unique id, no filePath, and empty doc.
   */
  private _createUntitledTab(): TabEntry {
    const autoTitle = (window as unknown as Record<string, unknown>)["__MARKABLE_AUTO_TITLE__"];
    return {
      id: crypto.randomUUID(),
      kind: "editor",
      filePath: null,
      title: "Untitled",
      isDirty: false,
      doc: autoTitle ? "# " : "",
      scrollTop: 0,
    };
  }

  /**
   * Applies the active tab's document text and scroll position to the shared
   * EditorView, then syncs the live-preview file path and title bar.
   *
   * Uses a dispatch transaction (not setState) so that all CM6 extensions,
   * compartments, and plugin state on the EditorView are preserved across
   * tab switches. setState would wipe every extension registered after editor
   * creation (live preview, syntax highlighting, plugin compartments, etc.).
   *
   * This function cannot be split below ~55 lines because it handles two
   * fundamentally different tab kinds (media and editor) that share the same
   * entry contract (zero-tab guard, editorView null guard) and the same exit
   * contract (title bar update). Extracting the media branch into a helper would
   * require threading four fields through a parameter object, and extracting the
   * editor branch would split the setLivePreviewFilePath + dispatch + scrollTop
   * trio that must execute in a specific order (path before dispatch, scroll after
   * dispatch). Any split introduces ordering bugs that are harder to catch than the
   * length itself.
   *
   * This is called after:
   *   - init() completes
   *   - activateTab() switches to a different tab
   *   - openNewTab() or openFileInTab() adds a tab and activates it
   */
  private _applyActiveTab(): void {
    // Zero-tab guard: last tab was closed. Show a blank screen.
    if (this.tabs.length === 0) {
      this.editorContainer?.classList.remove("has-media-tab");
      document.body.classList.remove("has-custom-tab");
      if (this.mediaViewerEl) this.mediaViewerEl.innerHTML = "";
      // Clear the editor and lock it — blank, non-editable empty state.
      if (this.editorView) {
        this.editorView.dispatch({
          changes: { from: 0, to: this.editorView.state.doc.length, insert: "" },
          effects: editableCompartment.reconfigure(EditorView.editable.of(false)),
        });
      }
      // Clear the title bar and current-file globals.
      const titleEl = document.getElementById("titlebar-title");
      if (titleEl) titleEl.textContent = "";
      (window as unknown as Record<string, unknown>)["__MARKABLE_CURRENT_FILE__"] = null;
      setLivePreviewFilePath(null);
      return;
    }

    if (this.editorView === null) return;

    const tab = this.tabs[this.activeIndex];

    if (tab.kind === "media") {
      // Show the media viewer; hide the CM6 editor.
      this.editorContainer?.classList.add("has-media-tab");
      this._renderMediaViewer(tab.filePath!);
      this._updateTitleBar(tab);
      // AD-6: expose current file path for IIFE plugins.
      (window as unknown as Record<string, unknown>)["__MARKABLE_CURRENT_FILE__"] =
        tab.filePath;
      return;
    }

    if (tab.kind === "custom") {
      // Hide the CM6 editor; show the custom tab host.
      // Remove has-media-tab in case the previous tab was a media tab.
      this.editorContainer?.classList.remove("has-media-tab");
      document.body.classList.add("has-custom-tab");
      this._updateTitleBar(tab);
      // AD-6: custom tabs have no meaningful file path.
      (window as unknown as Record<string, unknown>)["__MARKABLE_CURRENT_FILE__"] = null;
      return;
    }

    // Editor tab: hide the media viewer and restore the CM6 editor.
    this.editorContainer?.classList.remove("has-media-tab");
    // Remove has-custom-tab class in case the previous tab was a custom tab.
    document.body.classList.remove("has-custom-tab");

    // Set the file path BEFORE dispatching the document so that
    // buildDecorations() has the correct path on its first run.
    // If called after dispatch, images with relative paths never render on
    // initial load when the syntax tree is already cached (no second update fires).
    setLivePreviewFilePath(tab.filePath);
    // AD-6: expose the current document path so IIFE plugins (e.g. image-toolbar)
    // can resolve relative image paths without an app-internal import.
    (window as unknown as Record<string, unknown>)["__MARKABLE_CURRENT_FILE__"] =
      tab.filePath;

    // Replace doc text in one transaction. Re-enable editing (in case the
    // zero-tab state locked the editor), and for file-backed tabs include
    // setViewMode.of(true) so preview mode activates in the same transaction.
    // Untitled tabs start in edit mode so the user can type immediately.
    this.editorView.dispatch({
      changes: { from: 0, to: this.editorView.state.doc.length, insert: tab.doc },
      selection: { anchor: tab.filePath === null ? tab.doc.length : 0 },
      effects: [
        editableCompartment.reconfigure(EditorView.editable.of(true)),
        ...(tab.filePath !== null ? [setViewMode.of(true)] : []),
      ],
    });

    // Auto-title pre-fills "# " which triggers markActiveTabDirty via the
    // updateListener. Reset here so the tab doesn't show the dirty indicator
    // until the user actually types.
    if (tab.filePath === null && tab.doc.length > 0) {
      tab.isDirty = false;
      this.editorView.focus();
    }

    // Restore the scroll position the user was at when they last left this tab.
    this.editorView.scrollDOM.scrollTop = tab.scrollTop;

    // Update the chromeless title bar.
    this._updateTitleBar(tab);
  }

  /**
   * Captures the current EditorView state back into the active tab record.
   *
   * Called just before switching away from a tab. Without this call the user
   * would lose their cursor position, scroll position, and unsaved edits
   * if they switch tabs and return.
   *
   * Note: editorView.state is always post-transaction (EC-5), so there is no
   * race with an in-flight CM6 transaction.
   */
  private _captureActiveTab(): void {
    if (this.tabs.length === 0 || this.editorView === null) return;

    const tab = this.tabs[this.activeIndex];
    // Media and custom tabs have no document text or meaningful scroll position.
    // Capturing them would overwrite doc: "" with stale EditorView content.
    if (tab.kind === "media" || tab.kind === "custom") return;

    tab.doc = this.editorView.state.doc.toString();
    tab.scrollTop = this.editorView.scrollDOM.scrollTop;
  }

  /**
   * Sets the chromeless title bar text to reflect the active document.
   *
   * The dirty-indicator bullet (•) follows macOS convention: appended after
   * the document name rather than a leading asterisk, which is more common
   * on Unix but less familiar to macOS users.
   *
   * @param tab  The TabEntry whose title should be displayed.
   */
  private _updateTitleBar(tab: TabEntry): void {
    const titleEl = document.getElementById("titlebar-title");
    if (!titleEl) return;
    titleEl.textContent = tab.isDirty ? `${tab.title} •` : tab.title;
  }

  /**
   * Populates #media-viewer with the appropriate element for the given file.
   *
   * Synchronous — no Tauri IPC. The file is loaded by the browser's native
   * rendering after src is set (NFR-1).
   *
   * This function cannot be split below ~44 lines because it is a dispatch table
   * over three mutually exclusive rendering strategies (raster/vector image,
   * PDF embed, and unsupported fallback), each of which must set element
   * attributes, wire an error handler, and append to mediaViewerEl. Factoring
   * the shared "create element → set src → wire error → append" into a helper
   * would require conditional generics for HTMLImageElement vs HTMLEmbedElement —
   * the resulting abstraction would be longer and harder to follow than the
   * explicit if/else branches already here.
   *
   * @param filePath  Absolute path to the media file.
   */
  private _renderMediaViewer(filePath: string): void {
    if (!this.mediaViewerEl) return;

    // Clear stale content from a previous media tab (NFR-3).
    this.mediaViewerEl.innerHTML = "";

    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    const assetUrl = convertFileSrc(filePath);
    const basename = this._basenameFromPath(filePath);

    // Raster and vector image types rendered natively as <img>.
    const RASTER_EXTS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "ico", "svg"]);

    if (RASTER_EXTS.has(ext)) {
      const img = document.createElement("img");
      img.src = assetUrl;
      img.alt = basename;
      // EC-03: if the browser cannot load the file, replace the viewer content
      // with an error message instead of showing a broken image icon.
      img.addEventListener("error", () => {
        if (this.mediaViewerEl) {
          this.mediaViewerEl.innerHTML = '<p class="mv-load-error">Could not load file.</p>';
        }
      });
      this.mediaViewerEl.appendChild(img);
    } else if (ext === "pdf") {
      const embed = document.createElement("embed");
      embed.src = assetUrl;
      embed.type = "application/pdf";
      // EC-03: same error pattern as img.
      embed.addEventListener("error", () => {
        if (this.mediaViewerEl) {
          this.mediaViewerEl.innerHTML = '<p class="mv-load-error">Could not load file.</p>';
        }
      });
      this.mediaViewerEl.appendChild(embed);
    } else {
      // EC-04: unknown or missing extension — show a human-readable message.
      const p = document.createElement("p");
      p.className = "mv-unsupported";
      p.textContent = "Cannot preview this file type.";
      this.mediaViewerEl.appendChild(p);
    }
  }

  /**
   * Calls renderer.update() if a renderer is mounted and #tab-strip is present.
   *
   * This method is the single call-site for notifying the renderer of state
   * changes. Centralising it here means individual operations (openNewTab,
   * closeTab, etc.) only need to call _notifyRenderer() and do not need to
   * know which renderer is active or whether one is present at all.
   */
  private _notifyRenderer(): void {
    if (!this.renderer || !this.tabStripEl) return;
    this.renderer.update(this.tabs, this.activeIndex);
  }

  /**
   * Creates the renderer appropriate for the current mode and assigns it to
   * this.renderer. Tears down any existing renderer first.
   *
   * This method is the single place where renderer classes are instantiated.
   * Adding a new renderer (step_03, step_04) means adding one case here.
   *
   * Note: mount() is NOT called here — init() and setMode() each call mount()
   * themselves because they have access to the container and initial state.
   */
  private _instantiateRenderer(): void {
    // Tear down any renderer that is currently mounted to start from a clean state.
    if (this.renderer) {
      this.renderer.destroy();
      this.renderer = null;
    }

    // Stamp the current mode on <body> so CSS can style elements above #tab-strip
    // (e.g. #titlebar) based on tab mode. Only one class is present at a time.
    document.body.classList.remove("tab-mode-minimal", "tab-mode-regular", "tab-mode-vertical");
    document.body.classList.add(`tab-mode-${this.mode}`);

    // The default case intentionally falls through to "minimal" so the app
    // always has a functioning renderer even if a stored tabMode value from a
    // future build is encountered.
    switch (this.mode) {
      case "minimal":
      default:
        this.renderer = new MinimalTabBar(
          // Bind activateTab so the renderer callback is always in sync with
          // the current TabManager instance, not a stale closure.
          (id) => this.activateTab(id),
          undefined,
          (fromId, ins) => this.reorderTab(fromId, ins),
        );
        break;

      case "regular":
        // RegularTabBar needs three callbacks: activate, close, and new-tab.
        // void is used on closeTab because it returns a Promise and we do not
        // need to await it inside a synchronous renderer callback — errors are
        // handled internally by closeTab (confirm dialog + console.error).
        this.renderer = new RegularTabBar(
          (id) => this.activateTab(id),
          (id) => void this.closeTab(id),
          () => this.openNewTab(),
          (fromId, ins) => this.reorderTab(fromId, ins),
        );
        break;

      case "vertical":
        // VerticalTabStrip renders into #app-row (not #tab-strip). It takes
        // only two callbacks — activate and close. There is no "new tab" button
        // in vertical mode; new tabs are opened via the keyboard shortcut.
        // void is used on closeTab because it returns a Promise and we do not
        // need to await it inside a synchronous renderer callback — errors are
        // handled internally by closeTab.
        this.renderer = new VerticalTabStrip(
          (id) => this.activateTab(id),
          (id) => void this.closeTab(id),
          (fromId, ins) => this.reorderTab(fromId, ins),
        );
        break;
    }
  }

  // ── Tab operations ────────────────────────────────────────────────────────────

  /**
   * Opens a new empty (untitled) document in a new tab and activates it.
   *
   * Saves the current tab's state first so the user does not lose their
   * cursor position when they return.
   */
  openNewTab(): void {
    this._captureActiveTab();

    const newTab = this._createUntitledTab();
    this.tabs.push(newTab);
    this._sortPinnedTabsToFront();
    this.activeIndex = this.tabs.findIndex((t) => t.id === newTab.id);

    this._applyActiveTab();
    this._notifyRenderer();

    // Persist asynchronously; we do not need to await the result here.
    // Errors are logged inside saveSession / updateSettings.
    void this.saveSession();
  }

  /**
   * Opens a file in a new tab, or activates the existing tab if the file is
   * already open (EC-4 duplicate-path guard).
   *
   * @param filePath  Absolute path to the Markdown file to open.
   * @returns  true if a new tab was created; false if an existing tab was activated.
   */
  async openFileInTab(filePath: string): Promise<boolean> {
    // Duplicate-path guard (EC-4): if the file is already open in any tab,
    // activate that tab rather than opening a second copy. This prevents the
    // user from accidentally having two conflicting edits of the same file.
    const existingIdx = this.tabs.findIndex((t) => t.filePath === filePath);
    if (existingIdx !== -1) {
      this._captureActiveTab();
      this.activeIndex = existingIdx;
      this._applyActiveTab();
      this._notifyRenderer();
      return false;
    }

    // Read the file from disk. On failure, alert the user and abort.
    const result = await readFile(filePath);
    if (!result.ok) {
      alert(`Could not open file: ${result.error.message}`);
      return false;
    }

    this._captureActiveTab();

    const newTab: TabEntry = {
      id: crypto.randomUUID(),
      kind: "editor",
      filePath,
      title: this._titleFromPath(filePath),
      isDirty: false,
      doc: result.value,
      scrollTop: 0,
    };

    this.tabs.push(newTab);
    this._sortPinnedTabsToFront();
    this.activeIndex = this.tabs.findIndex((t) => t.id === newTab.id);

    this._applyActiveTab(); // enters view mode via the combined dispatch

    this._notifyRenderer();

    // Record in the "Open Recent" list and persist the session.
    void addRecentFile(filePath);
    void this.saveSession();

    // Auto-close a clean Untitled tab that was the only other tab before this
    // file opened (file-browser-first experience). Only close it when:
    //   1. Exactly two tabs now exist (the new file + the Untitled).
    //   2. The non-active tab has no filePath (is Untitled) and is not dirty.
    if (this.tabs.length === 2) {
      const otherIdx = this.tabs.findIndex((t) => t.id !== newTab.id);
      const other = otherIdx !== -1 ? this.tabs[otherIdx] : null;
      if (other && other.filePath === null && !other.isDirty) {
        this.tabs.splice(otherIdx, 1);
        // Recalculate active index after the splice.
        this.activeIndex = this.tabs.findIndex((t) => t.id === newTab.id);
        this._notifyRenderer();
        void this.saveSession();
      }
    }

    return true;
  }

  /**
   * Opens a synthetic (non-file) content tab — used for bundled help documents.
   *
   * Unlike openFileInTab(), this method does NOT read from disk: the content is
   * provided by the caller (typically main.ts after readResourceFile()). The tab
   * has no filePath so it is treated as transient — it is never included in the
   * session restore list (FR-6.3) and is excluded from saveSession().
   *
   * If opts.readOnly is true, an `editableCompartment.reconfigure` effect is
   * dispatched after setState() to prevent the user from typing in the tab.
   * This matches the behaviour of the legacy openHelpFile() function which used
   * editableCompartment to lock the editor (step_07 spec).
   *
   * @param title    Display title shown in the tab label and title bar.
   * @param content  The text content to load into the new tab.
   * @param opts     Optional flags: { readOnly?: boolean }
   */
  openContentTab(title: string, content: string, opts?: { readOnly?: boolean }): void {
    // Capture the current tab before switching so its state is preserved.
    this._captureActiveTab();

    const tab: TabEntry = {
      id: crypto.randomUUID(),
      kind: "editor",
      filePath: null,          // Content tabs are not backed by a file path.
      title,
      isDirty: false,
      doc: content,
      scrollTop: 0,
    };

    this.tabs.push(tab);
    this.activeIndex = this.tabs.length - 1;

    this._applyActiveTab();

    // Lock the editor if readOnly is requested.
    if (opts?.readOnly && this.editorView) {
      this.editorView.dispatch({
        effects: editableCompartment.reconfigure(EditorView.editable.of(false)),
      });
    }

    this._notifyRenderer();
    // Do NOT call saveSession() here — content tabs have no filePath and should
    // not appear in the persisted session list (FR-6.3).
  }

  /**
   * Opens a non-text asset (image, PDF, etc.) in a new media tab.
   *
   * Unlike openFileInTab(), this method does NOT read file contents from disk —
   * the file is rendered directly in #media-viewer via an asset:// URL. This
   * prevents the InvalidData error that fs::read_to_string raises on binary files.
   *
   * This function cannot be split below ~56 lines because its operations form a
   * single atomic state transition: duplicate check → capture current tab → build
   * the new tab record → push it → guard for the pre-init case → call
   * _applyActiveTab → notify renderer → persist session → auto-close the stale
   * Untitled tab. Every step depends on in-flight local variables (newTab,
   * existingIdx) and on the array being in a consistent state throughout. Splitting
   * the auto-close block into a helper would require passing at least three
   * arguments that are already available as locals here, making the call site less
   * readable than the inline code.
   *
   * @param filePath  Absolute path to the media file.
   * @returns  true if a new tab was created; false if an existing media tab
   *           for the same path was activated (duplicate guard).
   */
  openMediaInTab(filePath: string): boolean {
    // Duplicate guard: activate existing media tab for this path rather than
    // opening a second copy (EC-01 / requirements FR-3 step 1).
    const existingIdx = this.tabs.findIndex(
      (t) => t.kind === "media" && t.filePath === filePath,
    );
    if (existingIdx !== -1) {
      this._captureActiveTab();
      this.activeIndex = existingIdx;
      this._applyActiveTab();
      this._notifyRenderer();
      return false;
    }

    this._captureActiveTab();

    const newTab: TabEntry = {
      id: crypto.randomUUID(),
      kind: "media",
      filePath,
      title: this._basenameFromPath(filePath),
      isDirty: false,
      doc: "",
      scrollTop: 0,
    };

    this.tabs.push(newTab);
    this.activeIndex = this.tabs.length - 1;

    // Guard for EC-10: called before init() completes (editorContainer is null).
    // Push the tab into the array so it exists, but defer _applyActiveTab until
    // init() calls it at the end of its own sequence.
    if (this.editorContainer !== null) {
      this._applyActiveTab();
    }

    this._notifyRenderer();

    void addRecentFile(filePath);
    void this.saveSession();

    // Auto-close a clean Untitled editor tab when it was the only other tab
    // (matches the same behaviour in openFileInTab).
    if (this.tabs.length === 2) {
      const otherIdx = this.tabs.findIndex((t) => t.id !== newTab.id);
      const other = otherIdx !== -1 ? this.tabs[otherIdx] : null;
      if (other && other.kind === "editor" && other.filePath === null && !other.isDirty) {
        this.tabs.splice(otherIdx, 1);
        this.activeIndex = this.tabs.findIndex((t) => t.id === newTab.id);
        this._notifyRenderer();
        void this.saveSession();
      }
    }

    return true;
  }

  /**
   * Open a custom render tab with the given title and render function.
   *
   * If a custom tab with the same title already exists it is replaced in-place
   * (same array index, new renderFn) — prevents duplicate render tabs (DC-07).
   *
   * Clears #custom-tab-host, calls renderFn(hostEl), and activates the tab.
   * If renderFn throws, a fallback error message is shown in #custom-tab-host
   * and the tab remains active (EC-15).
   *
   * EC-25: if #custom-tab-host is absent from the DOM, logs a console error
   * and returns without opening a tab.
   *
   * @param title     Display title shown in the tab strip.
   * @param renderFn  Callback that populates the host element with HTML.
   */
  openCustomRenderTab(title: string, renderFn: (container: HTMLElement) => void): void {
    // EC-25: always use a live getElementById lookup so that test cases that
    // remove the element after init() is called are handled correctly. The
    // stored reference is only used as a fast path when the element exists.
    const hostEl = document.getElementById("custom-tab-host") ?? this.customTabHostEl;
    if (!hostEl || !hostEl.isConnected) {
      console.error("TabManager.openCustomRenderTab: #custom-tab-host not in DOM.");
      return;
    }

    this._captureActiveTab();

    // DC-07: replace an existing custom tab with the same title in-place so the
    // tab strip does not accumulate duplicate entries for the same layout.
    const existingIdx = this.tabs.findIndex(
      (t) => t.kind === "custom" && t.title === title
    );

    if (existingIdx !== -1) {
      // Update the renderFn in-place and activate the existing slot.
      this.tabs[existingIdx].renderFn = renderFn;
      this.activeIndex = existingIdx;
    } else {
      const tab: import("./tab-types").TabEntry = {
        id: crypto.randomUUID(),
        kind: "custom",
        filePath: null,
        title,
        isDirty: false,
        doc: "",
        scrollTop: 0,
        renderFn,
      };
      this.tabs.push(tab);
      this.activeIndex = this.tabs.length - 1;
    }

    // Clear the host and invoke the render function.
    hostEl.innerHTML = "";
    try {
      renderFn(hostEl);
    } catch (err) {
      // EC-15: renderFn errors produce a visible fallback rather than a silent crash.
      const msg = err instanceof Error ? err.message : String(err);
      hostEl.innerHTML = `<div class="layout-error">Render error: ${msg}</div>`;
    }

    // Show the custom tab host and hide the editor via body class.
    document.body.classList.add("has-custom-tab");
    this._updateTitleBar(this.tabs[this.activeIndex]);
    this._notifyRenderer();
    void this.saveSession();
  }

  /**
   * Closes the tab identified by id.
   *
   * Special cases:
   *   - Last tab + dirty → confirm dialog; on cancel do nothing (EC-3).
   *   - Last tab + clean → close the window (EC-2).
   *   - Non-last tab + dirty → confirm dialog; on cancel do nothing.
   *   - Non-last tab + clean → remove tab; recalculate active index.
   *
   * activeIndex recalculation rules (FR-5.2):
   *   - Closing a tab left of the active tab: decrement activeIndex by 1.
   *   - Closing the active tab: clamp activeIndex to the new array length.
   *   - Closing a tab right of the active tab: activeIndex unchanged.
   *
   * @param id  The TabEntry.id of the tab to close.
   */
  async closeTab(id: string): Promise<void> {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return; // Unknown id — silent no-op.

    const tab = this.tabs[idx];

    // Auto-unpin before closing so the pin state does not block the close.
    if (tab.pinned) tab.pinned = false;

    if (this.tabs.length === 1) {
      // This is the last tab.
      // Media and custom tabs are never dirty — skip the confirm dialog for them (FR-7).
      if (tab.isDirty && tab.kind !== "media" && tab.kind !== "custom") {
        const confirmed = confirm(
          `"${tab.title}" has unsaved changes. Close without saving?`
        );
        if (!confirmed) return;
      }
      // When a vault is active, stay open at 0 tabs — the file browser leads.
      // When no vault is configured, closing the last tab closes the window.
      const hasActiveVault = this._settingsHaveActiveVault();
      if (hasActiveVault) {
        this.tabs = [];
        this.activeIndex = -1;
        this._applyActiveTab();
        this._notifyRenderer();
        void this.saveSession();
        return;
      }
      // Remove the tab from in-memory state before closing the window so that
      // if the window-close event triggers saveSession() it writes empty state.
      this.tabs = [];
      const appWindow = getCurrentWebviewWindow();
      await appWindow.close();
      return;
    }

    // Multiple tabs remain — closing this tab does not exit the app.
    // Media and custom tabs are never dirty — skip the confirm dialog for them (FR-7).
    if (tab.isDirty && tab.kind !== "media" && tab.kind !== "custom") {
      const confirmed = confirm(
        `"${tab.title}" has unsaved changes. Close without saving?`
      );
      if (!confirmed) return;
    }

    // Capture the current active tab's state before mutating the array.
    // This is a no-op if we are closing the active tab itself, but it is
    // correct to call it unconditionally in case we are closing a background tab.
    this._captureActiveTab();

    this.tabs.splice(idx, 1);

    // Recalculate activeIndex after the splice (FR-5.2).
    if (idx < this.activeIndex) {
      // A tab to the left was removed; the active tab shifted one position left.
      this.activeIndex -= 1;
    } else if (idx === this.activeIndex) {
      // The active tab was closed; activate the nearest remaining tab.
      // Math.min clamps to the last tab when we removed the last element.
      this.activeIndex = Math.min(this.activeIndex, this.tabs.length - 1);
    }
    // If idx > this.activeIndex, the active tab did not move — no adjustment needed.

    this._applyActiveTab();
    this._notifyRenderer();

    // Notify the Command Bar plugin (EC-12 in command-bar/00_index.md) so it
    // can close defensively if a tab closes while the palette is open.
    document.dispatchEvent(new CustomEvent("markable-tab-closed"));

    void this.saveSession();
  }

  /**
   * Closes all tabs except the one with the given id.
   *
   * Each dirty "other" tab receives its own confirm dialog. Cancelling one
   * does not prevent the remaining tabs from being evaluated.
   * After the loop, the right-clicked tab is activated and the session saved.
   *
   * Implementation note: `getTabs()` returns a shallow copy so the iteration
   * is not affected by splices to `this.tabs` during the loop. The array
   * element's current index must be re-looked-up on each iteration for the
   * same reason.
   *
   * @param id  The TabEntry.id of the tab to keep open.
   */
  async closeOtherTabs(id: string): Promise<void> {
    // Build the list of tabs to attempt closing (all except the target and any pinned tabs).
    // getTabs() returns a shallow copy so the array can be safely mutated below.
    const others = this.getTabs().filter((t) => t.id !== id && !t.pinned);

    for (const tab of others) {
      // Media and custom tabs are never dirty — skip the confirm dialog for them.
      if (tab.isDirty && tab.kind !== "media" && tab.kind !== "custom") {
        const confirmed = confirm(
          `"${tab.title}" has unsaved changes. Close without saving?`
        );
        if (!confirmed) continue; // Skip this tab; continue evaluating the rest.
      }

      // Re-look-up the current index after previous iterations may have shifted
      // the array. If the tab was already removed (should not happen), skip it.
      const idx = this.tabs.findIndex((t) => t.id === tab.id);
      if (idx === -1) continue;

      this.tabs.splice(idx, 1);

      // Keep activeIndex consistent with the same rules used in closeTab().
      if (idx < this.activeIndex) {
        // A tab to the left of the active one was removed — shift index left.
        this.activeIndex -= 1;
      } else if (idx === this.activeIndex) {
        // The active tab was removed — clamp to the nearest remaining tab.
        this.activeIndex = Math.min(this.activeIndex, this.tabs.length - 1);
      }
      // If idx > this.activeIndex the active tab position is unchanged.
    }

    // Find the target tab's current (post-splice) index. All splices above may
    // have shifted the array, so we must re-locate the target by id rather than
    // using a cached index.
    const targetIdx = this.tabs.findIndex((t) => t.id === id);
    if (targetIdx !== -1) {
      this.activeIndex = targetIdx;
    }

    // Capture editor state into the now-active tab and apply it to the view.
    // We do NOT delegate through activateTab() here because activateTab() has an
    // early-return guard (`if (idx === this.activeIndex) return`) that short-circuits
    // when the target was already active before the splice loop — the common case when
    // the user right-clicks the active tab and chooses "Close Other Tabs". In that
    // scenario activateTab() would return without calling _notifyRenderer() or
    // _applyActiveTab(), leaving all three tab-bar renderers displaying stale DOM.
    // By driving the three-step sequence directly we guarantee notification always fires.
    this._captureActiveTab();
    this._applyActiveTab();
    this._notifyRenderer();

    // Persist the session exactly once after all removals.
    void this.saveSession();
  }

  /**
   * Closes all open tabs.
   *
   * Dirty tabs each receive their own confirm dialog. Cancelling one does not
   * prevent others from being evaluated. The last-tab side effects (vault-stay
   * vs window-close) are applied once after all removals, not per-iteration.
   *
   * Why NOT a closeTab() loop: closeTab() checks `this.tabs.length === 1` on
   * every call and fires the last-tab window/vault branch when only one tab
   * remains. In a loop that starts with N tabs, iteration N-1 would trigger
   * that branch early and call window.close() or saveSession() prematurely.
   *
   * Safe pattern: snapshot → collect confirmed IDs → apply all removals once
   * → execute last-tab branch exactly once.
   */
  async closeAllTabs(): Promise<void> {
    if (this.tabs.length === 0) return;

    // Step 1: Snapshot prevents "mutation during iteration" hazards.
    const snapshot = [...this.tabs];

    // Step 2: Collect the IDs the user confirmed closing (pinned tabs are always skipped).
    const confirmedIds = new Set<string>();
    for (const tab of snapshot) {
      // Pinned tabs survive batch-close operations.
      if (tab.pinned) continue;
      // Media and custom tabs are never dirty — close without dialog.
      if (tab.isDirty && tab.kind !== "media" && tab.kind !== "custom") {
        const confirmed = confirm(
          `"${tab.title}" has unsaved changes. Close without saving?`
        );
        if (confirmed) {
          confirmedIds.add(tab.id);
        }
        // If not confirmed, the tab is implicitly kept (not added to confirmedIds).
      } else {
        // Clean tabs always close without dialog.
        confirmedIds.add(tab.id);
      }
    }

    // Step 3: Apply all removals in one pass.
    // Filtering instead of splicing avoids off-by-one problems with multiple
    // simultaneous removes.
    this.tabs = this.tabs.filter((t) => !confirmedIds.has(t.id));

    // Step 4: Post-removal state handling.
    if (this.tabs.length > 0) {
      // Some dirty tabs were cancelled — they survive. Clamp activeIndex to
      // the valid range and notify the renderer of the new state.
      this.activeIndex = Math.max(
        0,
        Math.min(this.activeIndex, this.tabs.length - 1)
      );
      this._captureActiveTab();
      this._applyActiveTab();
      this._notifyRenderer();
      void this.saveSession();
      return;
    }

    // All tabs were closed (every confirm was accepted, or no dirty tabs existed).
    this.activeIndex = -1;

    const hasActiveVault = this._settingsHaveActiveVault();
    if (hasActiveVault) {
      // Vault active: stay open at 0 tabs. The file browser leads the next action.
      this._applyActiveTab();
      this._notifyRenderer();
      void this.saveSession();
      return;
    }

    // No vault: close the app window.
    // Clear state before closing so any saveSession() triggered by the window-close
    // event (if any) writes empty state.
    const appWindow = getCurrentWebviewWindow();
    await appWindow.close();
  }

  /**
   * Activates the tab with the given id.
   *
   * Captures the current tab's state first (scroll position, editor state)
   * so it can be restored correctly when the user returns.
   *
   * No-op if the id is not found or if the given tab is already active.
   *
   * @param id  The TabEntry.id of the tab to activate.
   */
  activateTab(id: string): void {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    if (idx === this.activeIndex) return; // Already active.

    this._captureActiveTab();
    this.activeIndex = idx;
    this._applyActiveTab();
    this._notifyRenderer();
    void this.saveSession();
  }

  /**
   * Pins the tab with the given id.
   *
   * Pinned tabs sort to the front of the tab list (preserving relative order
   * within each group) and are immune to closeOtherTabs() and closeAllTabs().
   * No-op when the id is not found or the tab is already pinned.
   */
  pinTab(id: string): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab || tab.pinned) return;
    tab.pinned = true;
    this._sortPinnedTabsToFront();
    this._notifyRenderer();
    void this.saveSession();
  }

  /**
   * Unpins the tab with the given id.
   *
   * The tab stays in its current position — unpinning does not reorder.
   * No-op when the id is not found or the tab is not pinned.
   */
  unpinTab(id: string): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab || !tab.pinned) return;
    tab.pinned = false;
    this._notifyRenderer();
    void this.saveSession();
  }

  /**
   * Stably partitions this.tabs so all pinned tabs come before non-pinned tabs,
   * preserving relative order within each group.
   *
   * Recalculates this.activeIndex so the currently active tab does not change
   * after the reorder.
   */
  private _sortPinnedTabsToFront(): void {
    const activeId = this.tabs[this.activeIndex]?.id;
    const pinned   = this.tabs.filter((t) => t.pinned);
    const unpinned = this.tabs.filter((t) => !t.pinned);
    this.tabs = [...pinned, ...unpinned];
    if (activeId) {
      const newIdx = this.tabs.findIndex((t) => t.id === activeId);
      if (newIdx !== -1) this.activeIndex = newIdx;
    }
  }

  /**
   * Activates a tab by one-based position, following the Cmd-1..9 convention.
   *
   * Cmd-9 always means "the last tab" regardless of how many tabs are open
   * (FR-5.3). Any other index >= 9 also maps to the last tab for safety.
   *
   * Out-of-range indices (e.g. Cmd-5 with only 3 tabs) are silent no-ops
   * (EC-8) to match standard browser and editor tab navigation behavior.
   *
   * @param oneBased  1-based tab position. 1 = leftmost, 9 = last tab.
   */
  /**
   * Moves the tab identified by fromId, inserting it before the tab identified
   * by insertBeforeId. Pass null to append it at the end of the tab list.
   *
   * The active tab follows its id across the reorder: if the active tab is
   * moved, it remains active; if a non-active tab is moved, the active index
   * is recalculated to point at the same tab as before.
   *
   * @param fromId        ID of the tab being moved.
   * @param insertBeforeId  ID of the tab to insert before, or null to append.
   */
  reorderTab(fromId: string, insertBeforeId: string | null): void {
    const fromIdx = this.tabs.findIndex((t) => t.id === fromId);
    if (fromIdx === -1) return;
    if (fromId === insertBeforeId) return;

    const activeId = this.tabs[this.activeIndex]?.id;
    const [moved] = this.tabs.splice(fromIdx, 1);

    if (insertBeforeId === null) {
      this.tabs.push(moved);
    } else {
      // Re-locate insertBeforeId in the now-shorter array (index may have shifted).
      const insertAt = this.tabs.findIndex((t) => t.id === insertBeforeId);
      if (insertAt === -1) {
        this.tabs.push(moved);
      } else {
        this.tabs.splice(insertAt, 0, moved);
      }
    }

    if (activeId) {
      const newIdx = this.tabs.findIndex((t) => t.id === activeId);
      if (newIdx !== -1) this.activeIndex = newIdx;
    }

    this._notifyRenderer();
    void this.saveSession();
  }

  /** Activates the tab to the left of the active one, wrapping around. */
  activatePrevTab(): void {
    if (this.tabs.length < 2) return;
    const idx = (this.activeIndex - 1 + this.tabs.length) % this.tabs.length;
    this.activateTab(this.tabs[idx].id);
  }

  /** Activates the tab to the right of the active one, wrapping around. */
  activateNextTab(): void {
    if (this.tabs.length < 2) return;
    const idx = (this.activeIndex + 1) % this.tabs.length;
    this.activateTab(this.tabs[idx].id);
  }

  activateTabByIndex(oneBased: number): void {
    if (this.tabs.length === 0) return;

    // Cmd-9 convention: "9 or more" always means the last tab (FR-5.3, EC-9).
    const idx = oneBased >= 9 ? this.tabs.length - 1 : oneBased - 1;

    // EC-8: out of range → no-op.
    if (idx < 0 || idx >= this.tabs.length) return;

    this.activateTab(this.tabs[idx].id);
  }

  /**
   * Update the filePath and title of any open tab that matches `oldPath`.
   *
   * Called after a successful file or directory rename so that in-memory tab
   * state stays consistent with the on-disk path. The tab's dirty state is
   * intentionally preserved — a dirty tab's content is canonical until the
   * user saves, and the next Cmd-S will write to the new path (EC-6).
   *
   * For directory renames the caller must invoke this method once per affected
   * tab (i.e. each tab whose filePath started with the old directory prefix).
   *
   * @param oldPath  Absolute path before the rename.
   * @param newPath  Absolute path after the rename.
   */
  handleFileRename(oldPath: string, newPath: string): void {
    // Mutate this.tabs directly (not the copy from getTabs()) because we need
    // in-place updates to the live tab records (spec: implementation note 2).
    for (const tab of this.tabs) {
      if (tab.filePath !== oldPath) continue;

      // Update the tab's canonical path and derived display title.
      tab.filePath = newPath;
      tab.title = this._titleFromPath(newPath);

      // When this tab is also the currently active tab, sync the globals that
      // downstream plugins (live-preview, image-toolbar, etc.) rely on.
      if (this.tabs[this.activeIndex]?.id === tab.id) {
        setLivePreviewFilePath(newPath);
        (window as unknown as Record<string, unknown>)["__MARKABLE_CURRENT_FILE__"] = newPath;
        this._updateTitleBar(tab);
      }
    }

    // Notify the renderer so the tab strip reflects the new title.
    this._notifyRenderer();

    // Persist session asynchronously — fire-and-forget (same pattern as other
    // mutating operations throughout this class).
    void this.saveSession();
  }

  /**
   * Close the tab for the given file path, handling the unsaved-changes dialog
   * internally via the existing `closeTab` flow.
   *
   * Returns `true` when the tab was successfully closed (or was never open),
   * meaning the caller may proceed with deleting the file.
   * Returns `false` when the user declined the unsaved-changes prompt, meaning
   * the delete must be aborted.
   *
   * EC-20: if two async operations race to close the same tab, the second call
   * finds no tab and returns `true` — correct, safe no-op.
   *
   * @param path  Absolute path of the file whose tab should be closed.
   * @returns     true = proceed with delete; false = abort.
   */
  async closeFileByPath(path: string): Promise<boolean> {
    // Locate the tab by file path.
    const tab = this.tabs.find((t) => t.filePath === path);

    // EC-20: nothing to close → caller may proceed.
    if (!tab) return true;

    // Store the id before the async close so we can check whether it survived.
    const tabId = tab.id;

    // Delegate to closeTab which handles the unsaved-changes confirm dialog.
    await this.closeTab(tabId);

    // If the tab is still in the array the user cancelled the confirm dialog.
    const stillOpen = this.tabs.some((t) => t.id === tabId);
    return !stillOpen;
  }

  // ── Save operations ──────────────────────────────────────────────────────────

  /**
   * Saves the active document to its current filePath.
   *
   * If the tab is untitled (filePath === null), delegates to saveActiveTabAs()
   * to prompt the user for a save location.
   *
   * Media tabs are never text documents — saving them would overwrite binary
   * file contents with stale editor state (data corruption). The early-return
   * guard prevents this without surfacing an error to the user; Cmd-S on a
   * media tab is intentionally silent.
   */
  async saveActiveTab(): Promise<void> {
    const tab = this.getActiveTab();
    if (!tab || tab.kind === "media" || tab.kind === "custom") return;

    if (tab.filePath === null) {
      const resolver = (window as unknown as Record<string, unknown>)["__MARKABLE_AUTO_TITLE__"] as
        | { resolveTargetPath(doc: string): Promise<string | null>; getFilenameStyle?(): string }
        | undefined;

      if (resolver) {
        const content = this.editorView!.state.doc.toString();
        const targetPath = await resolver.resolveTargetPath(content);
        if (targetPath !== null) {
          const result = await writeFile(targetPath, content);
          if (!result.ok) { alert(`Could not save file: ${result.error.message}`); return; }
          tab.filePath = targetPath;
          tab.title = this._titleFromPath(targetPath);
          tab.isDirty = false;
          this._updateTitleBar(tab);
          this._notifyRenderer();
          void addRecentFile(targetPath);
          setLivePreviewFilePath(targetPath);
          (window as unknown as Record<string, unknown>)["__MARKABLE_CURRENT_FILE__"] = targetPath;
          void this.saveSession();
          void (window as any).__MARKABLE_VAULT_MANAGER__?.reloadVaultIndex?.();
          return;
        }
      }
      const fallbackDoc = this.editorView!.state.doc.toString();
      const h1 = extractH1(fallbackDoc);
      const filenameStyle = (resolver?.getFilenameStyle?.() ?? "spaces") as "spaces" | "camel" | "kebab";
      const suggested = h1 ? h1ToFilename(h1, filenameStyle) + ".md" : undefined;
      await this.saveActiveTabAs(suggested);
      return;
    }

    const content = this.editorView!.state.doc.toString();
    const result = await writeFile(tab.filePath, content);

    if (!result.ok) {
      alert(`Could not save file: ${result.error.message}`);
      return;
    }

    tab.isDirty = false;
    this._updateTitleBar(tab);
    this._notifyRenderer();

    void addRecentFile(tab.filePath);
    void this.saveSession();
  }

  /**
   * Saves the active document to a user-chosen location via the system dialog.
   *
   * If the dialog is cancelled (EC-12), the method returns without side effects.
   * On success, the tab's filePath and title are updated to reflect the new path.
   *
   * Media tabs are never text documents — running "Save As" on one would write
   * binary file content to an arbitrary path using the stale editor buffer.
   * The early-return guard makes this a silent no-op for media tabs, which
   * matches the same protection applied in saveActiveTab().
   */
  async saveActiveTabAs(suggestedFilename?: string): Promise<void> {
    const tab = this.getActiveTab();
    if (!tab || tab.kind === "media" || tab.kind === "custom") return;

    const dialogResult = await saveFileDialog(suggestedFilename);
    if (dialogResult.cancelled) return; // User cancelled (EC-12).

    const path = dialogResult.path;
    const content = this.editorView!.state.doc.toString();
    const result = await writeFile(path, content);

    if (!result.ok) {
      alert(`Could not save file: ${result.error.message}`);
      return;
    }

    tab.filePath = path;
    tab.title = this._titleFromPath(path);
    tab.isDirty = false;

    this._updateTitleBar(tab);
    this._notifyRenderer();

    void addRecentFile(path);
    setLivePreviewFilePath(path);
    // AD-6: keep __MARKABLE_CURRENT_FILE__ in sync after Save As.
    (window as unknown as Record<string, unknown>)["__MARKABLE_CURRENT_FILE__"] = path;
    void this.saveSession();
  }

  // ── Dirty state ──────────────────────────────────────────────────────────────

  /**
   * Marks the active tab as having unsaved changes.
   *
   * Idempotent: calling this method on an already-dirty tab is a no-op (FR-7).
   * This allows callers (e.g. the CM6 onChange listener) to call it on every
   * keystroke without triggering unnecessary title-bar updates or renderer calls.
   *
   * Media tabs can never be dirty — they have no editable text content and their
   * binary file is never written by TabManager. The kind guard keeps isDirty
   * permanently false on media tabs, which is the contract the rest of the close
   * and save paths rely on (FR-7 / M-1).
   */
  markActiveTabDirty(): void {
    const tab = this.getActiveTab();
    if (!tab || tab.isDirty || tab.kind === "media" || tab.kind === "custom") return; // Idempotency and media/custom guard (FR-7 / M-1).
    tab.isDirty = true;
    this._updateTitleBar(tab);
    this._notifyRenderer();
  }

  /**
   * Marks the active tab as clean (no unsaved changes).
   *
   * Idempotent: calling this method on an already-clean tab is a no-op.
   */
  markActiveTabClean(): void {
    const tab = this.getActiveTab();
    if (!tab || !tab.isDirty) return; // Idempotency guard.
    tab.isDirty = false;
    this._updateTitleBar(tab);
    this._notifyRenderer();
  }

  // ── Mode switching ────────────────────────────────────────────────────────────

  /**
   * Switches the tab display mode and swaps the renderer.
   *
   * Mode switching is an immediate, synchronous operation on the renderer
   * side (no animation) to avoid a race condition where the user could
   * interact with a half-torn-down renderer (EC-11).
   *
   * toggleSide() for the vertical mode sidebar interaction is a no-op when
   * called before SidebarManager.init() because the slot element will not
   * yet exist (the SidebarManager guard handles this gracefully).
   *
   * @param mode  The new tab display mode.
   */
  setMode(mode: "minimal" | "regular" | "vertical"): void {
    if (mode === this.mode) return; // No-op: mode unchanged.

    // If leaving vertical mode, restore the left sidebar that was hidden
    // when vertical mode was entered (EC-10).
    //
    // toggleSide() is a pure DOM toggle — it reads el.style.display and flips
    // it. Calling it when the sidebar is already visible would hide it, which
    // is the wrong outcome. We therefore call it only when the sidebar is
    // currently hidden (i.e. display === "none" or the slot is absent from
    // the DOM). This matches the pattern documented in step_04 and
    // sidebar-manager.ts.
    if (this.mode === "vertical") {
      // Only restore if WE hid the sidebar when entering vertical mode.
      // If the user had the sidebar closed before entering vertical, or if they
      // manually reopened it during vertical mode, we leave it as-is (EC-10 /
      // EC-11: "do NOT auto-show the left sidebar when leaving vertical mode").
      if (this._hidSidebarForVertical) {
        const sidebarLeft = document.getElementById("sidebar-left");
        // Double-check: only call toggleSide if still hidden (user may have
        // reopened it while in vertical mode — respect that decision).
        if (sidebarLeft && sidebarLeft.style.display === "none") {
          toggleSide("left");
        }
        this._hidSidebarForVertical = false;
      }
    }

    this.mode = mode;

    // Persist mode change asynchronously.
    void updateSettings((s) => ({ ...s, tabMode: mode }));

    if (mode === "vertical") {
      // Hide the left sidebar to make room for the vertical strip. Track
      // whether WE did the hiding so the exit path can undo it correctly
      // (EC-10 / EC-11). toggleSide is a pure toggle; only call it when the
      // sidebar is currently visible to avoid a double-toggle.
      const sidebarLeft = document.getElementById("sidebar-left");
      if (sidebarLeft && sidebarLeft.style.display !== "none") {
        toggleSide("left");
        this._hidSidebarForVertical = true;
      } else {
        this._hidSidebarForVertical = false;
      }
    }

    // Instantiate the renderer for the new mode and mount it into the container.
    // _instantiateRenderer() tears down the previous renderer internally so
    // we do not need a separate destroy() call here.
    this._instantiateRenderer();
    if (this.renderer && this.tabStripEl) {
      this.renderer.mount(this.tabStripEl, this.tabs, this.activeIndex);
    }

    this._notifyRenderer();
  }

  // ── Session ──────────────────────────────────────────────────────────────────

  /**
   * Serialises the current session to MarkableSettings and persists to disk.
   *
   * Only tabs that have a filePath are saved — untitled tabs are transient
   * and cannot be reopened by path anyway (FR-6.2, FR-6.3).
   *
   * saveSession() is called fire-and-forget from all mutating operations.
   * If the settings write fails, the error is logged by updateSettings() and
   * the next successful save will overwrite it — no data is permanently lost
   * because the files themselves are already on disk.
   */
  async saveSession(): Promise<void> {
    // Capture the active tab's current scroll position before serialising.
    // scrollTop is normally updated by _captureActiveTab() on tab-switch, but
    // if the user never switched tabs the stored value is stale (FR-6.2 / M-3).
    // The kind check is required: media tabs have no CM6 scroll state —
    // writing editorView.scrollDOM.scrollTop to a media tab would store a
    // value from a previously displayed editor document (H-1).
    if (this.editorView && this.tabs.length > 0) {
      const activeTab = this.tabs[this.activeIndex];
      if (activeTab.kind === "editor") {
        activeTab.scrollTop = this.editorView.scrollDOM.scrollTop;
      }
    }

    const openFiles = this.tabs
      .filter((t) => t.kind === "editor" && t.filePath !== null)
      .map((t) => ({
        filePath: t.filePath!,
        scrollTop: t.scrollTop,
        ...(t.pinned ? { pinned: true as const } : {}),
      }));

    await updateSettings((s) => ({
      ...s,
      openFiles,
      activeTabIndex: this.activeIndex,
    }));
  }

  // ── Accessors ─────────────────────────────────────────────────────────────────

  /**
   * Returns the currently active TabEntry, or null if no tabs are open.
   *
   * The no-tabs case should not occur in normal operation because init()
   * always ensures at least one tab exists. The null return satisfies the
   * type system and guards against the period between construction and init().
   */
  getActiveTab(): TabEntry | null {
    return this.tabs[this.activeIndex] ?? null;
  }

  /**
   * Returns the filePath of the active tab, or null for untitled tabs.
   * Convenience wrapper used by main.ts for compatibility with single-doc code.
   */
  getActiveFilePath(): string | null {
    return this.getActiveTab()?.filePath ?? null;
  }

  /**
   * Returns a shallow copy of the current tabs array.
   *
   * Each call returns a new array — callers may iterate or store it freely
   * without risk of the array shrinking under them (e.g. during a close-all
   * loop). The TabEntry objects themselves are shared references; do not
   * mutate their properties directly.
   */
  getTabs(): TabEntry[] {
    return [...this.tabs];
  }

  /** Returns the number of currently open tabs. */
  getTabCount(): number {
    return this.tabs.length;
  }
}

// ── Module-level singleton ─────────────────────────────────────────────────────

/**
 * The application-wide TabManager instance.
 *
 * Imported by main.ts and (in later steps) by renderer files. Exported both
 * as a named export and re-exported from src/tabs/index.ts for a clean facade.
 *
 * Invariant: only one instance is ever created per process. The constructor
 * is exported only to enable isolated testing via `new TabManager()`.
 */
export const tabManager = new TabManager();

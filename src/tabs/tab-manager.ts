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
import { getCurrentSettings, updateSettings, addRecentFile } from "../lib/settings";
import { setLivePreviewFilePath, setViewMode } from "../editor/live-preview";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
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

    // Step 2: locate the permanent tab-strip container.
    // Its absence means index.html has not been updated (step_02 prerequisite).
    this.tabStripEl = document.getElementById("tab-strip");
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
        filePath: entry.filePath,
        title: this._titleFromPath(entry.filePath),
        isDirty: false,
        doc: result.value,
        scrollTop: entry.scrollTop,
      });
    }

    // Step 5 fallback: if no tabs were successfully restored, open an untitled
    // tab so the editor is never left empty (FR-6.5).
    if (this.tabs.length === 0) {
      this.tabs.push(this._createUntitledTab());
    }

    // Step 6: clamp the saved activeTabIndex to a valid range.
    // Out-of-range values (e.g. after removing files between sessions) default
    // to the last tab rather than crashing (FR-6.6).
    this.activeIndex = Math.max(0, Math.min(rawActiveIndex, this.tabs.length - 1));

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
   * Creates a fresh untitled TabEntry with an empty document.
   *
   * Used by openNewTab() and as the fallback in init() when session restore
   * produces zero tabs.
   *
   * @returns  A new TabEntry with a unique id, no filePath, and empty doc.
   */
  private _createUntitledTab(): TabEntry {
    return {
      id: crypto.randomUUID(),
      filePath: null,
      title: "Untitled",
      isDirty: false,
      doc: "",
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
   * This is called after:
   *   - init() completes
   *   - activateTab() switches to a different tab
   *   - openNewTab() or openFileInTab() adds a tab and activates it
   */
  private _applyActiveTab(): void {
    if (this.tabs.length === 0 || this.editorView === null) return;

    const tab = this.tabs[this.activeIndex];

    // Replace doc text in one transaction. For file-backed tabs, include
    // setViewMode.of(true) in the same transaction so the explicit effect
    // takes priority over the selection change — viewModeField checks
    // explicit effects first and short-circuits, preventing the selection
    // from exiting preview mode on open (the original pre-tabs behavior).
    // Untitled tabs start in edit mode so the user can type immediately.
    this.editorView.dispatch({
      changes: { from: 0, to: this.editorView.state.doc.length, insert: tab.doc },
      selection: { anchor: 0 },
      effects: tab.filePath !== null ? setViewMode.of(true) : undefined,
    });

    // Restore the scroll position the user was at when they last left this tab.
    this.editorView.scrollDOM.scrollTop = tab.scrollTop;

    // Inform the live-preview extension which file is now active so it can
    // resolve relative image paths correctly.
    setLivePreviewFilePath(tab.filePath);

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
    this.activeIndex = this.tabs.length - 1;

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
      filePath,
      title: this._titleFromPath(filePath),
      isDirty: false,
      doc: result.value,
      scrollTop: 0,
    };

    this.tabs.push(newTab);
    this.activeIndex = this.tabs.length - 1;

    this._applyActiveTab(); // enters view mode via the combined dispatch

    this._notifyRenderer();

    // Record in the "Open Recent" list and persist the session.
    void addRecentFile(filePath);
    void this.saveSession();

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

    if (this.tabs.length === 1) {
      // This is the last tab. Closing it ends the editing session.
      if (tab.isDirty) {
        const confirmed = confirm(
          `"${tab.title}" has unsaved changes. Close without saving?`
        );
        if (!confirmed) return;
      }
      // Remove the tab from in-memory state before closing the window so that
      // if the window-close event triggers saveSession() it writes empty state.
      this.tabs = [];
      const appWindow = getCurrentWebviewWindow();
      await appWindow.close();
      return;
    }

    // Multiple tabs remain — closing this tab does not exit the app.
    if (tab.isDirty) {
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
    void this.saveSession();
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

  // ── Save operations ──────────────────────────────────────────────────────────

  /**
   * Saves the active document to its current filePath.
   *
   * If the tab is untitled (filePath === null), delegates to saveActiveTabAs()
   * to prompt the user for a save location.
   */
  async saveActiveTab(): Promise<void> {
    const tab = this.getActiveTab();
    if (!tab) return;

    if (tab.filePath === null) {
      await this.saveActiveTabAs();
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
   */
  async saveActiveTabAs(): Promise<void> {
    const tab = this.getActiveTab();
    if (!tab) return;

    const dialogResult = await saveFileDialog();
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
    void this.saveSession();
  }

  // ── Dirty state ──────────────────────────────────────────────────────────────

  /**
   * Marks the active tab as having unsaved changes.
   *
   * Idempotent: calling this method on an already-dirty tab is a no-op (FR-7).
   * This allows callers (e.g. the CM6 onChange listener) to call it on every
   * keystroke without triggering unnecessary title-bar updates or renderer calls.
   */
  markActiveTabDirty(): void {
    const tab = this.getActiveTab();
    if (!tab || tab.isDirty) return; // Idempotency guard (FR-7).
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
    if (this.editorView && this.tabs.length > 0) {
      this.tabs[this.activeIndex].scrollTop =
        this.editorView.scrollDOM.scrollTop;
    }

    const openFiles = this.tabs
      .filter((t) => t.filePath !== null)
      .map((t) => ({ filePath: t.filePath!, scrollTop: t.scrollTop }));

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

/**
 * FindWidget — Floating find/replace panel for Markable 2.0.
 *
 * Implements a VS Code-style draggable overlay that replaces the CM6 built-in
 * search panel. The widget appends itself to document.body with position:fixed
 * so it floats above the editor without affecting layout.
 *
 * Architecture:
 *   - DOM construction: _buildDom() creates all elements and stores references.
 *   - CM6 integration: delegates to @codemirror/search commands (findNext,
 *     findPrevious, replaceNext, replaceAll, setSearchQuery).
 *   - Drag: native mousedown/mousemove/mouseup on document, with viewport
 *     clamping so the widget never leaves the visible area.
 *   - Persistence: position saved via updateSettings() after each drag-end;
 *     restored from getCurrentSettings() on open().
 *
 * See docs/specs/find-replace/00_index.md for full architecture decisions.
 */

import type { EditorView } from "@codemirror/view";
import {
  SearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
} from "@codemirror/search";
import { getCurrentSettings, updateSettings } from "../lib/settings";
import type { FindWidgetPosition } from "../lib/settings";
import "./find-widget.css";
import type { FindScope, PostFilterOptions } from "./vault-search-utils";
import { postFilterResults, applyStringReplace, escapeRegex } from "./vault-search-utils";
import { searchVaultContent, readFile, writeFile } from "../lib/bridge";
import type { ContentSearchPayload, FileContentResult, LineMatch } from "../lib/bridge";

// Re-export FindWidgetPosition so main.ts can import it from one place.
export type { FindWidgetPosition };

// ---------------------------------------------------------------------------
// FindWidget class
// ---------------------------------------------------------------------------

/**
 * Floating find/replace widget.
 *
 * Usage:
 *   const widget = createFindWidget(editorView);
 *   widget.open('find');      // open in find-only mode
 *   widget.open('replace');   // open with replace row visible
 *   widget.close();           // hide widget, return focus to editor
 *   widget.clearQuery();      // clear inputs + CM6 highlights (call after close on file load)
 *   widget.setPreFill(text);  // populate find input before calling open()
 */
export class FindWidget {
  /** The CM6 EditorView instance this widget operates on. */
  private view: EditorView;

  // ---- DOM element references (all set during _buildDom()) ----

  /** Root container element appended to document.body. */
  private root: HTMLDivElement;
  /** Main text input for the search term. */
  private findInput!: HTMLInputElement;
  /** Text input for the replacement string (in the replace row). */
  private replaceInput!: HTMLInputElement;
  /** Span showing "N of M" or "No results" or "Invalid". */
  private countLabel!: HTMLSpanElement;
  /** Toggle button: match case (Aa). */
  private toggleMatchCase!: HTMLButtonElement;
  /** Toggle button: whole word (ab). */
  private toggleWholeWord!: HTMLButtonElement;
  /** Toggle button: regular expression (.*). */
  private toggleRegexp!: HTMLButtonElement;
  /** Chevron button that shows/hides the replace row. */
  private chevronBtn!: HTMLButtonElement;
  /** The collapsible replace row. */
  private replaceRow!: HTMLDivElement;
  /** "Replace" button (replace current match). */
  private replaceOneBtn!: HTMLButtonElement;
  /** "All" button (replace all matches). */
  private replaceAllBtn!: HTMLButtonElement;
  /** Navigation buttons — store refs for click handlers. */
  private prevBtn!: HTMLButtonElement;
  private nextBtn!: HTMLButtonElement;
  /** Close × button. */
  private closeBtn!: HTMLButtonElement;

  // ---- Widget state fields ----

  /** Whether the widget is currently visible. */
  private _isOpen: boolean = false;
  /** Whether the replace row is expanded. */
  private _replaceVisible: boolean = false;

  // ---- Toggle state (mirrored into SearchQuery on every change) ----

  private _matchCase: boolean = false;
  private _wholeWord: boolean = false;
  private _regexp: boolean = false;

  // ---- Vault scope state ----

  /** Current find scope: "file", "vault", or "folder". */
  private _scope: FindScope = "file";

  /** Latest vault search results (null when no search has been run). */
  private _vaultResults: ContentSearchPayload | null = null;

  /**
   * The file path of the currently focused file group in the results panel.
   * null when no group is focused.
   */
  private _focusedFilePath: string | null = null;

  /**
   * The currently focused individual match (for single-match replace).
   * null when no individual match row is focused.
   */
  private _focusedMatch: { filePath: string; lineNumber: number; columnStart: number } | null = null;

  /** Timer handle for the 150 ms vault search debounce (NFR-2). */
  private _vaultDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Monotonically-increasing counter used to discard stale async search
   * results (EC-18). Incremented on every new search invocation. The async
   * callback compares its captured generation against the current value before
   * applying results to the DOM; if they differ the results are from a
   * superseded query and are discarded.
   */
  private _searchGeneration: number = 0;

  /** Index into the flat excerpt row list for keyboard navigation (-1 = none). */
  private _selectedExcerptIndex: number = -1;

  /**
   * After a single-match replace, holds the index to auto-select once results
   * re-render. Set in _replaceVaultMatch(); consumed and reset in
   * _renderVaultResults(). -1 means fall through to index 0.
   */
  private _pendingSelectAfterSearch: number = -1;

  /** True while the confirmation panel (FR-7) is visible. */
  private _confirmationVisible: boolean = false;

  /**
   * Guard: whether the vault-changed listener has been attached this session.
   * Prevents duplicate listeners when open() is called repeatedly.
   */
  private _vaultChangedAttached: boolean = false;

  /** Stored vault-changed callback reference for cleanup in destroy(). */
  private _vaultChangedCb: ((vault: unknown) => void) | null = null;

  /**
   * Stored markable-folder-selected callback reference for cleanup in destroy().
   *
   * Anonymous handlers cannot be removed by reference, so the bound function
   * must be stored here so destroy() can call removeEventListener with the
   * exact same reference (Issue 2 — memory-leak fix).
   */
  private _folderSelectedCb: (() => void) | null = null;

  // ---- Vault scope DOM element references (set in _buildDom) ----

  /** Row containing the scope toggle buttons (File / Vault / Folder). */
  private scopeRow!: HTMLDivElement;

  /** Scrollable panel containing grouped vault search results. */
  private vaultResultsPanel!: HTMLDivElement;

  /** Confirmation/progress panel for Replace All (FR-7). */
  private confirmationPanel!: HTMLDivElement;

  /**
   * Overlay span that visually disables the regexp toggle in vault scope
   * (FR-15, EC-9).
   */
  private regexpDisabledMsg!: HTMLSpanElement;

  /** "In File" replace button (vault scope only). */
  private replaceInFileBtn!: HTMLButtonElement;

  /** Scope toggle buttons stored individually for _updateScopeButtons(). */
  private _scopeBtnFile!: HTMLButtonElement;
  private _scopeBtnVault!: HTMLButtonElement;
  private _scopeBtnFolder!: HTMLButtonElement;

  // ---- Drag state fields ----

  /** True while the user is holding the drag handle. */
  private _isDragging: boolean = false;
  /** Mouse X offset from widget top-left at drag-start. */
  private _dragOffsetX: number = 0;
  /** Mouse Y offset from widget top-left at drag-start. */
  private _dragOffsetY: number = 0;

  // ---- Drag event handler references (stored so destroy() can remove them) ----

  /**
   * Bound mousemove handler. Stored as an instance property so the same
   * function reference can be passed to both addEventListener and
   * removeEventListener. Anonymous functions cannot be removed by reference.
   */
  private _onMouseMove!: (e: MouseEvent) => void;

  /**
   * Bound mouseup handler. Same rationale as _onMouseMove above.
   */
  private _onMouseUp!: () => void;

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  constructor(view: EditorView) {
    this.view = view;
    this.root = this._buildDom();
    document.body.appendChild(this.root);
    this._attachDrag();

    /*
     * Update the Folder scope option whenever the file-browser signals a
     * folder selection change (dispatched by buildActivateHandler in the
     * file-browser plugin). The pull model (getSelectedFolderPath) is used
     * at search time; this listener keeps the Folder toggle button visibility
     * in sync with the current browser state (EC-5, EC-15).
     *
     * The handler is stored as _folderSelectedCb so destroy() can remove it
     * by reference (prevents memory leak — Issue 2 fix).
     */
    this._folderSelectedCb = () => {
      if (this._isOpen && this._scope !== "file") {
        this._updateFolderScopeOption();
      }
    };
    window.addEventListener("markable-folder-selected", this._folderSelectedCb);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Open the widget.
   *
   * @param mode - 'find' shows only the find row; 'replace' also shows the
   *               replace row.
   *
   * EC-2: If the widget is already open, focus is returned to the find input
   * without reinitializing the position or toggling the replace row. This
   * prevents the widget from jumping when the user presses Cmd-F a second time.
   */
  open(mode: "find" | "replace"): void {
    if (this._isOpen) {
      // EC-2: Already open — update mode if changed, but do not reinitialize
      // position. This prevents the widget from jumping to the default corner
      // when the user presses Cmd-F or Cmd-Opt-F a second time after having
      // dragged it to a different location.
      this._setReplaceVisible(mode === "replace");
      this.root.setAttribute("aria-label", mode === "replace" ? "Find & Replace" : "Find");
      this.findInput.focus();
      this.findInput.select();
      return;
    }

    // Restore persisted scope and check vault state for the scope toggle row.
    this._restoreScope();
    this._syncVaultState();

    // Restore persisted position (or apply the default upper-right position).
    this._restorePosition();

    // Show or hide the replace row depending on requested mode.
    this._setReplaceVisible(mode === "replace");

    // Sync aria-label so screen readers announce the correct mode name.
    this.root.setAttribute("aria-label", mode === "replace" ? "Find & Replace" : "Find");

    // Make widget visible (CSS class controls display:flex).
    this.root.style.display = "flex";
    this._isOpen = true;

    // FR-3.6 / FR-3.7: Focus the find input in both modes; select all so the
    // user can start typing immediately without manually selecting the old term.
    this.findInput.focus();
    this.findInput.select();
  }

  /**
   * Close the widget and return focus to the CM6 editor.
   *
   * Note: This does NOT clear the search query or inputs. That is intentional —
   * the user may close and reopen the widget within the same session and expects
   * their previous search term to persist. Call clearQuery() explicitly when
   * switching documents (newFile, openFile, openRecentFileByPath).
   */
  close(): void {
    if (!this._isOpen) return;
    // Cancel any pending vault search so results don't apply after close (EC-18).
    if (this._vaultDebounceTimer !== null) {
      clearTimeout(this._vaultDebounceTimer);
      this._vaultDebounceTimer = null;
    }
    this.root.style.display = "none";
    this._isOpen = false;
    // FR-10.3: Return keyboard focus to the CM6 editor so editing can resume.
    this.view.focus();
  }

  /**
   * Returns true if the widget is currently visible.
   */
  isOpen(): boolean {
    return this._isOpen;
  }

  /**
   * Pre-populate the find input before calling open().
   *
   * Called by main.ts when the editor has a text selection so the user does not
   * need to retype the selected text in the find field.
   *
   * @param text - The text to place in the find input.
   *
   * FR-5.3 / EC-13: Only the text up to the first newline is used.
   * Multi-line selections are truncated to the first line so the input
   * stays on one line and the SearchQuery remains valid.
   */
  setPreFill(text: string): void {
    const firstLine = text.split("\n")[0];
    this.findInput.value = firstLine;
  }

  /**
   * Clear the find and replace inputs, the count label, and the CM6 search
   * highlights. Call this after close() when switching documents.
   *
   * FR-11.1: Clears CM6's searchState decorations by dispatching an empty query.
   */
  clearQuery(): void {
    this.findInput.value = "";
    this.replaceInput.value = "";
    this.countLabel.textContent = "";
    this.countLabel.classList.remove("no-results");
    this.findInput.classList.remove(
      "find-widget-no-results",
      "find-widget-invalid-regexp"
    );
    // Dispatch an empty SearchQuery to CM6 so the match highlight decorations
    // are removed from the document. Without this, stale yellow highlights
    // remain visible in the editor after opening a new file.
    this.view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: "" })),
    });

    // Clear vault results when the query is cleared (e.g. on file switch).
    this._vaultResults = null;
    this._focusedFilePath = null;
    this._focusedMatch = null;
    this._selectedExcerptIndex = -1;
    if (this.vaultResultsPanel) {
      this.vaultResultsPanel.innerHTML = "";
      this.vaultResultsPanel.style.display = "none";
    }
  }

  /**
   * Update the underlying EditorView reference.
   * Defensive method — the current architecture creates one EditorView for the
   * lifetime of the app, but this allows for future flexibility.
   */
  updateView(newView: EditorView): void {
    this.view = newView;
  }

  // ---------------------------------------------------------------------------
  // Private: DOM construction
  // ---------------------------------------------------------------------------

  /**
   * Build the complete widget DOM tree.
   *
   * Returns the root div (not yet in the document). All element references are
   * stored as class fields so event handlers can access them without querying.
   *
   * FR-3.2: DOM structure matches the specification exactly.
   */
  private _buildDom(): HTMLDivElement {
    // Long method justification: constructs and cross-wires all 15 DOM elements
    // in a single pass; splitting would require exposing intermediate element
    // references as constructor locals or additional private fields, which
    // increases coupling without improving readability.

    // ---- Root container ----
    const root = document.createElement("div");
    root.className = "find-widget";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Find");
    // Hidden by default; made visible by open().
    root.style.display = "none";

    // ---- Find row ----
    const findRow = document.createElement("div");
    findRow.className = "find-widget-find-row";

    // Chevron toggle (expand/collapse replace row).
    const chevronBtn = document.createElement("button");
    chevronBtn.className = "find-widget-chevron";
    chevronBtn.setAttribute("aria-label", "Toggle replace");
    chevronBtn.setAttribute("title", "Toggle Replace (Tab)");
    chevronBtn.setAttribute("aria-expanded", "false");
    const chevronIcon = document.createElement("span");
    chevronIcon.className = "find-widget-chevron-icon";
    chevronIcon.textContent = "›";
    chevronBtn.append(chevronIcon, Object.assign(document.createElement("kbd"), { className: "fw-kbd", textContent: "Tab" }));
    findRow.appendChild(chevronBtn);

    // Find input.
    const findInput = document.createElement("input");
    findInput.type = "text";
    findInput.className = "find-widget-input";
    findInput.placeholder = "Find";
    findInput.setAttribute("aria-label", "Find");
    findRow.appendChild(findInput);

    // Toggle: Match Case.
    const toggleMatchCase = document.createElement("button");
    toggleMatchCase.className = "find-widget-toggle";
    toggleMatchCase.setAttribute("data-name", "matchCase");
    toggleMatchCase.setAttribute("aria-label", "Match Case");
    toggleMatchCase.setAttribute("title", "Match Case");
    toggleMatchCase.textContent = "Aa";
    findRow.appendChild(toggleMatchCase);

    // Toggle: Whole Word.
    const toggleWholeWord = document.createElement("button");
    toggleWholeWord.className = "find-widget-toggle";
    toggleWholeWord.setAttribute("data-name", "wholeWord");
    toggleWholeWord.setAttribute("aria-label", "Whole Word");
    toggleWholeWord.setAttribute("title", "Whole Word");
    toggleWholeWord.textContent = "ab";
    findRow.appendChild(toggleWholeWord);

    // Toggle: Regular Expression.
    const toggleRegexp = document.createElement("button");
    toggleRegexp.className = "find-widget-toggle";
    toggleRegexp.setAttribute("data-name", "regexp");
    toggleRegexp.setAttribute("aria-label", "Use Regular Expression");
    toggleRegexp.setAttribute("title", "Use Regular Expression");
    toggleRegexp.textContent = ".*";
    findRow.appendChild(toggleRegexp);

    // Count label (shows "N of M" / "No results" / "Invalid").
    const countLabel = document.createElement("span");
    countLabel.className = "find-widget-count";
    countLabel.setAttribute("aria-live", "polite");
    findRow.appendChild(countLabel);

    // Previous match button.
    const prevBtn = document.createElement("button");
    prevBtn.className = "find-widget-prev";
    prevBtn.setAttribute("aria-label", "Previous Match");
    prevBtn.setAttribute("title", "Previous Match (⇧↩)");
    prevBtn.append("↑", Object.assign(document.createElement("kbd"), { className: "fw-kbd", textContent: "⇧↩" }));
    findRow.appendChild(prevBtn);

    // Next match button.
    const nextBtn = document.createElement("button");
    nextBtn.className = "find-widget-next";
    nextBtn.setAttribute("aria-label", "Next Match");
    nextBtn.setAttribute("title", "Next Match (↩)");
    nextBtn.append("↓", Object.assign(document.createElement("kbd"), { className: "fw-kbd", textContent: "↩" }));
    findRow.appendChild(nextBtn);

    // Close button.
    const closeBtn = document.createElement("button");
    closeBtn.className = "find-widget-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.setAttribute("title", "Close (Escape)");
    closeBtn.textContent = "×";
    findRow.appendChild(closeBtn);

    root.appendChild(findRow);

    // ---- Replace row (collapsible) ----
    const replaceRow = document.createElement("div");
    replaceRow.className = "find-widget-replace-row";
    replaceRow.style.display = "none";

    const replaceInput = document.createElement("input");
    replaceInput.type = "text";
    replaceInput.className = "find-widget-replace-input";
    replaceInput.placeholder = "Replace";
    replaceInput.setAttribute("aria-label", "Replace");
    replaceRow.appendChild(replaceInput);

    const replaceOneBtn = document.createElement("button");
    replaceOneBtn.className = "find-widget-replace-one";
    replaceOneBtn.setAttribute("aria-label", "Replace");
    replaceOneBtn.setAttribute("title", "Replace (↩)");
    replaceOneBtn.append("Replace", Object.assign(document.createElement("kbd"), { className: "fw-kbd", textContent: "↩" }));
    replaceRow.appendChild(replaceOneBtn);

    const replaceAllBtn = document.createElement("button");
    replaceAllBtn.className = "find-widget-replace-all";
    replaceAllBtn.setAttribute("aria-label", "Replace All");
    replaceAllBtn.setAttribute("title", "Replace All (⌘⌥⇧↩)");
    replaceAllBtn.append("All", Object.assign(document.createElement("kbd"), { className: "fw-kbd", textContent: "⌘⌥⇧↩" }));
    replaceRow.appendChild(replaceAllBtn);

    root.appendChild(replaceRow);

    // ---- "In File" replace button (vault scope only) ----
    // Inserted before replaceAllBtn so: [Replace] [In File] [All]
    const replaceInFileBtn = document.createElement("button");
    replaceInFileBtn.className = "find-widget-replace-in-file";
    replaceInFileBtn.setAttribute("aria-label", "Replace in File");
    replaceInFileBtn.setAttribute("title", "Replace All in File (⌘⌥↩)");
    replaceInFileBtn.append("In File", Object.assign(document.createElement("kbd"), { className: "fw-kbd", textContent: "⌘⌥↩" }));
    // Hidden by default; shown only when vault scope is active.
    replaceInFileBtn.style.display = "none";
    replaceRow.insertBefore(replaceInFileBtn, replaceAllBtn);

    // ---- Scope toggle row (appended after replace row) ----
    // Hidden by default; shown when a vault is active (EC-1).
    const scopeRow = document.createElement("div");
    scopeRow.className = "find-widget-scope-row";
    scopeRow.style.display = "none";

    const scopeFile = document.createElement("button");
    scopeFile.className = "find-widget-scope-btn active";
    scopeFile.setAttribute("data-scope", "file");
    scopeFile.setAttribute("aria-pressed", "true");
    scopeFile.append("File", Object.assign(document.createElement("kbd"), { className: "fw-kbd", textContent: "⌘1" }));

    const scopeVault = document.createElement("button");
    scopeVault.className = "find-widget-scope-btn";
    scopeVault.setAttribute("data-scope", "vault");
    scopeVault.setAttribute("aria-pressed", "false");
    scopeVault.append("Vault", Object.assign(document.createElement("kbd"), { className: "fw-kbd", textContent: "⌘2" }));

    // Folder button is created hidden; shown by _updateFolderScopeOption() when
    // a folder is selected in the file browser (EC-5, EC-15).
    const scopeFolder = document.createElement("button");
    scopeFolder.className = "find-widget-scope-btn";
    scopeFolder.setAttribute("data-scope", "folder");
    scopeFolder.setAttribute("aria-pressed", "false");
    scopeFolder.style.display = "none";
    scopeFolder.append("Folder", Object.assign(document.createElement("kbd"), { className: "fw-kbd", textContent: "⌘3" }));

    scopeRow.appendChild(scopeFile);
    scopeRow.appendChild(scopeVault);
    scopeRow.appendChild(scopeFolder);
    root.appendChild(scopeRow);

    // ---- Vault results panel ----
    // Scrollable panel containing grouped file results (FR-4).
    const vaultResultsPanel = document.createElement("div");
    vaultResultsPanel.className = "find-widget-vault-results";
    vaultResultsPanel.style.display = "none";
    vaultResultsPanel.setAttribute("role", "list");
    vaultResultsPanel.setAttribute("aria-label", "Vault search results");
    // Arrow-key navigation within the results panel.
    vaultResultsPanel.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); this._stepVaultResult(1); }
      if (e.key === "ArrowUp")   { e.preventDefault(); this._stepVaultResult(-1); }
    });
    root.appendChild(vaultResultsPanel);

    // ---- Confirmation panel (Replace All, created hidden, populated in step_04) ----
    const confirmationPanel = document.createElement("div");
    confirmationPanel.className = "find-widget-confirmation";
    confirmationPanel.style.display = "none";
    root.appendChild(confirmationPanel);

    // ---- Regexp disabled overlay (shown when vault scope is active, EC-9) ----
    // Not part of findRow; floats as a tooltip via CSS absolute positioning.
    const regexpDisabledMsg = document.createElement("span");
    regexpDisabledMsg.className = "find-widget-regexp-disabled";
    regexpDisabledMsg.textContent = "Regex not supported in vault search";
    regexpDisabledMsg.style.display = "none";
    root.appendChild(regexpDisabledMsg);

    // ---- Store all element references as class fields ----
    this.findInput = findInput;
    this.replaceInput = replaceInput;
    this.countLabel = countLabel;
    this.toggleMatchCase = toggleMatchCase;
    this.toggleWholeWord = toggleWholeWord;
    this.toggleRegexp = toggleRegexp;
    this.chevronBtn = chevronBtn;
    this.replaceRow = replaceRow;
    this.replaceOneBtn = replaceOneBtn;
    this.replaceAllBtn = replaceAllBtn;
    this.prevBtn = prevBtn;
    this.nextBtn = nextBtn;
    this.closeBtn = closeBtn;

    // ---- Vault extension DOM references ----
    this.scopeRow = scopeRow;
    this.vaultResultsPanel = vaultResultsPanel;
    this.confirmationPanel = confirmationPanel;
    this.regexpDisabledMsg = regexpDisabledMsg;
    this.replaceInFileBtn = replaceInFileBtn;
    this._scopeBtnFile = scopeFile;
    this._scopeBtnVault = scopeVault;
    this._scopeBtnFolder = scopeFolder;

    // ---- Attach all event listeners ----
    this._attachEvents(root);

    return root;
  }

  // ---------------------------------------------------------------------------
  // Private: Event listeners
  // ---------------------------------------------------------------------------

  /**
   * Attach all widget-level event listeners.
   *
   * Called once at the end of _buildDom(), before the root element is returned.
   * The root parameter (not yet this.root) is passed in to keep the call
   * self-contained within _buildDom().
   */
  private _attachEvents(root: HTMLDivElement): void {
    // Long method justification: wires 10 separate event listeners across all
    // interactive elements. Grouping them together makes the full event contract
    // readable in one place rather than scattering listeners across multiple
    // methods where the interactions between them (e.g., Tab focus chain) would
    // be harder to trace.

    // ---- Global widget keyboard shortcuts ----
    // Handled on the root so they work regardless of which element is focused.
    root.addEventListener("keydown", (e: KeyboardEvent) => {
      // EC-17 / EC-27: Escape closes from any focused element inside the widget.
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (this._confirmationVisible) {
          // EC-17: Escape cancels confirmation, does NOT close the widget.
          this._hideConfirmationPanel();
        } else {
          this.close();
        }
        return;
      }
      // ⌘1 / ⌘2 / ⌘3: switch scope (only when scope row is visible).
      if (e.metaKey && !e.altKey && !e.shiftKey && (e.key === "1" || e.key === "2" || e.key === "3")) {
        const scopeMap: Record<string, FindScope> = { "1": "file", "2": "vault", "3": "folder" };
        const target = scopeMap[e.key] as FindScope;
        if (target === "folder" && this._scopeBtnFolder.style.display === "none") return;
        e.preventDefault();
        e.stopPropagation();
        this._setScope(target);
        return;
      }
      // Cmd-Return: find next match (or next vault result in vault scope).
      if (e.key === "Enter" && e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (this._scope !== "file") {
          this._stepVaultResult(1);
        } else {
          findNext(this.view);
          this._updateCount(this._buildSearchQuery());
        }
        return;
      }
      // Cmd-Opt-Return: show In File preview (vault scope) or replace current
      // match (file scope). Only active when replace row is visible.
      if (e.key === "Enter" && e.metaKey && e.altKey && !e.shiftKey && this._replaceVisible) {
        e.preventDefault();
        e.stopPropagation();
        if (this._scope !== "file") {
          this._showInFilePreview();
        } else {
          replaceNext(this.view);
          this._updateCount(this._buildSearchQuery());
        }
        return;
      }
      // Cmd-Opt-Shift-Return: replace all matches. Only active when replace row is visible.
      if (e.key === "Enter" && e.metaKey && e.altKey && e.shiftKey && this._replaceVisible) {
        e.preventDefault();
        e.stopPropagation();
        if (this._scope !== "file") {
          this.replaceAllBtn.click();
        } else {
          replaceAll(this.view);
          this._updateCount(this._buildSearchQuery());
        }
      }
    });

    // ---- Chevron: toggle replace row ----
    this.chevronBtn.addEventListener("click", () => {
      this._setReplaceVisible(!this._replaceVisible);
    });

    // ---- Find input: dispatch query on every keystroke ----
    this.findInput.addEventListener("input", () => {
      // FR-4.1: Dispatch updated SearchQuery to CM6 on every keystroke so that
      // match highlights update in real time.
      this._dispatchQuery();
    });

    // ---- Find input: keyboard navigation shortcuts ----
    this.findInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey) {
        e.preventDefault();
        if (this._scope !== "file") {
          this._stepVaultResult(1);
        } else {
          findNext(this.view);
          this._updateCount(this._buildSearchQuery());
        }
      } else if (e.key === "Enter" && e.shiftKey && !e.metaKey) {
        e.preventDefault();
        if (this._scope !== "file") {
          this._stepVaultResult(-1);
        } else {
          findPrevious(this.view);
          this._updateCount(this._buildSearchQuery());
        }
      } else if (e.key === "Tab" && !e.shiftKey) {
        // Tab always opens the replace row (if not already open) and focuses it.
        e.preventDefault();
        if (!this._replaceVisible) this._setReplaceVisible(true);
        this.replaceInput.focus();
      }
      // Escape is handled by the root keydown listener above.
    });

    // ---- Replace input: default-action indicator ----
    // Highlight "Replace" when the replace input is focused (Enter will trigger it).
    this.replaceInput.addEventListener("focus", () => {
      this._setDefaultBtn(this.replaceOneBtn);
    });
    this.replaceInput.addEventListener("blur", () => {
      this._setDefaultBtn(null);
    });

    // ---- Root modifier tracking: shift highlight to "All" when ⌘⌥⇧ are all held ----
    root.addEventListener("keydown", (e: KeyboardEvent) => {
      if (document.activeElement !== this.replaceInput) return;
      if (e.metaKey && e.altKey && e.shiftKey) {
        this._setDefaultBtn(this.replaceAllBtn);
      }
    });
    root.addEventListener("keyup", (e: KeyboardEvent) => {
      if (document.activeElement !== this.replaceInput) return;
      if (!(e.metaKey && e.altKey && e.shiftKey)) {
        this._setDefaultBtn(this.replaceOneBtn);
      }
    });

    // ---- Replace input: keep replacement text in sync with SearchQuery ----
    this.replaceInput.addEventListener("input", () => {
      // The replace text must be part of the SearchQuery so that replaceNext
      // and replaceAll use the current value, not the value at query creation.
      this._dispatchQuery();
      this._updateExcerptPreviews();
    });

    // ---- Replace input: Enter commits a single replacement ----
    this.replaceInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        if (this._scope !== "file") {
          void this._replaceVaultMatch();
        } else {
          replaceNext(this.view);
          this._updateCount(this._buildSearchQuery());
        }
      }
    });

    // ---- Toggle buttons: update search immediately on each click ----
    this.toggleMatchCase.addEventListener("click", () => {
      this._matchCase = !this._matchCase;
      this.toggleMatchCase.classList.toggle("active", this._matchCase);
      // EC-19: Immediate re-dispatch so match highlights update at once.
      this._dispatchQuery();
    });

    this.toggleWholeWord.addEventListener("click", () => {
      this._wholeWord = !this._wholeWord;
      this.toggleWholeWord.classList.toggle("active", this._wholeWord);
      // EC-20: Immediate re-dispatch on whole-word toggle change.
      this._dispatchQuery();
    });

    this.toggleRegexp.addEventListener("click", () => {
      this._regexp = !this._regexp;
      this.toggleRegexp.classList.toggle("active", this._regexp);
      this._dispatchQuery();
    });

    // ---- Navigation buttons ----
    this.nextBtn.addEventListener("click", () => {
      if (this._scope !== "file") {
        this._stepVaultResult(1);
      } else {
        findNext(this.view);
        this._updateCount(this._buildSearchQuery());
      }
    });

    this.prevBtn.addEventListener("click", () => {
      if (this._scope !== "file") {
        this._stepVaultResult(-1);
      } else {
        findPrevious(this.view);
        this._updateCount(this._buildSearchQuery());
      }
    });

    // ---- Replace buttons ----
    this.replaceOneBtn.addEventListener("click", () => {
      if (this._scope !== "file") {
        // Vault scope: replace the focused match (FR-6); falls back to CM6 if
        // no match is focused (AC-8).
        void this._replaceVaultMatch();
      } else {
        // FR-4.4 / AC-21: Replace the current match and advance to the next.
        // EC-28: replaceNext is a no-op when there are zero matches (CM6 handles).
        replaceNext(this.view);
        this._updateCount(this._buildSearchQuery());
      }
    });

    this.replaceInFileBtn.addEventListener("click", () => {
      // Show In File preview before executing (vault scope).
      this._showInFilePreview();
    });

    this.replaceAllBtn.addEventListener("click", () => {
      if (this._scope === "file") {
        // FR-4.5 / AC-22: Replace all matches in a single CM6 transaction.
        // EC-8: Single transaction guarantees one-step undo (Cmd-Z).
        replaceAll(this.view);
        this._updateCount(this._buildSearchQuery());
        return;
      }

      // Vault scope: show confirmation panel first (FR-7 — do NOT commit immediately).
      const results = this._vaultResults;
      const findTerm = this.findInput.value;
      const replaceTerm = this.replaceInput.value;
      if (!results || results.results.length === 0 || !findTerm) return;
      this._showConfirmationPanel(results, findTerm, replaceTerm);
    });

    // ---- Close button ----
    this.closeBtn.addEventListener("click", () => {
      this.close();
    });

    // ---- Scope toggle buttons ----
    [this._scopeBtnFile, this._scopeBtnVault, this._scopeBtnFolder].forEach((btn) => {
      btn.addEventListener("click", () => {
        const newScope = btn.getAttribute("data-scope") as FindScope;
        this._setScope(newScope);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Private: Default-action button indicator
  // ---------------------------------------------------------------------------

  private _setDefaultBtn(btn: HTMLButtonElement | null): void {
    this.replaceOneBtn.classList.remove("find-widget-default-btn");
    this.replaceAllBtn.classList.remove("find-widget-default-btn");
    if (btn) btn.classList.add("find-widget-default-btn");
  }

  // ---------------------------------------------------------------------------
  // Private: CM6 search logic
  // ---------------------------------------------------------------------------

  /**
   * Build a SearchQuery from the current input values and toggle state.
   *
   * EC-6 / EC-25: If regexp mode is on and the pattern is invalid, SearchQuery
   * sets query.valid = false rather than throwing. No uncaught exception occurs.
   */
  private _buildSearchQuery(): SearchQuery {
    return new SearchQuery({
      search: this.findInput.value,
      caseSensitive: this._matchCase,
      wholeWord: this._wholeWord,
      regexp: this._regexp,
      replace: this.replaceInput.value,
    });
  }

  /**
   * Dispatch the current SearchQuery to the CM6 editor and refresh the count.
   *
   * Called on every input event and when any toggle changes.
   */
  private _dispatchQuery(): void {
    const query = this._buildSearchQuery();
    this.view.dispatch({ effects: setSearchQuery.of(query) });
    this._updateCount(query);

    // Vault search: only when scope is not "file".
    if (this._scope !== "file") {
      this._scheduleVaultSearch();
    }
  }

  /**
   * Update the count label to reflect the number of matches for `query` in the
   * current document and highlight the current match index.
   *
   * @param query - The SearchQuery to evaluate. Must match the currently
   *                dispatched query so the editor decorations are consistent
   *                with the displayed count.
   *
   * FR-12.1: "N of M" label where N is the 1-based index of the active match.
   * FR-12.2 / EC-3: "No results" label with red tint when zero matches.
   * FR-12.3: Empty label when the find input is empty.
   * EC-6 / EC-25: "Invalid" label with orange tint for invalid regexp.
   * EC-7: Count capped at "999+" to prevent hang on zero-width regexp patterns.
   */
  private _updateCount(query: SearchQuery): void {
    // Long method justification: performs match counting AND current-index
    // detection in coordinated logic that must share the cursor state from a
    // single document pass. Splitting into sub-methods would require passing
    // multiple cursor/count values between them, or re-iterating the document
    // twice, both of which are worse than keeping the logic co-located.

    // In vault/folder scope the count row reflects vault results, not single-file
    // CM6 matches. Suppress the single-file count display entirely so it never
    // shows a red "No results" while the vault panel has real matches below.
    if (this._scope !== "file") {
      this.countLabel.textContent = "";
      this.countLabel.classList.remove("no-results");
      this.findInput.classList.remove("find-widget-no-results", "find-widget-invalid-regexp");
      return;
    }

    const term = this.findInput.value;

    // FR-12.3 / EC-15: Empty search term — clear all feedback classes and hide
    // the count label. EC-15 covers the case where the document is also empty;
    // the behaviour is identical because the term check precedes any document
    // iteration, so zero-length documents produce the same empty-label result.
    if (!term) {
      this.countLabel.textContent = "";
      this.countLabel.classList.remove("no-results");
      this.findInput.classList.remove(
        "find-widget-no-results",
        "find-widget-invalid-regexp"
      );
      return;
    }

    // EC-6 / EC-25: Invalid regexp — query.valid is false; do not iterate.
    if (!query.valid) {
      this.countLabel.textContent = "Invalid";
      this.countLabel.classList.add("no-results");
      this.findInput.classList.remove("find-widget-no-results");
      this.findInput.classList.add("find-widget-invalid-regexp");
      return;
    }

    // Count total matches by iterating the document cursor.
    // EC-7: Cap at 1000 iterations to prevent hanging on zero-width patterns
    // like ".*" which produce a match at every character position.
    let totalCount = 0;
    const cursor = query.getCursor(this.view.state);
    while (!cursor.next().done) {
      totalCount++;
      if (totalCount > 999) {
        this.countLabel.textContent = "999+";
        this.countLabel.classList.remove("no-results");
        this.findInput.classList.remove(
          "find-widget-no-results",
          "find-widget-invalid-regexp"
        );
        return;
      }
    }

    // FR-12.2 / EC-3: Zero matches — show error state.
    if (totalCount === 0) {
      this.countLabel.textContent = "No results";
      this.countLabel.classList.add("no-results");
      this.findInput.classList.add("find-widget-no-results");
      this.findInput.classList.remove("find-widget-invalid-regexp");
      return;
    }

    // FR-12.1: Determine the current match index by counting all matches whose
    // end position is at or before the current editor selection anchor.
    const selFrom = this.view.state.selection.main.from;
    let currentIndex = 0;
    const indexCursor = query.getCursor(this.view.state);
    while (!indexCursor.next().done) {
      currentIndex++;
      // Stop once we reach the match that covers or passes the cursor position.
      if ((indexCursor as any).value.to > selFrom) break;
    }

    this.countLabel.textContent = `${currentIndex} of ${totalCount}`;
    this.countLabel.classList.remove("no-results");
    this.findInput.classList.remove(
      "find-widget-no-results",
      "find-widget-invalid-regexp"
    );
  }

  // ---------------------------------------------------------------------------
  // Private: Toggle replace row
  // ---------------------------------------------------------------------------

  /**
   * Show or hide the replace row and update the chevron button state.
   *
   * @param visible - true to expand the replace row, false to collapse it.
   */
  private _setReplaceVisible(visible: boolean): void {
    this._replaceVisible = visible;
    this.replaceRow.style.display = visible ? "flex" : "none";
    // Rotate the chevron 90 degrees when expanded (done via CSS class).
    this.chevronBtn.classList.toggle("expanded", visible);
    this.chevronBtn.setAttribute("aria-expanded", String(visible));
    this._updateExcerptPreviews();
  }

  // ---------------------------------------------------------------------------
  // Private: Drag implementation
  // ---------------------------------------------------------------------------

  /**
   * Attach the drag-handle listeners. Called once after _buildDom().
   *
   * The entire widget is draggable except for input fields and buttons. Drag
   * events are on `document` so dragging continues past the widget boundary.
   */
  private _attachDrag(): void {
    // Long method justification: manages a 3-phase drag state machine
    // (mousedown / mousemove / mouseup) that must share the captured start
    // coordinates (_dragOffsetX, _dragOffsetY) and the _isDragging flag across
    // all three phases. Splitting into sub-methods would require passing the
    // shared state via parameters or additional fields without reducing
    // complexity. The handlers are stored as named instance properties
    // (_onMouseMove, _onMouseUp) so destroy() can remove them by reference.

    this.root.addEventListener("mousedown", (e: MouseEvent) => {
      // Only respond to the primary (left) mouse button.
      if (e.button !== 0) return;
      // Do not start drag when clicking an input or button — let those handle
      // their own events (text selection, focus, click).
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "BUTTON") return;

      this._isDragging = true;

      // Calculate the offset from the widget's top-left corner to the mouse
      // position. This offset is held constant throughout the drag so the widget
      // appears to be grabbed at the click point rather than snapping to its origin.
      const rect = this.root.getBoundingClientRect();
      this._dragOffsetX = e.clientX - rect.left;
      this._dragOffsetY = e.clientY - rect.top;

      // FR-7.3: Clear `right` so `left` takes effect when dragging begins.
      // The default position uses `right: 16px`; switching to left/top absolute
      // coordinates is required for the drag math to work correctly.
      this.root.style.right = "auto";
      this.root.style.left = `${rect.left}px`;
      this.root.style.top = `${rect.top}px`;

      // FR-7.5: Suppress text selection in the underlying editor during drag
      // so the cursor does not inadvertently select content while dragging.
      document.body.style.userSelect = "none";
      (document.body.style as CSSStyleDeclaration & { webkitUserSelect: string }).webkitUserSelect = "none";

      e.preventDefault();
    });

    // FR-7.2: mousemove is on document so drag continues past the widget edge.
    // Stored as a named property so destroy() can remove this exact reference.
    this._onMouseMove = (e: MouseEvent) => {
      if (!this._isDragging) return;

      let newX = e.clientX - this._dragOffsetX;
      let newY = e.clientY - this._dragOffsetY;

      // FR-7.6 / EC-22: Clamp to visible viewport so the widget cannot be
      // dragged fully off-screen and become unrecoverable.
      newX = this._clampX(newX);
      newY = this._clampY(newY);

      this.root.style.left = `${newX}px`;
      this.root.style.top = `${newY}px`;

      // EC-19: Re-clamp vault results panel height as the widget is dragged
      // vertically. offsetHeight already includes the expanded panel (correct
      // because _clampY uses offsetHeight), so we only need to re-clamp the
      // panel max-height to prevent overflow at the new position.
      if (this._vaultResults) {
        this._clampVaultResultsHeight();
      }
    };
    document.addEventListener("mousemove", this._onMouseMove);

    // FR-7.4: End the drag on mouseup and persist the final position.
    // Stored as a named property so destroy() can remove this exact reference.
    this._onMouseUp = () => {
      if (!this._isDragging) return;

      this._isDragging = false;

      // FR-7.5: Restore text selection after drag ends.
      document.body.style.userSelect = "";
      (document.body.style as CSSStyleDeclaration & { webkitUserSelect: string }).webkitUserSelect = "";

      // FR-8.2 / FR-8.5: Save position at drag-end, not on every mousemove,
      // to avoid saturating the Tauri IPC with per-pixel save calls.
      const x = parseFloat(this.root.style.left) || 0;
      const y = parseFloat(this.root.style.top) || 0;
      this._savePosition({ x, y });
    };
    document.addEventListener("mouseup", this._onMouseUp);
  }

  // ---------------------------------------------------------------------------
  // Public: Lifecycle cleanup
  // ---------------------------------------------------------------------------

  /**
   * Remove all document-level event listeners and detach the root element from
   * the DOM. Call this when the widget is permanently dismissed (e.g., when the
   * editor view is destroyed) to prevent memory leaks.
   *
   * The mousemove and mouseup listeners are registered on `document` (not the
   * widget root), so they survive even when the root is hidden. Without explicit
   * removal they would remain in memory for the lifetime of the page, keeping
   * the FindWidget instance alive via closure even after it is no longer needed.
   */
  destroy(): void {
    document.removeEventListener("mousemove", this._onMouseMove);
    document.removeEventListener("mouseup", this._onMouseUp);
    this._detachVaultChangedListener();
    // Issue 2 fix: remove the folder-selected listener that was registered in
    // the constructor. Without this, the FindWidget instance would remain alive
    // via closure even after the widget is destroyed.
    if (this._folderSelectedCb !== null) {
      window.removeEventListener("markable-folder-selected", this._folderSelectedCb);
      this._folderSelectedCb = null;
    }
    if (this._vaultDebounceTimer !== null) {
      clearTimeout(this._vaultDebounceTimer);
      this._vaultDebounceTimer = null;
    }
    this.root.remove();
  }

  /**
   * Clamp an X coordinate so the widget stays within the horizontal viewport.
   *
   * EC-21 / EC-22: Ensures the widget is always at least partially visible.
   * Uses `offsetWidth` which is available once the widget has been painted.
   * Falls back to 320 (min-width in CSS) before first layout.
   */
  private _clampX(x: number): number {
    const widgetWidth = this.root.offsetWidth || 320;
    const maxX = window.innerWidth - widgetWidth;
    return Math.max(0, Math.min(x, Math.max(0, maxX)));
  }

  /**
   * Clamp a Y coordinate so the widget stays within the vertical viewport.
   *
   * EC-21 / EC-22: Same approach as _clampX.
   * Falls back to 100 (estimated min-height) before first layout.
   */
  private _clampY(y: number): number {
    const widgetHeight = this.root.offsetHeight || 100;
    const maxY = window.innerHeight - widgetHeight;
    return Math.max(0, Math.min(y, Math.max(0, maxY)));
  }

  // ---------------------------------------------------------------------------
  // Private: Position persistence
  // ---------------------------------------------------------------------------

  /**
   * Persist the widget position to application settings.
   *
   * FR-8.2: Called once at drag-end (mouseup). Uses updateSettings() which
   * writes to disk via the Tauri backend asynchronously. Errors are logged
   * but do not propagate — a failed position save is not fatal.
   *
   * @param pos - The top-left pixel position to save.
   */
  private _savePosition(pos: FindWidgetPosition): void {
    updateSettings((s) => ({ ...s, findWidget: pos })).catch((err) => {
      console.error("FindWidget: failed to save position:", err);
    });
  }

  /**
   * Restore the widget position from settings, or fall back to the default
   * upper-right position below the title bar.
   *
   * FR-8.3 / EC-23: Uses saved position if it exists and is at least partially
   * on-screen. Clamped to the current viewport so the widget never appears off-
   * screen after the display configuration changes (e.g., different monitor).
   *
   * D-3 / AC-6 / AC-8: Default position: top = 38px (titlebar) + 16px gap = 54px.
   * Uses `right: 16px` instead of `left` so it anchors to the right edge regardless
   * of window width. Drag converts to absolute left/top coordinates.
   */
  private _restorePosition(): void {
    const saved = getCurrentSettings().findWidget;

    // FR-8.3 / EC-23: Use saved position if it exists, has valid numeric
    // coordinates, and is visible on screen.
    // The != null check covers both null (explicit default) and undefined
    // (old settings files that pre-date the findWidget field).
    // The typeof guards defend against a partially-written settings file
    // (MEDIUM-2) where only one coordinate was persisted; without them,
    // NaN would propagate into style.left/top as "NaNpx".
    if (saved != null && typeof saved.x === 'number' && typeof saved.y === 'number' && this._isPositionVisible(saved.x, saved.y)) {
      const clampedX = this._clampX(saved.x);
      const clampedY = this._clampY(saved.y);
      this.root.style.right = "auto";
      this.root.style.left = `${clampedX}px`;
      this.root.style.top = `${clampedY}px`;
      return;
    }

    // FR-8.1 / AC-6 / AC-8: Default position — upper-right, below title bar.
    this.root.style.left = "auto";
    this.root.style.right = "16px";
    this.root.style.top = "54px";
  }

  /**
   * Check whether a widget positioned at (x, y) would be at least partially
   * visible in the current viewport.
   *
   * Requires at least 20px of the widget to be visible in both axes to ensure
   * the drag handle is reachable. This matches the approach in settings.ts
   * `isWindowOffScreen` (MIN_VISIBLE_PX = 50 there; we use 20 for the widget
   * because it is smaller and more easily repositioned).
   *
   * @param x - Left edge of the widget in viewport pixels.
   * @param y - Top edge of the widget in viewport pixels.
   */
  private _isPositionVisible(x: number, y: number): boolean {
    const MIN_VISIBLE = 20;
    // Use offsetWidth/Height if available; fall back to known CSS min-width/height.
    const w = this.root.offsetWidth || 320;
    const h = this.root.offsetHeight || 100;
    const visibleRight = Math.min(x + w, window.innerWidth) - Math.max(x, 0);
    const visibleBottom = Math.min(y + h, window.innerHeight) - Math.max(y, 0);
    return visibleRight >= MIN_VISIBLE && visibleBottom >= MIN_VISIBLE;
  }

  // ---------------------------------------------------------------------------
  // Private: Vault scope — state management
  // ---------------------------------------------------------------------------

  /**
   * Restore the persisted find scope from settings.
   *
   * Called on open(). Falls back to "file" when findWidgetScope is absent
   * in settings (e.g. settings files created before this feature was added).
   */
  private _restoreScope(): void {
    const saved = getCurrentSettings().findWidgetScope;
    this._scope = saved ?? "file";
  }

  /**
   * Persist the current scope to settings.
   *
   * Called after every scope change so the user's last-used scope survives
   * widget close/reopen and app restart. Errors are logged but not rethrown —
   * a failed scope save is not fatal.
   */
  private _saveScope(): void {
    updateSettings((s) => ({ ...s, findWidgetScope: this._scope })).catch((err) => {
      console.error("FindWidget: failed to save scope:", err);
    });
  }

  /**
   * Synchronise the scope toggle row visibility with the current vault state.
   *
   * Called on open() and whenever the vault changes mid-session. When no vault
   * is active, the scope row is hidden and the scope is forced to "file" (EC-1).
   */
  private _syncVaultState(): void {
    const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
    const vault = vm?.getActiveVault?.() ?? null;

    if (!vault) {
      // EC-1: No vault active — hide scope row, force to file scope.
      this.scopeRow.style.display = "none";
      if (this._scope !== "file") {
        this._scope = "file";
        this._clearVaultResults();
      }
      return;
    }

    // Vault is active — show scope row and update button state.
    this.scopeRow.style.display = "flex";
    this._updateFolderScopeOption();
    this._updateScopeButtons();

    // Subscribe to vault-changed events so we can react if vault becomes
    // inactive mid-session (EC-4).
    this._attachVaultChangedListener();
  }

  /**
   * Subscribe to vault-changed events from the vault manager.
   *
   * Guarded by _vaultChangedAttached to prevent duplicate subscriptions when
   * open() is called multiple times within the same session.
   */
  private _attachVaultChangedListener(): void {
    if (this._vaultChangedAttached) return;
    const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
    if (!vm?.onVaultChanged) return;

    this._vaultChangedCb = (vault: unknown) => {
      if (!vault) {
        // EC-4: Vault became inactive mid-session — revert to file scope.
        this._scope = "file";
        this.scopeRow.style.display = "none";
        this._clearVaultResults();
        this._updateScopeButtons();
      } else {
        // Vault changed to a different vault — update folder scope option.
        this._updateFolderScopeOption();
      }
    };
    vm.onVaultChanged(this._vaultChangedCb);
    this._vaultChangedAttached = true;
  }

  /**
   * Remove the vault-changed listener. Called from destroy().
   */
  private _detachVaultChangedListener(): void {
    if (!this._vaultChangedCb) return;
    const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
    vm?.offVaultChanged?.(this._vaultChangedCb);
    this._vaultChangedCb = null;
    this._vaultChangedAttached = false;
  }

  /**
   * Show or hide the Folder scope button based on whether a folder is
   * currently selected in the file browser.
   *
   * When the Folder option disappears while folder scope is active, falls
   * back to vault scope and shows a transient status message (EC-5).
   */
  private _updateFolderScopeOption(): void {
    const fb = (window as any).__MARKABLE_FILE_BROWSER__;
    const folderPath = fb?.getSelectedFolderPath?.() ?? null;
    const show = folderPath !== null;
    this._scopeBtnFolder.style.display = show ? "" : "none";

    if (!show && this._scope === "folder") {
      // EC-5: Folder selection lost — fall back to vault scope.
      this._scope = "vault";
      this._updateScopeButtons();
      this._showFolderLostMessage();
      this._scheduleVaultSearch();
    }
  }

  /**
   * Show a brief status message when the folder scope is lost (EC-5).
   *
   * The message auto-removes after 3 seconds so it does not persist.
   */
  private _showFolderLostMessage(): void {
    const msg = document.createElement("div");
    msg.className = "find-widget-vault-status";
    msg.textContent = "Folder selection lost. Showing vault results.";
    this.vaultResultsPanel.innerHTML = "";
    this.vaultResultsPanel.appendChild(msg);
    this.vaultResultsPanel.style.display = "block";
    setTimeout(() => {
      if (msg.parentNode === this.vaultResultsPanel) {
        msg.remove();
      }
    }, 3000);
  }

  /**
   * Set a new scope value and update all dependent UI state.
   *
   * @param scope - The new scope to activate.
   */
  private _setScope(scope: FindScope): void {
    if (scope === this._scope) return;

    this._scope = scope;
    this._updateScopeButtons();
    this._updateRegexpToggleState();
    this._saveScope();

    if (scope === "file") {
      // AC-7: Switch back to file scope — clear vault results.
      this._clearVaultResults();
    } else {
      // Run a vault search immediately if there is an existing query.
      if (this.findInput.value) {
        this._scheduleVaultSearch();
      }
    }
  }

  /**
   * Update the visual state of all scope toggle buttons to reflect _scope.
   *
   * Also shows/hides the "In File" replace button (visible only in vault scope).
   */
  private _updateScopeButtons(): void {
    [this._scopeBtnFile, this._scopeBtnVault, this._scopeBtnFolder].forEach((btn) => {
      const isActive = btn.getAttribute("data-scope") === this._scope;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-pressed", String(isActive));
    });

    // Show "In File" replace button only in vault/folder scope.
    const vaultActive = this._scope !== "file";
    this.replaceInFileBtn.style.display = vaultActive ? "" : "none";
  }

  /**
   * Update the regexp toggle button's interactive state.
   *
   * When vault scope is active, the regexp toggle is visually disabled
   * because regex mode is not supported in vault search (FR-15, EC-9).
   * The toggle is grayed out and pointer-events are removed so it cannot
   * be clicked, but it retains its visual position in the row.
   */
  private _updateRegexpToggleState(): void {
    const inVault = this._scope !== "file";
    if (inVault) {
      this.toggleRegexp.style.pointerEvents = "none";
      this.toggleRegexp.style.opacity = "0.4";
      this.toggleRegexp.setAttribute("title", "Regex not supported in vault search");
      this.toggleRegexp.setAttribute("aria-disabled", "true");
      // Show the disabled overlay message (EC-9).
      this.regexpDisabledMsg.style.display = "";
    } else {
      this.toggleRegexp.style.pointerEvents = "";
      this.toggleRegexp.style.opacity = "";
      this.toggleRegexp.setAttribute("title", "Use Regular Expression");
      this.toggleRegexp.removeAttribute("aria-disabled");
      // Hide the disabled overlay when returning to file scope.
      this.regexpDisabledMsg.style.display = "none";
    }
  }

  /**
   * Clear all vault result state and hide the results panel.
   *
   * Called when switching back to file scope, when the query is cleared,
   * or when the vault becomes inactive.
   */
  private _clearVaultResults(): void {
    this._vaultResults = null;
    this._focusedFilePath = null;
    this._focusedMatch = null;
    this._selectedExcerptIndex = -1;
    if (this.vaultResultsPanel) {
      this.vaultResultsPanel.innerHTML = "";
      this.vaultResultsPanel.style.display = "none";
    }
    if (this._vaultDebounceTimer !== null) {
      clearTimeout(this._vaultDebounceTimer);
      this._vaultDebounceTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Vault scope — search
  // ---------------------------------------------------------------------------

  /**
   * Schedule a vault search after the 150 ms debounce window (NFR-2).
   *
   * Resets the timer on every call so rapid keystrokes only trigger one search
   * at the end of the burst.
   */
  private _scheduleVaultSearch(): void {
    if (this._vaultDebounceTimer !== null) {
      clearTimeout(this._vaultDebounceTimer);
    }
    this._vaultDebounceTimer = setTimeout(() => {
      this._vaultDebounceTimer = null;
      void this._runVaultSearch();
    }, 150);
  }

  /**
   * Execute a vault search with the current query and scope.
   *
   * Calls searchVaultContent, post-filters the results, and renders them.
   * Stale results from superseded queries are discarded via the generation
   * counter (EC-18).
   */
  private async _runVaultSearch(): Promise<void> {
    // Long method justification: orchestrates the full async search pipeline
    // (scope resolution → Rust command → post-filter → render) in a single
    // method so the generation counter and results state update atomically.
    // Splitting into sub-methods would require threading the generation token
    // through additional parameters without reducing overall complexity.

    const query = this.findInput.value;

    // EC-3: Skip empty query.
    if (!query) {
      this._clearVaultResults();
      return;
    }

    const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
    const vault = vm?.getActiveVault?.();
    if (!vault) {
      this._clearVaultResults();
      return;
    }

    // EC-18: Capture the current generation before the await boundary.
    // Incrementing here ensures even two simultaneous searches use different
    // generations, so the older one's result is discarded when it arrives.
    this._searchGeneration++;
    const myGeneration = this._searchGeneration;

    // Determine which root paths to search based on scope.
    let rootPaths: string[];
    if (this._scope === "folder") {
      const fb = (window as any).__MARKABLE_FILE_BROWSER__;
      const folderPath = fb?.getSelectedFolderPath?.() ?? null;
      if (!folderPath) {
        // EC-5: Folder was deselected since scope was set — fall back silently.
        // Issue 6 fix: use _setScope("vault") rather than direct assignment so
        // the persist/update cycle (_saveScope, _updateRegexpToggleState,
        // _updateScopeButtons) runs consistently with every other scope change.
        this._setScope("vault");
        rootPaths = vault.rootPaths;
      } else {
        rootPaths = [folderPath];
      }
    } else {
      rootPaths = vault.rootPaths;
    }

    const result = await searchVaultContent({
      rootPaths,
      excludePatterns: vault.excludePatterns ?? [],
      query,
      maxResults: 200, // FR-12: cap at 200 files
    });

    // EC-18: Discard stale results from a superseded query.
    if (myGeneration !== this._searchGeneration) return;

    // EC-18: Also discard if the widget was closed during the async search.
    if (!this._isOpen) return;

    if (!result.ok) {
      this._renderVaultError(result.error.message);
      return;
    }

    // FR-13, FR-14: Apply client-side post-filtering for case and whole-word.
    const filtered = postFilterResults(result.value, query, {
      matchCase: this._matchCase,
      wholeWord: this._wholeWord,
    });

    this._vaultResults = filtered;
    this._renderVaultResults(filtered, query);
  }

  // ---------------------------------------------------------------------------
  // Private: Vault scope — rendering
  // ---------------------------------------------------------------------------

  /**
   * Render the vault search results in the results panel.
   *
   * Clears any previous content and re-builds the file group list. Each file
   * gets one group with a header (title + match count) and up to 3 excerpt
   * rows, expandable via "Show all N" (FR-4).
   *
   * @param payload - The filtered ContentSearchPayload to render.
   * @param query   - The raw query string, used to highlight match substrings.
   */
  private _renderVaultResults(payload: ContentSearchPayload, query: string): void {
    // Long method justification: builds the complete results DOM in one pass —
    // no-results state, per-file groups, capped notice, and skipped-count notice
    // all share the same panel reference and require a sequential render order.
    // Extracting sub-cases would require passing the panel element as a parameter
    // and coordinating the height-clamp call, which adds indirection without
    // reducing the total line count.

    const panel = this.vaultResultsPanel;
    panel.innerHTML = "";
    panel.style.display = "block";

    // FR-5: No results state.
    if (payload.results.length === 0) {
      const noResults = document.createElement("div");
      noResults.className = "find-widget-vault-no-results";
      const scopeLabel = this._scope === "folder" ? "folder" : "vault";
      noResults.textContent = `No results in ${scopeLabel}.`;
      panel.appendChild(noResults);
      this._clampVaultResultsHeight();
      return;
    }

    // FR-4: Render one group per file.
    for (const fileResult of payload.results) {
      panel.appendChild(this._buildFileGroup(fileResult, query));
    }

    // FR-4: Capped notice (EC-12).
    if (payload.capped) {
      const notice = document.createElement("div");
      notice.className = "find-widget-vault-notice";
      notice.textContent = "Results limited to the first 200 files. Refine your query to see more.";
      panel.appendChild(notice);
    }

    // Skipped files notice.
    if (payload.skippedCount > 0) {
      const notice = document.createElement("div");
      notice.className = "find-widget-vault-notice find-widget-vault-notice-warn";
      notice.textContent = `${payload.skippedCount} file(s) could not be read.`;
      panel.appendChild(notice);
    }

    this._clampVaultResultsHeight();
    // After a single replace, advance to the captured position; otherwise
    // select the first result so Enter/↑↓ work immediately.
    const targetIdx = this._pendingSelectAfterSearch >= 0 ? this._pendingSelectAfterSearch : 0;
    this._pendingSelectAfterSearch = -1;
    setTimeout(() => {
      this._selectExcerptAt(targetIdx);
      this._updateExcerptPreviews();
    }, 0);
  }

  /**
   * Build a file group element for one FileContentResult.
   *
   * The group contains: a header row (title + match count badge) and an excerpt
   * list showing up to 3 matches initially. When there are more than 3 matches,
   * a "Show all N" expander button appends the remaining rows on click.
   *
   * @param fileResult - The file result to render.
   * @param query      - The raw query string for match highlighting.
   * @returns          - The assembled file group <div>.
   */
  private _buildFileGroup(fileResult: FileContentResult, query: string): HTMLDivElement {
    // Long method justification: builds a composite DOM subtree (group container,
    // header, excerpt list, optional expander, focus listeners) for a single file
    // result. All elements share references created in this scope (e.g. the
    // excerptList used by both initial population and the expander closure).
    // Splitting would require passing those shared references as parameters or
    // returning intermediate values, increasing coupling rather than reducing it.

    const INITIAL_SHOWN = 3; // Default collapsed count (FR-4).

    const group = document.createElement("div");
    group.className = "find-widget-file-group";
    group.setAttribute("role", "listitem");
    group.setAttribute("data-file-path", fileResult.path);
    group.setAttribute("tabindex", "0");
    group.setAttribute(
      "aria-label",
      `${fileResult.title}, ${fileResult.matches.length} matches`
    );

    // File header: title + match count badge.
    const header = document.createElement("div");
    header.className = "find-widget-file-header";

    const titleSpan = document.createElement("span");
    titleSpan.className = "find-widget-file-title";
    titleSpan.textContent = fileResult.title;

    const countSpan = document.createElement("span");
    countSpan.className = "find-widget-file-match-count";
    countSpan.textContent = String(fileResult.matches.length);

    header.appendChild(titleSpan);
    header.appendChild(countSpan);
    group.appendChild(header);

    // Excerpt list.
    const excerptList = document.createElement("div");
    excerptList.className = "find-widget-excerpt-list";

    const totalMatches = fileResult.matches.length;
    const showAll = totalMatches <= INITIAL_SHOWN;
    const visibleMatches = showAll
      ? fileResult.matches
      : fileResult.matches.slice(0, INITIAL_SHOWN);

    for (const match of visibleMatches) {
      excerptList.appendChild(this._buildExcerpt(match, query, fileResult.path));
    }

    group.appendChild(excerptList);

    // "Show all N" expander — only when more than INITIAL_SHOWN matches exist.
    if (!showAll) {
      const expander = document.createElement("button");
      expander.className = "find-widget-show-all";
      expander.textContent = `Show all ${totalMatches}`;
      expander.addEventListener("click", (e) => {
        e.stopPropagation();
        // Append the hidden matches.
        for (const match of fileResult.matches.slice(INITIAL_SHOWN)) {
          excerptList.appendChild(this._buildExcerpt(match, query, fileResult.path));
        }
        expander.remove();
      });
      group.appendChild(expander);
    }

    // Focus tracking: update _focusedFilePath when this group is focused.
    group.addEventListener("focus", () => {
      this._focusedFilePath = fileResult.path;
    });
    group.addEventListener("blur", () => {
      // Clear only if focus moved outside this group.
      // setTimeout yields so the newly focused element is known before checking.
      setTimeout(() => {
        if (!group.contains(document.activeElement)) {
          if (this._focusedFilePath === fileResult.path) {
            this._focusedFilePath = null;
          }
        }
      }, 0);
    });

    return group;
  }

  /**
   * Build a single excerpt row for one LineMatch.
   *
   * The row shows: line number | highlighted line text. The matched substring
   * is wrapped in a <mark> element for the highlight (FR-4).
   *
   * @param match    - The line match from the search payload.
   * @param query    - Raw query string used to size the highlighted region.
   * @param filePath - The file path this match belongs to.
   * @returns        - The assembled excerpt <div>.
   */
  private _buildExcerpt(
    match: LineMatch,
    query: string,
    filePath: string,
  ): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "find-widget-excerpt";
    row.setAttribute("tabindex", "0");
    row.setAttribute("aria-label", `Line ${match.lineNumber}: ${match.lineText}`);
    row.setAttribute("data-line", String(match.lineNumber));
    row.setAttribute("data-col", String(match.columnStart));
    row.setAttribute("data-file", filePath);
    row.setAttribute("data-text", match.lineText);

    /*
     * Build highlighted line text. columnStart is 0-based; query.length gives
     * the character count of the highlighted region. This approach correctly
     * highlights even when the Rust search returned a case-insensitive match
     * (the match span uses the actual characters from lineText, not the query).
     */
    const before = match.lineText.slice(0, match.columnStart);
    const matched = match.lineText.slice(
      match.columnStart,
      match.columnStart + query.length
    );
    const after = match.lineText.slice(match.columnStart + query.length);

    const lineNum = document.createElement("span");
    lineNum.className = "find-widget-excerpt-linenum";
    lineNum.textContent = String(match.lineNumber);

    const text = document.createElement("span");
    text.className = "find-widget-excerpt-text";

    const beforeNode = document.createTextNode(before);
    const matchMark = document.createElement("mark");
    matchMark.className = "find-widget-match-highlight";
    matchMark.textContent = matched;
    const afterNode = document.createTextNode(after);

    text.appendChild(beforeNode);
    text.appendChild(matchMark);
    text.appendChild(afterNode);

    row.appendChild(lineNum);
    row.appendChild(text);

    // Focus tracking: update _focusedMatch and _selectedExcerptIndex when this
    // row receives focus (e.g. via mouse click or programmatic focus).
    row.addEventListener("focus", () => {
      this._focusedMatch = {
        filePath,
        lineNumber: match.lineNumber,
        columnStart: match.columnStart,
      };
      this._focusedFilePath = filePath;
      // Keep _selectedExcerptIndex in sync so keyboard navigation starts from
      // the clicked row rather than the last arrow-key position.
      const rows = this._getAllExcerptRows();
      const idx = rows.indexOf(row);
      if (idx !== -1) this._selectedExcerptIndex = idx;
    });

    return row;
  }

  /**
   * Render an error message in the vault results panel.
   *
   * @param message - The error message text to display.
   */
  private _renderVaultError(message: string): void {
    const panel = this.vaultResultsPanel;
    panel.innerHTML = "";
    panel.style.display = "block";
    const err = document.createElement("div");
    err.className = "find-widget-vault-no-results";
    err.textContent = `Search error: ${message}`;
    panel.appendChild(err);
  }

  // ---------------------------------------------------------------------------
  // Private: Vault scope — keyboard navigation
  // ---------------------------------------------------------------------------

  /** Returns all visible excerpt rows in the results panel in DOM order. */
  private _getAllExcerptRows(): HTMLDivElement[] {
    return Array.from(
      this.vaultResultsPanel.querySelectorAll<HTMLDivElement>(".find-widget-excerpt")
    );
  }

  /**
   * Select the excerpt row at `index`, update _focusedMatch, and scroll it
   * into view. Adds `find-widget-excerpt--active` class to mark it visually.
   * Calling with -1 clears the selection.
   */
  private _selectExcerptAt(index: number): void {
    const rows = this._getAllExcerptRows();
    // Clear previous selection.
    rows.forEach(r => r.classList.remove("find-widget-excerpt--active"));

    if (index < 0 || index >= rows.length) {
      this._selectedExcerptIndex = -1;
      this._focusedMatch = null;
      return;
    }

    this._selectedExcerptIndex = index;
    const row = rows[index];
    row.classList.add("find-widget-excerpt--active");
    row.scrollIntoView({ block: "nearest" });

    const filePath = row.getAttribute("data-file") ?? "";
    const lineNumber = parseInt(row.getAttribute("data-line") ?? "0", 10);
    const columnStart = parseInt(row.getAttribute("data-col") ?? "0", 10);
    this._focusedMatch = { filePath, lineNumber, columnStart };
    this._focusedFilePath = filePath;
  }

  /**
   * Move the vault result selection by `delta` steps (+1 = next, -1 = prev).
   * Clamps at boundaries (does not wrap).
   */
  private _stepVaultResult(delta: number): void {
    const rows = this._getAllExcerptRows();
    if (rows.length === 0) return;
    const next = Math.max(0, Math.min(rows.length - 1, this._selectedExcerptIndex + delta));
    this._selectExcerptAt(next);
  }

  /**
   * Update every excerpt row to show either a normal match highlight or a
   * del/ins replace preview, depending on whether the replace row is open
   * and the replace input has a value.
   *
   * Called whenever replace visibility or replace-input content changes.
   */
  private _updateExcerptPreviews(): void {
    const showPreview = this._replaceVisible && this.replaceInput.value !== "";
    const replaceTerm = this.replaceInput.value;
    const findTerm = this.findInput.value;
    const matchLen = findTerm.length;

    for (const row of this._getAllExcerptRows()) {
      const lineText = row.getAttribute("data-text") ?? "";
      const col = parseInt(row.getAttribute("data-col") ?? "0", 10);
      const textSpan = row.querySelector<HTMLSpanElement>(".find-widget-excerpt-text");
      if (!textSpan) continue;

      textSpan.textContent = "";

      if (showPreview) {
        // Show ALL occurrences on the line as del/ins — matches what
        // applyStringReplace (global replace) will actually do.
        const re = this._buildMatchRegex(findTerm);
        if (re) {
          let lastIdx = 0;
          let m: RegExpExecArray | null;
          re.lastIndex = 0;
          while ((m = re.exec(lineText)) !== null) {
            if (m.index > lastIdx) {
              textSpan.appendChild(document.createTextNode(lineText.slice(lastIdx, m.index)));
            }
            const del = document.createElement("del");
            del.className = "find-widget-match-del";
            del.textContent = m[0];
            textSpan.appendChild(del);
            const ins = document.createElement("mark");
            ins.className = "find-widget-match-ins";
            ins.textContent = replaceTerm;
            textSpan.appendChild(ins);
            lastIdx = m.index + m[0].length;
            if (m[0].length === 0) re.lastIndex++;
          }
          textSpan.appendChild(document.createTextNode(lineText.slice(lastIdx)));
        } else {
          textSpan.textContent = lineText;
        }
      } else {
        // Normal mode: single match highlight at the Rust-reported columnStart.
        const before = lineText.slice(0, col);
        const matched = lineText.slice(col, col + matchLen);
        const after = lineText.slice(col + matchLen);
        textSpan.appendChild(document.createTextNode(before));
        const mark = document.createElement("mark");
        mark.className = "find-widget-match-highlight";
        mark.textContent = matched;
        textSpan.appendChild(mark);
        textSpan.appendChild(document.createTextNode(after));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Vault scope — replace pipeline (Step 03)
  // ---------------------------------------------------------------------------

  /**
   * Convenience accessor for the current PostFilterOptions.
   *
   * Used by all replace methods to pass consistent options to applyStringReplace.
   */
  private _getPostFilterOpts(): PostFilterOptions {
    return {
      matchCase: this._matchCase,
      wholeWord: this._wholeWord,
    };
  }

  /**
   * Read, modify, and write a single file.
   *
   * This is the core file I/O method for vault replace operations. It handles:
   *   - Reading the current on-disk content (FR-8 step 1).
   *   - Applying the string replacement (applyStringReplace).
   *   - EC-6: skip write if count === 0 (content changed since search snapshot).
   *   - EC-7 / FR-9: dirty-tab collision detection and confirmation prompt.
   *   - NFR-3: applying the replacement to the open CM6 editor state so the
   *     in-memory document stays consistent.
   *   - Atomic disk write via writeFile (FR-8 step 3).
   *
   * @param path        - Absolute path to the target file.
   * @param findTerm    - The literal search term.
   * @param replaceTerm - The replacement string (may be empty for deletion, EC-13).
   * @returns The number of replacements made, or -1 if the operation was
   *          cancelled (user declined the dirty-tab prompt).
   * @throws  When writeFile fails — callers in the batch loop catch this per-file.
   */
  private async _replaceInFile(
    path: string,
    findTerm: string,
    replaceTerm: string,
  ): Promise<number> {
    // Long method justification: implements a multi-step pipeline (read → apply
    // → dirty-tab check → optional CM6 dispatch → write) where each step
    // consumes the result of the prior step. The dirty-tab branch requires an
    // async confirmation dialog, making it impossible to compose as pure
    // sub-functions without artificial promise chaining that would obscure the
    // sequential control flow the reviewer must trace during a security review.

    // FR-8 step 1: Read current on-disk content.
    const readResult = await readFile(path);
    if (!readResult.ok) {
      console.error(`FindWidget: readFile failed for "${path}":`, readResult.error.message);
      return 0;
    }

    const opts = this._getPostFilterOpts();
    const { newContent, count } = applyStringReplace(
      readResult.value,
      findTerm,
      replaceTerm,
      opts,
    );

    // EC-6: If the find term no longer exists in current content, skip the write.
    // This happens when the file was edited externally after the search ran.
    if (count === 0) {
      return 0;
    }

    // FR-9 / EC-7: Check for dirty-tab collision.
    const tm = (window as any).__MARKABLE_TAB_MANAGER__;
    const tabs: Array<{ filePath: string | null; isDirty: boolean; id: string }> =
      tm?.getTabs?.() ?? [];
    const openTab = tabs.find((t) => t.filePath === path);

    if (openTab?.isDirty) {
      // FR-9: File is open with unsaved changes — prompt before overwriting.
      const basename = path.split("/").pop() ?? path;
      const confirmed = await this._confirmDirtyTabReplace(basename);
      if (!confirmed) {
        // User cancelled — return -1 to signal skip.
        return -1;
      }
      // User confirmed — apply to CM6 state (tab stays dirty; no disk write).
      // Pass path so _applyReplaceToEditorState can guard against dispatching
      // to the wrong EditorView when the dirty tab is not the active one.
      this._applyReplaceToEditorState(path, newContent);
      return count;
    }

    if (openTab && !openTab.isDirty) {
      // NFR-3: File is open but not dirty — apply to CM6 state so the
      // in-memory document reflects the replacement before the disk write.
      this._applyReplaceToEditorState(path, newContent);
    }

    // FR-8 step 3: Atomic write via writeFile bridge.
    const writeResult = await writeFile(path, newContent);
    if (!writeResult.ok) {
      console.error(`FindWidget: writeFile failed for "${path}":`, writeResult.error.message);
      // Throw so the batch loop (step_04) can catch it as a per-file error.
      throw new Error(writeResult.error.message);
    }

    return count;
  }

  /**
   * Show a confirmation dialog before replacing content in a dirty (unsaved) tab.
   *
   * Uses the Tauri dialog plugin if available, otherwise falls back to the
   * browser's native window.confirm() (covers test environments).
   *
   * @param basename - The filename (not full path) shown in the dialog.
   * @returns true if the user confirmed; false if they cancelled.
   */
  private async _confirmDirtyTabReplace(basename: string): Promise<boolean> {
    const dialog = (window as any).__TAURI_DIALOG__;
    if (dialog?.confirm) {
      return dialog.confirm(
        `The file "${basename}" has unsaved changes. Replace anyway and discard unsaved changes?`,
        { title: "Unsaved Changes" }
      );
    }
    // Fallback for test environments.
    return window.confirm(
      `The file "${basename}" has unsaved changes. Replace anyway and discard unsaved changes?`
    );
  }

  /**
   * Replace the entire document in the CM6 editor view — but ONLY when the
   * given file path is the currently ACTIVE tab.
   *
   * Issue 4 fix: the architecture has one shared EditorView loaded with the
   * active tab's content. Dispatching to `this.view` when a non-active tab's
   * file is being replaced would corrupt the wrong document. Instead, we use
   * `window.__MARKABLE_CURRENT_FILE__` (kept in sync by TabManager._applyActiveTab)
   * to determine whether `path` is the active file. When it is not the active
   * file we skip the CM6 dispatch — the file-watcher event that fires after the
   * disk write will cause the tab to reload its content the next time the user
   * switches to it.
   *
   * Called when a replacement affects a file that is currently open in a tab
   * (NFR-3, NFR-5). This keeps the in-memory state consistent with the on-disk
   * write. Also dispatches a cleared SearchQuery to remove stale highlights.
   *
   * @param path       - The absolute file path being replaced.
   * @param newContent - The full new file content to set.
   */
  private _applyReplaceToEditorState(path: string, newContent: string): void {
    if (!this.view) return;

    // Only dispatch to the shared EditorView when path matches the active tab.
    // __MARKABLE_CURRENT_FILE__ is set by TabManager on every tab activation.
    const activeFilePath = (window as any).__MARKABLE_CURRENT_FILE__ as string | null | undefined;
    if (activeFilePath !== path) {
      // The file belongs to a non-active tab. Skip the CM6 dispatch — the disk
      // write has already been (or will be) performed by the caller, and the
      // file-watcher will reload the tab when the user next activates it.
      return;
    }

    const currentDoc = this.view.state.doc.toString();
    if (currentDoc === newContent) return;

    // Replace the entire document in a single CM6 transaction.
    this.view.dispatch({
      changes: {
        from: 0,
        to: this.view.state.doc.length,
        insert: newContent,
      },
      // Clear stale search decorations by dispatching an updated query.
      effects: setSearchQuery.of(
        new SearchQuery({ search: this.findInput.value })
      ),
    });
  }

  /**
   * Replace a single specific occurrence in a file, identified by exact line
   * number and column offset (FR-6).
   *
   * This is intentionally distinct from _replaceInFile, which replaces ALL
   * occurrences. Using _replaceInFile for the single-match "Replace" button
   * would violate FR-6 by replacing every occurrence in the file rather than
   * only the one the user focused.
   *
   * Algorithm:
   *   1. Read the current on-disk content.
   *   2. Split into lines (preserving line endings).
   *   3. Locate the target line by lineNumber (1-based).
   *   4. Verify the find term still appears at columnStart (EC-6: file may have
   *      changed since the search snapshot).
   *   5. Replace only that single occurrence on that line.
   *   6. Rejoin lines and write back.
   *   7. Update the active CM6 EditorView if the file is the active tab.
   *
   * @param path        - Absolute path to the file.
   * @param findTerm    - The literal search term.
   * @param replaceTerm - The replacement string.
   * @param lineNumber  - 1-based line number of the target occurrence.
   * @param columnStart - 0-based column offset of the target occurrence.
   * @returns true when the replacement was made; false when the occurrence
   *          was not found at the expected position (EC-6 stale snapshot).
   * @throws  When writeFile fails — caller logs this as a per-file error.
   */
  private async _replaceOneOccurrenceInFile(
    path: string,
    findTerm: string,
    replaceTerm: string,
    lineNumber: number,
    columnStart: number,
  ): Promise<boolean> {
    // Step 1: Read the current on-disk content.
    const readResult = await readFile(path);
    if (!readResult.ok) {
      console.error(`FindWidget: readFile failed for "${path}":`, readResult.error.message);
      return false;
    }

    const content = readResult.value;

    /*
     * Step 2-3: Split into lines while preserving the original line endings.
     * We separate on \n but keep \r (Windows CRLF) as part of each line so
     * the file is not re-normalised when writing back. lineNumber is 1-based,
     * so the target line is at index lineNumber - 1.
     */
    const lines = content.split("\n");
    const targetIndex = lineNumber - 1;

    if (targetIndex < 0 || targetIndex >= lines.length) {
      // EC-6: Line no longer exists — stale snapshot; skip.
      console.warn(
        `FindWidget: line ${lineNumber} out of range in "${path}" — skipping single replace`,
      );
      return false;
    }

    const targetLine = lines[targetIndex];

    // Step 4: Verify the find term still exists at the expected column.
    // Use slice to check the exact position rather than a full-line indexOf,
    // so we handle duplicate occurrences correctly.
    const actualSlice = targetLine.slice(columnStart, columnStart + findTerm.length);
    const matches =
      this._matchCase
        ? actualSlice === findTerm
        : actualSlice.toLowerCase() === findTerm.toLowerCase();

    if (!matches) {
      // EC-6: Occurrence no longer at the expected position — stale snapshot.
      console.warn(
        `FindWidget: expected "${findTerm}" at col ${columnStart} on line ${lineNumber} ` +
        `of "${path}", found "${actualSlice}" — skipping single replace`,
      );
      return false;
    }

    // Whole-word boundary check: if enabled, confirm the characters immediately
    // before and after the match are non-word characters.
    if (this._wholeWord) {
      const wordChar = /\w/;
      const charBefore = columnStart > 0 ? targetLine[columnStart - 1] : "";
      const charAfter = targetLine[columnStart + findTerm.length] ?? "";
      if ((charBefore && wordChar.test(charBefore)) || (charAfter && wordChar.test(charAfter))) {
        console.warn(
          `FindWidget: whole-word boundary check failed at col ${columnStart} ` +
          `on line ${lineNumber} of "${path}" — skipping single replace`,
        );
        return false;
      }
    }

    // Step 5: Replace only the single occurrence at columnStart.
    const newLine =
      targetLine.slice(0, columnStart) +
      replaceTerm +
      targetLine.slice(columnStart + findTerm.length);

    lines[targetIndex] = newLine;

    // Step 6: Rejoin lines with \n (original endings were preserved per line).
    const newContent = lines.join("\n");

    // FR-9 / EC-7: Check for dirty-tab collision (same logic as _replaceInFile).
    const tm = (window as any).__MARKABLE_TAB_MANAGER__;
    const tabs: Array<{ filePath: string | null; isDirty: boolean; id: string }> =
      tm?.getTabs?.() ?? [];
    const openTab = tabs.find((t) => t.filePath === path);

    if (openTab?.isDirty) {
      const basename = path.split("/").pop() ?? path;
      const confirmed = await this._confirmDirtyTabReplace(basename);
      if (!confirmed) {
        return false;
      }
      // User confirmed — update CM6 state only (no disk write for dirty tabs).
      this._applyReplaceToEditorState(path, newContent);
      return true;
    }

    if (openTab && !openTab.isDirty) {
      // NFR-3: Reflect the change in the CM6 view before the disk write.
      this._applyReplaceToEditorState(path, newContent);
    }

    // Step 7: Atomic disk write.
    const writeResult = await writeFile(path, newContent);
    if (!writeResult.ok) {
      console.error(`FindWidget: writeFile failed for "${path}":`, writeResult.error.message);
      throw new Error(writeResult.error.message);
    }

    return true;
  }

  /**
   * Replace the focused single match in vault scope.
   *
   * FR-6: "Replace" replaces only the single occurrence identified by
   * _focusedMatch.lineNumber and _focusedMatch.columnStart — not all
   * occurrences in the file. _replaceOneOccurrenceInFile enforces this.
   *
   * If no match is focused (no excerpt row has been clicked), falls back to
   * the CM6 replaceNext command (AC-8 — single-file behaviour preserved).
   */
  private async _replaceVaultMatch(): Promise<void> {
    const match = this._focusedMatch;
    const replaceTerm = this.replaceInput.value;
    const findTerm = this.findInput.value;

    if (!match || this._scope === "file") {
      // AC-8: No focused match in vault results — fall back to CM6 replace.
      replaceNext(this.view);
      this._updateCount(this._buildSearchQuery());
      return;
    }

    // Capture current position and clear state immediately so a rapid second
    // press cannot target the same occurrence again.
    const capturedIndex = this._selectedExcerptIndex;
    this._focusedMatch = null;
    this._focusedFilePath = null;
    this._selectedExcerptIndex = -1;

    try {
      await this._replaceOneOccurrenceInFile(
        match.filePath,
        findTerm,
        replaceTerm,
        match.lineNumber,
        match.columnStart,
      );
      // Always refresh so the panel reflects the current on-disk state.
      // Re-select the same index position — if the replace succeeded, the
      // current entry was removed so this index now points to the next match.
      this._pendingSelectAfterSearch = capturedIndex;
      await this._runVaultSearch();
    } catch (err) {
      console.error("FindWidget: _replaceVaultMatch error:", err);
      await this._runVaultSearch();
    }
  }

  /**
   * Replace all matches in the focused file group.
   *
   * Called by the "In File" button. _focusedFilePath is set when the user
   * focuses a file group row or an excerpt row within it.
   */
  private async _replaceAllInFile(): Promise<void> {
    const filePath = this._focusedFilePath;
    const findTerm = this.findInput.value;
    const replaceTerm = this.replaceInput.value;

    if (!filePath || !findTerm) return;

    // Clear focused state before the async operation.
    this._focusedMatch = null;
    this._focusedFilePath = null;
    this._selectedExcerptIndex = -1;

    try {
      const result = await this._replaceInFile(filePath, findTerm, replaceTerm);
      if (result !== -1) {
        // Refresh results — even when result === 0 (EC-6) so the display
        // reflects the current on-disk state.
        await this._runVaultSearch();
      }
    } catch (err) {
      // NFR-6: Surface write error without aborting (single-file path).
      console.error("FindWidget: _replaceAllInFile error:", err);
    }
  }

  // ---------------------------------------------------------------------------
  // Private: Replace All confirmation panel (Step 04)
  // ---------------------------------------------------------------------------

  /**
   * Count the total number of matches across all files in a payload.
   *
   * Used by the confirmation panel summary to show "N matches in M files".
   *
   * @param results - The filtered ContentSearchPayload.
   * @returns Total match count.
   */
  private _countTotalMatches(results: ContentSearchPayload): number {
    return results.results.reduce((sum, f) => sum + f.matches.length, 0);
  }

  /**
   * Build a RegExp that matches all occurrences of findTerm on a single line,
   * respecting the current _matchCase, _wholeWord, and _regexp toggles.
   * Returns null if findTerm is empty or the regexp is invalid.
   */
  private _buildMatchRegex(findTerm: string): RegExp | null {
    if (!findTerm) return null;
    try {
      let pattern: string;
      if (this._regexp) {
        pattern = findTerm;
      } else {
        pattern = escapeRegex(findTerm);
        if (this._wholeWord) pattern = `\\b${pattern}\\b`;
      }
      return new RegExp(pattern, this._matchCase ? "g" : "gi");
    } catch {
      return null;
    }
  }

  /**
   * Build a scrollable del/ins diff preview list from an array of file results.
   *
   * Each file gets a sticky header row. Each match gets a linenum + text row
   * using the existing .find-widget-match-del / .find-widget-match-ins classes.
   * Rendering stops once maxRows excerpt rows have been emitted and a
   * "…and N more changes" notice is appended.
   *
   * @param files       - Array of per-file results to render.
   * @param findTerm    - The literal search term (used to size the del span).
   * @param replaceTerm - The replacement string. Empty string = deletion only.
   * @param maxRows     - Maximum number of excerpt rows before capping.
   */
  private _buildPreviewList(
    files: FileContentResult[],
    findTerm: string,
    replaceTerm: string,
    maxRows: number,
  ): HTMLDivElement {
    const container = document.createElement("div");
    container.className = "find-widget-preview-list";

    let rowCount = 0;
    let remaining = 0;
    let capped = false;

    outer: for (let fi = 0; fi < files.length; fi++) {
      const file = files[fi];
      const basename = file.path.split("/").pop() ?? file.path;
      const header = document.createElement("div");
      header.className = "find-widget-preview-file-header";
      header.textContent = `${basename} (${file.matches.length})`;
      container.appendChild(header);

      for (let mi = 0; mi < file.matches.length; mi++) {
        if (rowCount >= maxRows) {
          capped = true;
          // Count remaining: rest of this file + all subsequent files.
          remaining += file.matches.length - mi;
          for (let i = fi + 1; i < files.length; i++) {
            remaining += files[i].matches.length;
          }
          break outer;
        }

        const match = file.matches[mi];
        const lineText = match.lineText;

        const row = document.createElement("div");
        row.className = "find-widget-preview-row";

        const lineNum = document.createElement("span");
        lineNum.className = "find-widget-preview-linenum";
        lineNum.textContent = String(match.lineNumber);

        const text = document.createElement("span");
        text.className = "find-widget-preview-text";

        // Render ALL occurrences of findTerm on this line as del/ins so the
        // preview accurately reflects what applyStringReplace will do (global
        // replace, not just the single columnStart occurrence).
        const re = this._buildMatchRegex(findTerm);
        if (re) {
          let lastIdx = 0;
          let m: RegExpExecArray | null;
          re.lastIndex = 0;
          while ((m = re.exec(lineText)) !== null) {
            if (m.index > lastIdx) {
              text.appendChild(document.createTextNode(lineText.slice(lastIdx, m.index)));
            }
            const del = document.createElement("del");
            del.className = "find-widget-match-del";
            del.textContent = m[0];
            text.appendChild(del);
            if (replaceTerm !== "") {
              const ins = document.createElement("mark");
              ins.className = "find-widget-match-ins";
              ins.textContent = replaceTerm;
              text.appendChild(ins);
            }
            lastIdx = m.index + m[0].length;
            if (m[0].length === 0) re.lastIndex++; // guard against zero-length matches
          }
          text.appendChild(document.createTextNode(lineText.slice(lastIdx)));
        } else {
          text.appendChild(document.createTextNode(lineText));
        }
        row.appendChild(lineNum);
        row.appendChild(text);
        container.appendChild(row);
        rowCount++;
      }
    }

    if (capped && remaining > 0) {
      const more = document.createElement("div");
      more.className = "find-widget-preview-more";
      more.textContent = `…and ${remaining} more change${remaining === 1 ? "" : "s"}`;
      container.appendChild(more);
    }

    return container;
  }

  /**
   * Show a per-file replace preview panel for the currently focused file.
   *
   * Triggered by the "In File" button click or ⌘⌥↩ in vault scope.
   * Shows a del/ins diff of all matches in the focused file with
   * "Replace In File" / "Cancel" buttons. On confirm, calls _replaceAllInFile().
   */
  private _showInFilePreview(): void {
    const filePath = this._focusedFilePath;
    const results = this._vaultResults;
    const findTerm = this.findInput.value;
    const replaceTerm = this.replaceInput.value;

    if (!filePath || !results || !findTerm) return;

    const fileResult = results.results.find((r) => r.path === filePath);
    if (!fileResult) return;

    this._confirmationVisible = true;
    const panel = this.confirmationPanel;
    panel.innerHTML = "";

    const basename = filePath.split("/").pop() ?? filePath;
    const actionVerb = replaceTerm === "" ? "Delete" : "Replace";
    const summary = document.createElement("div");
    summary.className = "find-widget-confirmation-summary";
    summary.textContent =
      `${actionVerb} in ${basename} (${fileResult.matches.length} match${fileResult.matches.length === 1 ? "" : "es"})?`;
    panel.appendChild(summary);

    panel.appendChild(this._buildPreviewList([fileResult], findTerm, replaceTerm, 200));

    const btnRow = document.createElement("div");
    btnRow.className = "find-widget-confirmation-btns";

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "find-widget-confirm-replace-all";
    confirmBtn.textContent = `${actionVerb} In File`;

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "find-widget-confirm-cancel";
    cancelBtn.textContent = "Cancel";

    btnRow.appendChild(confirmBtn);
    btnRow.appendChild(cancelBtn);
    panel.appendChild(btnRow);

    confirmBtn.addEventListener("keydown", (e) => {
      if (e.key === "Tab") { e.preventDefault(); cancelBtn.focus(); }
    });
    cancelBtn.addEventListener("keydown", (e) => {
      if (e.key === "Tab") { e.preventDefault(); confirmBtn.focus(); }
    });

    confirmBtn.addEventListener("click", () => {
      this._hideConfirmationPanel();
      void this._replaceAllInFile();
    });
    cancelBtn.addEventListener("click", () => this._hideConfirmationPanel());

    this.vaultResultsPanel.style.display = "none";
    panel.style.display = "block";
    requestAnimationFrame(() => confirmBtn.focus());
    this._clampVaultResultsHeight();
  }

  /**
   * Show the Replace All confirmation panel.
   *
   * Hides the results list and displays a summary of the pending operation
   * with "Confirm" and "Cancel" buttons. Focus is trapped between the two
   * buttons (NFR-7). The Escape handler in _attachEvents checks
   * _confirmationVisible and cancels the confirmation without closing the
   * widget (EC-17, AC-18).
   *
   * @param results     - The vault search results to act on.
   * @param findTerm    - The search term shown in the summary.
   * @param replaceTerm - The replacement string shown in the summary.
   */
  private _showConfirmationPanel(
    results: ContentSearchPayload,
    findTerm: string,
    replaceTerm: string,
  ): void {
    this._confirmationVisible = true;

    const fileCount = results.results.length;
    const matchCount = this._countTotalMatches(results);
    const scopeLabel = this._scope === "folder" ? "folder" : "vault";

    // EC-13: Use "Delete" phrasing when replace term is empty.
    const actionVerb = replaceTerm === "" ? "Delete" : "Replace";
    const actionDetail =
      replaceTerm === ""
        ? `Delete '${findTerm}' in ${fileCount} file(s) (${matchCount} matches)?`
        : `Replace '${findTerm}' with '${replaceTerm}' in ${fileCount} file(s) (${matchCount} matches)?`;

    const panel = this.confirmationPanel;
    panel.innerHTML = "";

    const summary = document.createElement("div");
    summary.className = "find-widget-confirmation-summary";
    summary.textContent = actionDetail;
    panel.appendChild(summary);

    panel.appendChild(this._buildPreviewList(results.results, findTerm, replaceTerm, 50));

    const btnRow = document.createElement("div");
    btnRow.className = "find-widget-confirmation-btns";

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "find-widget-confirm-replace-all";
    confirmBtn.textContent = `${actionVerb} All`;
    confirmBtn.setAttribute("aria-label", `Confirm ${actionVerb} All in ${scopeLabel}`);

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "find-widget-confirm-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.setAttribute("aria-label", "Cancel");

    btnRow.appendChild(confirmBtn);
    btnRow.appendChild(cancelBtn);
    panel.appendChild(btnRow);

    // NFR-7: Trap focus between the two buttons while confirmation is open.
    // Issue 8 fix: handle both Tab (forward) and Shift-Tab (backward) so
    // keyboard users cannot escape the trap in either direction. Without
    // the shiftKey check, pressing Shift-Tab on confirmBtn would move focus
    // outside the widget, breaking the accessibility contract.
    confirmBtn.addEventListener("keydown", (e) => {
      if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); cancelBtn.focus(); }
      if (e.key === "Tab" && e.shiftKey)  { e.preventDefault(); cancelBtn.focus(); }
    });
    cancelBtn.addEventListener("keydown", (e) => {
      if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); confirmBtn.focus(); }
      if (e.key === "Tab" && e.shiftKey)  { e.preventDefault(); confirmBtn.focus(); }
    });

    confirmBtn.addEventListener("click", () => {
      void this._executeReplaceAll(results, findTerm, replaceTerm);
    });

    cancelBtn.addEventListener("click", () => {
      // AC-12: Cancel — return to results list without any writes.
      this._hideConfirmationPanel();
    });

    // Hide results panel, show confirmation panel.
    this.vaultResultsPanel.style.display = "none";
    panel.style.display = "block";

    // Focus the confirm button so keyboard users can act immediately (NFR-7).
    requestAnimationFrame(() => confirmBtn.focus());

    this._clampVaultResultsHeight();
  }

  /**
   * Hide the confirmation panel and restore the results panel.
   *
   * Called by Cancel, Escape (EC-17), and the "Close" button after completion.
   */
  private _hideConfirmationPanel(): void {
    this._confirmationVisible = false;
    this.confirmationPanel.style.display = "none";
    this.confirmationPanel.innerHTML = "";

    // Restore the results panel when there are results to show.
    if (this._vaultResults && this._vaultResults.results.length > 0) {
      this.vaultResultsPanel.style.display = "block";
    }
  }

  /**
   * Execute the Replace All batch operation with per-file progress reporting.
   *
   * Each file is processed sequentially (FR-7 step 3). Per-file outcomes
   * (success, error, skipped) are accumulated and shown in the panel. The
   * batch continues even when individual files fail (EC-20, NFR-6).
   *
   * @param results     - The vault search results snapshot to act on.
   * @param findTerm    - The search term.
   * @param replaceTerm - The replacement string.
   */
  private async _executeReplaceAll(
    results: ContentSearchPayload,
    findTerm: string,
    replaceTerm: string,
  ): Promise<void> {
    // Long method justification: interleaves live DOM mutation (progress rows)
    // with sequential async file I/O so the user sees per-file feedback as each
    // replacement completes. Separating the DOM and I/O into sub-methods would
    // require passing both the live panel and the accumulated outcomes array
    // between them, creating tighter coupling than keeping the loop co-located.

    const files = results.results;
    const total = files.length;
    const panel = this.confirmationPanel;

    // Build progress UI.
    panel.innerHTML = "";
    const progressLabel = document.createElement("div");
    progressLabel.className = "find-widget-progress-label";
    progressLabel.textContent = `Replacing 0 of ${total} files…`;
    panel.appendChild(progressLabel);

    const progressList = document.createElement("div");
    progressList.className = "find-widget-progress-list";
    panel.appendChild(progressList);

    type FileOutcome = {
      path: string;
      title: string;
      count: number;
      error?: string;
      skipped?: boolean;
    };
    const outcomes: FileOutcome[] = [];

    for (let i = 0; i < files.length; i++) {
      const fileResult = files[i];
      progressLabel.textContent = `Replacing ${i + 1} of ${total} files…`;

      let outcome: FileOutcome;
      try {
        const count = await this._replaceInFile(
          fileResult.path,
          findTerm,
          replaceTerm,
        );
        if (count === -1) {
          // User cancelled this file (dirty tab, FR-9).
          outcome = { path: fileResult.path, title: fileResult.title, count: 0, skipped: true };
        } else {
          outcome = { path: fileResult.path, title: fileResult.title, count };
        }
      } catch (err) {
        // EC-8, EC-20: Write failed — surface per-file error; continue batch.
        const msg = err instanceof Error ? err.message : String(err);
        outcome = { path: fileResult.path, title: fileResult.title, count: 0, error: msg };
      }

      outcomes.push(outcome);

      // Append per-file result row to the progress list.
      const row = document.createElement("div");
      row.className = "find-widget-progress-row";

      const icon = document.createElement("span");
      if (outcome.error) {
        icon.className = "find-widget-progress-icon error";
        icon.textContent = "✕";
        icon.setAttribute("aria-label", "failed");
      } else if (outcome.skipped) {
        icon.className = "find-widget-progress-icon skipped";
        icon.textContent = "–";
        icon.setAttribute("aria-label", "skipped");
      } else {
        icon.className = "find-widget-progress-icon success";
        icon.textContent = "✓";
        icon.setAttribute("aria-label", "replaced");
      }

      const label = document.createElement("span");
      label.className = "find-widget-progress-file";
      label.textContent = outcome.title;

      if (outcome.error) {
        const errSpan = document.createElement("span");
        errSpan.className = "find-widget-progress-error-msg";
        errSpan.textContent = ` — ${outcome.error}`;
        label.appendChild(errSpan);
      }

      row.appendChild(icon);
      row.appendChild(label);
      progressList.appendChild(row);
    }

    // Done — update the label with a final summary.
    const succeeded = outcomes.filter((o) => !o.error && !o.skipped).length;
    const failed = outcomes.filter((o) => !!o.error).length;
    const skipped = outcomes.filter((o) => !!o.skipped).length;
    progressLabel.textContent =
      `Done. ${succeeded} replaced` +
      (skipped > 0 ? `, ${skipped} skipped` : "") +
      (failed > 0 ? `, ${failed} failed` : "") +
      ".";

    // Add a "Close" button so the user can dismiss the progress panel.
    const doneBtn = document.createElement("button");
    doneBtn.className = "find-widget-progress-done";
    doneBtn.textContent = "Close";
    doneBtn.addEventListener("click", () => {
      this._hideConfirmationPanel();
    });
    panel.appendChild(doneBtn);

    // FR-7 step 5: Refresh results after all replacements complete.
    await this._runVaultSearch();
  }

  // ---------------------------------------------------------------------------
  // Private: Viewport overflow clamping (Step 05)
  // ---------------------------------------------------------------------------

  /**
   * Dynamically clamp the max-height of the vault results and confirmation
   * panels so the widget does not overflow the viewport vertically (EC-16, FR-16).
   *
   * Called after any operation that changes the results panel content:
   *   - _renderVaultResults()
   *   - _showConfirmationPanel()
   *   - _onMouseMove (during drag, when results are visible)
   *
   * The available height is calculated as: viewport height minus the widget's
   * top edge minus the height of the non-results rows minus a padding buffer.
   * The result is clamped to [MIN_RESULTS_HEIGHT, DEFAULT_MAX_HEIGHT].
   */
  private _clampVaultResultsHeight(): void {
    const PADDING = 16;             // px gap between widget bottom and viewport edge
    const MIN_RESULTS_HEIGHT = 80;  // never shrink below this (usability floor)
    const DEFAULT_MAX_HEIGHT = 320; // FR-16 default max-height

    const widgetTop = parseFloat(this.root.style.top) || 54;
    const viewportHeight = window.innerHeight;

    // Calculate the height of non-results content (find row + scope row + replace row).
    // We measure the current root height and subtract the panel's scroll height to
    // estimate the "chrome" height that is always present.
    const panelScrollHeight = this.vaultResultsPanel.scrollHeight || 0;
    const currentRootHeight = this.root.offsetHeight || 200;
    const nonPanelHeight = currentRootHeight - Math.min(panelScrollHeight, DEFAULT_MAX_HEIGHT);

    const availableForPanel =
      viewportHeight - widgetTop - nonPanelHeight - PADDING;

    const clampedMax = Math.max(
      MIN_RESULTS_HEIGHT,
      Math.min(DEFAULT_MAX_HEIGHT, availableForPanel),
    );

    this.vaultResultsPanel.style.maxHeight = `${clampedMax}px`;
    this.confirmationPanel.style.maxHeight = `${clampedMax}px`;
  }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

/**
 * Create and return a new FindWidget instance bound to the given EditorView.
 *
 * FR-3.1: The widget is appended to document.body on construction and hidden
 * by default. Call widget.open() to show it.
 *
 * @param view - The CM6 EditorView that search commands will be dispatched to.
 */
export function createFindWidget(view: EditorView): FindWidget {
  return new FindWidget(view);
}

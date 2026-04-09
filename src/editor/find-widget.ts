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
  private findInput: HTMLInputElement;
  /** Text input for the replacement string (in the replace row). */
  private replaceInput: HTMLInputElement;
  /** Span showing "N of M" or "No results" or "Invalid". */
  private countLabel: HTMLSpanElement;
  /** Toggle button: match case (Aa). */
  private toggleMatchCase: HTMLButtonElement;
  /** Toggle button: whole word (ab). */
  private toggleWholeWord: HTMLButtonElement;
  /** Toggle button: regular expression (.*). */
  private toggleRegexp: HTMLButtonElement;
  /** Chevron button that shows/hides the replace row. */
  private chevronBtn: HTMLButtonElement;
  /** The collapsible replace row. */
  private replaceRow: HTMLDivElement;
  /** "Replace" button (replace current match). */
  private replaceOneBtn: HTMLButtonElement;
  /** "All" button (replace all matches). */
  private replaceAllBtn: HTMLButtonElement;
  /** Navigation buttons — store refs for click handlers. */
  private prevBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  /** Close × button. */
  private closeBtn: HTMLButtonElement;

  // ---- Widget state fields ----

  /** Whether the widget is currently visible. */
  private _isOpen: boolean = false;
  /** Whether the replace row is expanded. */
  private _replaceVisible: boolean = false;

  // ---- Toggle state (mirrored into SearchQuery on every change) ----

  private _matchCase: boolean = false;
  private _wholeWord: boolean = false;
  private _regexp: boolean = false;

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
  private _onMouseMove: (e: MouseEvent) => void;

  /**
   * Bound mouseup handler. Same rationale as _onMouseMove above.
   */
  private _onMouseUp: () => void;

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  constructor(view: EditorView) {
    this.view = view;
    this.root = this._buildDom();
    document.body.appendChild(this.root);
    this._attachDrag();
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
    chevronBtn.setAttribute("title", "Toggle Replace");
    chevronBtn.setAttribute("aria-expanded", "false");
    chevronBtn.textContent = "›";
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
    prevBtn.setAttribute("title", "Previous Match (Shift+Enter)");
    prevBtn.textContent = "↑";
    findRow.appendChild(prevBtn);

    // Next match button.
    const nextBtn = document.createElement("button");
    nextBtn.className = "find-widget-next";
    nextBtn.setAttribute("aria-label", "Next Match");
    nextBtn.setAttribute("title", "Next Match (Enter)");
    nextBtn.textContent = "↓";
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
    replaceOneBtn.setAttribute("title", "Replace (Enter)");
    replaceOneBtn.textContent = "Replace";
    replaceRow.appendChild(replaceOneBtn);

    const replaceAllBtn = document.createElement("button");
    replaceAllBtn.className = "find-widget-replace-all";
    replaceAllBtn.setAttribute("aria-label", "Replace All");
    replaceAllBtn.setAttribute("title", "Replace All");
    replaceAllBtn.textContent = "All";
    replaceRow.appendChild(replaceAllBtn);

    root.appendChild(replaceRow);

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
        this.close();
        return;
      }
      // Cmd-Return: find next match.
      if (e.key === "Enter" && e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        findNext(this.view);
        this._updateCount(this._buildSearchQuery());
        return;
      }
      // Cmd-Opt-Return: replace current match. Only active when replace row is
      // visible so the shortcut doesn't surprise the user in find-only mode.
      if (e.key === "Enter" && e.metaKey && e.altKey && !e.shiftKey && this._replaceVisible) {
        e.preventDefault();
        e.stopPropagation();
        replaceNext(this.view);
        this._updateCount(this._buildSearchQuery());
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
        // FR-6.6: Enter → advance to the next match. Exclude Cmd-Enter, which
        // is handled by the root listener as the explicit "find next" shortcut.
        e.preventDefault();
        findNext(this.view);
        this._updateCount(this._buildSearchQuery());
      } else if (e.key === "Enter" && e.shiftKey && !e.metaKey) {
        // FR-6.7: Shift-Enter → go to the previous match.
        e.preventDefault();
        findPrevious(this.view);
        this._updateCount(this._buildSearchQuery());
      } else if (e.key === "Tab" && !e.shiftKey && this._replaceVisible) {
        // FR-6.8: Tab moves focus to the replace input when the replace row
        // is visible. This makes keyboard-only find-and-replace efficient.
        e.preventDefault();
        this.replaceInput.focus();
      }
      // Escape is handled by the root keydown listener above.
    });

    // ---- Replace input: keep replacement text in sync with SearchQuery ----
    this.replaceInput.addEventListener("input", () => {
      // The replace text must be part of the SearchQuery so that replaceNext
      // and replaceAll use the current value, not the value at query creation.
      this._dispatchQuery();
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
      // FR-4.2 / AC-13: Advance to next match (wraps at document end — EC-18
      // is CM6 default behavior; no extra code needed).
      findNext(this.view);
      // FR-12.4: Update the "N of M" count after each navigation step.
      this._updateCount(this._buildSearchQuery());
    });

    this.prevBtn.addEventListener("click", () => {
      // FR-4.3 / AC-13: Go to the previous match.
      findPrevious(this.view);
      this._updateCount(this._buildSearchQuery());
    });

    // ---- Replace buttons ----
    this.replaceOneBtn.addEventListener("click", () => {
      // FR-4.4 / AC-21: Replace the current match and advance to the next.
      // EC-28: replaceNext is a no-op when there are zero matches (CM6 handles).
      replaceNext(this.view);
      this._updateCount(this._buildSearchQuery());
    });

    this.replaceAllBtn.addEventListener("click", () => {
      // FR-4.5 / AC-22: Replace all matches in a single CM6 transaction.
      // EC-8: Single transaction guarantees one-step undo (Cmd-Z).
      replaceAll(this.view);
      this._updateCount(this._buildSearchQuery());
    });

    // ---- Close button ----
    this.closeBtn.addEventListener("click", () => {
      this.close();
    });
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
      if (indexCursor.value.to > selFrom) break;
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

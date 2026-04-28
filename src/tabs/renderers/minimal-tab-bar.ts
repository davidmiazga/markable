/**
 * minimal-tab-bar.ts — MinimalTabBar renderer for the multi-document tab system.
 *
 * Renders the compact dot/pill strip that sits below the title bar. Each open
 * document is represented as a small gray circle; the active document expands
 * to a wider pill. Dirty documents display a small amber dot overlay.
 *
 * Implements the ITabRenderer interface defined in tab-types.ts so TabManager
 * can swap this renderer in/out without knowing its internals.
 *
 * Tooltip behavior (FR-3.1):
 *   A single shared <div id="tab-tooltip"> is appended to document.body on
 *   mount and removed on destroy. Each dot starts an 800 ms timer on mouseenter
 *   to show the tooltip near the cursor; mouseleave or click cancels the timer
 *   and hides the tooltip immediately.
 */

// Vite processes this CSS import at bundle time so all tab styles are included
// in the final build without a separate <link> tag in index.html.
import "../tabs.css";

import type { TabEntry, ITabRenderer } from "../tab-types";
import { TAB_SOFT_WARNING_THRESHOLD } from "../tab-types";
import { showTabContextMenu, closeTabContextMenu } from "../tab-context-menu";

/** Delay in milliseconds before the hover tooltip appears (FR-3.1). */
const TOOLTIP_DELAY_MS = 800;

/**
 * ID for the shared tooltip element so it can be found and removed during
 * destroy() and to prevent duplicate creation across mount/destroy cycles.
 */
const TOOLTIP_ELEMENT_ID = "tab-tooltip";

export class MinimalTabBar implements ITabRenderer {
  // ── Private state ────────────────────────────────────────────────────────────

  /**
   * The #tab-strip (or any container passed to mount()). Null before mount()
   * and after destroy() so method guards are uniform.
   */
  private container: HTMLElement | null = null;

  /**
   * Callback fired when the user clicks a dot to switch to that tab.
   * Provided by TabManager as `(id) => this.activateTab(id)`.
   */
  private readonly onActivate: (id: string) => void;


  /** Inner track element — dots are appended here so the track can be
   *  absolutely centred in the strip without dots affecting the position. */
  private trackEl: HTMLElement | null = null;

  /** Reference to the shared tooltip element created in mount(). */
  private tooltipEl: HTMLElement | null = null;

  /**
   * The pending setTimeout handle for showing the tooltip.
   * Stored so it can be cancelled on mouseleave before the delay expires.
   * null means no timer is currently running.
   */
  private tooltipTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Constructor ───────────────────────────────────────────────────────────────

  /**
   * Creates a MinimalTabBar instance.
   *
   * The instance is reusable: call mount() to attach it to a container, and
   * destroy() to detach. TabManager creates one instance per mode-switch
   * rather than keeping a long-lived instance across mode changes.
   *
   * @param onActivate  Called with the tab id when the user clicks a dot.
   * @param onClose     Optional; not used by MinimalTabBar (no close buttons).
   */
  constructor(
    onActivate: (id: string) => void,
    // onClose is accepted for constructor-signature parity with step_03's
    // RegularTabBar (which does render close buttons) but is not stored or
    // used in MinimalTabBar because dot mode has no close button.
    _onClose?: (id: string) => void,
  ) {
    this.onActivate = onActivate;
  }

  // ── ITabRenderer interface ────────────────────────────────────────────────────

  /**
   * Attaches the renderer to container, sets required ARIA roles, and
   * performs the first render.
   *
   * mount() is called once per renderer lifetime. It must be idempotent with
   * respect to the DOM: it appends exactly one tooltip element to body and
   * does not accumulate duplicates on repeated calls (protect yourself by
   * checking if the tooltip element already exists before creating it).
   *
   * @param container    The #tab-strip element (or any wrapper in tests).
   * @param tabs         Current tab array snapshot.
   * @param activeIndex  Index of the currently active tab.
   */
  mount(
    container: HTMLElement,
    tabs: TabEntry[],
    activeIndex: number,
  ): void {
    this.container = container;

    // Mark the container as a tab list for screen readers (NFR-3).
    container.setAttribute("role", "tablist");

    // Mode class lets CSS apply minimal-specific sizing (height, gap, padding).
    container.classList.add("tab-mode-minimal");

    // Create the centred track that dots live inside. The track is absolutely
    // positioned at left:50% so its centre is always at the strip's centre
    // regardless of how many dots are open or how wide the active pill is.
    const track = document.createElement("div");
    track.className = "tab-dot-track";
    container.appendChild(track);
    this.trackEl = track;

    // Create the shared tooltip element and attach it to document.body.
    // Guard against duplicates: a previous destroy() should have removed it,
    // but defensive coding prevents ghost elements if destroy() was not called.
    this._ensureTooltipEl();

    // Do the initial render by reusing update() so rendering logic is not duplicated.
    this.update(tabs, activeIndex);
  }

  /**
   * Re-renders the dot strip after any state change.
   *
   * Uses a full innerHTML clear + re-build rather than diffing. The dot count
   * is small (typically 1–10) so the cost is negligible and the logic stays
   * simple. Correctness is more important than micro-optimisation at this stage.
   *
   * @param tabs         Current tab array snapshot.
   * @param activeIndex  Index of the currently active tab.
   */
  update(tabs: TabEntry[], activeIndex: number): void {
    if (!this.container || !this.trackEl) return;
    // Close any open context menu before rebuilding DOM (EC-12, EC-16, EC-17).
    closeTabContextMenu();

    // Wipe the existing dots. Any event listeners on the old <button> elements
    // are garbage-collected with their nodes — no manual cleanup required.
    this.trackEl.innerHTML = "";

    // Render one dot per tab into the centred track.
    tabs.forEach((tab, i) => {
      const btn = this._createDotButton(tab, i === activeIndex);
      this.trackEl!.appendChild(btn);
    });

    // Soft-warning indicator (FR-9, step_08): when the user has more tabs open
    // than the recommended threshold, add a visual warning class so the CSS can
    // dim the dots and append a count label via ::after content.
    const overLimit = tabs.length > TAB_SOFT_WARNING_THRESHOLD;
    this.container.classList.toggle("tab-over-limit", overLimit);

    if (overLimit) {
      // The count is written to a data attribute so the CSS ::after pseudo-element
      // can render it without a dedicated DOM node (see tabs.css).
      this.container.dataset.tabWarning = `${tabs.length} tabs open`;
    } else {
      // Clean up the data attribute when the count drops back below the threshold
      // so the CSS does not show stale text.
      delete this.container.dataset.tabWarning;
    }
  }

  /**
   * Tears down all renderer DOM and cancels any pending tooltip timer.
   *
   * After destroy() the container is returned to a neutral state so the next
   * renderer can mount into it cleanly. The tooltip element is removed from
   * document.body to prevent dangling DOM nodes (NFR-5).
   */
  destroy(): void {
    // Close any open context menu before tearing down the renderer DOM (EC-11).
    closeTabContextMenu();

    // Cancel any pending tooltip timer to prevent the tooltip from appearing
    // after the renderer has been destroyed (would reference a removed element).
    this._cancelTooltipTimer();

    // Remove the tooltip from document.body.
    if (this.tooltipEl && this.tooltipEl.parentNode) {
      this.tooltipEl.parentNode.removeChild(this.tooltipEl);
    }
    this.tooltipEl = null;

    if (!this.container) return;

    // Remove the mode class so the next renderer starts with a clean container.
    this.container.classList.remove("tab-mode-minimal");

    // Remove the ARIA role — the container is neutral until the next renderer
    // calls mount() and sets its own role.
    this.container.removeAttribute("role");

    // Clear all dot buttons, the track, and their event listeners.
    this.container.innerHTML = "";

    this.container = null;
    this.trackEl = null;
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  /**
   * Creates and returns a single dot/pill <button> element for one tab.
   *
   * The button is keyboard-accessible (buttons are naturally in the tab order),
   * labeled via aria-label for screen readers, and has aria-selected to
   * indicate the active state (NFR-3).
   *
   * @param tab       The TabEntry this dot represents.
   * @param isActive  Whether this tab is currently active.
   * @returns  A configured button element ready to be appended.
   */
  private _createDotButton(tab: TabEntry, isActive: boolean): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "tab-dot";
    btn.setAttribute("role", "tab");

    // aria-selected drives CSS (.tab-dot[aria-selected="true"]) for the pill shape.
    btn.setAttribute("aria-selected", String(isActive));

    // aria-label gives screen readers the document name (NFR-3).
    btn.setAttribute("aria-label", tab.title);

    // Dirty indicator via CSS class; the ::after pseudo-element draws the dot.
    if (tab.isDirty) {
      btn.classList.add("is-dirty");
    }

    // Wire the tooltip (800 ms delay, FR-3.1).
    this._attachTooltipHandlers(btn, tab);

    // Click handler delegates to the TabManager callback.
    btn.addEventListener("click", () => {
      // Hide the tooltip immediately on click so it doesn't linger after the
      // tab switch updates the strip (which rebuilds all buttons).
      this._cancelTooltipTimer();
      this._hideTooltip();
      this.onActivate(tab.id);
    });

    // Right-click: show the tab context menu (FR-1.1 / EC-13).
    // EC-13: even for the small dot buttons (8px circles), clientX/clientY
    // from the native event provides the correct viewport coordinates.
    // stopPropagation prevents the event from reaching any ancestor that might
    // also have a contextmenu handler (EC-10).
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showTabContextMenu(tab, e.clientX, e.clientY);
    });

    return btn;
  }

  /**
   * Ensures the shared tooltip element exists in document.body.
   *
   * Called from mount(). If an element with TOOLTIP_ELEMENT_ID already exists
   * (e.g. because destroy() was not called before re-mount), it is reused to
   * prevent duplicate elements.
   */
  private _ensureTooltipEl(): void {
    // Reuse an existing tooltip element from a previous mount() cycle.
    const existing = document.getElementById(TOOLTIP_ELEMENT_ID);
    if (existing) {
      this.tooltipEl = existing;
      return;
    }

    // Create a fresh tooltip div. Styling is handled by #tab-tooltip in tabs.css.
    const tooltip = document.createElement("div");
    tooltip.id = TOOLTIP_ELEMENT_ID;
    // aria-live="polite" lets screen readers announce tooltip content when it
    // appears without interrupting the user's current focus (NFR-3).
    tooltip.setAttribute("aria-live", "polite");
    document.body.appendChild(tooltip);
    this.tooltipEl = tooltip;
  }

  /**
   * Attaches mouseenter/mouseleave handlers to a dot button that show/hide the
   * tooltip after the required 800 ms delay (FR-3.1).
   *
   * Tooltip content is the tab title plus the file path when available:
   *   "my-note"                     (untitled)
   *   "my-note — /Users/.../my-note.md"  (saved file)
   *
   * The button is also wired up as the tooltip's aria-describedby target so
   * screen readers can associate the tooltip with the button (NFR-3).
   *
   * @param btn  The dot button element.
   * @param tab  The TabEntry whose label should appear in the tooltip.
   */
  private _attachTooltipHandlers(btn: HTMLButtonElement, tab: TabEntry): void {
    if (!this.tooltipEl) return;

    // Give the tooltip a stable id so aria-describedby can reference it.
    // (The id is already set to TOOLTIP_ELEMENT_ID in _ensureTooltipEl.)
    btn.setAttribute("aria-describedby", TOOLTIP_ELEMENT_ID);

    btn.addEventListener("mouseenter", () => {
      // Start the delay timer. Any previous timer is cancelled first to prevent
      // multiple timers from running if the mouse moves between dots quickly.
      this._cancelTooltipTimer();

      this.tooltipTimer = setTimeout(() => {
        if (!this.tooltipEl) return;

        // Build tooltip label: title, and path if the document has been saved.
        const label = tab.filePath
          ? `${tab.title} — ${tab.filePath}`
          : tab.title;
        this.tooltipEl.textContent = label;

        // Position the tooltip below the dot using its bounding rect.
        // fixed positioning is used (matching the CSS) so scrolling does not
        // misalign it.
        const rect = btn.getBoundingClientRect();
        this.tooltipEl.style.top = `${rect.bottom + 4}px`;
        this.tooltipEl.style.left = `${rect.left}px`;

        this.tooltipEl.style.display = "block";
      }, TOOLTIP_DELAY_MS);
    });

    btn.addEventListener("mouseleave", () => {
      this._cancelTooltipTimer();
      this._hideTooltip();
    });
  }

  /**
   * Cancels the pending tooltip show timer, if any.
   *
   * Safe to call multiple times — a no-op when no timer is running.
   */
  private _cancelTooltipTimer(): void {
    if (this.tooltipTimer !== null) {
      clearTimeout(this.tooltipTimer);
      this.tooltipTimer = null;
    }
  }

  /**
   * Hides the tooltip element without removing it from the DOM.
   *
   * The element stays in document.body between show/hide cycles to avoid
   * the cost of creating/destroying it on every tooltip interaction. The CSS
   * default is `display: none`; this method restores that state.
   */
  private _hideTooltip(): void {
    if (this.tooltipEl) {
      this.tooltipEl.style.display = "none";
    }
  }
}

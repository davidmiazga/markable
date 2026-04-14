/**
 * vertical-tab-strip.ts — VerticalTabStrip renderer for the multi-document tab system.
 *
 * Renders an Obsidian-style vertical strip of narrow columns inserted as the
 * first child of #app-row (NOT inside #tab-strip). Each column represents one
 * open document and displays:
 *   - The document title rotated 90° so it reads bottom-to-top
 *   - A × close button that appears on hover
 *   - A dirty-state dot appended to the title via CSS ::after
 *
 * When this renderer is active, #tab-strip is hidden by the CSS rule
 * `#tab-strip.tab-mode-vertical { display: none }` (set via the class
 * added in mount() and removed in destroy()).
 *
 * Implements the ITabRenderer interface defined in tab-types.ts so TabManager
 * can swap this renderer in/out without knowing its internals.
 *
 * DOM structure per item:
 * ```html
 * <button class="tab-vertical-item [is-dirty]" role="tab"
 *         aria-selected="[true/false]" aria-label="[title]">
 *   <span class="tab-vertical-text">[title]</span>
 *   <button class="tab-close" aria-label="Close [title]">×</button>
 * </button>
 * ```
 */

// Vite processes this CSS import at bundle time so all tab styles are included
// in the final build without a separate <link> tag in index.html.
import "../tabs.css";

import type { TabEntry, ITabRenderer } from "../tab-types";
import { TAB_SOFT_WARNING_THRESHOLD } from "../tab-types";

export class VerticalTabStrip implements ITabRenderer {
  // ── Private state ────────────────────────────────────────────────────────────

  /**
   * The #tab-strip container passed to mount(). This renderer adds a class to
   * it (to hide #tab-strip via CSS) but renders its own DOM into #app-row.
   * Null before mount() and after destroy() so method guards are uniform.
   */
  private container: HTMLElement | null = null;

  /**
   * The #tab-vertical-strip element created by mount() and inserted into
   * #app-row as its first child. Null before mount() and after destroy().
   */
  private stripEl: HTMLElement | null = null;

  /**
   * Callback fired when the user clicks a vertical item to switch to that tab.
   * Provided by TabManager as `(id) => this.activateTab(id)`.
   */
  private readonly onActivate: (id: string) => void;

  /**
   * Callback fired when the user clicks the × close button on a vertical item.
   * Provided by TabManager as `(id) => void this.closeTab(id)`.
   */
  private readonly onClose: (id: string) => void;

  // ── Constructor ───────────────────────────────────────────────────────────────

  /**
   * Creates a VerticalTabStrip instance.
   *
   * The instance is reusable: call mount() to attach it and destroy() to
   * detach. TabManager creates one instance per mode-switch rather than
   * keeping a long-lived instance across mode changes.
   *
   * @param onActivate  Called with the tab id when the user clicks a strip item.
   * @param onClose     Called with the tab id when the user clicks a × close button.
   */
  constructor(
    onActivate: (id: string) => void,
    onClose: (id: string) => void,
  ) {
    this.onActivate = onActivate;
    this.onClose = onClose;
  }

  // ── ITabRenderer interface ────────────────────────────────────────────────────

  /**
   * Attaches the renderer to the DOM.
   *
   * Unlike the horizontal renderers, this renderer does NOT render into
   * `container` (#tab-strip). Instead it:
   *   1. Adds class "tab-mode-vertical" to container — CSS then sets
   *      `display: none` on #tab-strip, hiding the horizontal strip.
   *   2. Locates #app-row and inserts a new #tab-vertical-strip element as
   *      the first flex child so it appears to the left of #sidebar-left.
   *   3. Delegates the first render to update().
   *
   * @param container    The #tab-strip element — its class list is modified,
   *                     but no children are added to it.
   * @param tabs         Current tab array snapshot.
   * @param activeIndex  Index of the currently active tab.
   */
  mount(
    container: HTMLElement,
    tabs: TabEntry[],
    activeIndex: number,
  ): void {
    this.container = container;

    // Hide #tab-strip by adding the mode class. The CSS rule
    // `#tab-strip.tab-mode-vertical { display: none }` handles the rest.
    container.classList.add("tab-mode-vertical");

    // Locate the flex row that holds sidebar + editor. The vertical strip must
    // be inserted here so it participates in the same flex layout.
    const appRow = document.getElementById("app-row");
    if (!appRow) {
      // Programming error: #app-row must exist before mount() is called.
      // SidebarManager.init() creates it; TabManager.init() is called after.
      console.error(
        "VerticalTabStrip.mount: #app-row not found in DOM. " +
        "Ensure SidebarManager.init() has been called before TabManager.init()."
      );
      return;
    }

    // Create the vertical strip container and give it the required ARIA role
    // so screen readers treat it as a tab list (NFR-3).
    const stripEl = document.createElement("div");
    stripEl.id = "tab-vertical-strip";
    stripEl.setAttribute("role", "tablist");

    // Insert as the first child of #app-row so it appears left of #sidebar-left
    // and the editor. insertBefore(node, null) would append — use firstChild
    // to guarantee first-position insertion regardless of existing children.
    appRow.insertBefore(stripEl, appRow.firstChild);

    this.stripEl = stripEl;

    // Delegate the first render to update() so rendering logic is not duplicated.
    this.update(tabs, activeIndex);
  }

  /**
   * Re-renders all vertical strip items after any state change (open, close,
   * activate, dirty toggle).
   *
   * Uses a full innerHTML clear + re-build rather than diffing. The tab count
   * is typically small (≤30) so the cost is negligible and the logic stays
   * simple. Correctness matters more than micro-optimisation at this stage.
   *
   * @param tabs         Current tab array snapshot.
   * @param activeIndex  Index of the currently active tab.
   */
  update(tabs: TabEntry[], activeIndex: number): void {
    // Guard: update() is a no-op if mount() has not been called (or was called
    // without a valid #app-row — stripEl would be null in that case).
    if (!this.stripEl) return;

    // Wipe existing item buttons. Any event listeners on the old <button>
    // elements are garbage-collected with their nodes — no manual cleanup needed.
    this.stripEl.innerHTML = "";

    // Render one column item per tab.
    tabs.forEach((tab, i) => {
      const itemEl = this._buildItemEl(tab, i === activeIndex);
      this.stripEl!.appendChild(itemEl);
    });

    // Soft-warning indicator (FR-9, step_08): when the user has more tabs open
    // than the recommended threshold, add a visual warning class so the CSS
    // can display an indicator (e.g. via ::after pseudo-element).
    const overLimit = tabs.length > TAB_SOFT_WARNING_THRESHOLD;
    this.stripEl.classList.toggle("tab-over-limit", overLimit);
  }

  /**
   * Tears down all renderer DOM and resets the container to a neutral state.
   *
   * Removes #tab-vertical-strip from the DOM and removes the "tab-mode-vertical"
   * class from the container (#tab-strip), making it visible again.
   *
   * After destroy(), the container is ready for the next renderer to mount
   * into it cleanly (NFR-5).
   */
  destroy(): void {
    // Remove the vertical strip element from the DOM entirely.
    // Optional-chaining makes this safe to call before mount() or after a
    // second destroy() (idempotent teardown).
    this.stripEl?.remove();
    this.stripEl = null;

    if (!this.container) return;

    // Remove the mode class to un-hide #tab-strip. The next renderer will set
    // its own class in mount().
    this.container.classList.remove("tab-mode-vertical");

    this.container = null;
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  /**
   * Creates and returns a single vertical strip <button> element for one tab.
   *
   * The element structure:
   * ```html
   * <button class="tab-vertical-item [is-dirty]" role="tab"
   *         aria-selected="[true/false]" aria-label="[title]">
   *   <span class="tab-vertical-text">[title]</span>
   *   <button class="tab-close" aria-label="Close [title]">×</button>
   * </button>
   * ```
   *
   * The title text is rotated 90° via CSS (`writing-mode: vertical-rl;
   * transform: rotate(180deg)`) so it reads bottom-to-top in the narrow column.
   *
   * Click routing:
   *   - Click on the outer button → calls this.onActivate(tab.id)
   *   - Click on close button → calls this.onClose(tab.id) and calls
   *     stopPropagation() so the outer button's click does NOT fire (FR-5.2).
   *
   * @param tab       The TabEntry this item represents.
   * @param isActive  Whether this tab is currently active.
   * @returns  A configured button element ready to be appended to stripEl.
   */
  private _buildItemEl(tab: TabEntry, isActive: boolean): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "tab-vertical-item";
    btn.setAttribute("role", "tab");

    // aria-selected drives CSS `.tab-vertical-item[aria-selected="true"]` for
    // the active-state accent border and background.
    btn.setAttribute("aria-selected", String(isActive));

    // aria-label gives screen readers the document name (NFR-3).
    btn.setAttribute("aria-label", tab.title);

    // Toggle is-dirty so CSS can append a dirty-indicator bullet via ::after
    // on `.tab-vertical-item.is-dirty .tab-vertical-text::after`.
    btn.classList.toggle("is-dirty", tab.isDirty);

    // Title text — the CSS rotates this 90° so it reads bottom-to-top.
    // `writing-mode: vertical-rl` plus `transform: rotate(180deg)` achieves
    // the correct reading direction without JavaScript coordinate math.
    const textSpan = document.createElement("span");
    textSpan.className = "tab-vertical-text";
    textSpan.textContent = tab.title;
    btn.appendChild(textSpan);

    // Close button — shown only on hover (CSS: `.tab-vertical-item .tab-close {
    // opacity: 0 }` and `.tab-vertical-item:hover .tab-close { opacity: 1 }`).
    // stopPropagation prevents the click from reaching the outer button so that
    // closing a tab does not also activate it (FR-5.2).
    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close";
    closeBtn.setAttribute("aria-label", `Close ${tab.title}`);
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", (e) => {
      // Prevent the click from reaching the outer button's handler so that
      // onActivate is NOT called when the user closes a tab (FR-5.2).
      e.stopPropagation();
      this.onClose(tab.id);
    });
    btn.appendChild(closeBtn);

    // Outer button click: activate the tab. Fires only when the user clicks
    // the item area, not the close button (guarded by stopPropagation above).
    btn.addEventListener("click", () => {
      this.onActivate(tab.id);
    });

    return btn;
  }
}

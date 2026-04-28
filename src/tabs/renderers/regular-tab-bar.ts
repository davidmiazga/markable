/**
 * regular-tab-bar.ts — RegularTabBar renderer for the multi-document tab system.
 *
 * Renders a horizontal bar of filename tabs, each showing:
 *   - A dirty-state dot indicator (amber bullet, hidden when clean)
 *   - The document title (filename without extension, or "Untitled")
 *   - A × close button
 *
 * A "+" button sits at the right end of the bar and calls onNew() to open a
 * new untitled tab.
 *
 * The active tab is distinguished by aria-selected="true" and the CSS rule
 * `.tab-label[aria-selected="true"]` which applies an accent underline and a
 * slightly lighter background.
 *
 * Implements the ITabRenderer interface defined in tab-types.ts so TabManager
 * can swap this renderer in/out alongside MinimalTabBar and VerticalTabStrip
 * without knowing the renderer's internals.
 *
 * Overflow strategy: .tab-bar-inner has overflow:hidden per the spec (scrolling
 * deferred OOS per step_03). The "+" button has flex-shrink:0 so it is never
 * clipped.
 */

// Vite processes this CSS import at bundle time so all tab styles are included
// in the final build without a separate <link> tag in index.html.
import "../tabs.css";

import type { TabEntry, ITabRenderer } from "../tab-types";
import { TAB_SOFT_WARNING_THRESHOLD } from "../tab-types";
import { showTabContextMenu, closeTabContextMenu } from "../tab-context-menu";

export class RegularTabBar implements ITabRenderer {
  // ── Private state ────────────────────────────────────────────────────────────

  /**
   * The #tab-strip (or any container passed to mount()). Null before mount()
   * and after destroy() so method guards are uniform.
   */
  private container: HTMLElement | null = null;

  /**
   * The scrollable inner container that holds the tab label buttons.
   * Created in mount() and cleared in destroy(). Kept as a field so
   * update() can clear and repopulate it without walking the DOM.
   */
  private innerEl: HTMLElement | null = null;

  /**
   * The "+" button that opens a new untitled tab. Created in mount() so
   * update() can toggle the over-limit warning class on it without
   * re-creating the element on each update.
   */
  private newBtnEl: HTMLButtonElement | null = null;

  /**
   * Callback fired when the user clicks a tab label to switch to that tab.
   * Provided by TabManager as `(id) => this.activateTab(id)`.
   */
  private readonly onActivate: (id: string) => void;

  /**
   * Callback fired when the user clicks the × close button on a tab.
   * Provided by TabManager as `(id) => void this.closeTab(id)`.
   */
  private readonly onClose: (id: string) => void;

  /**
   * Callback fired when the user clicks the "+" button to open a new tab.
   * Provided by TabManager as `() => this.openNewTab()`.
   */
  private readonly onNew: () => void;

  // ── Constructor ───────────────────────────────────────────────────────────────

  /**
   * Creates a RegularTabBar instance.
   *
   * The instance is reusable: call mount() to attach it to a container and
   * destroy() to detach. TabManager creates one instance per mode-switch rather
   * than keeping a long-lived instance across mode changes.
   *
   * @param onActivate  Called with the tab id when the user clicks a tab label.
   * @param onClose     Called with the tab id when the user clicks a × close button.
   * @param onNew       Called when the user clicks the "+" new-tab button.
   */
  constructor(
    onActivate: (id: string) => void,
    onClose: (id: string) => void,
    onNew: () => void,
  ) {
    this.onActivate = onActivate;
    this.onClose = onClose;
    this.onNew = onNew;
  }

  // ── ITabRenderer interface ────────────────────────────────────────────────────

  /**
   * Attaches the renderer to container, sets required ARIA roles, builds the
   * tab bar DOM structure, and performs the first render.
   *
   * DOM structure after mount():
   * ```
   * container[role="tablist"].tab-mode-regular
   *   div.tab-bar-inner
   *     button.tab-label[role="tab"]  × N tabs
   *   button.tab-new-btn
   * ```
   *
   * mount() delegates the first render to update() to avoid duplicating
   * the rendering logic.
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

    // Mode class lets CSS apply regular-specific sizing (height, border, etc.).
    container.classList.add("tab-mode-regular");

    // Create the scrollable inner wrapper that holds all .tab-label buttons.
    // overflow:hidden is set by CSS (.tab-bar-inner); scrolling is OOS per spec.
    const inner = document.createElement("div");
    inner.className = "tab-bar-inner";
    container.appendChild(inner);
    this.innerEl = inner;

    // Create the "+" button that opens a new untitled tab. It lives outside
    // innerEl so it is never clipped by overflow:hidden and always remains visible.
    const newBtn = document.createElement("button");
    newBtn.className = "tab-new-btn";
    newBtn.textContent = "+";
    newBtn.setAttribute("aria-label", "New tab");
    newBtn.addEventListener("click", () => this.onNew());
    container.appendChild(newBtn);
    this.newBtnEl = newBtn;

    // Delegate first render to update() so rendering logic is not duplicated.
    this.update(tabs, activeIndex);
  }

  /**
   * Re-renders all tab labels after any state change (open, close, activate,
   * dirty toggle).
   *
   * Uses a full innerHTML clear + re-build rather than diffing. The tab count
   * is typically small (≤30) so the cost is negligible and the logic stays
   * simple. Correctness matters more than micro-optimisation at this stage.
   *
   * The "+" button element is NOT re-created on each update — only its
   * over-limit class is toggled to avoid losing the click listener.
   *
   * @param tabs         Current tab array snapshot.
   * @param activeIndex  Index of the currently active tab.
   */
  update(tabs: TabEntry[], activeIndex: number): void {
    if (!this.innerEl || !this.newBtnEl) return;
    // Close any open context menu before rebuilding the DOM. This handles
    // EC-12 (close button fires while menu is open) and EC-16 (any background
    // state change triggers a re-render while the menu is visible).
    closeTabContextMenu();

    // Wipe existing tab label buttons. Event listeners attached to the old
    // <button> elements are garbage-collected with their nodes — no manual
    // cleanup required.
    this.innerEl.innerHTML = "";

    // Render one label button per tab.
    tabs.forEach((tab, i) => {
      const labelEl = this._buildTabEl(tab, i === activeIndex);
      this.innerEl!.appendChild(labelEl);
    });

    // Soft-warning indicator (FR-9, step_08): when the user has more tabs open
    // than the recommended threshold, add a warning class to the "+" button so
    // the CSS can color it amber. The button remains enabled — per spec, FR-9
    // is a visual cue only, not a hard cap.
    const overLimit = tabs.length > TAB_SOFT_WARNING_THRESHOLD;
    this.newBtnEl.classList.toggle("tab-over-limit", overLimit);

    // Set the native title tooltip to give the user a count and a hint when
    // over the limit. When the count drops back to safe levels, restore the
    // default tooltip that reminds the user of the Cmd-T keyboard shortcut.
    if (overLimit) {
      this.newBtnEl.title = `${tabs.length} tabs open — consider closing some tabs`;
    } else {
      this.newBtnEl.title = "New Tab (Cmd-T)";
    }
  }

  /**
   * Tears down all renderer DOM and resets the container to a neutral state.
   *
   * After destroy() the container is ready for the next renderer to mount
   * into it cleanly. No event listeners need explicit removal because they are
   * all attached to child elements that are deleted by clearing innerHTML (NFR-5).
   */
  destroy(): void {
    // Close any open context menu before tearing down the renderer DOM.
    // This handles EC-11 (mode switch while menu is open). Called before the
    // container guard so it fires even on early-return paths.
    closeTabContextMenu();

    if (!this.container) return;

    // Remove the mode class so the next renderer starts with a clean container.
    this.container.classList.remove("tab-mode-regular");

    // Remove the ARIA role — the container is neutral until the next renderer
    // calls mount() and sets its own role.
    this.container.removeAttribute("role");

    // Clear all tab labels, inner wrapper, and the "+" button and their event
    // listeners (GC'd with the removed nodes).
    this.container.innerHTML = "";

    // Null out all element references so any lingering reference to this
    // renderer instance cannot accidentally interact with a recycled DOM node.
    this.container = null;
    this.innerEl = null;
    this.newBtnEl = null;
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  /**
   * Creates and returns a single tab label <button> element for one tab.
   *
   * The element structure:
   * ```html
   * <button class="tab-label [is-dirty]" role="tab"
   *         aria-selected="[true/false]" aria-label="[title]">
   *   <span class="tab-label-dirty">•</span>
   *   <span class="tab-label-text">[title]</span>
   *   <button class="tab-close" aria-label="Close [title]">×</button>
   * </button>
   * ```
   *
   * Click routing:
   *   - Click on the outer button → calls this.onActivate(tab.id)
   *   - Click on the close button → calls this.onClose(tab.id) and calls
   *     stopPropagation() so the outer button's click handler does NOT fire
   *     (FR-5.2: close button must not also activate the tab)
   *
   * @param tab       The TabEntry this label represents.
   * @param isActive  Whether this tab is currently active.
   * @returns  A configured button element ready to be appended to innerEl.
   */
  private _buildTabEl(tab: TabEntry, isActive: boolean): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "tab-label";
    btn.setAttribute("role", "tab");

    // aria-selected drives CSS (.tab-label[aria-selected="true"]) for the
    // active-state underline and background.
    btn.setAttribute("aria-selected", String(isActive));

    // aria-label gives screen readers the document name (NFR-3).
    btn.setAttribute("aria-label", tab.title);

    // Toggle the is-dirty class on the outer button so CSS can control the
    // visibility of .tab-label-dirty via `.tab-label.is-dirty .tab-label-dirty`.
    btn.classList.toggle("is-dirty", tab.isDirty);

    // Dirty indicator span — always present in the DOM; visibility controlled
    // by CSS (.tab-label-dirty { display:none } by default,
    // .tab-label.is-dirty .tab-label-dirty { display:inline }).
    // Keeping it in the DOM at all times avoids layout reflow when toggling.
    const dirtyDot = document.createElement("span");
    dirtyDot.className = "tab-label-dirty";
    dirtyDot.textContent = "•";
    btn.appendChild(dirtyDot);

    // Text label: the filename without extension, or "Untitled".
    const textSpan = document.createElement("span");
    textSpan.className = "tab-label-text";
    textSpan.textContent = tab.title;
    btn.appendChild(textSpan);

    // Close button: clicking this fires onClose and must NOT bubble up to the
    // outer button's click handler (which would fire onActivate). stopPropagation
    // is the standard technique for nested-button interaction (FR-5.2).
    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close";
    closeBtn.setAttribute("aria-label", `Close ${tab.title}`);
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", (e) => {
      // Prevent the click from reaching the outer tab label button so that
      // closing a tab does not also activate it (FR-5.2).
      e.stopPropagation();
      this.onClose(tab.id);
    });
    btn.appendChild(closeBtn);

    // Outer button click handler: activate the tab. Fires only when the user
    // clicks the tab label area, not the close button (stopPropagation guards).
    btn.addEventListener("click", () => {
      this.onActivate(tab.id);
    });

    // Right-click: show the tab context menu (FR-1.1 / FR-1.2 / FR-1.3).
    // e.preventDefault() suppresses the browser's native context menu.
    // e.stopPropagation() prevents the event from bubbling to the strip
    // container so that right-clicking the strip background shows no menu
    // (EC-10 — no listener is attached to the container, and propagation is
    // stopped here at the tab element level).
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showTabContextMenu(tab, e.clientX, e.clientY);
    });

    return btn;
  }
}

/**
 * vertical-tab-strip.ts — VerticalTabStrip renderer for the multi-document tab system.
 *
 * Implements a carousel vertical tab layout:
 *
 *   [sidebar] | [tabs BEFORE active] [active label] | EDITOR | [tabs AFTER active] | [sidebar-right]
 *
 * Tabs that come before the active one in the tab list are rendered as narrow
 * columns to the LEFT of #editor (#tab-vertical-left). The active tab appears
 * as the last (rightmost) column in the left strip, styled with an accent border
 * and accent-colored title to indicate it is the current document. Tabs that
 * come after the active one are rendered as columns to the RIGHT of #editor
 * (#tab-vertical-right).
 *
 * Cycling with Cmd-Opt-←/→ moves which tab is active; update() is called by
 * TabManager after each activation and the layout adjusts automatically.
 *
 * A small document icon below the close button in each column is deferred
 * until the icon system is in place (FC2).
 *
 * DOM structure per column:
 * ```html
 * <div class="tab-vertical-col [is-active] [is-dirty]" role="tab"
 *      aria-selected="[true/false]" aria-label="[title]" tabindex="0">
 *   <button class="tab-close" aria-label="Close [title]">×</button>
 *   <span class="tab-vertical-text">[title]</span>
 * </div>
 * ```
 *
 * Implements the ITabRenderer interface so TabManager can swap this renderer
 * in/out without knowing its internals.
 */

import "../tabs.css";

import type { TabEntry, ITabRenderer } from "../tab-types";
import { TAB_SOFT_WARNING_THRESHOLD } from "../tab-types";

export const LEFT_STRIP_ID = "tab-vertical-left";
export const RIGHT_STRIP_ID = "tab-vertical-right";

export class VerticalTabStrip implements ITabRenderer {
  // ── Private state ────────────────────────────────────────────────────────────

  /**
   * The #tab-strip element passed to mount(). Only used to add/remove
   * "tab-mode-vertical" so CSS can hide the horizontal strip. No children are
   * appended to it by this renderer.
   */
  private container: HTMLElement | null = null;

  /**
   * #tab-vertical-left — the flex-row container inserted into #app-row
   * immediately before #editor. Holds tab columns for tabs[0..activeIndex].
   * The active tab is the last (rightmost) column in this strip.
   */
  private leftStripEl: HTMLElement | null = null;

  /**
   * #tab-vertical-right — the flex-row container inserted into #app-row
   * immediately before #sidebar-right (after #editor). Holds tab columns for
   * tabs[activeIndex+1..end]. Hidden via inline style when there are no
   * after-tabs so it takes no space in the layout.
   */
  private rightStripEl: HTMLElement | null = null;

  private readonly onActivate: (id: string) => void;
  private readonly onClose: (id: string) => void;

  // ── Constructor ───────────────────────────────────────────────────────────────

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
   * Adds "tab-mode-vertical" to `container` (#tab-strip) so CSS hides the
   * horizontal strip. Then creates #tab-vertical-left (before #editor) and
   * #tab-vertical-right (before #sidebar-right) inside #app-row, and delegates
   * the first render to update().
   */
  mount(
    container: HTMLElement,
    tabs: TabEntry[],
    activeIndex: number,
  ): void {
    this.container = container;
    container.classList.add("tab-mode-vertical");

    const appRow = document.getElementById("app-row");
    const editorEl = document.getElementById("editor");

    if (!appRow || !editorEl) {
      console.error(
        "VerticalTabStrip.mount: #app-row or #editor not found in DOM. " +
        "Ensure SidebarManager.init() has been called before TabManager.init()."
      );
      return;
    }

    // Left strip: before the editor. All before-tabs + active label go here.
    const leftStrip = document.createElement("div");
    leftStrip.id = LEFT_STRIP_ID;
    leftStrip.setAttribute("role", "tablist");
    appRow.insertBefore(leftStrip, editorEl);
    this.leftStripEl = leftStrip;

    // Right strip: after the editor, before the right sidebar.
    // Guard: only use sidebarRight as insertBefore reference if it is a direct
    // child of appRow — otherwise appending to appRow is correct.
    const sidebarRight = document.getElementById("sidebar-right");
    const rightRef =
      sidebarRight?.parentElement === appRow ? sidebarRight : null;
    const rightStrip = document.createElement("div");
    rightStrip.id = RIGHT_STRIP_ID;
    rightStrip.setAttribute("role", "tablist");
    appRow.insertBefore(rightStrip, rightRef);
    this.rightStripEl = rightStrip;

    this.update(tabs, activeIndex);
  }

  /**
   * Re-renders all columns after any state change.
   *
   * Splits tabs at activeIndex:
   *   - tabs[0..activeIndex]        → left strip (active is the last column)
   *   - tabs[activeIndex+1..end]    → right strip (hidden when empty)
   */
  update(tabs: TabEntry[], activeIndex: number): void {
    if (!this.leftStripEl || !this.rightStripEl) return;

    this.leftStripEl.innerHTML = "";
    this.rightStripEl.innerHTML = "";

    // Left strip: tabs up to and including the active one.
    for (let i = 0; i <= activeIndex && i < tabs.length; i++) {
      this.leftStripEl.appendChild(
        this._buildColEl(tabs[i], i === activeIndex)
      );
    }

    // Right strip: tabs after the active one.
    for (let i = activeIndex + 1; i < tabs.length; i++) {
      this.rightStripEl.appendChild(this._buildColEl(tabs[i], false));
    }

    // Hide the right strip when it has no content so it contributes no width.
    this.rightStripEl.style.display =
      tabs.length > activeIndex + 1 ? "" : "none";

    // Soft-warning: flag the left strip when too many tabs are open (FR-9).
    this.leftStripEl.classList.toggle(
      "tab-over-limit",
      tabs.length > TAB_SOFT_WARNING_THRESHOLD
    );
  }

  /**
   * Removes both strip elements from the DOM and clears the container class.
   * Idempotent — safe to call multiple times or before mount().
   */
  destroy(): void {
    this.leftStripEl?.remove();
    this.rightStripEl?.remove();
    this.leftStripEl = null;
    this.rightStripEl = null;

    if (!this.container) return;
    this.container.classList.remove("tab-mode-vertical");
    this.container = null;
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  /**
   * Builds a single tab column element.
   *
   * @param tab       The TabEntry this column represents.
   * @param isActive  True when this column is the currently active document.
   */
  private _buildColEl(tab: TabEntry, isActive: boolean): HTMLDivElement {
    const col = document.createElement("div");
    col.className = "tab-vertical-col";
    if (isActive) col.classList.add("is-active");
    col.classList.toggle("is-dirty", tab.isDirty);
    col.setAttribute("role", "tab");
    col.setAttribute("aria-selected", String(isActive));
    col.setAttribute("aria-label", tab.title);
    col.setAttribute("tabindex", "0");

    // Close button. stopPropagation prevents the outer click from also firing
    // onActivate when the user closes a tab (FR-5.2).
    const closeBtn = document.createElement("button");
    closeBtn.className = "tab-close";
    closeBtn.setAttribute("aria-label", `Close ${tab.title}`);
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onClose(tab.id);
    });
    col.appendChild(closeBtn);

    // Title span — rotated bottom-to-top by CSS writing-mode + transform.
    const textSpan = document.createElement("span");
    textSpan.className = "tab-vertical-text";
    textSpan.textContent = tab.title;
    col.appendChild(textSpan);

    // Clicking anywhere on the column (outside the close button) activates it.
    col.addEventListener("click", () => {
      this.onActivate(tab.id);
    });

    return col;
  }
}

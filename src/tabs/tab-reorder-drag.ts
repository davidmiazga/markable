/**
 * tab-reorder-drag.ts — Shared pointer-events drag handler for tab reordering.
 *
 * Attaches pointerdown / pointermove / pointerup handlers to a tab element.
 * After a 6 px movement threshold:
 *   - A ghost label follows the cursor.
 *   - A 2 px insertion line appears between tabs at the nearest gap.
 * On pointer-up, onReorder(fromId, insertBeforeId) is called where
 * insertBeforeId is the tab the dragged tab will be placed before (null = end).
 *
 * Gap-based hit detection: the insertion point is the gap line closest to the
 * cursor's X position, computed from the bounding rects of all non-dragged tab
 * elements. This means the user only has to be vaguely in the right area — no
 * need to land exactly on a small dot or label.
 *
 * Compatible with WKWebView (Tauri/macOS) which does not reliably fire HTML5
 * dragstart events — same constraint as the file-browser drag-to-move code.
 *
 * @param el           Tab element (button or div) to make draggable.
 * @param tabId        ID of the tab this element represents.
 * @param tabSelector  CSS selector matching all draggable tab elements in
 *                     this renderer, e.g. ".tab-dot[data-tab-id]". Used by
 *                     querySelectorAll to enumerate sibling tabs for gap calc.
 * @param onReorder    Called with (fromId, insertBeforeId) on a successful
 *                     drop. insertBeforeId is null when dropped after the
 *                     last tab.
 */
export function attachTabReorderDrag(
  el: HTMLElement,
  tabId: string,
  tabSelector: string,
  onReorder: (fromId: string, insertBeforeId: string | null) => void,
): void {
  let startX = 0;
  let startY = 0;
  let dragActive = false;
  let activePointerId = -1;
  let ghostEl: HTMLElement | null = null;
  let lineEl: HTMLElement | null = null;
  let insertBeforeId: string | null = null;

  const cleanup = (): void => {
    ghostEl?.remove();
    ghostEl = null;
    lineEl?.remove();
    lineEl = null;
    insertBeforeId = null;
    dragActive = false;
    activePointerId = -1;
    document.body.style.userSelect = "";
    (document.body.style as unknown as Record<string, string>).webkitUserSelect = "";
    document.body.style.cursor = "";
  };

  /**
   * Find the nearest gap between non-dragged tabs and return its x position
   * plus the vertical bounds to draw the insertion line.
   *
   * Siblings are grouped by parent container so that cross-container midpoints
   * are never created. This is important for VerticalTabStrip which splits tabs
   * into #tab-vertical-left and #tab-vertical-right on opposite sides of the
   * editor — a naive midpoint between those two groups would land in the middle
   * of the editor content area.
   *
   * For the boundary between two groups, two slots are emitted: one at the
   * right edge of the last element in group N (belonging to group N's container)
   * and one at the left edge of the first element in group N+1 (belonging to
   * group N+1's container). Both map to the same insertBeforeId (the first tab
   * of group N+1), so the logical result is the same regardless of which slot
   * is nearest to the cursor.
   */
  const computeInsertion = (cursorX: number): {
    id: string | null;
    lineX: number;
    lineTop: number;
    lineHeight: number;
  } => {
    const allSiblings = [...document.querySelectorAll<HTMLElement>(tabSelector)]
      .filter((e) => e.dataset.tabId !== tabId);

    if (allSiblings.length === 0) {
      return { id: null, lineX: 0, lineTop: 0, lineHeight: 0 };
    }

    // Group consecutive siblings that share the same parent container.
    interface Group { container: Element; els: HTMLElement[] }
    const groups: Group[] = [];
    for (const s of allSiblings) {
      const p = s.parentElement!;
      const last = groups[groups.length - 1];
      if (last && last.container === p) {
        last.els.push(s);
      } else {
        groups.push({ container: p, els: [s] });
      }
    }

    interface Slot { id: string | null; x: number; containerRect: DOMRect }
    const slots: Slot[] = [];

    for (let g = 0; g < groups.length; g++) {
      const { container, els } = groups[g];
      const containerRect = container.getBoundingClientRect();

      // Slot before the first element in this group.
      const firstRect = els[0].getBoundingClientRect();
      slots.push({ id: els[0].dataset.tabId!, x: firstRect.left, containerRect });

      // Slots between consecutive elements within the same group.
      for (let i = 0; i < els.length - 1; i++) {
        const rect = els[i].getBoundingClientRect();
        const nextRect = els[i + 1].getBoundingClientRect();
        slots.push({
          id: els[i + 1].dataset.tabId!,
          x: (rect.right + nextRect.left) / 2,
          containerRect,
        });
      }

      // Slot at the right edge of the last element in this group.
      // Maps to the first tab of the next group (or null for the final group).
      const lastRect = els[els.length - 1].getBoundingClientRect();
      const nextGroupFirstId = g < groups.length - 1
        ? groups[g + 1].els[0].dataset.tabId!
        : null;
      slots.push({ id: nextGroupFirstId, x: lastRect.right, containerRect });
    }

    // Pick the slot whose x is closest to cursorX.
    let best = slots[0];
    let bestDist = Math.abs(best.x - cursorX);
    for (const slot of slots) {
      const dist = Math.abs(slot.x - cursorX);
      if (dist < bestDist) {
        bestDist = dist;
        best = slot;
      }
    }

    return {
      id: best.id,
      lineX: best.x,
      lineTop: best.containerRect.top,
      lineHeight: best.containerRect.height,
    };
  };

  el.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    activePointerId = e.pointerId;
    try { el.setPointerCapture(e.pointerId); } catch { /* JSDOM may not support */ }
    document.body.style.userSelect = "none";
    (document.body.style as unknown as Record<string, string>).webkitUserSelect = "none";
    window.getSelection()?.removeAllRanges();
  });

  el.addEventListener("pointermove", (e: PointerEvent) => {
    if (e.pointerId !== activePointerId) return;

    if (!dragActive) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < 6) return;
      dragActive = true;
      document.body.style.cursor = "grabbing";
      window.getSelection()?.removeAllRanges();

      ghostEl = document.createElement("div");
      ghostEl.className = "tab-drag-ghost";
      ghostEl.textContent = el.getAttribute("aria-label") || "";
      ghostEl.style.cssText =
        "position:fixed;z-index:9999;pointer-events:none;padding:2px 8px;" +
        "background:var(--bg-secondary,#2a2a2a);border:1px solid var(--border-color,#444);" +
        "border-radius:4px;font-size:12px;white-space:nowrap;opacity:0.9;";
      document.body.appendChild(ghostEl);

      lineEl = document.createElement("div");
      lineEl.className = "tab-insert-line";
      document.body.appendChild(lineEl);
    }
    if (!ghostEl || !lineEl) return;

    ghostEl.style.left = `${e.clientX + 12}px`;
    ghostEl.style.top = `${e.clientY + 4}px`;

    const ins = computeInsertion(e.clientX);
    insertBeforeId = ins.id;
    lineEl.style.left = `${ins.lineX - 1}px`;
    lineEl.style.top = `${ins.lineTop}px`;
    lineEl.style.height = `${ins.lineHeight}px`;
  });

  const handlePointerEnd = (e: PointerEvent, fire: boolean): void => {
    if (e.pointerId !== activePointerId) {
      if (activePointerId === -1) return;
      document.body.style.userSelect = "";
      (document.body.style as unknown as Record<string, string>).webkitUserSelect = "";
      return;
    }
    try { el.releasePointerCapture(e.pointerId); } catch { /* JSDOM */ }

    if (fire && dragActive) {
      const from = tabId;
      const to = insertBeforeId;
      cleanup();
      onReorder(from, to);
    } else {
      cleanup();
    }
  };

  el.addEventListener("pointerup",     (e: PointerEvent) => handlePointerEnd(e, true));
  el.addEventListener("pointercancel", (e: PointerEvent) => handlePointerEnd(e, false));
}

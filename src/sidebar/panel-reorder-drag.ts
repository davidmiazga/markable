/**
 * panel-reorder-drag.ts — Pointer-events drag handler for sidebar panel reordering.
 *
 * Vertical counterpart to src/tabs/tab-reorder-drag.ts. Attaches pointerdown /
 * pointermove / pointerup handlers to a drag-handle element (typically the
 * panel header's title span). After a 6 px movement threshold:
 *   - A ghost label follows the cursor.
 *   - A 2 px horizontal insertion line appears between panels at the nearest
 *     gap (chosen by absolute Y distance to cursor).
 * On pointer-up, onReorder(fromId, insertBeforeId) is called where
 * insertBeforeId is the panel id the dragged panel will be placed BEFORE
 * (null = drop at the end of the list).
 *
 * @param el            The drag-handle element (panel title span).
 * @param panelId       The panel id this handle represents.
 * @param panelSelector CSS selector matching all draggable panel wrapper
 *                      elements (e.g. ".sidebar-panel-wrapper[data-panel-id]").
 *                      The handler enumerates these to compute insertion gaps.
 * @param onReorder     Called with (fromId, insertBeforeId) on a successful
 *                      drop. insertBeforeId is null for end-of-list.
 */
export function attachPanelReorderDrag(
  el: HTMLElement,
  panelId: string,
  panelSelector: string,
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

  /** Compute the nearest insertion gap on the Y axis among non-dragged, visible siblings. */
  const computeInsertion = (cursorY: number): {
    id: string | null;
    lineY: number;
    lineLeft: number;
    lineWidth: number;
  } => {
    const siblings = [...document.querySelectorAll<HTMLElement>(panelSelector)]
      .filter((e) => e.dataset.panelId !== panelId)
      .filter((e) => e.getBoundingClientRect().height > 0); // skip iconized/hidden

    if (siblings.length === 0) {
      return { id: null, lineY: 0, lineLeft: 0, lineWidth: 0 };
    }

    const container = siblings[0].parentElement!;
    const containerRect = container.getBoundingClientRect();

    interface Slot { id: string | null; y: number }
    const slots: Slot[] = [];

    // Slot above the first sibling.
    const firstRect = siblings[0].getBoundingClientRect();
    slots.push({ id: siblings[0].dataset.panelId!, y: firstRect.top });

    // Slots between consecutive siblings.
    for (let i = 0; i < siblings.length - 1; i++) {
      const rect = siblings[i].getBoundingClientRect();
      const nextRect = siblings[i + 1].getBoundingClientRect();
      slots.push({
        id: siblings[i + 1].dataset.panelId!,
        y: (rect.bottom + nextRect.top) / 2,
      });
    }

    // Slot below the last sibling (drop at end → insertBeforeId = null).
    const lastRect = siblings[siblings.length - 1].getBoundingClientRect();
    slots.push({ id: null, y: lastRect.bottom });

    let best = slots[0];
    let bestDist = Math.abs(best.y - cursorY);
    for (const slot of slots) {
      const dist = Math.abs(slot.y - cursorY);
      if (dist < bestDist) { bestDist = dist; best = slot; }
    }

    return {
      id: best.id,
      lineY: best.y,
      lineLeft: containerRect.left,
      lineWidth: containerRect.width,
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
      ghostEl.className = "panel-drag-ghost";
      ghostEl.textContent = el.textContent || "";
      ghostEl.style.cssText =
        "position:fixed;z-index:9999;pointer-events:none;padding:3px 10px;" +
        "background:var(--bg-secondary,#2a2a2a);border:1px solid var(--border-color,#444);" +
        "border-radius:4px;font-size:11px;font-weight:600;letter-spacing:0.04em;" +
        "text-transform:uppercase;color:var(--text-primary);" +
        "white-space:nowrap;opacity:0.92;";
      document.body.appendChild(ghostEl);

      lineEl = document.createElement("div");
      lineEl.className = "panel-insert-line";
      document.body.appendChild(lineEl);
    }
    if (!ghostEl || !lineEl) return;

    ghostEl.style.left = `${e.clientX + 12}px`;
    ghostEl.style.top  = `${e.clientY + 4}px`;

    const ins = computeInsertion(e.clientY);
    insertBeforeId = ins.id;
    lineEl.style.left   = `${ins.lineLeft}px`;
    lineEl.style.top    = `${ins.lineY - 1}px`;
    lineEl.style.width  = `${ins.lineWidth}px`;
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
      const from = panelId;
      const to = insertBeforeId;
      cleanup();
      onReorder(from, to);
    } else {
      cleanup();
    }
  };

  el.addEventListener("pointerup",     (e) => handlePointerEnd(e, true));
  el.addEventListener("pointercancel", (e) => handlePointerEnd(e, false));
}

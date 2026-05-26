/**
 * folder-item-drag.ts — Pointer-event drag-reorder for folder-view items.
 *
 * Adapted from the proven `src/tabs/tab-reorder-drag.ts` pattern. Uses pointer
 * events (not HTML5 drag) because Tauri's WKWebView on macOS doesn't reliably
 * fire `dragstart`. After a 6 px movement threshold:
 *   - A ghost label follows the cursor.
 *   - A 2 px insertion line appears at the nearest gap between items.
 * On pointer-up, `onReorder(newOrderedIds)` fires with the full post-drop
 * order — the consumer doesn't have to compute the diff themselves.
 *
 * Generic over container + item selector + ID extractor so the same util can
 * wire drag for Cards (`.fv-card`), Table rows (`.fv-row`), List rows,
 * Bookshelf spines (`.fv-book`), and Kanban rows in later phases.
 *
 * @param el           The draggable item element.
 * @param container    The container scoping sibling lookups. Required so a
 *                     page with multiple folder-views doesn't cross-contaminate
 *                     (e.g. two `\`\`\`select` fences in one document).
 * @param id           The stable ID this element represents (e.g. file path).
 * @param itemSelector CSS selector that matches all sibling draggable items
 *                     INSIDE `container` (e.g. ".folder-view-card-file[data-path]").
 * @param onReorder    Called with the full new order of IDs after a successful
 *                     drop. Below the 6 px threshold it does not fire — that
 *                     path stays a click.
 */
export function attachFolderItemDrag(
  el: HTMLElement,
  container: HTMLElement,
  id: string,
  itemSelector: string,
  onReorder: (orderedIds: string[]) => void,
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
   * Enumerate sibling items in source order (excluding the dragged element),
   * read each one's ID, and return the full ordered ID list with the dragged
   * item inserted at the position implied by `insertBeforeId` (null = end).
   */
  const computeOrderedIds = (): string[] => {
    const siblings = [...container.querySelectorAll<HTMLElement>(itemSelector)]
      .filter((e) => idOf(e) !== id);
    const result: string[] = [];
    let placed = false;
    for (const s of siblings) {
      const sid = idOf(s);
      if (!placed && sid === insertBeforeId) {
        result.push(id);
        placed = true;
      }
      result.push(sid);
    }
    if (!placed) result.push(id);  // dropped at the end, or insertBeforeId = null
    return result;
  };

  /**
   * Find the nearest gap between non-dragged items. Returns the ID of the item
   * the dragged element will land before (null = drop at the end of the
   * container), plus the geometry needed to draw the insertion line.
   *
   * The grid for Cards can wrap into multiple rows, so we compute a 2D nearest
   * gap: the slot in the dragged-row whose center is closest to the cursor.
   * This is the same logic as the tab implementation but with row-awareness.
   */
  const computeInsertion = (cursorX: number, cursorY: number): {
    id: string | null;
    lineX: number;
    lineTop: number;
    lineHeight: number;
  } => {
    const allSiblings = [...container.querySelectorAll<HTMLElement>(itemSelector)]
      .filter((e) => idOf(e) !== id);

    if (allSiblings.length === 0) {
      return { id: null, lineX: 0, lineTop: 0, lineHeight: 0 };
    }

    // Group by visual row using getBoundingClientRect().top. Two items are in
    // the same row when their tops are within half their height of each other.
    interface Slot { id: string | null; x: number; rowTop: number; rowHeight: number }
    const slots: Slot[] = [];

    // Find the row whose vertical center is closest to the cursor.
    type Row = { top: number; height: number; els: HTMLElement[] };
    const rows: Row[] = [];
    for (const s of allSiblings) {
      const r = s.getBoundingClientRect();
      const placed = rows.find(
        (row) => Math.abs(row.top - r.top) < row.height / 2,
      );
      if (placed) {
        placed.els.push(s);
        placed.height = Math.max(placed.height, r.height);
      } else {
        rows.push({ top: r.top, height: r.height, els: [s] });
      }
    }
    // Pick the row whose center is closest to cursorY.
    let bestRow = rows[0];
    let bestRowDist = Math.abs(cursorY - (bestRow.top + bestRow.height / 2));
    for (const row of rows) {
      const d = Math.abs(cursorY - (row.top + row.height / 2));
      if (d < bestRowDist) { bestRowDist = d; bestRow = row; }
    }

    // Emit slots before each element in the row, plus one at the row's right edge.
    for (let i = 0; i < bestRow.els.length; i++) {
      const r = bestRow.els[i].getBoundingClientRect();
      slots.push({ id: idOf(bestRow.els[i]), x: r.left, rowTop: bestRow.top, rowHeight: bestRow.height });
    }
    const lastRect = bestRow.els[bestRow.els.length - 1].getBoundingClientRect();
    slots.push({ id: null, x: lastRect.right, rowTop: bestRow.top, rowHeight: bestRow.height });

    // Nearest slot by horizontal distance within the chosen row.
    let best = slots[0];
    let bestDist = Math.abs(best.x - cursorX);
    for (const slot of slots) {
      const d = Math.abs(slot.x - cursorX);
      if (d < bestDist) { bestDist = d; best = slot; }
    }
    return { id: best.id, lineX: best.x, lineTop: best.rowTop, lineHeight: best.rowHeight };
  };

  /** Read the ID from a sibling element. Uses data-path for cards; falls back
   * to data-id. Kept as a tiny helper to centralize the convention. */
  const idOf = (e: HTMLElement): string =>
    e.dataset.path ?? e.dataset.id ?? "";

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
      ghostEl.className = "fv-drag-ghost";
      ghostEl.textContent = el.dataset.dragLabel
        ?? el.getAttribute("aria-label")
        ?? "";
      ghostEl.style.cssText =
        "position:fixed;z-index:9999;pointer-events:none;padding:3px 9px;" +
        "background:var(--bg-secondary);border:1px solid var(--border-color);" +
        "border-radius:4px;font-size:12px;color:var(--text-primary);" +
        "white-space:nowrap;opacity:0.92;box-shadow:0 2px 8px var(--shadow-color);";
      document.body.appendChild(ghostEl);

      lineEl = document.createElement("div");
      lineEl.className = "fv-drag-insert-line";
      lineEl.style.cssText =
        "position:fixed;z-index:9998;pointer-events:none;width:2px;" +
        "background:var(--accent-color);border-radius:1px;";
      document.body.appendChild(lineEl);
    }
    if (!ghostEl || !lineEl) return;

    ghostEl.style.left = `${e.clientX + 12}px`;
    ghostEl.style.top = `${e.clientY + 4}px`;

    const ins = computeInsertion(e.clientX, e.clientY);
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
      const ordered = computeOrderedIds();
      cleanup();
      onReorder(ordered);
    } else {
      cleanup();
    }
  };

  el.addEventListener("pointerup",     (e: PointerEvent) => handlePointerEnd(e, true));
  el.addEventListener("pointercancel", (e: PointerEvent) => handlePointerEnd(e, false));
}

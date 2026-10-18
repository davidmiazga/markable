/**
 * panel-reorder-drag.ts — Pointer-events drag handler for sidebar panel reordering
 * and cross-dock drag-and-drop.
 *
 * Vertical/horizontal counterpart to src/tabs/tab-reorder-drag.ts. Attaches
 * pointerdown / pointermove / pointerup handlers to a drag-handle element
 * (typically the panel header's title span). After a 6 px movement threshold:
 *   - A ghost label follows the cursor.
 *   - Drop-zone indicators appear for Left, Right, Top, and Bottom dock edges.
 *   - When dragging within the current dock, a 2 px insertion line appears
 *     between panels at the nearest gap.
 *   - When dragging over another dock edge, that dock drop-zone indicator is
 *     highlighted; dropping there moves the panel to that dock and opens it.
 */

import type { DockSide } from "../lib/settings";

export interface PanelDragOptions {
  /** Resolve the dock side the panel currently lives on. */
  getCurrentSide?: () => DockSide;
  /** Called when the panel is dropped onto a different dock's edge drop-zone. */
  onDockMove?: (fromId: string, targetSide: DockSide) => void;
  /** Returns true when panel positions are locked against dragging/reordering. */
  isLocked?: () => boolean;
}

const DOCK_SIDES: DockSide[] = ["left", "right", "top", "bottom"];

const DOCK_LABELS: Record<DockSide, string> = {
  left: "Left Dock",
  right: "Right Dock",
  top: "Top Dock",
  bottom: "Bottom Dock",
};

export function attachPanelReorderDrag(
  el: HTMLElement,
  panelId: string,
  panelSelector: string | (() => string),
  onReorder: (fromId: string, insertBeforeId: string | null) => void,
  options?: PanelDragOptions,
): void {
  let startX = 0;
  let startY = 0;
  let dragActive = false;
  let activePointerId = -1;
  let ghostEl: HTMLElement | null = null;
  let lineEl: HTMLElement | null = null;
  let dropZonesContainerEl: HTMLElement | null = null;
  let insertBeforeId: string | null = null;
  let hoveredDockSide: DockSide | null = null;

  const resolveSelector = (): string =>
    typeof panelSelector === "function" ? panelSelector() : panelSelector;

  const resolveCurrentSide = (): DockSide => {
    if (options?.getCurrentSide) return options.getCurrentSide();
    const slot = el.closest<HTMLElement>('[id^="sidebar-"]');
    const side = slot?.id.replace("sidebar-", "") as DockSide | undefined;
    if (side && DOCK_SIDES.includes(side)) return side;
    return "right";
  };

  const cleanup = (): void => {
    ghostEl?.remove();
    ghostEl = null;
    lineEl?.remove();
    lineEl = null;
    dropZonesContainerEl?.remove();
    dropZonesContainerEl = null;
    insertBeforeId = null;
    hoveredDockSide = null;
    dragActive = false;
    activePointerId = -1;
    document.body.style.userSelect = "";
    (document.body.style as unknown as Record<string, string>).webkitUserSelect = "";
    document.body.style.cursor = "";
  };

  /** Build the 4 edge drop-zone indicators for cross-dock drag-and-drop. */
  const createDropZones = (currentSide: DockSide): HTMLElement => {
    const container = document.createElement("div");
    container.className = "panel-dock-drop-zones";

    const appRow = document.getElementById("app-row");
    const appRect = appRow?.getBoundingClientRect();
    if (appRect && appRect.width > 0 && appRect.height > 0) {
      container.style.top = `${appRect.top}px`;
      container.style.left = `${appRect.left}px`;
      container.style.width = `${appRect.width}px`;
      container.style.height = `${appRect.height}px`;
      container.style.right = "auto";
      container.style.bottom = "auto";
    }

    for (const side of DOCK_SIDES) {
      const zone = document.createElement("div");
      zone.className = `panel-dock-drop-zone panel-dock-drop-zone--${side}`;
      if (side === currentSide) {
        zone.classList.add("is-current-side");
      }
      zone.dataset.dockSide = side;
      zone.dataset.side = side;

      const label = document.createElement("span");
      label.className = "panel-dock-drop-zone-label";
      label.textContent = DOCK_LABELS[side];
      zone.appendChild(label);

      container.appendChild(zone);
    }

    document.body.appendChild(container);
    return container;
  };

  /**
   * Determine if the cursor is over one of the 4 dock edge drop zones.
   * Checks both individual `.panel-dock-drop-zone` bounding boxes (when laid out)
   * and `#app-row` / viewport edge bands so it works in both browser layout and JSDOM/happy-dom.
   */
  const detectDockEdge = (clientX: number, clientY: number, currentSide: DockSide): DockSide | null => {
    // 1. Check if any drop zone element has a non-zero bounding rect containing the pointer.
    if (dropZonesContainerEl) {
      const zones = dropZonesContainerEl.querySelectorAll<HTMLElement>(".panel-dock-drop-zone");
      for (const zone of zones) {
        const zRect = zone.getBoundingClientRect();
        if (
          zRect.width > 0 &&
          zRect.height > 0 &&
          clientX >= zRect.left &&
          clientX <= zRect.right &&
          clientY >= zRect.top &&
          clientY <= zRect.bottom
        ) {
          const zSide = zone.dataset.dockSide as DockSide;
          return zSide !== currentSide ? zSide : null;
        }
      }
    }

    // 2. Check #app-row or viewport edge bands.
    const appRow = document.getElementById("app-row");
    const appRect = appRow?.getBoundingClientRect();
    const hasAppRect = !!appRect && appRect.width > 0 && appRect.height > 0;
    const left = hasAppRect ? appRect!.left : 0;
    const top = hasAppRect ? appRect!.top : 0;
    const width = hasAppRect ? appRect!.width : (window.innerWidth || 1000);
    const height = hasAppRect ? appRect!.height : (window.innerHeight || 800);
    const right = left + width;
    const bottom = top + height;

    const edgeX = Math.max(40, Math.min(80, width * 0.12));
    const edgeY = Math.max(40, Math.min(72, height * 0.12));

    let candidate: DockSide | null = null;
    if (clientX >= left && clientX <= left + edgeX) {
      candidate = "left";
    } else if (clientX <= right && clientX >= right - edgeX) {
      candidate = "right";
    } else if (clientY >= top && clientY <= top + edgeY) {
      candidate = "top";
    } else if (clientY <= bottom && clientY >= bottom - edgeY) {
      candidate = "bottom";
    }

    if (candidate && candidate !== currentSide) {
      return candidate;
    }
    return null;
  };

  const updateDropZoneHighlight = (activeSide: DockSide | null): void => {
    if (!dropZonesContainerEl) return;
    const zones = dropZonesContainerEl.querySelectorAll<HTMLElement>(".panel-dock-drop-zone");
    for (const zone of zones) {
      const isMatch = zone.dataset.dockSide === activeSide;
      zone.classList.toggle("is-active", isMatch);
      zone.classList.toggle("active", isMatch);
    }
  };

  /** Compute the nearest insertion gap on the Y axis among non-dragged, visible siblings. */
  const computeInsertion = (cursorY: number): {
    id: string | null;
    lineY: number;
    lineLeft: number;
    lineWidth: number;
  } => {
    const siblings = [...document.querySelectorAll<HTMLElement>(resolveSelector())]
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

  const isDragLocked = (): boolean =>
    Boolean(options?.isLocked?.()) || el.closest(".is-panels-locked") !== null;

  el.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0 || isDragLocked()) return;
    startX = e.clientX;
    startY = e.clientY;
    activePointerId = e.pointerId;
    try { el.setPointerCapture(e.pointerId); } catch { /* JSDOM may not support */ }
    document.body.style.userSelect = "none";
    (document.body.style as unknown as Record<string, string>).webkitUserSelect = "none";
    window.getSelection()?.removeAllRanges();
  });

  el.addEventListener("pointermove", (e: PointerEvent) => {
    if (isDragLocked()) {
      if (dragActive) cleanup();
      return;
    }
    if (e.pointerId !== activePointerId) return;

    const currentSide = resolveCurrentSide();

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

      dropZonesContainerEl = createDropZones(currentSide);
    }
    if (!ghostEl || !lineEl) return;

    ghostEl.style.left = `${e.clientX + 12}px`;
    ghostEl.style.top  = `${e.clientY + 4}px`;

    hoveredDockSide = detectDockEdge(e.clientX, e.clientY, currentSide);
    updateDropZoneHighlight(hoveredDockSide);

    if (hoveredDockSide) {
      lineEl.style.display = "none";
    } else {
      lineEl.style.display = "";
      const ins = computeInsertion(e.clientY);
      insertBeforeId = ins.id;
      lineEl.style.left   = `${ins.lineLeft}px`;
      lineEl.style.top    = `${ins.lineY - 1}px`;
      lineEl.style.width  = `${ins.lineWidth}px`;
    }
  });

  const handlePointerEnd = (e: PointerEvent, fire: boolean): void => {
    if (isDragLocked()) {
      cleanup();
      return;
    }
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
      const targetDock = hoveredDockSide;
      const currentSide = resolveCurrentSide();
      cleanup();
      if (targetDock && targetDock !== currentSide && options?.onDockMove) {
        options.onDockMove(from, targetDock);
      } else {
        onReorder(from, to);
      }
    } else {
      cleanup();
    }
  };

  el.addEventListener("pointerdown",   () => { hoveredDockSide = null; });
  el.addEventListener("pointerup",     (e) => handlePointerEnd(e, true));
  el.addEventListener("pointercancel", (e) => handlePointerEnd(e, false));
}

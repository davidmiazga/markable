/**
 * Universal modal keyboard helper.
 *
 * Provides four behaviors that every Markable modal needs:
 *   1. Initial focus when the modal opens (defaults to the active item in the
 *      first declared list, or the first focusable element).
 *   2. Tab / Shift-Tab focus trap — Tab cycles among the modal's focusable
 *      descendants in DOM order and does not escape to background controls.
 *   3. Up / Down arrow navigation across items in declared "lists" (using a
 *      roving-tabindex pattern). Enter activates the focused item.
 *   4. Escape calls the supplied `onClose` callback.
 *
 * Usage:
 *
 *   const detach = attachModalKeyboard({
 *     modal: overlayEl,
 *     onClose: closeModal,
 *     lists: [{
 *       container: listEl,
 *       itemSelector: ".am-item",
 *       onActivate: (item) => item.click(),
 *     }],
 *   });
 *   // Later, when the modal closes:
 *   detach();
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export interface ModalListSpec {
  /** Container element that holds the navigable items. */
  container: HTMLElement;
  /** CSS selector matching individual items within the container. */
  itemSelector: string;
  /** Invoked when Enter is pressed on a focused item. Defaults to item.click(). */
  onActivate?: (item: HTMLElement) => void;
}

export interface ModalKeyboardOptions {
  /** Modal container element (typically the overlay). All keydown listening attaches here. */
  modal: HTMLElement;
  /** Invoked when Escape is pressed. */
  onClose: () => void;
  /**
   * Element to focus when the modal mounts. May be an element, a function
   * returning one, or null. When omitted: focuses the active item in the first
   * declared list, falling back to the first focusable descendant.
   */
  initialFocus?: HTMLElement | null | (() => HTMLElement | null);
  /** Lists with Up/Down arrow navigation. Items in each list use roving tabindex. */
  lists?: ModalListSpec[];
  /** Whether Tab / Shift-Tab is trapped inside the modal. Default true. */
  trapTab?: boolean;
}

function visibleFocusables(modal: HTMLElement): HTMLElement[] {
  return Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((el) => el.offsetParent !== null);
}

function listItems(list: ModalListSpec): HTMLElement[] {
  return Array.from(list.container.querySelectorAll<HTMLElement>(list.itemSelector));
}

function activeListItem(list: ModalListSpec): HTMLElement | null {
  const items = listItems(list);
  return items.find((i) => i.classList.contains("is-selected"))
      ?? items.find((i) => i.getAttribute("tabindex") === "0")
      ?? items[0]
      ?? null;
}

function applyRovingTabindex(list: ModalListSpec, active: HTMLElement | null): void {
  for (const it of listItems(list)) {
    it.setAttribute("tabindex", it === active ? "0" : "-1");
  }
}

export function attachModalKeyboard(opts: ModalKeyboardOptions): () => void {
  const { modal, onClose, lists = [], trapTab = true } = opts;

  for (const list of lists) {
    applyRovingTabindex(list, activeListItem(list));
  }

  function findOwningList(target: EventTarget | null): ModalListSpec | null {
    if (!(target instanceof HTMLElement)) return null;
    for (const list of lists) {
      if (list.container.contains(target) && target.matches(list.itemSelector)) {
        return list;
      }
    }
    return null;
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const list = findOwningList(e.target);
      if (!list) return;
      const items = listItems(list);
      if (items.length === 0) return;
      e.preventDefault();
      const cur = items.indexOf(e.target as HTMLElement);
      const dir = e.key === "ArrowDown" ? 1 : -1;
      const next = items[(cur + dir + items.length) % items.length];
      applyRovingTabindex(list, next);
      next.focus();
      return;
    }

    if (e.key === "Enter") {
      const list = findOwningList(e.target);
      if (!list || !(e.target instanceof HTMLElement)) return;
      e.preventDefault();
      (list.onActivate ?? ((item) => item.click()))(e.target);
      return;
    }

    if (e.key === "Tab" && trapTab) {
      const focusable = visibleFocusables(modal);
      if (focusable.length === 0) return;
      const idx = focusable.indexOf(document.activeElement as HTMLElement);
      const last = focusable.length - 1;
      const next = e.shiftKey
        ? (idx <= 0 ? last : idx - 1)
        : (idx === -1 ? 0 : (idx === last ? 0 : idx + 1));
      e.preventDefault();
      focusable[next].focus();
    }
  }

  modal.addEventListener("keydown", onKeyDown);

  function focusInitial(): void {
    const raw = opts.initialFocus;
    const target = typeof raw === "function" ? raw() : raw;
    if (target) { target.focus(); return; }
    if (lists[0]) {
      const it = activeListItem(lists[0]);
      if (it) { it.focus(); return; }
    }
    const first = visibleFocusables(modal)[0];
    if (first) first.focus();
  }
  requestAnimationFrame(focusInitial);

  return () => modal.removeEventListener("keydown", onKeyDown);
}

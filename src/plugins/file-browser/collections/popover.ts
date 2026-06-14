/**
 * popover.ts — Two-item "Note / Stack" menu used by the Home canvas's
 * + affordance and the empty-state placeholder.
 *
 * Visually mirrors the file-browser right-click context menu by reusing
 * its `.context-menu` and `.context-menu-item` classes — those styles
 * are injected globally as part of FILE_BROWSER_CSS, so a `<ul>` with
 * matching markup picks them up automatically.
 *
 * The two functional choices are:
 *   - "Note"  → `onNotecard` (creates a notecard in the default Stack;
 *               EC-12 creates the Stack if none exists).
 *   - "Stack" → `onStack`    (creates a new Stack subfolder).
 *
 * Chapter / Book aren't surfaced here — the menu is intentionally
 * minimal "for now" per user direction. When they ship, add them as
 * additional items (the chrome scales trivially).
 *
 * @module collections/popover
 */

export interface NotecardStackPopoverHandlers {
  readonly onStack: () => void;
  readonly onNotecard: () => void;
}

/**
 * Generic small context menu used by Collections (note tile + Stack
 * tile right-click). Reuses the global `.context-menu` chrome from
 * `FILE_BROWSER_CSS` so the visual matches the file-browser tree's
 * own right-click menus. Items with `onClick === null` render disabled.
 *
 * Dismisses on outside-click or Escape.
 */
export interface CollectionsContextMenuItem {
  readonly label: string;
  readonly onClick: (() => void) | null;
  readonly danger?: boolean;
}

export function showCollectionsContextMenu(
  x: number,
  y: number,
  items: readonly CollectionsContextMenuItem[],
): void {
  // Remove any prior instance — both the Notecard/Stack popover and
  // this menu share the `.context-menu` class so a stale one never
  // lingers when the user re-triggers from a different element.
  document.querySelectorAll(".fv-collection-popover, .context-menu").forEach(
    (n) => n.remove(),
  );

  const ul = document.createElement("ul");
  ul.className = "context-menu fv-collection-popover";
  ul.setAttribute("role", "menu");

  for (const item of items) {
    const li = document.createElement("li");
    li.className = "context-menu-item fv-collection-popover-item";
    li.setAttribute("role", "menuitem");
    li.textContent = item.label;
    if (item.danger) li.classList.add("is-danger");
    if (item.onClick === null) {
      (li as HTMLLIElement).setAttribute("aria-disabled", "true");
      (li as unknown as { disabled?: boolean }).disabled = true;
      li.style.opacity = "0.5";
      li.style.cursor = "not-allowed";
    } else {
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const fn = item.onClick!;
        dismiss();
        fn();
      });
    }
    ul.appendChild(li);
  }

  document.body.appendChild(ul);

  const rect = ul.getBoundingClientRect();
  const clampedX = Math.min(x, window.innerWidth - rect.width - 4);
  const clampedY = Math.min(y, window.innerHeight - rect.height - 4);
  ul.style.position = "fixed";
  ul.style.left = `${Math.max(0, clampedX)}px`;
  ul.style.top = `${Math.max(0, clampedY)}px`;

  function dismiss(): void {
    ul.remove();
    document.removeEventListener("mousedown", onMouseDown, true);
    document.removeEventListener("keydown", onKey);
  }
  const onMouseDown = (e: MouseEvent): void => {
    if (!ul.contains(e.target as Node)) dismiss();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") dismiss();
  };
  queueMicrotask(() => {
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKey);
  });
}

/**
 * Open the menu near `anchorEl`. Idempotent — dismisses any existing
 * menu before creating a new one.
 */
export function showNotecardStackPopover(
  anchorEl: HTMLElement,
  handlers: NotecardStackPopoverHandlers,
): void {
  // Remove any prior instance (covers both the legacy popover class and
  // the new context-menu class so a stale one never lingers).
  document.querySelectorAll(".fv-collection-popover, .context-menu").forEach(
    (n) => n.remove(),
  );

  const menu = document.createElement("ul");
  // Two classes: the canonical right-click context-menu class for
  // styling (FILE_BROWSER_CSS) plus a feature-scoped tag so collections
  // tests can locate the menu deterministically.
  menu.className = "context-menu fv-collection-popover";
  menu.setAttribute("role", "menu");

  const items: ReadonlyArray<{ label: string; onClick: () => void }> = [
    { label: "Note",  onClick: handlers.onNotecard },
    { label: "Stack", onClick: handlers.onStack },
  ];
  for (const { label, onClick } of items) {
    const li = document.createElement("li");
    li.className = "context-menu-item fv-collection-popover-item";
    li.setAttribute("role", "menuitem");
    li.textContent = label;
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
      onClick();
    });
    menu.appendChild(li);
  }

  document.body.appendChild(menu);

  // Position below-and-right of the anchor. Clamped to viewport.
  const rect = anchorEl.getBoundingClientRect();
  const popRect = menu.getBoundingClientRect();
  const x = Math.min(rect.left, window.innerWidth - popRect.width - 4);
  const y = Math.min(rect.bottom + 4, window.innerHeight - popRect.height - 4);
  menu.style.position = "fixed";
  menu.style.left = `${Math.max(0, x)}px`;
  menu.style.top = `${Math.max(0, y)}px`;

  // Dismiss on outside click or Escape.
  const onMouseDown = (e: MouseEvent): void => {
    if (!menu.contains(e.target as Node)) dismiss();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") dismiss();
  };
  function dismiss(): void {
    menu.remove();
    document.removeEventListener("mousedown", onMouseDown, true);
    document.removeEventListener("keydown", onKey);
  }
  // Microtask delay so the click that opened the menu isn't itself
  // treated as an outside click.
  queueMicrotask(() => {
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("keydown", onKey);
  });
}

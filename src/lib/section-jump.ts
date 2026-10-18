/** True while a sidebar click is moving the pane, so the scroll spy does not override that choice. */
let jumpLock = false;

/**
 * Blank space after the last section, equal to the visible pane.
 * Without it, a short page cannot scroll a bottom section up to the top.
 */
export function applyJumpTail(pane: HTMLElement): void {
  const height = pane.clientHeight;
  if (height <= 0) return;
  pane.style.paddingBottom = `${height}px`;
}

/** Scroll a section to the top of its pane. */
export function scrollSectionIntoPane(pane: HTMLElement, section: HTMLElement): void {
  jumpLock = true;
  applyJumpTail(pane);
  const top =
    section.getBoundingClientRect().top -
    pane.getBoundingClientRect().top +
    pane.scrollTop;
  pane.scrollTo({ top: Math.max(0, top) });
  queueMicrotask(() => {
    jumpLock = false;
  });
}

export function isSectionJumpLocked(): boolean {
  return jumpLock;
}

/**
 * The last section whose top has reached the pane top.
 * Earlier sections stay in the document so the pane can still scroll.
 */
export function sectionNearestPaneTop(
  pane: HTMLElement,
  sections: readonly HTMLElement[],
): HTMLElement | null {
  if (sections.length === 0) return null;
  const origin = pane.getBoundingClientRect().top;
  const paneTop = origin + 12;
  let current = sections[0];
  let laidOut = false;
  for (const section of sections) {
    const top = section.getBoundingClientRect().top;
    if (top !== origin) laidOut = true;
    if (top <= paneTop) current = section;
  }
  return laidOut ? current : null;
}

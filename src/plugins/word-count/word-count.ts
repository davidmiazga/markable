/**
 * Word Count Plugin — live word/character count in the status bar.
 *
 * Displays in the center zone of the status bar.
 * Shows selection count when text is selected.
 * Debounced to avoid lag on large documents.
 */

let targetEl: HTMLElement | null = null;
let enabled = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const DEBOUNCE_MS = 150;

function countWords(text: string): number {
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

function update(docText: string, selFrom: number, selTo: number): void {
  if (!targetEl || !enabled) return;

  const totalWords = countWords(docText);
  const totalChars = docText.length;

  if (selFrom !== selTo) {
    const selText = docText.slice(selFrom, selTo);
    const selWords = countWords(selText);
    const selChars = selText.length;
    targetEl.textContent = `${selWords} / ${totalWords} words    ${selChars} / ${totalChars} chars`;
  } else {
    targetEl.textContent = `${totalWords} words    ${totalChars} chars`;
  }
}

/** Schedule a debounced update. */
export function scheduleUpdate(docText: string, selFrom: number, selTo: number): void {
  if (!enabled) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => update(docText, selFrom, selTo), DEBOUNCE_MS);
}

/** Enable word count — attach to a status bar zone element. */
export function enableWordCount(el: HTMLElement): void {
  enabled = true;
  targetEl = el;
}

/** Disable word count — clear the display. */
export function disableWordCount(): void {
  enabled = false;
  if (targetEl) targetEl.textContent = "";
  targetEl = null;
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
}

/** Check if word count is currently enabled. */
export function isWordCountEnabled(): boolean {
  return enabled;
}

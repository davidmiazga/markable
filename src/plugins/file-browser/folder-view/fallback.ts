/**
 * fallback.ts — Graceful-degradation renderer for missing or unknown layouts.
 *
 * renderFallback() is called when _folder.md has no `layout:` field (FR-12)
 * or an unrecognized `layout:` value (FR-13). It renders a faint notice and
 * optionally renders the markdown body as plain markdown below it.
 *
 * This renderer must never throw (NFR-06). The call site in tab.ts wraps it
 * in a try/catch as an additional safety net.
 *
 * @module folder-view/fallback
 */

import { stripScripts } from "./shared";

/**
 * Render the fallback view for missing or unrecognized layout values.
 *
 * Shows a faint notice paragraph and, when the markdown body is non-empty,
 * renders the body as HTML below it. The container is cleared before rendering.
 *
 * @param body      - Markdown body extracted from _folder.md (may be empty).
 *                    Rendered via __MARKABLE_RENDER_MD__ when non-empty.
 * @param notice    - The notice string to display to the user (FR-12/FR-13).
 *                    E.g. "No layout specified — showing raw content."
 * @param container - The #custom-tab-host element to render into.
 */
export function renderFallback(
  body: string,
  notice: string,
  container: HTMLElement,
): void {
  container.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "folder-view-fallback";

  // Faint notice text (FR-12/FR-13).
  const noticeEl = document.createElement("p");
  noticeEl.className = "folder-view-fallback-notice";
  noticeEl.textContent = notice;
  wrapper.appendChild(noticeEl);

  // Optional body block (FR-11): render markdown when non-empty.
  if (body.trim()) {
    const bodyEl = document.createElement("div");
    bodyEl.className = "folder-view-description";

    // Use the global markdown renderer if available; fall back to <pre> text.
    const renderMd = (window as any).__MARKABLE_RENDER_MD__ as
      ((md: string) => string) | undefined;

    if (renderMd) {
      // EC-14: sanitize rendered HTML before injecting into DOM.
      bodyEl.innerHTML = stripScripts(renderMd(body));
    } else {
      const pre = document.createElement("pre");
      pre.textContent = body;
      bodyEl.appendChild(pre);
    }

    wrapper.appendChild(bodyEl);
  }

  container.appendChild(wrapper);
}

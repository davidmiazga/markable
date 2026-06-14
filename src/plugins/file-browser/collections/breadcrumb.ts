/**
 * breadcrumb.ts — Multi-level-ready breadcrumb chrome (FR-30, FR-31, C-11).
 *
 * Pure, stateless render function. Takes an ordered list of segments
 * (`{ label, onClick }`) and returns a fresh detached element. To "update"
 * the breadcrumb the caller replaces the node — no internal state, no
 * external observers.
 *
 * MVP usage emits three segments (Home, Stack, Note); the Phase-2 Book/
 * Chapter layers will emit five without any code change here.
 *
 * Labels are rendered via `textContent` so XSS payloads in user-typed Stack
 * or note names are inert.
 *
 * @module collections/breadcrumb
 */

import type { BreadcrumbSegment } from "./types";

/**
 * Build the breadcrumb DOM.
 *
 *   - One `<button>` (or `<span>` when `onClick === null`) per segment.
 *   - A `<span class="fv-collection-breadcrumb-sep">/</span>` between
 *     consecutive segments. None after the last segment.
 *   - The current segment (`onClick === null`) gets the `is-current`
 *     modifier class so the CSS can style it differently from clickable
 *     ancestors.
 *
 * @param segments - Ordered list of breadcrumb segments.
 * @returns A fresh `<nav>` element (detached from the DOM).
 */
export function renderBreadcrumb(
  segments: readonly BreadcrumbSegment[],
): HTMLElement {
  const nav = document.createElement("nav");
  nav.className = "fv-collection-breadcrumb";
  nav.setAttribute("aria-label", "Breadcrumb");

  segments.forEach((seg, i) => {
    let el: HTMLElement;
    if (seg.onClick === null) {
      // Non-clickable segment (the "current" page; FR-31).
      el = document.createElement("span");
      el.className = "fv-collection-breadcrumb-seg is-current";
    } else {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fv-collection-breadcrumb-seg";
      btn.addEventListener("click", seg.onClick);
      el = btn;
    }
    // Drop-target tagging: a note tile dragged onto this segment moves
    // the file into `seg.dropTargetPath`. The current segment never
    // sets this; only ancestor breadcrumbs do.
    if (seg.dropTargetPath) {
      el.setAttribute("data-bc-path", seg.dropTargetPath);
    }
    // Optional icon prefix (currently only "home"). Inline SVG so it picks
    // up `currentColor` from the segment's color rule. Material-Symbols
    // path data, 24×24 viewBox.
    if (seg.icon === "home") {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", "14");
      svg.setAttribute("height", "14");
      svg.setAttribute("aria-hidden", "true");
      svg.classList.add("fv-collection-breadcrumb-icon");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M12 3l-9 8h3v8h6v-6h0v0h0v6h6v-8h3l-9-8z");
      path.setAttribute("fill", "currentColor");
      svg.appendChild(path);
      el.appendChild(svg);
    }
    // textContent (NOT innerHTML) — labels containing markup chars
    // (`<`, `>`, `&`) are rendered literally with no parsing.
    // Use a child <span> for the label so the icon sits beside it.
    const labelSpan = document.createElement("span");
    labelSpan.textContent = seg.label;
    el.appendChild(labelSpan);
    nav.appendChild(el);

    // Separator after every segment except the last.
    if (i < segments.length - 1) {
      const sep = document.createElement("span");
      sep.className = "fv-collection-breadcrumb-sep";
      sep.setAttribute("aria-hidden", "true");
      sep.textContent = "/";
      nav.appendChild(sep);
    }
  });

  return nav;
}

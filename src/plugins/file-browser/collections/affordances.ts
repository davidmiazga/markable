/**
 * affordances.ts — Shared visual components for Collections.
 *
 * One module owning every reusable widget the Collections feature renders.
 * Home canvas, Stack panel, and any future Collections surface must build
 * shared visuals through helpers here — no per-surface SVG/DOM duplication.
 *
 * Currently exported:
 *
 *   buildAddCircleIcon          — the dashed-circle-plus SVG used as the
 *                                 "add new" affordance icon. One source of
 *                                 truth so home + stack + future surfaces
 *                                 always match.
 *   createAddCircleAffordance   — a full button element wrapping the icon,
 *                                 with the shared `.fv-collection-add-affordance`
 *                                 class so styling stays centralised.
 *
 * Future additions (tile chrome, header strip, breadcrumb segments, …)
 * should land here too so component drift cannot happen silently.
 *
 * @module collections/affordances
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Build the dashed-circle-plus SVG used as the visual affordance for any
 * "add new" action inside Collections. 48×48 viewBox; stroke uses
 * `currentColor` so the parent button's color drives the visible tint.
 */
export function buildAddCircleIcon(sizePx = 40): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("width", String(sizePx));
  svg.setAttribute("height", String(sizePx));
  svg.setAttribute("aria-hidden", "true");

  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", "24");
  circle.setAttribute("cy", "24");
  circle.setAttribute("r", "22");
  circle.setAttribute("fill", "none");
  circle.setAttribute("stroke", "currentColor");
  circle.setAttribute("stroke-width", "2");
  circle.setAttribute("stroke-dasharray", "4 6");
  circle.setAttribute("stroke-linecap", "round");
  svg.appendChild(circle);

  const plusH = document.createElementNS(SVG_NS, "line");
  plusH.setAttribute("x1", "14");
  plusH.setAttribute("y1", "24");
  plusH.setAttribute("x2", "34");
  plusH.setAttribute("y2", "24");
  plusH.setAttribute("stroke", "currentColor");
  plusH.setAttribute("stroke-width", "2");
  plusH.setAttribute("stroke-linecap", "round");
  svg.appendChild(plusH);

  const plusV = document.createElementNS(SVG_NS, "line");
  plusV.setAttribute("x1", "24");
  plusV.setAttribute("y1", "14");
  plusV.setAttribute("x2", "24");
  plusV.setAttribute("y2", "34");
  plusV.setAttribute("stroke", "currentColor");
  plusV.setAttribute("stroke-width", "2");
  plusV.setAttribute("stroke-linecap", "round");
  svg.appendChild(plusV);

  return svg;
}

/** Options accepted by createAddCircleAffordance. */
export interface AddCircleAffordanceOptions {
  /** aria-label / native tooltip for the button. */
  readonly ariaLabel: string;
  /**
   * Click handler. Receives the inner icon-wrap element so callers can
   * anchor popovers / menus right under the visible `+` glyph rather
   * than at the (possibly stretched) button rect.
   */
  readonly onClick: (anchorEl: HTMLElement) => void;
  /**
   * Optional extra class for context-specific layout tweaks. The base
   * `.fv-collection-add-affordance` class is always applied.
   */
  readonly extraClass?: string;
  /** Icon size in px. Defaults to 40 (matches home canvas tile icons). */
  readonly iconSize?: number;
}

/**
 * Build a "+" affordance button styled to match every other Collections
 * surface. Used by both the Home canvas grid and Stack panel list.
 */
export function createAddCircleAffordance(
  opts: AddCircleAffordanceOptions,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "fv-collection-add-affordance";
  if (opts.extraClass) btn.classList.add(opts.extraClass);
  btn.setAttribute("aria-label", opts.ariaLabel);
  btn.setAttribute("title", opts.ariaLabel);

  // Inner icon wrap — the same `.fv-collection-note-box-icon` slot used
  // by sibling tiles so the + lines up vertically with their icons.
  const iconWrap = document.createElement("div");
  iconWrap.className = "fv-collection-note-box-icon";
  iconWrap.setAttribute("aria-hidden", "true");
  iconWrap.appendChild(buildAddCircleIcon(opts.iconSize ?? 40));
  btn.appendChild(iconWrap);

  btn.addEventListener("click", () => opts.onClick(iconWrap));

  return btn;
}

/**
 * panel-icons.ts — Inline SVG icons for known sidebar panels.
 *
 * Maps panel id → 24×24 stroke SVG (Lucide-style). Renders at 14px in the
 * panel header via CSS, currentColor inherits from the title text colour.
 *
 * To add an icon for a new panel: pick a panel id above, add a key/value
 * here. To override per-plugin, the plugin descriptor would need a new
 * `iconSvg?: string` field — out of scope for the first pass.
 */

const COMMON_ATTRS =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const TOC =
  `<svg ${COMMON_ATTRS}>` +
  `<line x1="3" y1="6" x2="21" y2="6"/>` +
  `<line x1="3" y1="12" x2="13" y2="12"/>` +
  `<line x1="3" y1="18" x2="17" y2="18"/>` +
  `</svg>`;

const LINK =
  `<svg ${COMMON_ATTRS}>` +
  `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>` +
  `<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>` +
  `</svg>`;

const OUTLINE =
  `<svg ${COMMON_ATTRS}>` +
  `<line x1="8" y1="6" x2="21" y2="6"/>` +
  `<line x1="8" y1="12" x2="21" y2="12"/>` +
  `<line x1="8" y1="18" x2="21" y2="18"/>` +
  `<circle cx="3.5" cy="6" r="0.6" fill="currentColor"/>` +
  `<circle cx="3.5" cy="12" r="0.6" fill="currentColor"/>` +
  `<circle cx="3.5" cy="18" r="0.6" fill="currentColor"/>` +
  `</svg>`;

const SLIDERS =
  `<svg ${COMMON_ATTRS}>` +
  `<line x1="4" y1="21" x2="4" y2="14"/>` +
  `<line x1="4" y1="10" x2="4" y2="3"/>` +
  `<line x1="12" y1="21" x2="12" y2="12"/>` +
  `<line x1="12" y1="8"  x2="12" y2="3"/>` +
  `<line x1="20" y1="21" x2="20" y2="16"/>` +
  `<line x1="20" y1="12" x2="20" y2="3"/>` +
  `<line x1="1"  y1="14" x2="7"  y2="14"/>` +
  `<line x1="9"  y1="8"  x2="15" y2="8"/>` +
  `<line x1="17" y1="16" x2="23" y2="16"/>` +
  `</svg>`;

const PENCIL =
  `<svg ${COMMON_ATTRS}>` +
  `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>` +
  `<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>` +
  `</svg>`;

const HUB =
  `<svg ${COMMON_ATTRS}>` +
  `<circle cx="12" cy="12" r="3"/>` +
  `<circle cx="5"  cy="6"  r="2"/>` +
  `<circle cx="19" cy="6"  r="2"/>` +
  `<circle cx="5"  cy="18" r="2"/>` +
  `<circle cx="19" cy="18" r="2"/>` +
  `<line x1="6.5"  y1="7.5"  x2="9.5"  y2="10.5"/>` +
  `<line x1="17.5" y1="7.5"  x2="14.5" y2="10.5"/>` +
  `<line x1="6.5"  y1="16.5" x2="9.5"  y2="13.5"/>` +
  `<line x1="17.5" y1="16.5" x2="14.5" y2="13.5"/>` +
  `</svg>`;

const FOLDER =
  `<svg ${COMMON_ATTRS}>` +
  `<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"/>` +
  `</svg>`;

const CALENDAR =
  `<svg ${COMMON_ATTRS}>` +
  `<rect x="3" y="4" width="18" height="18" rx="2"/>` +
  `<line x1="16" y1="2" x2="16" y2="6"/>` +
  `<line x1="8"  y1="2" x2="8"  y2="6"/>` +
  `<line x1="3"  y1="10" x2="21" y2="10"/>` +
  `</svg>`;

/** Map panel id → SVG markup. Missing keys → no icon rendered. */
export const PANEL_ICONS: Readonly<Record<string, string>> = {
  "auto-toc":            TOC,
  "backlinks":           LINK,
  "outline-panel":       OUTLINE,
  "yaml-pane":           SLIDERS,
  "markdown-toolbar":    PENCIL,
  "knowledge-graph":     HUB,
  "file-browser":        FOLDER,
  "daily-note-calendar": CALENDAR,
};

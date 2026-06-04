/**
 * callout-icons.ts — Material Symbols icons rendered in callout titles.
 *
 * One icon per canonical callout type (see ./callouts.ts CALLOUT_TYPES).
 * Style matches the existing Material Symbols set in
 * src/plugins/file-browser/icons/material/index.ts:
 *   - Material Symbols Outlined, weight 400
 *   - viewBox: 0 -960 960 960
 *   - currentColor fill (CSS color: var(--callout-color))
 *
 * Two icons (note / abstract / quote / example) are re-used from the
 * file-browser material set where the visual fits; the rest are new
 * Material Symbols glyphs added here to round out the 13 types Obsidian
 * uses. Source for all: https://fonts.google.com/icons (weight 400,
 * outlined style).
 *
 * Unknown types (user-defined custom callouts via CSS) fall through to
 * the `info` icon — same fallback Obsidian uses when no `--callout-icon`
 * is set in a user's CSS snippet.
 */

import { isPlainCallout } from "./callouts";

// Reuse from the existing material/index.ts where the visual fits.
// (Imported as data so callout-icons.ts stays self-contained — no
// circular dependency between editor/ and plugins/.)

const NOTE = // Material Symbols: edit (pencil)
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T794-700L266-172q-12 12-26.5 18T209-148L120-120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z"/></svg>`;

const ABSTRACT = // Material Symbols: list_alt
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M380-280h280v-80H380v80Zm0-160h280v-80H380v80Zm-80-80q17 0 28.5-11.5T340-560q0-17-11.5-28.5T300-600q-17 0-28.5 11.5T260-560q0 17 11.5 28.5T300-520Zm0 160q17 0 28.5-11.5T340-400q0-17-11.5-28.5T300-440q-17 0-28.5 11.5T260-400q0 17 11.5 28.5T300-360Zm0 160q17 0 28.5-11.5T340-240q0-17-11.5-28.5T300-280q-17 0-28.5 11.5T260-240q0 17 11.5 28.5T300-200Zm80-320h280v-80H380v80ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z"/></svg>`;

const INFO = // Material Symbols: info
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M440-280h80v-240h-80v240Zm40-320q17 0 28.5-11.5T520-640q0-17-11.5-28.5T480-680q-17 0-28.5 11.5T440-640q0 17 11.5 28.5T480-600Zm0 520q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg>`;

const TODO = // Material Symbols: check_circle (outlined)
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="m424-296 282-282-56-56-226 226-114-114-56 56 170 170Zm56 216q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg>`;

const TIP = // Material Symbols: lightbulb (outlined)
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M480-80q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80ZM320-200v-80h320v80H320Zm10-120q-69-41-109.5-110T180-580q0-125 87.5-212.5T480-880q125 0 212.5 87.5T780-580q0 81-40.5 150T630-320H330Zm24-80h252q45-32 69.5-79T700-580q0-92-64-156t-156-64q-92 0-156 64t-64 156q0 54 24.5 101t69.5 79Zm126 0Z"/></svg>`;

const SUCCESS = // Material Symbols: check
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/></svg>`;

const QUESTION = // Material Symbols: help (outlined)
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M478-240q21 0 35.5-14.5T528-290q0-21-14.5-35.5T478-340q-21 0-35.5 14.5T428-290q0 21 14.5 35.5T478-240Zm-36-154h74q0-33 7.5-52.5T555-487q35-34 48.5-58t13.5-53q0-55-37.5-89.5T484-722q-51 0-88.5 27T343-622l66 26q5-18 22.5-39t53.5-21q32 0 48 17.5t16 38.5q0 20-12 37.5T506-526q-44 39-54 59t-10 73Zm38 314q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg>`;

const WARNING = // Material Symbols: warning (outlined)
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="m40-120 440-760 440 760H40Zm138-80h604L480-720 178-200Zm302-40q17 0 28.5-11.5T520-280q0-17-11.5-28.5T480-320q-17 0-28.5 11.5T440-280q0 17 11.5 28.5T480-240Zm-40-120h80v-200h-80v200Zm40-100Z"/></svg>`;

const FAILURE = // Material Symbols: cancel (outlined)
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="m336-280 144-144 144 144 56-56-144-144 144-144-56-56-144 144-144-144-56 56 144 144-144 144 56 56ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg>`;

const DANGER = // Material Symbols: bolt
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M400-80v-304H240l320-496v304h160L400-80Zm80-238 154-186h-94v-160l-154 240h94v106Zm0-162Z"/></svg>`;

const BUG = // Material Symbols: bug_report (outlined)
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M480-160q-83 0-141.5-58.5T280-360v-40H120v-80h160v-128q-37-22-58.5-58.5T200-760h80q0 50 35 85t85 35h160q50 0 85-35t35-85h80q0 57-21.5 93.5T680-608v128h160v80H680v40q0 83-58.5 141.5T480-160Zm-80-280q-17 0-28.5-11.5T360-480q0-17 11.5-28.5T400-520q17 0 28.5 11.5T440-480q0 17-11.5 28.5T400-440Zm160 0q-17 0-28.5-11.5T520-480q0-17 11.5-28.5T560-520q17 0 28.5 11.5T600-480q0 17-11.5 28.5T560-440ZM400-720q0-33 23.5-56.5T480-800q33 0 56.5 23.5T560-720H400Z"/></svg>`;

const EXAMPLE = // Material Symbols: code (reused from material/index.ts)
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M320-242 80-482l242-242 43 43-199 199 197 197-43 43Zm318 2-43-43 199-199-197-197 43-43 240 240-242 242Z"/></svg>`;

const QUOTE = // Material Symbols: format_quote
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M580-360h160l80-160v-240H580v240h120l-80 160H580Zm-360 0h160l80-160v-240H220v240h120l-80 160H220Zm192-80h-32l80-160H280v-160h120v160l-68 160Zm360 0h-32l80-160H640v-160h120v160l-68 160Zm-300 0Zm360 0Z"/></svg>`;

const CHEVRON = // Material Symbols: chevron_right (reused from material/index.ts)
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor"><path d="M530-481 332-679l43-43 241 241-241 241-43-43 198-198Z"/></svg>`;

/**
 * Canonical type → SVG string. Used by both the live-preview renderer
 * and the HTML exporter via `calloutIconSvg`.
 */
export const CALLOUT_ICONS: Record<string, string> = {
  note: NOTE,
  abstract: ABSTRACT,
  info: INFO,
  todo: TODO,
  tip: TIP,
  success: SUCCESS,
  question: QUESTION,
  warning: WARNING,
  failure: FAILURE,
  danger: DANGER,
  bug: BUG,
  example: EXAMPLE,
  quote: QUOTE,
};

/**
 * Return the icon SVG for a canonical callout type. Falls back to the
 * `info` icon for unknown types (user-defined custom callouts) — matches
 * Obsidian's behavior when no `--callout-icon` is set in a CSS snippet.
 *
 * `plain` (and every `plain-<color>` variant) explicitly opts out of an
 * icon — we return "" so callers know to skip rendering the icon span
 * entirely (vs. unknown types, which still get the info fallback for
 * visual affordance).
 */
export function calloutIconSvg(canonical: string): string {
  if (isPlainCallout(canonical)) return "";
  return CALLOUT_ICONS[canonical] ?? CALLOUT_ICONS.info;
}

/**
 * Foldable callouts use a chevron that rotates 90° when the callout is
 * collapsed (CSS handles the rotation). Exported so both the live-preview
 * renderer and the HTML exporter render the same chevron.
 */
export const CALLOUT_CHEVRON_SVG = CHEVRON;

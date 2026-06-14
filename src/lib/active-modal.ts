/**
 * active-modal.ts — sentinel-id guard for the View Modal's
 * stacking-refusal contract (EC-12).
 *
 * The Architect locked AD-8: a sentinel-id list (not a claim/release
 * registry) is the modal-stacking guard. Each known modal's overlay
 * id appears here; the View Modal's open path calls `isAnyModalOpen()`
 * and silently returns when true.
 *
 * Adding a new modal? Append its overlay id (or sentinel class) to
 * `KNOWN_MODAL_OVERLAYS`. Missing entries fail OPEN — the View Modal
 * opens stacked, which is recoverable. Over-inclusion would block
 * legitimate opens, which is not.
 *
 * The smart-filter-builder modal is INTENTIONALLY excluded because
 * it's opened from inside the View Modal's `+ Add filter` flow and
 * must be allowed to stack on top.
 *
 * @module active-modal
 */

/**
 * Each entry describes how to detect that a particular modal is open.
 * Either by document id (most modals) or by a CSS-selector class
 * scoped to the modal's overlay element (used by modals that mount
 * with `class="settings-overlay ..."` and no stable id).
 *
 * The list is verified against the codebase during step_06; new
 * modals added later must register here OR opt into a claim/release
 * registry (deferred — DW-10).
 */
interface KnownModalOverlay {
  /** Human-readable label so a future audit can map back to the source. */
  source: string;
  /** Detection mode: by element id or by CSS selector. */
  kind: "id" | "selector";
  /** The element id OR the selector string, depending on `kind`. */
  match: string;
}

/**
 * The canonical list of modal-overlay sentinels. Audited 2026-06-08.
 *
 * - Codeblock modal (legacy `openCodeBlockModal`, deleted in step_09):
 *   id `__codeblock-modal-overlay__`. Same id is reused by the legacy
 *   modal flow until step_09 cuts it.
 * - View Modal (this feature): id `__view-modal-overlay__`. Treated
 *   here so a self-stack is also blocked (defence-in-depth — the
 *   inner `document.getElementById(VIEW_MODAL_OVERLAY_ID)` check in
 *   `openViewModal` is the primary guard).
 * - Template picker (deleted in step_05/step_08): id
 *   `__template-picker-overlay__`. Listed for safety until the deletion
 *   completes; no harm if it lingers.
 * - Folder-icon picker: mounted with class `folder-icon-picker-overlay`
 *   (no stable id). Detected via the class on the document overlay.
 * - Settings / keybindings / plugins panels: all use the shared
 *   id `settings-overlay`. The `hidden` class is toggled when the
 *   panel is closed; we treat a non-hidden `settings-overlay` as open.
 * - Command bar: id `markable-command-bar-overlay`.
 */
export const KNOWN_MODAL_OVERLAYS: ReadonlyArray<KnownModalOverlay> = [
  { source: "View Modal",            kind: "id",       match: "__view-modal-overlay__" },
  // The legacy codeblock-modal overlay id (`__codeblock-modal-overlay__`)
  // was deleted in step_09 of the view-modal feature when the legacy
  // `openCodeBlockModal` was removed; the entry stays in this list as
  // a regression pin so a future revival of the legacy id would still
  // be detected.
  { source: "Codeblock Modal (legacy)", kind: "id",    match: "__codeblock-modal-overlay__" },
  // Template Picker is still used by `src/lib/layout-manager.ts` for
  // the apply-page-layout flow (different feature). The in-plugin
  // copy was deleted in step_08, but the shared lib copy remains.
  { source: "Template Picker",       kind: "id",       match: "__template-picker-overlay__" },
  { source: "Folder Icon Picker",    kind: "selector", match: ".folder-icon-picker-overlay" },
  // Settings panel / keybindings / plugins all share `id=settings-overlay`.
  // The `hidden` class is toggled when the panel is closed; we treat a
  // *visible* settings-overlay (no `.hidden`) as the open signal.
  { source: "Settings / Keybindings / Plugins",
    kind: "selector",
    match: "#settings-overlay:not(.hidden)" },
  // Command Bar overlay is mounted at app startup and persists in the DOM,
  // toggled visible via removal of `.cb-hidden`. A plain id lookup would
  // always match and block every View Modal open — use a selector that
  // requires the overlay to be VISIBLE (no `.cb-hidden` class).
  { source: "Command Bar",           kind: "selector", match: "#markable-command-bar-overlay:not(.cb-hidden)" },
  { source: "Collision Dialog",      kind: "id",       match: "__collision-dialog-overlay__" },
];

/**
 * Re-exported sentinel list of overlay IDs only (the keys most tests
 * pre-populate). The selector entries are appended after for
 * convenience; tests that mount stub elements with these ids will be
 * detected by `isAnyModalOpen()`.
 */
export const KNOWN_MODAL_OVERLAY_IDS: readonly string[] = KNOWN_MODAL_OVERLAYS
  .filter((m) => m.kind === "id")
  .map((m) => m.match);

/**
 * True when ANY of the known modal overlays is currently mounted.
 * Used by the View Modal's open path to refuse stacking (EC-12).
 *
 * Implementation note: this function only touches the DOM; no
 * side effects. Safe to call from any context.
 */
export function isAnyModalOpen(): boolean {
  for (const m of KNOWN_MODAL_OVERLAYS) {
    if (m.kind === "id") {
      if (document.getElementById(m.match)) return true;
    } else {
      if (document.querySelector(m.match)) return true;
    }
  }
  return false;
}

/**
 * Returns the `source` of the first detected open modal, or null when
 * none are open. Useful for diagnostics in tests; never displayed to
 * the end user (EC-12 is silent — no toast, no console log).
 */
export function currentModalSource(): string | null {
  for (const m of KNOWN_MODAL_OVERLAYS) {
    if (m.kind === "id") {
      if (document.getElementById(m.match)) return m.source;
    } else {
      if (document.querySelector(m.match)) return m.source;
    }
  }
  return null;
}

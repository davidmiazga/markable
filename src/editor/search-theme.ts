/**
 * Search match highlight theme for Markable.
 *
 * These rules style the document-level decorations that CM6 applies to
 * matched text when a SearchQuery is active. They are independent of
 * the panel UI — the custom FindWidget (src/editor/find-widget.ts) manages
 * its own appearance via src/editor/find-widget.css.
 *
 * The previous version of this file also styled the CM6 built-in panel DOM.
 * Those rules have been removed because the CM6 panel factory is now suppressed
 * — no panel element is ever injected.
 * See docs/specs/find-replace/00_index.md § TC-2.
 *
 * CSS custom properties (defined in styles.css):
 *   --search-match-bg            highlight color for all non-active matches
 *   --search-match-selected-bg   highlight color for the active (current) match
 */
import { EditorView } from "@codemirror/view";

export const searchTheme = EditorView.theme({
  /**
   * FR-4.1 / AC-15: All non-active match highlights.
   * Semi-transparent so the underlying text remains readable.
   */
  ".cm-searchMatch": {
    backgroundColor: "var(--search-match-bg)",
    outline: "none",
    borderRadius: "2px",
  },

  /**
   * FR-4.2 / AC-15: The currently active (selected) match highlight.
   * More saturated than .cm-searchMatch so the user can track position.
   */
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--search-match-selected-bg)",
    outline: "1px solid color-mix(in srgb, var(--search-match-selected-bg) 80%, transparent)",
  },
});

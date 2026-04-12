/**
 * IIFE entry point for the Word Count core plugin.
 *
 * Compiled by vite.plugins.config.ts into:
 *   src-tauri/plugins/core/word-count.js
 *
 * Evaluated at runtime via: new Function(source + "\nreturn __markablePlugin__;")()
 *
 * Self-containment rules: only @codemirror/view import allowed; no app-internal modules.
 * No CSS injection needed — the status bar zones are styled by the main app bundle.
 * The `import type` for MarkablePluginAPI is erased by tsc; no runtime code emitted.
 *
 * Key difference from the static path:
 *   The static word-count.ts receives scheduleUpdate() calls from main.ts's CM6
 *   updateListener. This IIFE version registers its own EditorView.updateListener
 *   via api.addExtensions(), making the plugin fully self-contained. Both approaches
 *   are correct and independent — the static call site in main.ts is removed in step_04a.
 *
 * EC-30, EC-31, EC-32: see focus-mode.plugin.ts for full EC rationale.
 */

import { EditorView, type ViewUpdate } from "@codemirror/view";
import type { MarkablePluginAPI } from "../markable-plugin-api";

// ── Module-level state ────────────────────────────────────────────────────────
// These variables are private to the IIFE closure after bundling — they are
// not visible outside the Function() scope at runtime.

/** Debounce interval in milliseconds to throttle status bar updates while typing. */
const DEBOUNCE_MS = 150;

/** Reference to the status bar center zone element, set in onEnable. */
let _targetEl: HTMLElement | null = null;

/** Whether the plugin is currently enabled. Guards the updateListener callback. */
let _enabled = false;

/** Active debounce timer handle. Cleared on each new event and on disable. */
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

// ── Word counting ─────────────────────────────────────────────────────────────

/**
 * Count the number of words in a string by splitting on whitespace runs.
 * Returns 0 for empty or whitespace-only strings.
 *
 * @param text - Raw document or selection text.
 * @returns    Integer word count.
 */
function countWords(text: string): number {
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

/**
 * Update the status bar center zone with the current word and character counts.
 *
 * When there is an active selection (selFrom !== selTo), the display shows
 * "N / M words    X / Y chars" (selection counts / total counts).
 * When there is no selection: "N words    M chars".
 *
 * @param docText  - Full document text as a plain string.
 * @param selFrom  - Selection start offset (equals selTo when no selection).
 * @param selTo    - Selection end offset.
 */
function updateDisplay(docText: string, selFrom: number, selTo: number): void {
  if (!_targetEl || !_enabled) return;
  const totalWords = countWords(docText);
  const totalChars = docText.length;
  if (selFrom !== selTo) {
    const selText = docText.slice(selFrom, selTo);
    _targetEl.textContent = `${countWords(selText)} / ${totalWords} words    ${selText.length} / ${totalChars} chars`;
  } else {
    _targetEl.textContent = `${totalWords} words    ${totalChars} chars`;
  }
}

// ── CM6 extension ─────────────────────────────────────────────────────────────

/**
 * CM6 updateListener registered via api.addExtensions() in onEnable.
 *
 * Fires on every editor transaction. Short-circuits if the plugin is disabled
 * or if neither the document nor the selection changed (perf: avoids redundant
 * debounce scheduling on cursor blink or focus events).
 *
 * Debounced at DEBOUNCE_MS so rapid keystrokes do not trigger a display update
 * on every character.
 */
const wordCountListener = EditorView.updateListener.of((update: ViewUpdate) => {
  if (!_enabled) return;
  if (!update.docChanged && !update.selectionSet) return;
  // Cancel any pending debounce before scheduling a new one.
  if (_debounceTimer) clearTimeout(_debounceTimer);
  // Snapshot state before the async delay so the correct doc/sel is used.
  const docText = update.state.doc.toString();
  const sel = update.state.selection.main;
  _debounceTimer = setTimeout(
    () => updateDisplay(docText, sel.from, sel.to),
    DEBOUNCE_MS,
  );
});

// ── Plugin object ─────────────────────────────────────────────────────────────

/**
 * UnifiedPlugin definition for Word Count.
 *
 * onEnable: sets the target element, ensures the status bar is visible,
 *   and registers the CM6 updateListener via api.addExtensions().
 *
 * onDisable: clears the display text, nulls the target element, cancels the
 *   pending debounce timer, removes the CM6 extension, and hides the status bar
 *   if no other plugin is using it.
 */
export default {
  id: "word-count",
  name: "Word Count",
  version: "1.0.0",
  description: "Word and character count in the status bar",
  detail:
    "Displays a live word count and character count in the status bar. Updates as you type. Shows selection count when text is selected.",

  onEnable(api: MarkablePluginAPI): void {
    _enabled = true;
    _targetEl = api.statusBar.center;
    api.ensureStatusBar();
    api.addExtensions([wordCountListener]);
  },

  onDisable(api: MarkablePluginAPI): void {
    _enabled = false;
    if (_targetEl) _targetEl.textContent = "";
    _targetEl = null;
    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }
    api.removeExtensions();
    api.hideStatusBarIfUnused();
  },
};

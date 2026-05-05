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

// Bug #5 fix: DO NOT import from @codemirror/* directly. The build marks all
// @codemirror/* packages as external. At runtime, main.ts assigns the real CM6
// module objects to window globals (cm-globals.ts) before any plugin IIFE runs.
// Destructuring from those globals ensures this plugin's EditorView.updateListener
// is registered on the same CM6 instance as the main editor.
/* eslint-disable @typescript-eslint/no-explicit-any */
const {
  EditorView,
} = (window as any).__CM_VIEW__ as typeof import("@codemirror/view");
/* eslint-enable @typescript-eslint/no-explicit-any */

// Type-only import — erased by tsc, safe for IDE support.
import type { ViewUpdate } from "@codemirror/view";
import type { MarkablePluginAPI } from "../markable-plugin-api";
import { buildToggleRow } from "../../settings/settings-fields";

// ── Module-level state ────────────────────────────────────────────────────────

/** Debounce interval in milliseconds to throttle status bar updates while typing. */
const DEBOUNCE_MS = 150;

/** Reading speed assumption in words per minute. */
const WPM = 200;

/** Reference to the status bar center zone element, set in onEnable. */
let _targetEl: HTMLElement | null = null;

/** Whether the plugin is currently enabled. Guards the updateListener callback. */
let _enabled = false;

/** Active debounce timer handle. Cleared on each new event and on disable. */
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Whether to show reading time alongside word/char counts. Persisted via plugin settings. */
let _showReadingTime = false;

/** Plugin API reference, held so renderDetailExtra can save settings. */
let _api: MarkablePluginAPI | null = null;

// ── Word counting ─────────────────────────────────────────────────────────────

/**
 * Count the number of words in a string by splitting on whitespace runs.
 * Returns 0 for empty or whitespace-only strings.
 */
function countWords(text: string): number {
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

/**
 * Format a word count as a reading-time string (e.g. "~3 min read", "< 1 min read").
 */
function readingTimeLabel(words: number): string {
  const mins = Math.round(words / WPM);
  return mins < 1 ? "< 1 min read" : `~${mins} min read`;
}

/**
 * Update the status bar center zone with word/char counts and optionally reading time.
 *
 * When there is an active selection the display shows selection / total counts.
 * Reading time is shown only when there is no selection (it reflects the whole doc).
 */
function updateDisplay(docText: string, selFrom: number, selTo: number): void {
  if (!_targetEl || !_enabled) return;
  const totalWords = countWords(docText);
  const totalChars = docText.length;

  if (selFrom !== selTo) {
    const selText = docText.slice(selFrom, selTo);
    _targetEl.textContent =
      `${countWords(selText)} / ${totalWords} words    ${selText.length} / ${totalChars} chars`;
  } else {
    const readingTime = _showReadingTime ? `    ${readingTimeLabel(totalWords)}` : "";
    _targetEl.textContent = `${totalWords} words    ${totalChars} chars${readingTime}`;
  }
}

// ── CM6 extension ─────────────────────────────────────────────────────────────

const wordCountListener = EditorView.updateListener.of((update: ViewUpdate) => {
  if (!_enabled) return;
  if (!update.docChanged && !update.selectionSet) return;
  if (_debounceTimer) clearTimeout(_debounceTimer);
  const docText = update.state.doc.toString();
  const sel = update.state.selection.main;
  _debounceTimer = setTimeout(
    () => updateDisplay(docText, sel.from, sel.to),
    DEBOUNCE_MS,
  );
});

// ── Plugin settings UI ────────────────────────────────────────────────────────

function renderDetailExtra(container: HTMLElement): void {
  const row = buildToggleRow({
    label: "Show reading time",
    description: "Appends an estimated read time to the status bar (assumes 200 WPM).",
    checked: _showReadingTime,
    onChange: async (checked) => {
      _showReadingTime = checked;
      if (_api) await _api.saveSettings({ showReadingTime: checked });
      // Refresh display immediately so the change is visible without typing.
      const view = (window as any).__MARKABLE_EDITOR_VIEW__;
      if (view) {
        const docText = view.state.doc.toString();
        const sel = view.state.selection.main;
        updateDisplay(docText, sel.from, sel.to);
      }
    },
  });
  container.appendChild(row);
}

// ── Plugin object ─────────────────────────────────────────────────────────────

export default {
  id: "word-count",
  name: "Word Count",
  version: "1.0.0",
  description: "Word and character count in the status bar",
  detail:
    "Displays a live word count and character count in the status bar. Updates as you type. Shows selection count when text is selected. Optionally shows estimated reading time.",

  async onEnable(api: MarkablePluginAPI): Promise<void> {
    _enabled = true;
    _api = api;
    _targetEl = api.statusBar.center;

    const stored = await api.loadSettings().catch(() => null) as Record<string, unknown> | null;
    if (stored?.showReadingTime === true) _showReadingTime = true;

    api.registerStatusBarDependent();
    api.ensureStatusBar();
    api.addExtensions([wordCountListener]);
  },

  onDisable(api: MarkablePluginAPI): void {
    _enabled = false;
    _api = null;
    if (_targetEl) _targetEl.textContent = "";
    _targetEl = null;
    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }
    api.removeExtensions();
    api.unregisterStatusBarDependent();
    api.hideStatusBarIfUnused();
  },

  renderDetailExtra,
};

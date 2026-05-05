/**
 * Typing Assist — input transformation plugin.
 *
 * A home for behaviors that silently rewrite keystrokes as you type.
 * Current features (all opt-in, default off):
 *   • Smart quotes  — "text" → "text",  'text' → 'text'
 *   • Smart dashes  — -- → –,  --- → —
 *   • Ellipsis      — ... → …
 *
 * All substitutions are suppressed inside fenced code blocks, indented
 * code blocks, inline code spans, and YAML front matter.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const { EditorView } =
  (window as any).__CM_VIEW__ as typeof import("@codemirror/view");
const { syntaxTree } =
  (window as any).__CM_LANGUAGE__ as typeof import("@codemirror/language");
/* eslint-enable @typescript-eslint/no-explicit-any */

import type { EditorView as EditorViewType } from "@codemirror/view";
import type { MarkablePluginAPI } from "../markable-plugin-api";
import { buildToggleRow } from "../../settings/settings-fields";

// ── Module-level state ────────────────────────────────────────────────────────

let _enabled      = false;
let _smartQuotes  = true;   // on by default
let _smartDashes  = false;
let _ellipsis     = false;
let _api: MarkablePluginAPI | null = null;

// ── Context detection ─────────────────────────────────────────────────────────

/**
 * Returns true when `pos` falls inside a code block, inline code span, or
 * YAML front matter — places where typography substitutions must not fire.
 */
function isProtectedContext(view: EditorViewType, pos: number): boolean {
  const { state } = view;
  const doc = state.doc;

  // YAML front matter: doc starts with "---\n", find the closing "---" or "..."
  if (doc.lines >= 3 && doc.line(1).text === "---") {
    for (let i = 2; i <= doc.lines; i++) {
      const t = doc.line(i).text;
      if (t === "---" || t === "...") {
        if (pos <= doc.line(i).to) return true;
        break;
      }
    }
  }

  // Syntax tree: walk ancestors from the cursor position
  let node = syntaxTree(state).resolveInner(pos, -1);
  while (node) {
    const { name } = node;
    if (
      name === "FencedCode" ||
      name === "CodeBlock"  ||
      name === "InlineCode" ||
      name === "CodeText"
    ) return true;
    if (!node.parent) break;
    node = node.parent;
  }

  return false;
}

/**
 * Returns true when the character immediately before `pos` suggests an
 * *opening* quote context: whitespace, an opening bracket, a dash, or the
 * start of the document.
 */
function isOpeningContext(view: EditorViewType, pos: number): boolean {
  if (pos === 0) return true;
  const prev = view.state.sliceDoc(pos - 1, pos);
  return /[\s\u2014\u2013\-\(\[\{]/.test(prev);
}

// ── Input handler ─────────────────────────────────────────────────────────────

const typingAssistHandler = EditorView.inputHandler.of(
  (view, from, to, text) => {
    if (!_enabled) return false;
    if (isProtectedContext(view, from)) return false;

    // ── Smart quotes — double ─────────────────────────────────────────────
    if (_smartQuotes && text === '"') {
      const ch = isOpeningContext(view, from) ? "\u201C" : "\u201D"; // " or "
      view.dispatch(view.state.update({
        changes:   { from, to, insert: ch },
        selection: { anchor: from + 1 },
      }));
      return true;
    }

    // ── Smart quotes — single ─────────────────────────────────────────────
    if (_smartQuotes && text === "'") {
      // After a word character: closing quote / apostrophe (')
      // Otherwise: opening quote (')
      const prev = from > 0 ? view.state.sliceDoc(from - 1, from) : "";
      const ch = /\w/.test(prev) ? "\u2019" : "\u2018"; // ' or '
      view.dispatch(view.state.update({
        changes:   { from, to, insert: ch },
        selection: { anchor: from + 1 },
      }));
      return true;
    }

    // ── Smart dashes ──────────────────────────────────────────────────────
    if (_smartDashes && text === "-" && from >= 1) {
      const prev = view.state.sliceDoc(from - 1, from);
      if (prev === "\u2013") {
        // – + - → — (em-dash); cursor after the new char
        view.dispatch(view.state.update({
          changes:   { from: from - 1, to, insert: "\u2014" },
          selection: { anchor: from },
        }));
        return true;
      }
      if (prev === "-") {
        // - + - → – (en-dash); cursor after the new char
        view.dispatch(view.state.update({
          changes:   { from: from - 1, to, insert: "\u2013" },
          selection: { anchor: from },
        }));
        return true;
      }
    }

    // ── Ellipsis ──────────────────────────────────────────────────────────
    if (_ellipsis && text === "." && from >= 2) {
      const prev2 = view.state.sliceDoc(from - 2, from);
      if (prev2 === "..") {
        // Replace the 2 dots already in doc plus this one → …; cursor after
        view.dispatch(view.state.update({
          changes:   { from: from - 2, to, insert: "\u2026" },
          selection: { anchor: from - 1 },
        }));
        return true;
      }
    }

    return false;
  },
);

// ── Settings UI ───────────────────────────────────────────────────────────────

async function saveSettings(): Promise<void> {
  if (_api) {
    await _api.saveSettings({
      smartQuotes: _smartQuotes,
      smartDashes: _smartDashes,
      ellipsis:    _ellipsis,
    });
  }
}

function renderDetailExtra(container: HTMLElement): void {
  container.appendChild(buildToggleRow({
    label: "Smart quotes",
    description: 'Replaces " and \' with curly "quotes" and apostrophes.',
    checked: _smartQuotes,
    onChange: async (v) => { _smartQuotes = v; await saveSettings(); },
  }));
  container.appendChild(buildToggleRow({
    label: "Smart dashes",
    description: "Converts -- to an en-dash (–) and --- to an em-dash (—).",
    checked: _smartDashes,
    onChange: async (v) => { _smartDashes = v; await saveSettings(); },
  }));
  container.appendChild(buildToggleRow({
    label: "Ellipsis",
    description: "Converts ... to a single ellipsis character (…).",
    checked: _ellipsis,
    onChange: async (v) => { _ellipsis = v; await saveSettings(); },
  }));
}

// ── Plugin lifecycle ──────────────────────────────────────────────────────────

async function onEnable(api: MarkablePluginAPI): Promise<void> {
  _enabled = true;
  _api = api;

  const stored = await api.loadSettings().catch(() => null) as Record<string, unknown> | null;
  if (stored) {
    if (typeof stored.smartQuotes === "boolean") _smartQuotes = stored.smartQuotes;
    if (typeof stored.smartDashes === "boolean") _smartDashes = stored.smartDashes;
    if (typeof stored.ellipsis    === "boolean") _ellipsis    = stored.ellipsis;
  }

  api.addExtensions([typingAssistHandler]);
}

function onDisable(api: MarkablePluginAPI): void {
  _enabled     = false;
  _smartQuotes = true;   // reset to default for next enable
  _smartDashes = false;
  _ellipsis    = false;
  _api         = null;
  api.removeExtensions();
}

// ── Export ────────────────────────────────────────────────────────────────────

export default {
  id:   "typing-assist",
  name: "Typing Assist",
  version: "1.0.0",
  description: "Smart typography as you type",
  detail:
    "Silently transforms keystrokes into typographically correct characters. " +
    'Smart quotes turns " and \' into curly quotes. Smart dashes converts -- into an ' +
    "en-dash and --- into an em-dash. Ellipsis converts ... into the single … character. " +
    "All substitutions are disabled inside code blocks and YAML front matter. " +
    "Each feature can be toggled independently.",
  renderDetailExtra,
  onEnable,
  onDisable,
};

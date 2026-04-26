/**
 * Expose CodeMirror packages as window globals so IIFE plugin bundles can
 * reference them without bundling their own copy.
 *
 * Bug #5 fix: when each .plugin.ts IIFE bundles its own copy of @codemirror/*,
 * it creates a separate set of StateField slot IDs. A StateField registered by
 * the plugin bundle is invisible to the main app's CM6 instance — the editor
 * cannot see the field at all. ViewPlugins similarly fail if their EditorView
 * references do not match the live view's internal registry.
 *
 * The solution is to expose the main app's CM6 module objects on `window` globals
 * and mark all `@codemirror/*` packages as external in the plugin build config.
 * Plugin code then references `window.__CM_STATE__` / `window.__CM_VIEW__` instead
 * of bundled copies, ensuring all StateField/StateEffect/ViewPlugin instances share
 * the same slot-ID namespace as the main editor.
 *
 * This file must be imported at the very top of main.ts, before any plugin code
 * runs, so the globals are available before evaluatePlugin() calls the IIFE.
 *
 * Exported names on each global match the named exports used by the plugin files:
 *   __CM_STATE__    — @codemirror/state exports used by focus-mode and typewriter-mode
 *   __CM_VIEW__     — @codemirror/view exports used by all plugins
 *   __CM_LANGUAGE__ — @codemirror/language exports used by table-toolbar (syntaxTree)
 *   __CM_AUTOCOMPLETE__ — @codemirror/autocomplete exports used by backlinks (autocompletion)
 */

// We import the full module objects so we can expose every named export that
// any plugin might need. New plugin authors can add exports here if needed.
import * as _cmState from "@codemirror/state";
import * as _cmView from "@codemirror/view";
import * as _cmLanguage from "@codemirror/language";
import * as _cmAutocomplete from "@codemirror/autocomplete";

/**
 * Assign CodeMirror module namespaces to the window object.
 *
 * These must be set synchronously before any plugin IIFE is evaluated.
 * The assignments are unconditional — there is no guard for existing values
 * because main.ts imports this module before any plugin code runs.
 */
(window as unknown as Record<string, unknown>)["__CM_STATE__"] = _cmState;
(window as unknown as Record<string, unknown>)["__CM_VIEW__"] = _cmView;
// Required by table-toolbar.plugin.ts — exposes syntaxTree and related language utilities.
(window as unknown as Record<string, unknown>)["__CM_LANGUAGE__"] = _cmLanguage;
// Required by backlinks.plugin.ts — exposes autocompletion, CompletionContext,
// CompletionResult, and related autocomplete utilities.
(window as unknown as Record<string, unknown>)["__CM_AUTOCOMPLETE__"] = _cmAutocomplete;

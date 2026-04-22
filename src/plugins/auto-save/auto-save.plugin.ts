/**
 * IIFE entry point for the Auto-Save core plugin.
 *
 * Compiled by vite.plugins.config.ts into:
 *   src-tauri/plugins/core/auto-save.js
 *
 * Evaluated at runtime via: new Function(source + "\nreturn __markablePlugin__;")()
 *
 * Self-containment rules: no app-internal imports at runtime. All app interaction
 * goes through window globals and the api parameter. CM6 globals accessed via
 * window.__CM_VIEW__ / window.__CM_STATE__. CSS injected as <style> tags.
 *
 * EC-30, EC-31, EC-32: see focus-mode.plugin.ts for full rationale.
 */

// Bug #5 fix: DO NOT import from @codemirror/* directly. The build marks all
// @codemirror/* packages as external. At runtime, main.ts assigns the real CM6
// module objects to window globals (cm-globals.ts) before any plugin IIFE runs.
// Destructuring from those globals ensures this plugin shares the SAME updateListener
// factory as the main editor — a bundled copy would create a disjoint factory instance.
/* eslint-disable @typescript-eslint/no-explicit-any */
const {
  EditorView,
} = (window as any).__CM_VIEW__ as typeof import("@codemirror/view");
/* eslint-enable @typescript-eslint/no-explicit-any */

// Type-only imports — erased by tsc, safe for IDE support.
import type { ViewUpdate } from "@codemirror/view";
import type { MarkablePluginAPI } from "../markable-plugin-api";

// ── Settings types and defaults ───────────────────────────────────────────────

/**
 * The three trigger modes supported by Auto-Save.
 *
 * - "debounce"   : Save after N ms of typing inactivity (FR-03).
 * - "focus-loss" : Save when the app window loses focus (FR-02).
 * - "both"       : Both triggers active simultaneously (default, FR-01).
 */
type TriggerMode = "debounce" | "focus-loss" | "both";

/** Persisted settings shape for the Auto-Save plugin. */
interface AutoSaveSettings {
  triggerMode: TriggerMode;
  /** Debounce wait time in milliseconds. Clamped to [500, 30000]. */
  debounceDelayMs: number;
}

/** Factory defaults used when no stored settings exist (EC-09). */
const DEFAULT_SETTINGS: AutoSaveSettings = {
  triggerMode: "both",
  debounceDelayMs: 2000,
};

// ── Module-level state ────────────────────────────────────────────────────────
// These variables are private to the IIFE closure after bundling — they are
// not visible outside the Function() scope at runtime.

/**
 * Current persisted settings. Populated in onEnable; kept in sync by UI handlers.
 *
 * IMPORTANT: This must remain a module-level `let` (not `const`) and must be
 * mutated in place by onEnable (not replaced with a new object). The `autoSaveListener`
 * closure captures the variable binding, so it reads `_settings.debounceDelayMs`
 * live on each timer reset. Replacing the binding (e.g. `const _settings = ...`) or
 * freezing the object would break the live-read contract (AD-5, FR-06.4).
 */
let _settings: AutoSaveSettings = { ...DEFAULT_SETTINGS };

/**
 * Guards the async onEnable continuation against a race with onDisable (EC-10).
 * Set true at the start of onEnable; set false at the start of onDisable.
 * The onEnable continuation checks this before attaching any listeners.
 */
let _active = false;

/** Pending debounce timer handle. Only one timer runs at a time (FR-03.4). */
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Named reference to the blur handler so removeEventListener can remove exactly
 * the same function reference that addEventListener registered (FR-08.2, NFR-04).
 * Created fresh in each onEnable; set to null in onDisable after removal.
 */
let _blurHandler: (() => void) | null = null;

/** Plugin API reference, used by attemptSave and renderDetailExtra. */
let _api: MarkablePluginAPI | null = null;

// ── Pure helpers (exported for unit testing) ─────────────────────────────────

/**
 * Clamp a raw delay value to the valid range [500, 30000].
 * Non-numeric input falls back to the default (2000 ms) per FR-03.3.
 *
 * Exported for unit testing.
 *
 * @param raw - The raw value (number, string, or unknown) from settings or UI.
 * @returns   Integer delay in ms, clamped to [500, 30000].
 */
export function clampDelay(raw: unknown): number {
  // Treat null and undefined as missing — fall back to the default rather than
  // clamping: Number(null) === 0 and Number(undefined) === NaN, but the spec
  // treats both as "no value provided" per FR-03.3.
  if (raw === null || raw === undefined) return DEFAULT_SETTINGS.debounceDelayMs;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.debounceDelayMs;
  return Math.max(500, Math.min(30_000, Math.round(n)));
}

/**
 * Merge raw settings from api.loadSettings() with the defaults.
 * Returns a fully-populated AutoSaveSettings even when raw is null (EC-09).
 *
 * Exported for unit testing.
 *
 * @param raw - The return value of api.loadSettings(), or null.
 * @returns   Merged settings with validated and clamped values.
 */
export function loadAndMergeSettings(raw: Record<string, unknown> | null): AutoSaveSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  const validModes: TriggerMode[] = ["debounce", "focus-loss", "both"];
  // Validate triggerMode: fall back to default if the stored value is unrecognised.
  const triggerMode: TriggerMode = validModes.includes(raw.triggerMode as TriggerMode)
    ? (raw.triggerMode as TriggerMode)
    : DEFAULT_SETTINGS.triggerMode;
  // Clamp debounceDelayMs — covers EC-12 on the load path.
  const debounceDelayMs = clampDelay(raw.debounceDelayMs ?? DEFAULT_SETTINGS.debounceDelayMs);
  return { triggerMode, debounceDelayMs };
}

// ── Core save logic ───────────────────────────────────────────────────────────

/**
 * Attempt to auto-save the currently active tab.
 *
 * Guards applied in order:
 *   1. Tab manager global absent → warn + skip (EC-15, FR-04.5)
 *   2. No active tab (getActiveTab() returns null) → skip silently (EC-07)
 *   3. Tab is untitled (filePath === null) → skip silently (EC-01, FR-04.3)
 *   4. Tab is clean (isDirty === false) → skip silently (EC-02, FR-04.4)
 *   5. All guards pass → call saveActiveTab()
 *
 * Exported for unit testing.
 */
export function attemptSave(): void {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // EC-15 / FR-04.5: the global may not be present in all runtime contexts.
  if (!tabManager) {
    console.warn("[auto-save] __MARKABLE_TAB_MANAGER__ is not available; skipping.");
    return;
  }

  const tab = tabManager.getActiveTab();

  // EC-07: no open tab (e.g. all tabs closed).
  if (!tab) return;

  // EC-01 / FR-04.3: untitled tab — never open an unexpected Save-As dialog.
  if (tab.filePath === null) return;

  // EC-02 / FR-04.4: nothing to save — tab has not been modified since last save.
  if (!tab.isDirty) return;

  // All guards passed — delegate the actual write to the tab manager.
  // Called without await: the plugin is fire-and-forget; EC-08 (write failure)
  // is surfaced by TabManager's own alert() so no extra UI is needed here.
  tabManager.saveActiveTab();
}

// ── CM6 extension ─────────────────────────────────────────────────────────────

/**
 * CM6 updateListener that resets the debounce timer on every docChanged transaction.
 *
 * Short-circuits if the transaction did not change the document — cursor moves
 * and selection changes do not start or reset the timer (EC-03 implicit).
 *
 * Starting a new timer always cancels any pending timer first (FR-03.4, EC-03).
 * The delay is read from _settings.debounceDelayMs at each reset — changes to
 * the setting take effect on the next reset without a restart (FR-06.4, AD-5).
 *
 * Exported for unit testing (value identity check only; CM6 machinery not replicated).
 */
export const autoSaveListener = EditorView.updateListener.of((update: ViewUpdate) => {
  if (!update.docChanged) return;

  // Cancel any already-pending debounce so only the most-recent keystroke counts.
  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }

  // Schedule the save. The delay is read from current settings so in-flight
  // changes to _settings.debounceDelayMs take effect immediately (AD-5).
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    attemptSave();
  }, _settings.debounceDelayMs);
});

// ── CSS helpers ───────────────────────────────────────────────────────────────

/**
 * Inject the Auto-Save settings CSS into the document <head>.
 * No-op if already injected (identified by the unique element id).
 * Called at the end of onEnable so controls rendered by renderDetailExtra
 * pick up the styles immediately.
 */
function injectCSS(): void {
  const id = "__markable_auto_save_css__";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .auto-save-settings-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      font-family: var(--ui-font);
      font-size: 13px;
    }
    .auto-save-settings-row label {
      flex: 0 0 140px;
      color: var(--text-color, inherit);
    }
    .auto-save-settings-row select,
    .auto-save-settings-row input[type="number"] {
      font-family: var(--ui-font);
      font-size: 13px;
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid var(--border-color, #ccc);
      background: var(--input-bg, #fff);
      color: var(--text-color, inherit);
    }
    .auto-save-delay-unit {
      color: var(--text-muted, #888);
      font-family: var(--ui-font);
      font-size: 12px;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Remove the Auto-Save settings CSS from the document <head>.
 * Called in onDisable so styles are cleaned up when the plugin is toggled off.
 */
function removeCSS(): void {
  document.getElementById("__markable_auto_save_css__")?.remove();
}

// ── Settings UI helpers ───────────────────────────────────────────────────────

/**
 * Build the trigger mode selector row.
 *
 * Change handler:
 *   1. Updates _settings.triggerMode in memory.
 *   2. Calls api.saveSettings() to persist.
 *   3. Calls api.restartSelf() so the new listener set takes effect (FR-06.3, EC-11).
 *
 * Note: after restartSelf() the detail panel may re-render; the next open will
 * show the updated setting because renderDetailExtra reads _settings directly.
 */
function buildTriggerRow(api: MarkablePluginAPI): HTMLElement {
  const row = document.createElement("div");
  row.className = "auto-save-settings-row";

  const label = document.createElement("label");
  label.textContent = "Trigger";

  const select = document.createElement("select");
  // Declare options as a plain array to avoid TS inference issues with the tuple type.
  const options: Array<[TriggerMode, string]> = [
    ["debounce",   "Debounce Timer"],
    ["focus-loss", "Focus Loss"],
    ["both",       "Both"],
  ];
  for (const [value, text] of options) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = text;
    // Pre-select the currently active mode so the UI reflects in-memory state.
    opt.selected = _settings.triggerMode === value;
    select.appendChild(opt);
  }

  select.addEventListener("change", async () => {
    _settings.triggerMode = select.value as TriggerMode;
    await api.saveSettings(_settings as unknown as Record<string, unknown>);
    // Restart is required here so onEnable re-runs and attaches the correct
    // set of listeners for the new mode (EC-11, FR-06.3).
    await api.restartSelf();
    // After restartSelf() the plugin is re-enabled; the container reference is
    // stale — no further DOM manipulation is needed here.
  });

  row.appendChild(label);
  row.appendChild(select);
  return row;
}

/**
 * Build the debounce delay numeric input row.
 *
 * Visibility: hidden when triggerMode is "focus-loss" (FR-06.2) because the
 * delay setting only applies to the debounce path.
 *
 * Change handler (fires on input blur or Enter — not on every keystroke):
 *   1. Clamps the raw input value via clampDelay() (EC-12).
 *   2. Updates the input's displayed value to the clamped value (corrects out-of-range input).
 *   3. Updates _settings.debounceDelayMs in memory.
 *   4. Calls api.saveSettings() to persist.
 *   No restart required — the timer reads _settings.debounceDelayMs at each reset (AD-5).
 */
function buildDelayRow(api: MarkablePluginAPI): HTMLElement {
  const row = document.createElement("div");
  row.className = "auto-save-settings-row";

  // Hide the delay row when focus-loss-only mode is active (FR-06.2).
  if (_settings.triggerMode === "focus-loss") {
    row.style.display = "none";
  }

  const label = document.createElement("label");
  label.textContent = "Debounce Delay";

  const input = document.createElement("input");
  input.type = "number";
  input.min = "500";
  input.max = "30000";
  input.step = "100";
  input.value = String(_settings.debounceDelayMs);
  input.style.width = "80px";

  const unit = document.createElement("span");
  unit.className = "auto-save-delay-unit";
  unit.textContent = "ms";

  // "change" fires on blur or Enter — not on every keystroke — which is
  // intentional: we only clamp and persist when the user commits the value.
  input.addEventListener("change", async () => {
    const clamped = clampDelay(input.value);
    // EC-12: update the UI to display the clamped (corrected) value.
    input.value = String(clamped);
    _settings.debounceDelayMs = clamped;
    await api.saveSettings(_settings as unknown as Record<string, unknown>);
    // No restartSelf() — the listener reads _settings.debounceDelayMs live (AD-5).
  });

  row.appendChild(label);
  row.appendChild(input);
  row.appendChild(unit);
  return row;
}

// ── Plugin lifecycle ──────────────────────────────────────────────────────────

/**
 * Enable handler: loads settings, attaches listeners based on triggerMode,
 * and injects the settings CSS. The _active flag guards against a race where
 * onDisable is called before the async loadSettings resolves (EC-10, AD-1).
 */
async function onEnable(api: MarkablePluginAPI): Promise<void> {
  // AD-1: set _active before the await so any concurrent onDisable call sets
  // it to false and the continuation below will bail out cleanly.
  _active = true;
  _api = api;

  const raw = await api.loadSettings();

  // EC-10: onDisable was called before the settings load resolved.
  // _active was set to false in onDisable; bail out without attaching anything.
  if (!_active) return;

  _settings = loadAndMergeSettings(raw);

  const { triggerMode } = _settings;

  // Attach the CM6 updateListener for debounce mode.
  if (triggerMode === "debounce" || triggerMode === "both") {
    api.addExtensions([autoSaveListener]);
  }

  // Attach the window blur listener for focus-loss mode.
  // The handler is constructed fresh in each onEnable so that it closes over
  // the current module state. Stored in _blurHandler so onDisable can pass
  // the exact same reference to removeEventListener (AD-2, FR-08.2.3).
  if (triggerMode === "focus-loss" || triggerMode === "both") {
    _blurHandler = () => {
      attemptSave();
    };
    window.addEventListener("blur", _blurHandler);
  }

  // Inject CSS after listeners are attached so the settings UI is styled on
  // the first open of the detail panel.
  injectCSS();
}

/**
 * Disable handler: cancels the pending debounce timer, removes the CM6 extension,
 * removes the blur listener (if attached), and cleans up the injected CSS.
 *
 * _active is set false first so that any async onEnable continuation in flight
 * will bail out rather than re-attaching listeners (AD-1, EC-10).
 */
function onDisable(api: MarkablePluginAPI): void {
  // Must be set first so that the EC-10 check in onEnable's continuation bails out.
  _active = false;
  _api = null;

  // EC-05 / FR-08.2.1: cancel any pending debounce timer so no save fires
  // after the plugin is switched off.
  if (_debounceTimer !== null) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }

  // FR-08.2.2: remove the CM6 extension (no-op if it was never added).
  api.removeExtensions();

  // FR-08.2.3 / EC-13: remove the blur listener using the exact same reference
  // that was passed to addEventListener. Using _blurHandler = null after removal
  // prevents double-remove on repeated disable calls.
  if (_blurHandler !== null) {
    window.removeEventListener("blur", _blurHandler);
    _blurHandler = null;
  }

  // Clean up CSS so it does not leak into the DOM when the plugin is disabled.
  removeCSS();
}

/**
 * Render Auto-Save settings into the Plugins Panel detail view (FR-06.1).
 *
 * Called every time the detail view is opened. The container is freshly created
 * on each call — no cleanup required. Must not throw.
 *
 * Renders:
 *   1. buildTriggerRow() — trigger mode dropdown (always visible)
 *   2. buildDelayRow()   — debounce delay input (hidden in focus-loss mode)
 *
 * Uses the module-level _api reference set in onEnable. If the plugin is somehow
 * disabled when the detail view is opened (unlikely but possible), _api will be null
 * and a dummy no-op api object is used so the handlers do not throw (AD-6).
 */
function renderDetailExtra(container: HTMLElement): void {
  // Use the module-level _api captured in onEnable.
  // If plugin is somehow disabled when this renders, pass a dummy object that no-ops
  // so the change handlers are safe to call.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  if (_api === null) {
    // The plugin is disabled but the detail panel is still open. Log a warning
    // so the developer knows settings changes will not persist (FR-05.2).
    console.warn("[auto-save] renderDetailExtra called while plugin is disabled — settings changes will not persist");
  }
  const api = _api ?? ({
    saveSettings: async () => {},
    restartSelf: async () => {},
  } as any as MarkablePluginAPI);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  container.appendChild(buildTriggerRow(api));
  container.appendChild(buildDelayRow(api));
}

// ── Plugin default export ─────────────────────────────────────────────────────

export default {
  id: "auto-save",
  name: "Auto-Save",
  version: "1.0.0",
  description: "Automatically save documents after inactivity or on focus loss",
  detail:
    "Saves the active document automatically so you never lose work. " +
    "Choose between a debounce timer (saves N ms after you stop typing), " +
    "focus loss (saves when the app window loses focus), or both triggers together. " +
    "Untitled documents are always skipped — no unexpected Save dialogs.",
  onEnable,
  onDisable,
  renderDetailExtra,
};

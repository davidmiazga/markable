/**
 * PluginManager — unified registry for Markable plugins.
 *
 * After Chunk 3 (step_03b), all plugins — core and user — are loaded from disk
 * as IIFE `.js` files. The old static built-in array (`this.plugins`) is gone.
 * Every plugin is evaluated through the same `evaluatePlugin()` path and given
 * the same `MarkablePluginAPI` object.
 *
 * Architecture:
 *   - `_records`: PluginRecord[]  — one entry per discovered file.
 *   - `loadPlugins(settings, statusBarZones)` — scans both `plugins/core/` and
 *     `plugins/user/`, performs override detection, evaluates each file, and
 *     restores enabled state from `settings.plugins`.
 *   - `toggle(id, enabled)` — unified enable/disable; persists to `settings.plugins`.
 *   - `getStates()` — unified Record<string, boolean> for all loaded plugins.
 *   - `getDefinitions()` — unified UnifiedPluginDef[] for panel rendering.
 *
 * EC-7/EC-8: override detection — a user file whose filename matches a core file
 *   causes the core slot to be marked "overridden" and the user file is loaded.
 * EC-12: id collision across all loaded records is checked and rejected.
 * EC-13/EC-14/EC-15: onEnable/onDisable errors are caught per-plugin.
 * EC-18: pendingExtensions queue guards against extensions added before setEditorView.
 * EC-23: already-registered filenames are skipped on repeated loadPlugins calls.
 */

import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { UnifiedPlugin } from "./markable-plugin-api";
import { buildMarkablePluginAPI } from "./markable-plugin-api";
import { listCorePlugins, listUserPlugins, readPluginFile } from "../lib/bridge";
import type { ReadPluginFileResult } from "../lib/bridge";
import { evaluatePlugin } from "./user-plugin-loader";
import { updateSettings } from "../lib/settings";
import type { MarkableSettings } from "../lib/settings";
import { pluginCompartment } from "../editor/extensions";

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Unified descriptor for rendering in the Plugins panel.
 *
 * Superset of PluginDef — carries the new fields needed for Chunk 3+ rendering.
 * Exported so plugins-panel.ts can import this type directly from index.ts.
 */
export interface UnifiedPluginDef {
  id: string;
  name: string;
  description: string;
  detail: string;
  version: string;
  /**
   * The filename on disk (e.g. "focus-mode.js").
   *
   * Required by FR-9: the Overridden badge tooltip must name the specific
   * user file that is shadowing this core slot. Exposed here so the panel
   * can construct a human-readable tooltip without reaching back into
   * PluginManager internals.
   */
  filename: string;
  kind: "core" | "user";
  status: "loaded" | "failed" | "missing" | "overridden";
  failReason?: string;
}

/**
 * Unified record for a registered plugin (core or user).
 *
 * Replaces the old split between the implicit built-in records (on MarkablePlugin[])
 * and UserPluginRecord. All plugins — core and user — share this one type.
 *
 * Status values:
 *   "loaded"     — evaluated, validated, API built.
 *   "failed"     — eval, validation, or id-collision error.
 *   "missing"    — was loaded last session; .js file no longer on disk (future).
 *   "overridden" — core slot whose filename exists in plugins/user/; not evaluated.
 */
interface PluginRecord {
  /** Plugin id. Null for failed-to-load records before validation. */
  id: string | null;
  /** Filename on disk (e.g. "focus-mode.js"). Used for override detection. */
  filename: string;
  /** Whether this record came from plugins/core/ or plugins/user/. */
  kind: "core" | "user";
  /** Load and validation outcome. */
  status: "loaded" | "failed" | "missing" | "overridden";
  /** The validated plugin object. Null for failed/overridden records. */
  plugin: UnifiedPlugin | null;
  /** The per-plugin API instance. Null for failed/overridden records. */
  api: ReturnType<typeof buildMarkablePluginAPI> | null;
  /** Runtime enabled state. Maintained by _enable / _disable helpers. */
  _enabled: boolean;
  /** Human-readable load error. Set only when status === "failed". */
  failReason?: string;
}

// ── PluginManager class ───────────────────────────────────────────────────────

export class PluginManager {
  /**
   * All plugin records, in load order (core first, then user,
   * within each group in lexicographic filename order).
   */
  private _records: PluginRecord[] = [];

  /**
   * Maps plugin id → CM6 extensions registered by that plugin.
   * Used to reconstruct the full compartment contents on every add/remove.
   * All-or-nothing removal per plugin id (Decision 8 from active_task.md).
   */
  private extensionMap = new Map<string, Extension[]>();

  /**
   * Live EditorView reference. Set by setEditorView() after editor creation.
   * Null before the editor exists — addExtensions queues extensions when null.
   * EC-18: prevents lost extensions during async startup sequences.
   */
  private editorView: EditorView | null = null;

  /**
   * Extensions queued by addExtensions() calls that arrive before
   * setEditorView() is called. Flushed immediately inside setEditorView().
   * EC-18: guards against the case where a plugin's onEnable fires before
   * the editor view is wired (e.g. during an async startup race).
   */
  private pendingExtensions: Array<{ pluginId: string; exts: Extension[] }> = [];

  constructor() {
    // No static plugin registrations.
    // All plugins are loaded from disk by loadPlugins().
  }

  // ── Editor wiring ────────────────────────────────────────────────────────

  /**
   * Store the live EditorView reference. Called once from main.ts immediately
   * after createEditor() returns, before loadPlugins() is called.
   *
   * Flushes any extensions queued by addExtensions() calls that arrived before
   * the editor existed (EC-18). Under the normal startup sequence the queue will
   * be empty here, but it is drained unconditionally for correctness.
   *
   * @param view  The live EditorView returned by createEditor().
   */
  setEditorView(view: EditorView): void {
    this.editorView = view;
    // EC-18: drain the pending queue. Each entry was pushed by an addExtensions()
    // call that occurred before the view was available. Map.set() is called in
    // insertion order, so if the same plugin id appears more than once the last
    // entry wins (last-write-wins) — the second call's extensions fully replace
    // the first, which is the same semantics as calling addExtensions() twice
    // after the view is already wired.
    for (const { pluginId, exts } of this.pendingExtensions) {
      this.extensionMap.set(pluginId, exts);
    }
    this.pendingExtensions = [];
    // Only dispatch if the queue actually contained entries; avoids a no-op
    // reconfigure on the common path where no plugins have called addExtensions yet.
    if (this.extensionMap.size > 0) {
      this._reconfigureCompartment();
    }
  }

  /**
   * Register CM6 extensions for the given plugin id and reconfigure the shared
   * pluginCompartment. Called from a plugin's onEnable via the MarkablePluginAPI closure.
   *
   * Replaces any extensions previously registered under this plugin id, making it
   * idempotent on repeated enable calls (e.g. toggle off then back on).
   *
   * EC-18: if the editor does not yet exist, the extensions are queued and applied
   * immediately when setEditorView() is later called.
   *
   * @param pluginId  The calling plugin's id (captured in buildMarkablePluginAPI closure).
   * @param exts      CM6 extensions to register for this plugin.
   */
  addExtensions(pluginId: string, exts: Extension[]): void {
    if (!this.editorView) {
      // EC-18: queue for deferred flush in setEditorView().
      this.pendingExtensions.push({ pluginId, exts });
      return;
    }
    this.extensionMap.set(pluginId, exts);
    this._reconfigureCompartment();
  }

  /**
   * Remove all CM6 extensions registered under the given plugin id and
   * reconfigure the shared pluginCompartment.
   *
   * EC-17: no-op if the plugin id has no registered extensions (e.g. the plugin
   * never called addExtensions, or was already removed).
   *
   * @param pluginId  The calling plugin's id (captured in buildMarkablePluginAPI closure).
   */
  removeExtensions(pluginId: string): void {
    if (!this.extensionMap.has(pluginId)) return; // EC-17: nothing registered for this id
    this.extensionMap.delete(pluginId);
    if (!this.editorView) return; // Guard: should never be null post-init, but safe.
    this._reconfigureCompartment();
  }

  /**
   * Dispatch a Compartment.reconfigure effect on the live EditorView,
   * rebuilding the flat extension array from all currently registered plugins.
   *
   * Internal — not part of the public PluginManager API. Called by
   * addExtensions() and removeExtensions() after they mutate extensionMap.
   */
  private _reconfigureCompartment(): void {
    if (!this.editorView) return;
    // Flatten all per-plugin extension arrays into a single array.
    // Map insertion order is preserved, giving deterministic extension ordering.
    const allExts: Extension[] = [];
    for (const exts of this.extensionMap.values()) {
      allExts.push(...exts);
    }
    this.editorView.dispatch({
      effects: pluginCompartment.reconfigure(allExts),
    });
  }

  // ── Unified loading ────────────────────────────────────────────────────────

  /**
   * Discover, evaluate, and restore all plugins from both `plugins/core/` and
   * `plugins/user/` directories.
   *
   * Algorithm:
   *   1. List filenames from core and user dirs.
   *   2. Build override set: user filenames take priority over same-named core files.
   *   3. Process core files — mark overridden entries, evaluate the rest.
   *   4. Process user files — skip already-registered filenames (EC-23).
   *   5. Restore enabled state from settings.plugins for each loaded plugin.
   *
   * EC-7/EC-8:  Override detection — user file wins when names collide.
   * EC-12:      Id collision check across all loaded records.
   * EC-23:      Already-registered filenames are skipped (idempotency guard).
   * EC-29:      50-plugin cap applied by Rust for user dir; no cap for core.
   *
   * @param settings         Persisted application settings (must be migrated first).
   * @param statusBarZones   DOM references for the three status bar zones.
   */
  async loadPlugins(
    settings: MarkableSettings,
    statusBarZones: { left: HTMLElement; center: HTMLElement; right: HTMLElement },
  ): Promise<void> {
    // ── 1. Discover filenames ──────────────────────────────────────────────
    let coreFilenames: string[];
    let userFilenames: string[];

    try {
      const coreResponse = await listCorePlugins();
      coreFilenames = coreResponse.files;
    } catch (err) {
      console.error("PluginManager.loadPlugins: failed to list core plugins:", err);
      coreFilenames = [];
    }

    try {
      const userResponse = await listUserPlugins();
      userFilenames = userResponse.files;
      // HF-2: emit a visible warning when the 50-plugin cap is exceeded.
      if (userResponse.truncated.length > 0) {
        console.warn(
          "[Plugins] 50-plugin limit reached. Ignored:",
          userResponse.truncated.join(", "),
        );
      }
    } catch (err) {
      console.error("PluginManager.loadPlugins: failed to list user plugins:", err);
      userFilenames = [];
    }

    // ── 2. Build override set (EC-7, EC-8) ────────────────────────────────
    // Any core file whose filename also exists in user/ is marked "overridden".
    // The user version is loaded instead.
    const userFilenameSet = new Set(userFilenames);

    // Track all filenames already registered to support idempotency (EC-23).
    const registeredFilenames = new Set(this._records.map((r) => r.filename));

    // Track all registered ids to detect collisions (EC-12).
    const registeredIds = new Set(
      this._records.filter((r) => r.id !== null).map((r) => r.id as string),
    );

    // ── 3. Process core files ──────────────────────────────────────────────
    for (const filename of coreFilenames) {
      // EC-23: skip already-registered filenames (e.g. on repeated loadPlugins calls).
      if (registeredFilenames.has(filename)) continue;

      // EC-7/EC-8: user file with the same name overrides this core slot.
      // IMPORTANT: do NOT add the filename to registeredFilenames for overridden
      // slots — the user copy of this file must still be loaded when we process
      // the user list. The override record merely documents that this core slot
      // was superseded; the user file is loaded separately.
      if (userFilenameSet.has(filename)) {
        this._records.push({
          id: null,
          filename,
          kind: "core",
          status: "overridden",
          plugin: null,
          api: null,
          _enabled: false,
        });
        // Do not add to registeredFilenames — the user copy must be processed.
        continue;
      }

      // Non-overridden core file: register and load.
      registeredFilenames.add(filename);
      const record = await this._loadPluginFile(
        filename,
        "core",
        registeredIds,
        statusBarZones,
      );
      this._records.push(record);
      if (record.id !== null) registeredIds.add(record.id);
    }

    // ── 4. Process user files ──────────────────────────────────────────────
    for (const filename of userFilenames) {
      // EC-23: skip already-registered filenames (includes filenames added
      // when processing core above, e.g. override scenarios).
      if (registeredFilenames.has(filename)) continue;
      registeredFilenames.add(filename);

      const record = await this._loadPluginFile(
        filename,
        "user",
        registeredIds,
        statusBarZones,
      );
      this._records.push(record);
      if (record.id !== null) registeredIds.add(record.id);
    }

    // ── 5. Restore enabled state ───────────────────────────────────────────
    for (const record of this._records) {
      if (record.status !== "loaded" || !record.plugin || !record.api) continue;
      const saved = settings.plugins?.[record.plugin.id];
      if (saved?.enabled === true) {
        await this._enable(record);
      }
    }
  }

  /**
   * Read, evaluate, and validate a single plugin file.
   *
   * Returns a PluginRecord with status "loaded" on success, or "failed" on any
   * read/eval/validation/collision error.
   *
   * @param filename        The `.js` filename on disk.
   * @param kind            "core" or "user" — controls which directory is read.
   * @param registeredIds   Set of already-registered plugin ids (collision check).
   * @param statusBarZones  DOM references for the status bar zones.
   */
  private async _loadPluginFile(
    filename: string,
    kind: "core" | "user",
    registeredIds: Set<string>,
    statusBarZones: { left: HTMLElement; center: HTMLElement; right: HTMLElement },
  ): Promise<PluginRecord> {
    const failed = (failReason: string): PluginRecord => ({
      id: null,
      filename,
      kind,
      status: "failed",
      plugin: null,
      api: null,
      _enabled: false,
      failReason,
    });

    // Read the file source via Rust (path-confined, size-limited).
    const fileResult: ReadPluginFileResult = await readPluginFile(filename, kind);
    if ("error" in fileResult) {
      const reason = `${filename}: ${fileResult.error}`;
      console.warn(`[PluginManager] Skipped "${filename}": ${fileResult.error}`);
      return failed(reason);
    }

    // Evaluate and validate (EC-2 through EC-5, EC-20, EC-22).
    const evalResult = evaluatePlugin(fileResult.source, filename, kind);
    if (!evalResult.ok) {
      console.warn(`[PluginManager] Skipped "${filename}": ${evalResult.reason}`);
      return failed(evalResult.reason);
    }

    // evalResult.plugin is already typed as UnifiedPlugin after the step_04b
    // cleanup (user-plugin-loader.ts now returns UnifiedPlugin directly).
    const plugin = evalResult.plugin;

    // EC-12: id collision check — reject if this id is already registered.
    if (registeredIds.has(plugin.id)) {
      const reason = `${filename}: id "${plugin.id}" collides with an already-registered plugin`;
      console.warn(`[PluginManager] Rejected "${filename}": id "${plugin.id}" already registered.`);
      return failed(reason);
    }

    // Build the per-plugin API instance.
    const api = buildMarkablePluginAPI(plugin.id, statusBarZones);

    return {
      id: plugin.id,
      filename,
      kind,
      status: "loaded",
      plugin,
      api,
      _enabled: false,
    };
  }

  // ── Reload user plugins ────────────────────────────────────────────────────

  /**
   * Rescan the user plugin directory and load any new plugins found since
   * the last loadPlugins() call. Already-registered filenames are skipped
   * (EC-23). Core plugins are not rescanned.
   *
   * Called from the panel's "Reload" button. Safe to call multiple times;
   * the filename registration guard prevents duplicate loading.
   *
   * @param settings         Current application settings.
   * @param statusBarZones   DOM references for the three status bar zones.
   */
  async reloadUserPlugins(
    settings: MarkableSettings,
    statusBarZones: { left: HTMLElement; center: HTMLElement; right: HTMLElement },
  ): Promise<void> {
    let userFilenames: string[];
    try {
      const userResponse = await listUserPlugins();
      userFilenames = userResponse.files;
      // HF-2: emit a visible warning when the 50-plugin cap is exceeded.
      if (userResponse.truncated.length > 0) {
        console.warn(
          "[Plugins] 50-plugin limit reached during reload. Ignored:",
          userResponse.truncated.join(", "),
        );
      }
    } catch (err) {
      console.error("PluginManager.reloadUserPlugins: failed to list user plugins:", err);
      return;
    }

    // Build the set of filenames already registered (any kind) to guard against
    // re-evaluating a file that was loaded at startup (EC-23).
    const registeredFilenames = new Set(this._records.map((r) => r.filename));
    const registeredIds = new Set(
      this._records.filter((r) => r.id !== null).map((r) => r.id as string),
    );

    for (const filename of userFilenames) {
      // EC-23: skip files we have already registered.
      if (registeredFilenames.has(filename)) continue;
      registeredFilenames.add(filename);

      const record = await this._loadPluginFile(
        filename,
        "user",
        registeredIds,
        statusBarZones,
      );
      this._records.push(record);
      if (record.id !== null) registeredIds.add(record.id);

      // Restore enabled state for newly-loaded plugins based on persisted settings.
      if (record.status === "loaded" && record.plugin && record.api) {
        const saved = settings.plugins?.[record.plugin.id];
        if (saved?.enabled === true) {
          await this._enable(record);
        }
      }
    }
  }

  // ── Toggle ─────────────────────────────────────────────────────────────────

  /**
   * Enable or disable a plugin by id.
   *
   * Calls onEnable or onDisable and persists the new state to settings.plugins.
   * No-op (with console.warn) for unknown, failed, or overridden plugin ids.
   *
   * EC-13/EC-14/EC-15: errors in onEnable/onDisable are caught per-plugin.
   *
   * @param id       Plugin id — must match a loaded plugin's id.
   * @param enabled  Target enabled state.
   */
  async toggle(id: string, enabled: boolean): Promise<void> {
    const record = this._recordById(id);
    if (!record || record.status !== "loaded" || !record.plugin || !record.api) {
      console.warn(`PluginManager.toggle: unknown or non-loaded plugin id "${id}"`);
      return;
    }
    if (enabled) {
      await this._enable(record);
    } else {
      await this._disable(record);
    }
    // Persist the ACTUAL outcome, not the requested `enabled` parameter.
    // If _enable() threw internally (EC-13/EC-14), record._enabled will be
    // false even though `enabled` was true — persisting `enabled` in that case
    // would create a persistent broken-enable loop on every subsequent launch.
    // Using record._enabled guarantees the stored state reflects reality.
    void updateSettings((s) => ({
      ...s,
      plugins: {
        ...(s.plugins ?? {}),
        [id]: { enabled: record._enabled, kind: record.kind },
      },
    }));
  }

  // ── State and definitions ─────────────────────────────────────────────────

  /**
   * Returns a snapshot of all loaded plugins' enabled states.
   *
   * Failed, overridden, and missing records are excluded — they are not
   * toggleable and their enabled state is always false.
   *
   * @returns Record mapping plugin id to its current enabled state.
   */
  getStates(): Record<string, boolean> {
    const states: Record<string, boolean> = {};
    for (const record of this._records) {
      if (record.id !== null && record.status === "loaded") {
        states[record.id] = record._enabled;
      }
    }
    return states;
  }

  /**
   * Returns UnifiedPluginDef[] for all registered records (loaded + failed +
   * missing + overridden), in load order (core first, then user, within each
   * group in lexicographic filename order).
   *
   * Used by createPluginsPanel() as the unified data source for list rendering.
   *
   * @returns Array of unified plugin descriptors for panel rendering.
   */
  getDefinitions(): UnifiedPluginDef[] {
    return this._records.map((r) => ({
      id: r.id ?? `__failed__${r.filename}`,
      name: r.plugin?.name ?? r.filename,
      description: r.plugin?.description ?? "Failed to load",
      detail: r.plugin?.detail ?? r.plugin?.description ?? "Failed to load",
      // r.plugin is typed as UnifiedPlugin | null. UnifiedPlugin carries a
      // `version` string (EC-22). The double-cast to Record<string, unknown>
      // was introduced as a defensive measure but is unnecessary — access the
      // field directly on the already-validated UnifiedPlugin object instead.
      version: r.plugin?.version ?? "",
      // filename is the on-disk basename (e.g. "focus-mode.js"). It is exposed
      // on UnifiedPluginDef so the panel can name the overriding file in the
      // Overridden badge tooltip without importing PluginRecord internals (FR-9).
      filename: r.filename,
      kind: r.kind,
      status: r.status,
      failReason: r.failReason,
    }));
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Find a loaded record by plugin id.
   * Overridden records are excluded — they are not directly accessible.
   */
  private _recordById(id: string): PluginRecord | undefined {
    return this._records.find((r) => r.id === id && r.status !== "overridden");
  }

  /**
   * Call plugin.onEnable(api) with async-aware error isolation.
   *
   * EC-13: synchronous throw caught; _enabled stays false.
   * EC-14: rejected promise caught; _enabled stays false.
   * Sets _enabled = true on success.
   */
  private async _enable(record: PluginRecord): Promise<void> {
    if (!record.plugin || !record.api) return;
    try {
      // Use Promise.resolve() rather than `instanceof Promise` so that thenable
      // objects from non-standard Promise implementations are awaited correctly.
      // `instanceof Promise` would skip the await for thenables, silently
      // ignoring any async error they carry. Promise.resolve() handles all
      // thenable shapes uniformly (Issue 5 — LOW).
      await Promise.resolve(record.plugin.onEnable(record.api));
      record._enabled = true;
    } catch (err) {
      console.error(`[Plugin:${record.plugin.id}] onEnable threw:`, err);
      record._enabled = false;
    }
  }

  /**
   * Call plugin.onDisable(api) with error isolation.
   *
   * EC-15: throw caught; _enabled is forced to false via finally.
   * Uses `finally` to guarantee _enabled = false regardless of outcome.
   */
  private async _disable(record: PluginRecord): Promise<void> {
    if (!record.plugin || !record.api) return;
    try {
      // Use Promise.resolve() for the same thenable-safety reason as _enable().
      // See Issue 5 comment in _enable() above.
      await Promise.resolve(record.plugin.onDisable(record.api));
    } catch (err) {
      console.error(`[Plugin:${record.plugin.id}] onDisable threw:`, err);
    } finally {
      record._enabled = false;
    }
  }
}

/**
 * Module-level singleton. Instantiated before the editor exists.
 * EC-9: ES module resolution guarantees this is non-null when imported.
 */
export const pluginManager = new PluginManager();

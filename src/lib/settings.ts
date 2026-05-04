/**
 * Settings persistence layer.
 *
 * Manages an in-memory settings singleton that syncs with the Rust backend.
 * Settings are loaded once during init (before window.show) and saved
 * immediately for user actions or debounced for high-frequency events.
 */

import { getSettings, saveSettings } from "./bridge";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import type { VaultEntry } from "./vault-types";
import type { FindScope } from "../editor/vault-search-utils";

// --- Types (mirror Rust MarkableSettings) ---

/**
 * Persisted position for the floating FindWidget.
 * Stored as viewport-relative pixel coordinates (top-left corner of the widget).
 * null means "use default position" (upper-right, below the title bar).
 */
export interface FindWidgetPosition {
  x: number;
  y: number;
}

/**
 * One entry in the session restore list.
 *
 * Stored in MarkableSettings.openFiles. Each entry captures everything needed
 * to reopen a file and restore the user's scroll position:
 *
 *   filePath  — absolute path used as the argument to readFile() on restore.
 *   scrollTop — the value of editorView.scrollDOM.scrollTop when the user
 *               last navigated away from (or closed) the tab. Applied via
 *               editorView.scrollDOM.scrollTop = entry.scrollTop after setState().
 *
 * Untitled tabs are NOT included — they have no filePath and cannot be
 * reconstructed from disk (FR-6.3). Only tabs where filePath !== null appear
 * in this array.
 */
export interface SessionTabEntry {
  /** Absolute file path on the host filesystem. */
  filePath: string;
  /**
   * Scroll position in CSS pixels at the time the tab was last left or saved.
   * Zero when the document was opened but never scrolled.
   */
  scrollTop: number;

  /**
   * True when this tab was pinned at the time the session was saved.
   * Restored by TabManager.init() on the next launch.
   */
  pinned?: boolean;
}

/**
 * Per-plugin enable/disable state entry in the unified `plugins` map.
 *
 * `kind` distinguishes core plugins (shipped with the app) from user plugins
 * (loaded from the user's plugins directory). It is stored so the panel can
 * display the correct section without re-reading disk on each open.
 */
export interface PluginEnableRecord {
  enabled: boolean;
  kind: "core" | "user";
}

// ── Sidebar settings ──────────────────────────────────────────────────────────

/**
 * Per-panel accordion state for one registered panel.
 * Keyed by panelId in SidebarSlotState.panels.
 */
export interface SidebarPanelState {
  accordionExpanded: boolean;
  iconized?: boolean;
  pinned?: boolean;
}

/**
 * Persisted state for one sidebar slot (left or right).
 *
 * open           — whether the slot is currently visible.
 * activeTabId    — id of the panel whose content is shown; null if no panels
 *                  were registered when the settings were last written.
 * width          — slot width in pixels (clamped 150–600 at write time).
 * panels         — per-panel accordion state map (key = panelId).
 */
export interface SidebarSlotState {
  open: boolean;
  activeTabId: string | null;
  width: number;
  panels: Record<string, SidebarPanelState>;
}

/**
 * Top-level sidebar settings object stored under MarkableSettings.sidebar.
 * The Rust backend's raw-JSON pass-through makes this field safe without
 * touching Rust structs (same precedent as findWidget, keybindings, plugins).
 *
 * panelSides stores per-panel user overrides for which sidebar side the panel
 * should appear on. Keys are panel ids; values are "left" or "right". When a
 * key is absent the panel uses its descriptor.side default.
 */
export interface SidebarSettings {
  left: SidebarSlotState;
  right: SidebarSlotState;
  /**
   * Per-panel side override map. Populated by movePanel() when the user
   * reassigns a panel from its descriptor-declared default side to the other.
   * Absent key = panel uses descriptor.side. Empty object = no overrides.
   */
  panelSides?: Record<string, "left" | "right">;
}

/**
 * Default state for one sidebar slot. Used when the settings file predates
 * the sidebar field (EC-10 migration case) and as the factory default.
 *
 * Both sidebars default to closed on first run (FR-6, EC-10).
 */
export const DEFAULT_SIDEBAR_SLOT: SidebarSlotState = {
  open: false,
  activeTabId: null,
  width: 220,
  panels: {},
};

export interface MarkableSettings {
  version: number;
  window: WindowSettings;
  editor: EditorSettings;
  theme: ThemeSettings;
  recentFiles: string[];
  /** TC-6: optional field — null means use default position (upper-right). */
  findWidget: FindWidgetPosition | null;
  /** Custom keybinding overrides. Maps command-id → key string (e.g. "Cmd-Shift-O"). Absent = use default. */
  keybindings?: Record<string, string>;
  /** Active list style for ambiguous markers (e.g. "1."). */
  listStyle?: "standard" | "alphanumeric" | "decimal" | "steps";
  /**
   * Unified plugin enable/disable state map. Keys are plugin ids (kebab-case).
   *
   * This is the single authoritative source for plugin state as of Chunk 3.
   * Populated from old flat fields by migratePluginSettings() on first run
   * after upgrade. Existing settings.json files may still contain the old flat
   * fields (focusMode, typewriterMode, wordCount, statusBar, userPlugins) —
   * those are read by migratePluginSettings() and written back into this map,
   * then ignored at the TypeScript layer. The Rust raw-JSON pass-through means
   * removing them from this interface does not corrupt settings files.
   *
   * Absent key = never configured (treated as disabled on first run).
   * Absent map = settings file pre-dates Chunk 3 (migratePluginSettings runs).
   */
  plugins?: Record<string, PluginEnableRecord>;

  /**
   * Sidebar slot state for left and right sidebars.
   *
   * Optional — absent in settings files created before sidebar support was
   * added. SidebarManager.init() applies DEFAULT_SIDEBAR_SLOT for each side
   * that is absent. The Rust raw-JSON pass-through means this field is safe
   * to add without modifying any Rust struct.
   */
  sidebar?: SidebarSettings;

  /**
   * Active tab display mode. Defaults to "minimal" (compact dot/pill strip).
   *
   * Optional — absent in settings files created before multi-document tabs
   * were added. TabManager.init() falls back to "minimal" when this field
   * is absent. The Rust raw-JSON pass-through means this field is safe to
   * add without any Rust struct change.
   */
  tabMode?: "minimal" | "regular" | "vertical";

  /**
   * Session restore data: the list of open file paths and their scroll positions
   * at the time the app was last closed or the session was last saved.
   *
   * Only tabs with a non-null filePath are included (untitled tabs cannot be
   * restored by path). Absent when no session has been saved yet.
   *
   * Typed as SessionTabEntry[] so callers get property auto-complete and
   * type-checking when reading filePath and scrollTop.
   */
  openFiles?: SessionTabEntry[];

  /**
   * Zero-based index of the active tab in the openFiles array at last save.
   * Used to restore the user's focus to the same document on next launch.
   * Clamped to the valid range by TabManager.init() after restore (FR-6.6).
   */
  activeTabIndex?: number;

  /**
   * PKM vault list. Each entry describes a named, bounded collection of file
   * paths that forms the indexing scope for the File Browser and Knowledge
   * Graph features.
   *
   * Optional — absent in settings files created before PKM support was added.
   * vault-manager.ts treats an absent or empty array as "no vaults configured".
   * The Rust raw-JSON pass-through means this field is safe to add without
   * touching any Rust struct.
   */
  vaults?: VaultEntry[];

  /**
   * The id of the currently active vault, or null when no vault is active.
   *
   * Optional — absent in settings files created before PKM support.
   * vault-manager.init() resets this to null when the referenced vault id
   * no longer exists in the `vaults` array (EC-11).
   */
  activeVaultId?: string | null;

  /**
   * Last-used scope for the find widget ("file", "vault", or "folder").
   *
   * Optional — absent in settings files created before multi-file find was
   * added. FindWidget._restoreScope() defaults to "file" when this field is
   * absent via the ?? "file" guard (FR-11). The Rust raw-JSON pass-through
   * means this field is safe to add without modifying any Rust struct.
   */
  findWidgetScope?: FindScope;

  /**
   * Quick Capture overlay configuration.
   * Optional — absent in settings files created before Quick Capture was added.
   * QuickCaptureWidget falls back to DEFAULT_SETTINGS.quickCapture when absent.
   */
  quickCapture?: QuickCaptureSettings;
}

export interface QuickCaptureSettings {
  /** Folder name relative to the active vault root. Default: "Inbox". */
  inboxFolder: string;
  /** Absolute path used when no vault is active. Supports "~/" prefix. */
  fallbackPath: string;
}

/** Window size mode per axis: a preset percentage of screen, or "manual" (user-defined). */
export type WindowSizeMode = "50%" | "65%" | "80%" | "100%" | "manual";

export interface WindowSettings {
  x: number;
  y: number;
  width: number;
  height: number;
  fullscreen: boolean;
  maximized: boolean;
  /** Width mode. "manual" = remember last width. */
  sizeW?: WindowSizeMode;
  /** Height mode. "manual" = remember last height. */
  sizeH?: WindowSizeMode;
  /** Always maximize on launch — overrides sizeW/sizeH. */
  launchMaximized?: boolean;
}

export interface EditorSettings {
  contentMaxWidth: number;
  contentPadding: string;
  baseFontSize: number;
  /** Content width as CSS value, e.g. "900px" or "80%". Overrides contentMaxWidth if set. */
  contentWidth?: string;
  /**
   * Whether the browser's native spell-checker underlines are shown in the
   * editor content element. Defaults to false (off). Set via the "Editor"
   * section in the Settings panel (FR-B.1, FR-B.3).
   *
   * Optional (`?`) so that old settings files that pre-date this field
   * are handled gracefully: applyEditorSettings uses `?? false` to coerce
   * the absent value to false, preventing `spellcheck="undefined"` on the
   * DOM element (EC-B.01, AD-09).
   */
  spellCheck?: boolean;
}

export interface ThemeSettings {
  active: string;
  fallback: string;
}

// --- Defaults ---

export const DEFAULT_SETTINGS: MarkableSettings = {
  version: 1,
  window: {
    x: -1,
    y: -1,
    width: 0,
    height: 0,
    fullscreen: false,
    maximized: false,
    sizeW: "50%",
    sizeH: "80%",
  },
  editor: {
    contentMaxWidth: 900,
    contentPadding: "responsive",
    baseFontSize: 16,
    spellCheck: false, // EC-B.05: default off; reset-all handler relies on this (AD-08)
  },
  theme: {
    active: "default-dark",
    fallback: "default-dark",
  },
  recentFiles: [],
  /** FR-8.1: null means use default position (upper-right, below title bar). */
  findWidget: null,
  keybindings: {},
  quickCapture: {
    inboxFolder: "Inbox",
    fallbackPath: "~/Documents/Markable Inbox",
  },
  sidebar: {
    left: { ...DEFAULT_SIDEBAR_SLOT },
    right: { ...DEFAULT_SIDEBAR_SLOT },
    panelSides: {},
  },
};

// --- Window state helpers ---

export function isWindowOffScreen(
  x: number,
  y: number,
  width: number,
  height: number,
  screenWidth: number,
  screenHeight: number
): boolean {
  const MIN_VISIBLE_PX = 50;
  const visibleRight = Math.min(x + width, screenWidth) - Math.max(x, 0);
  const visibleBottom = Math.min(y + height, screenHeight) - Math.max(y, 0);
  if (visibleRight < MIN_VISIBLE_PX || visibleBottom < MIN_VISIBLE_PX) {
    return true;
  }
  return false;
}

export async function applyWindowSettings(settings: WindowSettings): Promise<void> {
  const appWindow = getCurrentWebviewWindow();

  // Launch maximized overrides everything
  if (settings.launchMaximized) {
    try { await appWindow.maximize(); } catch {}
    return;
  }

  const modeW = settings.sizeW ?? "50%";
  const modeH = settings.sizeH ?? "80%";
  const scaleFactor = window.devicePixelRatio || 1;
  const screenW = window.screen.width * scaleFactor;
  const screenH = window.screen.height * scaleFactor;

  // Resolve width
  let w: number;
  if (modeW === "manual" && settings.width > 0) {
    w = settings.width;
  } else {
    const pct = modeW === "manual" ? 50 : parseInt(modeW, 10);
    w = Math.round(screenW * pct / 100);
  }

  // Resolve height
  let h: number;
  if (modeH === "manual" && settings.height > 0) {
    h = settings.height;
  } else {
    const pct = modeH === "manual" ? 50 : parseInt(modeH, 10);
    h = Math.round(screenH * pct / 100);
  }

  // Resolve position: if both axes are manual and we have a saved position, use it.
  // Otherwise center on screen.
  let x: number, y: number;
  if (modeW === "manual" && modeH === "manual" && settings.width > 0 && settings.height > 0) {
    x = settings.x;
    y = settings.y;
    // Validate not off-screen
    if (isWindowOffScreen(x, y, w, h, window.screen.width, window.screen.height)) {
      x = Math.round((screenW - w) / 2);
      y = Math.round((screenH - h) / 2);
    }
  } else {
    x = Math.round((screenW - w) / 2);
    y = Math.round((screenH - h) / 2);
  }

  try {
    await appWindow.setSize(new PhysicalSize(w, h));
    await appWindow.setPosition(new PhysicalPosition(x, y));
  } catch (err) {
    console.error("Failed to apply window size:", err);
    await appWindow.center();
  }

  if (settings.fullscreen) {
    try { await appWindow.setFullscreen(true); } catch {}
  }
  if (settings.maximized && !settings.fullscreen) {
    try { await appWindow.maximize(); } catch {}
  }
}

// --- In-memory singleton ---

let currentSettings: MarkableSettings = structuredClone(DEFAULT_SETTINGS);
let settingsWritable = true;

export function getCurrentSettings(): MarkableSettings {
  return currentSettings;
}

/**
 * Load settings from Rust backend. Call once during init, before window.show().
 * On failure, returns defaults and marks settings as read-only for the session.
 */
export async function loadSettings(): Promise<MarkableSettings> {
  const result = await getSettings();

  if (result.ok) {
    // Merge loaded data over defaults so that any new optional fields added to
    // DEFAULT_SETTINGS (e.g. findWidget) are present even in old settings files
    // that pre-date the field. Object spread at the top level is sufficient for
    // flat optional fields; nested objects (window, editor, theme) are replaced
    // wholesale by the persisted value, which is correct since they are always
    // fully written on save.
    currentSettings = { ...structuredClone(DEFAULT_SETTINGS), ...result.value };
  } else {
    console.error("Failed to load settings:", result.error.message);
    console.warn("Using default settings.");
    currentSettings = structuredClone(DEFAULT_SETTINGS);
    settingsWritable = false;
  }

  return currentSettings;
}

/**
 * Update settings in memory and persist to disk immediately.
 * Use for user actions (settings panel changes, theme switch, etc).
 */
export async function updateSettings(
  updater: (current: MarkableSettings) => MarkableSettings
): Promise<void> {
  currentSettings = updater(currentSettings);

  if (!settingsWritable) {
    console.warn("Settings not writable. Changes are in-memory only.");
    return;
  }

  const result = await saveSettings(currentSettings);
  if (!result.ok) {
    console.error("Failed to save settings:", result.error.message);
  }
}

/**
 * Update settings in memory WITHOUT persisting.
 * Use when batching changes before a manual save.
 */
export function updateSettingsInMemory(
  updater: (current: MarkableSettings) => MarkableSettings
): void {
  currentSettings = updater(currentSettings);
}

// --- Editor settings ---

export const EDITOR_CONSTRAINTS = {
  contentMaxWidth: { min: 500, max: 1400, step: 50 },
  baseFontSize: { min: 8, max: 48, step: 2 },
} as const;

/**
 * Apply editor settings to the live editor and CSS variables.
 *
 * Two responsibilities:
 *  1. CSS variables — sets `--settings-content-max-width` and
 *     `--settings-base-font-size` on the document root (unchanged behaviour).
 *  2. Spell-check compartment — dispatches a `spellCheckCompartment.reconfigure`
 *     effect to the live `__MARKABLE_EDITOR_VIEW__` (FR-B.2, AD-07).
 *
 * The EditorView global may be absent when this function is called during
 * startup (before createEditor() completes). In that case the compartment
 * reconfiguration is silently skipped; the compartment's initial value
 * ("false") holds until applyEditorSettings is called again post-mount
 * with the loaded settings (EC-B.04).
 *
 * The `?? false` guard on `editor.spellCheck` handles old settings files
 * that pre-date this field, preventing `spellcheck="undefined"` from being
 * set as a DOM attribute (EC-B.01, AD-09).
 *
 * @param editor - The current editor settings object.
 */
export function applyEditorSettings(editor: EditorSettings): void {
  const root = document.documentElement;
  const cw = editor.contentWidth ?? `${editor.contentMaxWidth}px`;
  root.style.setProperty("--settings-content-max-width", cw);
  root.style.setProperty("--settings-base-font-size", `${editor.baseFontSize}px`);

  /*
   * Reconfigure the spell-check compartment on the live EditorView.
   * Uses the established window-global pattern (AD-07) so that the
   * function signature does not change and all call sites in main.ts
   * and settings-panel.ts remain unchanged.
   *
   * `?? false` ensures that an undefined spellCheck field from an old
   * settings file is treated as false, not as the string "undefined"
   * on the DOM attribute (EC-B.01, AD-09).
   */
  const spellCheckEnabled = editor.spellCheck ?? false;
  const view = (window as any).__MARKABLE_EDITOR_VIEW__;
  const compartment = (window as any).__MARKABLE_SPELL_CHECK_COMPARTMENT__;
  const cmView = (window as any).__CM_VIEW__;
  if (view && compartment && cmView) {
    /*
     * EditorView.contentAttributes is a Facet — its value is provided via
     * `.of()` not via a direct call. This mirrors the initial value set in
     * buildExtensions() and the CM6 Facet API contract.
     *
     * CM6 is accessed via window globals (same pattern as plugin IIFE bundles)
     * to avoid pulling @codemirror/* imports into settings.ts, which is a
     * shared module imported by the file-browser bundle chain.
     */
    view.dispatch({
      effects: compartment.reconfigure(
        cmView.EditorView.contentAttributes.of({
          spellcheck: spellCheckEnabled ? "true" : "false",
        })
      ),
    });
  }
  // EC-B.04: if view/compartment/cmView are absent (called before editor mounts),
  // dispatch is skipped; the compartment's initial value ("false") holds.
}

// --- Recent files ---

const MAX_RECENT_FILES = 10;

export async function addRecentFile(path: string): Promise<void> {
  await updateSettings((s) => {
    const files = s.recentFiles.filter((f) => f !== path);
    files.unshift(path);
    if (files.length > MAX_RECENT_FILES) {
      files.length = MAX_RECENT_FILES;
    }
    return { ...s, recentFiles: files };
  });
}

export async function removeRecentFile(path: string): Promise<void> {
  await updateSettings((s) => ({
    ...s,
    recentFiles: s.recentFiles.filter((f) => f !== path),
  }));
}

export async function clearRecentFiles(): Promise<void> {
  await updateSettings((s) => ({
    ...s,
    recentFiles: [],
  }));
}

export function getMostRecentFile(): string | null {
  return currentSettings.recentFiles.length > 0 ? currentSettings.recentFiles[0] : null;
}

// --- Debounced save (for window move/resize) ---

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 1000;

export function saveSettingsDebounced(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(async () => {
    debounceTimer = null;
    if (!settingsWritable) return;

    const result = await saveSettings(currentSettings);
    if (!result.ok) {
      console.error("Debounced settings save failed:", result.error.message);
    }
  }, DEBOUNCE_MS);
}

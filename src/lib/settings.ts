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
  /** Status bar visibility. */
  statusBar?: { visible: boolean };
  /** Word count plugin enabled. */
  wordCount?: boolean;
  /** Focus mode (dim non-active paragraphs). */
  focusMode?: boolean;
  /** Typewriter mode (cursor always vertically centered). */
  typewriterMode?: boolean;
}

export interface WindowSettings {
  x: number;
  y: number;
  width: number;
  height: number;
  fullscreen: boolean;
  maximized: boolean;
}

export interface EditorSettings {
  contentMaxWidth: number;
  contentPadding: string;
  baseFontSize: number;
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
  },
  editor: {
    contentMaxWidth: 900,
    contentPadding: "responsive",
    baseFontSize: 16,
  },
  theme: {
    active: "default-dark",
    fallback: "default-dark",
  },
  recentFiles: [],
  /** FR-8.1: null means use default position (upper-right, below title bar). */
  findWidget: null,
  keybindings: {},
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

  if (settings.width <= 0 || settings.height <= 0) {
    await appWindow.center();
    return;
  }

  const screenWidth = window.screen.width;
  const screenHeight = window.screen.height;

  if (isWindowOffScreen(settings.x, settings.y, settings.width, settings.height, screenWidth, screenHeight)) {
    console.warn("Saved window position is off-screen. Centering on primary display.");
    await appWindow.center();
    return;
  }

  try {
    await appWindow.setSize(new PhysicalSize(settings.width, settings.height));
    await appWindow.setPosition(new PhysicalPosition(settings.x, settings.y));
  } catch (err) {
    console.error("Failed to restore window position/size:", err);
    await appWindow.center();
  }

  if (settings.fullscreen) {
    try {
      await appWindow.setFullscreen(true);
    } catch (err) {
      console.error("Failed to restore fullscreen:", err);
    }
  }

  if (settings.maximized && !settings.fullscreen) {
    try {
      await appWindow.maximize();
    } catch (err) {
      console.error("Failed to restore maximized state:", err);
    }
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

export function applyEditorSettings(editor: EditorSettings): void {
  const root = document.documentElement;
  root.style.setProperty("--settings-content-max-width", `${editor.contentMaxWidth}px`);
  root.style.setProperty("--settings-base-font-size", `${editor.baseFontSize}px`);
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

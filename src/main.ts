/**
 * Markable 2.0 -- Main Entry Point
 *
 * Initializes the application:
 * 1. Waits for DOM to be ready
 * 2. Creates the CodeMirror editor
 * 3. Sets up event listeners for file operations
 * 4. Updates the custom title bar with document name
 * 5. Shows the window after frontend renders (no-flash pattern)
 */

// Bug #5 fix: expose CM6 packages as window globals BEFORE any plugin IIFE runs.
// Plugin bundles mark @codemirror/* as external and reference these globals,
// ensuring all StateField/ViewPlugin instances share the same slot-ID namespace
// as the main editor. Must be the first import so globals exist at eval time.
import "./lib/cm-globals";

import { EditorView } from "@codemirror/view";
import { StateEffect } from "@codemirror/state";
import { createEditor } from "./editor/editor";
import { previewCompartment, previewExtensions, spellCheckCompartment } from "./editor/extensions";
import { setViewMode } from "./editor/live-preview";
import { createFindWidget } from "./editor/find-widget";
import type { FindWidget } from "./editor/find-widget";
import { QuickCaptureWidget } from "./editor/quick-capture";
import "./editor/quick-capture.css";
import {
  toggleHeading,
  toggleInlineWrap,
  toggleLinePrefix,
  toggleOrderedList,
  toggleTaskList,
  insertCodeFence,
  insertHorizontalRule,
  indentLines,
  outdentLines,
  clearFormatting,
  copyAsPlainText,
  copyAsHtml,
  pasteWithoutFormatting,
  insertImage,
  insertTable,
  insertInlineMath,
  insertMathBlock,
  insertFrontMatter,
  duplicateLine,
  deleteLine,
} from "./editor/format";
import { switchListStyle, listStyleIndicator, createListStyleIndicator } from "./editor/list-style-switch";
import { ensureStatusBar, getStatusBarVisible, setStatusBarVisible } from "./plugins/status-bar/status-bar";
import {
  readFile,
  readResourceFile,
  openFileDialog,
  openFolderDialog,
  updateRecentFilesMenu,
  listThemes,
  readThemeCss,
  updateThemeMenu,
  copyCorePlugins,
  copyDefaultThemes,
  writeBinaryFile,
  saveImageDialog,
  ensureDirectory,
  writeFile,
  deleteDirectory,
} from "./lib/bridge";
import type { ThemeEntry } from "./lib/bridge";
import { handleImagePaste } from "./lib/clipboard-image-handler";
import { extractImageItem } from "./lib/clipboard-image";
import {
  loadSettings,
  applyWindowSettings,
  applyEditorSettings,
  updateSettingsInMemory,
  updateSettings,
  getCurrentSettings,
  saveSettingsDebounced,
  removeRecentFile,
  EDITOR_CONSTRAINTS,
} from "./lib/settings";
import { createSettingsPanel, toggleSettingsPanel, initAppearanceCallbacks } from "./settings/settings-panel";
import { createKeybindingsPanel, toggleKeybindingsPanel, resolveAction, COMMANDS } from "./keybindings/keybindings-panel";
import {
  createPluginsPanel,
  togglePluginsPanel,
  updateUserPluginDefs,
} from "./plugins/plugins-panel/plugins-panel";
import { pluginManager } from "./plugins/index";
import { migratePluginSettings } from "./plugins/settings-migration";
import {
  initSidebar,
  restoreSidebarFromSettings,
  toggleSidebarSide,
} from "./sidebar";
// tabManager is imported here so TabManager.init() can be called after the
// editor and sidebar are both ready. The singleton is used directly; it is
// not re-exported from main.ts.
import { tabManager } from "./tabs";
import { createDragDropHandler } from "./tabs/drag-drop";
import { openExportDialog, printDocument } from "./lib/export";
// marked is already a project dependency (used by live-preview.ts).
// The bundler deduplicates the import — no second copy is produced (D-02).
import { marked } from "marked";
import * as vaultManager from "./lib/vault-manager";
import {
  buildMetaStore,
  emptyMetaStore,
  isMetaFolderEvent,
} from "./lib/meta-manager";
import type { MetaStore } from "./lib/meta-manager";
import { getAppDataDir } from "./lib/bridge";
import { buildQuickCommandExtension } from "./editor/quick-commands";
import {
  buildAutoRenderExtension,
  buildLayoutInlineExtension,
  checkAndApplyLayoutOnSave,
  showLayoutForFile,
  openLayoutPicker,
  ensureStarterLayouts,
  injectLayoutsCSS,
  injectSidebarCSS,
  injectGridCSS,
} from "./lib/layout-manager";
import type { LayoutDeps } from "./lib/layout-manager";
import { openAssignModal } from "./lib/assign-modal";
import {
  findSelectFenceRange,
  findCustomFenceAtCursor,
  findFirstCustomFence,
  parseSelectBodyForBuilder,
} from "./editor/select-widget";
import { openViewModal } from "./lib/codeblock-modal";
import { buildSelectFenceFromState } from "./lib/select-builder";
import type { RuleRowContext } from "./lib/rule-row";
import { readContentWidthFromFrontmatter, applyPageContentWidth } from "./lib/page-width";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import "./styles.css";

// Global editor instance. currentFilePath, isDirty, isReadOnly, setDirty(),
// setCurrentFile(), and updateTitleBar() were all removed in step_07 — their
// responsibilities now belong to TabManager (_updateTitleBar, markActiveTabDirty,
// getActiveFilePath, openFileInTab, saveActiveTab, saveActiveTabAs).
let editor: ReturnType<typeof createEditor> = null;
let previewEnabled = true;
/** Floating find/replace widget. Initialized in initApp() after editor is ready. */
let findWidget: FindWidget | null = null;
/** Quick Capture overlay. Initialized in initApp(). */
let quickCapture: QuickCaptureWidget | null = null;
/** Layout system deps. Set in initApp() after tabManager.init(). */
let _layoutDeps: LayoutDeps | null = null;

async function refreshRecentFilesMenu(): Promise<void> {
  await updateRecentFilesMenu(getCurrentSettings().recentFiles);
}

// --- Theme system with persistence, custom CSS themes, and fallback chain ---

const BUNDLED_DEFAULT = "default-dark";
const CUSTOM_STYLE_ID = "markable-custom-theme";

// Bundled themes map to data-theme attribute values
const BUNDLED_THEMES: Record<string, string> = {
  "light": "light",
  "default-light": "light",
  "dark": "dark",
  "default-dark": "dark",
};

// Discovered custom themes (populated at startup)
let customThemes: ThemeEntry[] = [];

// Theme cycle order: bundled + custom + system
let themeOrder: string[] = ["default-light", "default-dark", "system"];

function buildThemeOrder(): void {
  themeOrder = [
    "default-light",
    "default-dark",
    ...customThemes.map((t) => `custom:${t.filename}`),
    "system",
  ];
}

export function getCustomThemes(): ThemeEntry[] {
  return customThemes;
}

export function getThemeOrder(): string[] {
  return themeOrder;
}

function removeCustomStylesheet(): void {
  document.getElementById(CUSTOM_STYLE_ID)?.remove();
}

function injectCustomStylesheet(css: string): void {
  removeCustomStylesheet();
  const style = document.createElement("style");
  style.id = CUSTOM_STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

function applyBundledTheme(themeName: string): boolean {
  if (themeName === "system") {
    removeCustomStylesheet();
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
    return true;
  }

  const dataTheme = BUNDLED_THEMES[themeName];
  if (dataTheme === undefined) return false;

  removeCustomStylesheet();
  document.documentElement.setAttribute("data-theme", dataTheme);
  return true;
}

async function applyCustomTheme(filename: string): Promise<boolean> {
  const css = await readThemeCss(filename);
  if (css === null) return false;

  // Look up the theme's declared visual base ("light" or "dark") from the
  // ThemeEntry the loader parsed at startup. Themes carry this via a
  // `/* @theme-base: ... */` header comment so we set data-theme correctly
  // and the canonical token catalog in styles.css falls back to the right
  // palette for tokens the theme doesn't override.
  const entry = customThemes.find((t) => t.filename === filename);
  const base = entry?.base ?? "light";
  document.documentElement.setAttribute("data-theme", base);
  injectCustomStylesheet(css);
  return true;
}

/**
 * Convert a `setTheme` argument to the slug used by the native Theme menu's
 * checkmark logic (see `update_theme_menu` in src-tauri/src/lib.rs):
 *   - `custom:foo.css`  → `foo.css`  (matches the custom-theme menu entry)
 *   - `default-light` / `default-dark` / `system` → unchanged
 */
function themeMenuSlug(themeName: string): string {
  return themeName.startsWith("custom:") ? themeName.slice("custom:".length) : themeName;
}

async function setTheme(themeName: string, persist = true): Promise<void> {
  let success: boolean;

  if (themeName.startsWith("custom:")) {
    const filename = themeName.slice("custom:".length);
    success = await applyCustomTheme(filename);
  } else {
    success = applyBundledTheme(themeName);
  }

  if (success) {
    if (persist) {
      await updateSettings((s) => ({
        ...s,
        theme: { active: themeName, fallback: themeName },
      }));
    }
    console.log(`Theme applied: ${themeName}`);
    void updateThemeMenu(customThemes, themeMenuSlug(themeName));
    return;
  }

  // Fallback chain
  const settings = getCurrentSettings();
  const fallbackName = settings.theme.fallback;

  if (fallbackName && fallbackName !== themeName) {
    const fallbackSuccess = applyBundledTheme(fallbackName);
    if (fallbackSuccess) {
      if (persist) {
        await updateSettings((s) => ({
          ...s,
          theme: { ...s.theme, active: fallbackName },
        }));
      }
      console.log(`Fallback theme applied: ${fallbackName}`);
      void updateThemeMenu(customThemes, themeMenuSlug(fallbackName));
      return;
    }
  }

  // Both failed — use bundled default
  console.warn("Using bundled default theme.");
  applyBundledTheme(BUNDLED_DEFAULT);
  if (persist) {
    await updateSettings((s) => ({
      ...s,
      theme: { active: BUNDLED_DEFAULT, fallback: BUNDLED_DEFAULT },
    }));
  }
  void updateThemeMenu(customThemes, themeMenuSlug(BUNDLED_DEFAULT));
}

function nextTheme() {
  const current = getCurrentSettings().theme.active;
  const idx = themeOrder.indexOf(current);
  const next = themeOrder[(idx + 1) % themeOrder.length];
  setTheme(next);
}

function prevTheme() {
  const current = getCurrentSettings().theme.active;
  const idx = themeOrder.indexOf(current);
  const prev = themeOrder[(idx - 1 + themeOrder.length) % themeOrder.length];
  setTheme(prev);
}

async function zoomIn() {
  const s = getCurrentSettings();
  const next = Math.min(s.editor.baseFontSize + EDITOR_CONSTRAINTS.baseFontSize.step, EDITOR_CONSTRAINTS.baseFontSize.max);
  await updateSettings((c) => ({ ...c, editor: { ...c.editor, baseFontSize: next } }));
  applyEditorSettings(getCurrentSettings().editor);
}

async function zoomOut() {
  const s = getCurrentSettings();
  const next = Math.max(s.editor.baseFontSize - EDITOR_CONSTRAINTS.baseFontSize.step, EDITOR_CONSTRAINTS.baseFontSize.min);
  await updateSettings((c) => ({ ...c, editor: { ...c.editor, baseFontSize: next } }));
  applyEditorSettings(getCurrentSettings().editor);
}

async function zoomReset() {
  await updateSettings((c) => ({ ...c, editor: { ...c.editor, baseFontSize: 16 } }));
  applyEditorSettings(getCurrentSettings().editor);
}

function togglePreview() {
  if (!editor) return;
  previewEnabled = !previewEnabled;
  (window as unknown as Record<string, unknown>)["__MARKABLE_PREVIEW_ENABLED__"] = previewEnabled;
  editor.dispatch({
    effects: previewCompartment.reconfigure(
      previewEnabled ? previewExtensions : []
    ),
  });
  document.getElementById("editor")?.classList.toggle("preview-mode", previewEnabled);
  console.log(`Preview mode: ${previewEnabled ? "ON" : "OFF"}`);
}

/**
 * Open a bundled help resource file as a read-only tab.
 *
 * Help files are synthetic content tabs (no filePath, not persisted in
 * session) that display the resource file content with editing disabled.
 * This replaces the legacy openHelpFile() which mutated the single shared
 * document; the tab-aware version opens the content in a dedicated tab
 * so the user's current document is not displaced (step_07 spec).
 *
 * @param filename  Bare resource filename, e.g. "quickstart.md"
 * @param title     Display title for the tab label, e.g. "Quickstart"
 */
async function openHelpFileInTab(filename: string, title: string): Promise<void> {
  try {
    const content = await readResourceFile(filename);
    // openContentTab() creates the tab, calls setState(), and applies the
    // read-only compartment reconfigure in sequence.
    tabManager.openContentTab(title, content, { readOnly: true });
  } catch (e) {
    console.error("openHelpFileInTab error:", e);
    alert(`Could not open help file: ${filename}\n\n${String(e)}`);
  }
}

/**
 * Show a native open-file dialog and open the selected file in a new tab.
 *
 * Delegates the actual file read, duplicate detection, live-preview wiring,
 * recent-files registration, and state swap to tabManager.openFileInTab().
 * This function is responsible only for showing the dialog and refreshing
 * the Open Recent menu after the tab is created.
 */
async function openFile(): Promise<void> {
  const result = await openFileDialog();
  if (result.cancelled) return;
  await openAndMaybeLayout(result.path);
  await refreshRecentFilesMenu();
}

/**
 * Collect tag and extension suggestions from the current vault index so the
 * select-builder modal can populate its datalists. Returns empty arrays when
 * the vault index is not yet available.
 */
function getRuleRowContext(): RuleRowContext {
  const vm = (window as unknown as {
    __MARKABLE_VAULT_MANAGER__?: { getVaultIndex?: () => unknown };
  }).__MARKABLE_VAULT_MANAGER__;
  const vaultIndex = vm?.getVaultIndex?.() as
    | { entries?: Array<{ path: string; tags?: string[] }>; nonMdFiles?: Array<{ path?: string } | string> }
    | null
    | undefined;
  if (!vaultIndex) return { knownTags: [], distinctExtensions: [] };
  const tagSet = new Set<string>();
  const extSet = new Set<string>();
  const addExt = (p: string): void => {
    const dot = p.lastIndexOf(".");
    if (dot < 0) return;
    const ext = p.slice(dot).toLowerCase();
    if (ext.length > 1 && ext.length < 10) extSet.add(ext);
  };
  for (const entry of vaultIndex.entries ?? []) {
    for (const tag of entry.tags ?? []) tagSet.add(tag);
    addExt(entry.path);
  }
  for (const nf of vaultIndex.nonMdFiles ?? []) {
    const p = typeof nf === "string" ? nf : nf.path;
    if (p) addExt(p);
  }
  return {
    knownTags: [...tagSet].sort(),
    distinctExtensions: [...extSet].sort(),
  };
}

/**
 * Open a file in a new tab and auto-apply its `layout:` YAML field if present.
 *
 * Replaces direct tabManager.openFileInTab() calls so the layout field is
 * honoured whenever a file is opened — not just when the user presses Cmd-E.
 * When the file declares a `view-*` layout, enters folder view mode automatically.
 */
async function openAndMaybeLayout(path: string): Promise<boolean> {
  const opened = await tabManager.openFileInTab(path);
  if (opened && path.endsWith(".md") && editor) {
    const content = editor.state.doc.toString();
    // Page-level content-width: apply this file's frontmatter override (or
    // clear it if absent). The updateListener keeps it in sync on edits;
    // this initial apply covers the tab-open + tab-switch cases.
    applyPageContentWidth(readContentWidthFromFrontmatter(content));
  }
  return opened;
}

/**
 * Open a file by absolute path without showing a dialog.
 *
 * Used by:
 *   - The "open-file-path" menu event (Rust opens the dialog itself in the
 *     hidden-window case and sends the selected path via IPC).
 *   - The drag-and-drop handler (paths are provided by Tauri's onDragDropEvent).
 *
 * @param path  Absolute path to the file to open.
 */
async function openFileByPath(path: string): Promise<void> {
  await openAndMaybeLayout(path);
  await refreshRecentFilesMenu();
}

/**
 * Open a file from the "Open Recent" submenu in a new tab.
 *
 * If tabManager.openFileInTab() returns false, the outcome is one of two cases:
 *   (a) The file is already open — the existing tab was activated (no action needed).
 *   (b) The file could not be read (alert already shown by tabManager) — in this
 *       case the path must be removed from the recent list so it does not appear
 *       again next launch.
 *
 * To distinguish (a) from (b): check whether any open tab has the path. If it
 * does, the file is open (case a). If not, the read failed (case b) — remove it.
 *
 * @param path  Absolute path that appeared in the recent-files list.
 */
async function openRecentFileByPath(path: string): Promise<void> {
  const opened = await openAndMaybeLayout(path);

  if (!opened) {
    // false means either duplicate-activated or read-failed. Distinguish by
    // checking whether the path appears in any open tab.
    const isOpen = tabManager.getTabs().some((t) => t.filePath === path);
    if (!isOpen) {
      // Read failed — the path is stale (file moved / deleted). Remove it so
      // it does not reappear the next time the user opens the Recent menu.
      await removeRecentFile(path);
    }
  }

  // Always refresh the native submenu so any removal takes effect immediately.
  await refreshRecentFilesMenu();
}

/**
 * Save the active tab's content to its current file path.
 * Delegates entirely to TabManager, which handles the untitled → save-as
 * redirect and clears the dirty flag on success.
 */
async function saveFile(): Promise<void> {
  await tabManager.saveActiveTab();
  await refreshRecentFilesMenu();
  if (_layoutDeps && editor) {
    const path = tabManager.getActiveFilePath();
    const doc = editor.state.doc.toString();
    void checkAndApplyLayoutOnSave(path, doc, _layoutDeps);
  }
}

/**
 * Prompt the user for a new save location and write the active tab's content.
 * Delegates entirely to TabManager, which updates the tab's filePath and title.
 */
async function saveFileAs(): Promise<void> {
  await tabManager.saveActiveTabAs();
  await refreshRecentFilesMenu();
}

/**
 * Show the window after the frontend has fully rendered.
 *
 * This implements the "no-flash" pattern:
 * 1. Window starts with visible: false in tauri.conf.json
 * 2. Frontend loads, CSS applies, editor mounts
 * 3. This function calls window.show() to make it visible
 * 4. User sees a fully styled window from the first frame
 */
async function showWindow() {
  try {
    const appWindow = getCurrentWebviewWindow();
    await appWindow.show();
    console.log("Window shown (no-flash pattern complete)");
  } catch (err) {
    console.error("Failed to show window:", err);
    // If show fails, the window remains hidden.
    // This should never happen in production, but log for debugging.
  }
}

async function setupWindowStateListeners(): Promise<void> {
  const appWindow = getCurrentWebviewWindow();

  await appWindow.onMoved(async (event) => {
    const pos = event.payload;
    updateSettingsInMemory((s) => ({
      ...s,
      window: { ...s.window, x: pos.x, y: pos.y },
    }));
    saveSettingsDebounced();
  });

  await appWindow.onResized(async (event) => {
    const sz = event.payload;
    const isMaximized = await appWindow.isMaximized();
    const isFullscreen = await appWindow.isFullscreen();

    updateSettingsInMemory((s) => ({
      ...s,
      window: {
        ...s.window,
        width: sz.width,
        height: sz.height,
        maximized: isMaximized,
        fullscreen: isFullscreen,
      },
    }));
    saveSettingsDebounced();
  });
}

// printDocument was moved to src/lib/export.ts (step_04).
// It now accepts `editor` as a parameter (D-01 in export/00_index.md) and wraps
// window.print() in a try/finally block for unconditional cleanup (EC-15).

/** Currently open Go to Line overlay (null if none). */
let gotoLineOverlay: HTMLElement | null = null;

/** Show a small overlay asking for a line number, then scroll to it. */
function showGoToLineOverlay(): void {
  if (!editor) return;
  if (gotoLineOverlay) { gotoLineOverlay.remove(); gotoLineOverlay = null; }

  const overlay = document.createElement("div");
  overlay.className = "goto-line-overlay";

  const label = document.createElement("span");
  label.textContent = "Go to Line:";

  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.max = String(editor.state.doc.lines);
  input.placeholder = `1–${editor.state.doc.lines}`;

  const btn = document.createElement("button");
  btn.textContent = "Go";

  overlay.append(label, input, btn);
  document.body.appendChild(overlay);
  gotoLineOverlay = overlay;
  input.focus();

  function go() {
    const num = parseInt(input.value, 10);
    if (!editor || isNaN(num)) { dismiss(); return; }
    const clamped = Math.max(1, Math.min(num, editor.state.doc.lines));
    const line = editor.state.doc.line(clamped);
    editor.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
    dismiss();
    editor.focus();
  }

  function dismiss() {
    overlay.remove();
    gotoLineOverlay = null;
  }

  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); go(); }
    if (e.key === "Escape") { e.preventDefault(); dismiss(); editor?.focus(); }
  });
  btn.addEventListener("click", go);
}


// ── Collections command-bar helpers (step 15 + refactor R01) ─────────────────
//
// The MVP-era `getFocusedFolderPath()` helper was deleted in refactor
// step_R01 (2026-06-06) along with the `collection:make-collection`
// dispatcher case — it was the only consumer. The two surviving helpers
// below are still wired into `case "collection:new-stack"` and
// `case "collection:add-reference"` respectively.

/**
 * Resolve the absolute path of the active tab's folder iff that folder is
 * a Collection. Returns null when the active tab isn't a folder-view tab,
 * or when its folder doesn't carry `layout: collection-home`.
 *
 * Implemented via a fire-once async probe through the active tab manager;
 * the synchronous return makes this a best-effort hint — when in doubt,
 * the command surfaces a toast.
 */
function getActiveCollectionPath(): string | null {
  const path = tabManager.getActiveFilePath();
  if (!path) return null;
  // Active tab path could be either a file or a folder. The collection
  // detection probe walks up to the folder containing `_folder.md`.
  if (path.endsWith("/_folder.md")) {
    return path.slice(0, -"/_folder.md".length);
  }
  return null;
}

/**
 * Resolve the absolute path of the focused note iff that note lives inside
 * a Collection. Returns null otherwise. The cross-feature scaffolding for
 * proper "focused note" tracking arrives with the renderer's context-menu
 * dispatch (step 14); this helper falls back to the active tab's file path.
 */
function getFocusedNotePath(): string | null {
  const path = tabManager.getActiveFilePath();
  if (!path || !path.endsWith(".md")) return null;
  return path;
}

/** Surface a Collections-related notification via the project's toast system. */
function notifyCollectionsToast(message: string): void {
  // Reuse the project's existing toast machinery (console fallback is fine
  // for unit tests; production fires through `__MARKABLE_TOAST__`).
  const t = (window as unknown as {
    __MARKABLE_TOAST__?: (msg: string) => void;
  }).__MARKABLE_TOAST__;
  if (t) t(message);
  else console.warn("[collections]", message);
}

/**
 * Central action dispatcher — shared by the native menu-event listener and
 * the custom keybinding document keydown handler.
 */
function handleAction(action: string): void {
  switch (action) {
    case "quick-capture":
      quickCapture?.open();
      break;

    case "app-settings":    toggleSettingsPanel();    break;
    case "app-keybindings": toggleKeybindingsPanel(); break;
    case "app-plugins":
      togglePluginsPanel(pluginManager.getStates());
      break;

    // Command Bar plugin open dispatch (AD-03 in command-bar/00_index.md).
    // The plugin registers window.__MARKABLE_COMMAND_BAR_OPEN__ at onEnable and
    // sets it to null at onDisable. If the plugin is off, the global is null and
    // this is a safe no-op (EC-19).
    //
    // Modal command bar (Step 01): three action ids map to three modes:
    //   command-bar-open             → Commands mode   (legacy Cmd-Shift-P; preserved)
    //   command-bar-open-files       → Files mode      (Cmd-P)
    //   command-bar-open-content     → Content mode    (Cmd-Shift-F)
    //   command-bar-open-keybindings → Keybindings mode (Cmd-Shift-K)
    case "command-bar-open": {
      const openCB = (window as any).__MARKABLE_COMMAND_BAR_OPEN__;
      if (typeof openCB === "function") openCB("commands");
      break;
    }
    case "command-bar-open-files": {
      const openCB = (window as any).__MARKABLE_COMMAND_BAR_OPEN__;
      if (typeof openCB === "function") openCB("files");
      break;
    }
    case "command-bar-open-content": {
      const openCB = (window as any).__MARKABLE_COMMAND_BAR_OPEN__;
      if (typeof openCB === "function") openCB("content");
      break;
    }
    case "command-bar-open-keybindings": {
      const openCB = (window as any).__MARKABLE_COMMAND_BAR_OPEN__;
      if (typeof openCB === "function") openCB("keybindings");
      break;
    }
    case "command-bar-open-tags": {
      const openCB = (window as any).__MARKABLE_COMMAND_BAR_OPEN__;
      if (typeof openCB === "function") openCB("tags");
      break;
    }
    case "edit-select-none":
      if (editor) {
        // Collapse selection to remove highlight, then enter view mode
        editor.dispatch({
          selection: { anchor: 0 },
          effects: setViewMode.of(true),
        });
        editor.contentDOM.blur();
      }
      break;
    // "file-new" (Cmd-N): open a new untitled document in a new tab.
    // Both Cmd-N and Cmd-T resolve to tabManager.openNewTab() (AD-7, EC-19).
    // The legacy newFile() function was removed in step_07.
    case "file-new":
      tabManager.openNewTab();
      break;

    // "file-new-from-template" (Cmd-Shift-N): open the template picker.
    // Delegates to the Templates plugin via window global (AD-1, FR-7.3).
    case "file-new-from-template": {
      const templatesForNew = (window as any).__MARKABLE_TEMPLATES__;
      if (templatesForNew && typeof templatesForNew.openPicker === "function") {
        templatesForNew.openPicker();
      } else {
        alert("Enable the Templates plugin in Markable > Plugins to use this feature.");
      }
      break;
    }

    // "file-save-as-template": save current doc as a template file.
    // Delegates to the Templates plugin via window global (AD-1, FR-7.3).
    case "file-save-as-template": {
      const templatesForSave = (window as any).__MARKABLE_TEMPLATES__;
      if (templatesForSave && typeof templatesForSave.saveAsTemplate === "function") {
        templatesForSave.saveAsTemplate();
      } else {
        alert("Enable the Templates plugin in Markable > Plugins to use this feature.");
      }
      break;
    }

    // ── Tab operations (step_06) ───────────────────────────────────────────────

    // "tab-new" (Cmd-T): open a new empty untitled document in a new tab.
    case "tab-new":
      tabManager.openNewTab();
      break;

    // "tab-close" (Cmd-W): close whichever tab is currently active.
    // closeTab() is async; we fire-and-forget with void because handleAction()
    // is a synchronous dispatcher. Errors are handled inside closeTab().
    case "tab-close":
      void (async () => {
        const tab = tabManager.getActiveTab();
        if (tab) await tabManager.closeTab(tab.id);
      })();
      break;

    // "tab-1".."tab-9" (Cmd-1..Cmd-9): switch to tab by one-based position.
    // Cmd-9 always activates the last tab regardless of count (FR-5.3).
    // An out-of-range index (e.g. Cmd-5 with only 3 tabs) is a silent no-op
    // handled internally by activateTabByIndex() (EC-8).
    case "tab-1":  tabManager.activateTabByIndex(1); break;
    case "tab-2":  tabManager.activateTabByIndex(2); break;
    case "tab-3":  tabManager.activateTabByIndex(3); break;
    case "tab-4":  tabManager.activateTabByIndex(4); break;
    case "tab-5":  tabManager.activateTabByIndex(5); break;
    case "tab-6":  tabManager.activateTabByIndex(6); break;
    case "tab-7":  tabManager.activateTabByIndex(7); break;
    case "tab-8":  tabManager.activateTabByIndex(8); break;
    case "tab-9":  tabManager.activateTabByIndex(9); break;

    case "tab-prev": tabManager.activatePrevTab(); break;
    case "tab-next": tabManager.activateNextTab(); break;

    case "file-open":       void openFile();          break;
    case "file-save":       void saveFile();          break;
    case "file-save-as":    void saveFileAs();        break;
    case "file-close-all":
      // Close all open tabs in order. Each closeTab() call handles its own
      // dirty-check dialog and stops the loop when the last tab closes the
      // window (EC-2). Async IIFE because handleAction() is synchronous.
      void (async () => {
        // Snapshot the id list before the loop — the array shrinks as we close.
        const ids = tabManager.getTabs().map((t) => t.id);
        for (const id of ids) {
          await tabManager.closeTab(id);
          // Stop early if the window closed (no more tabs remain).
          if (tabManager.getTabCount() === 0) break;
        }
      })();
      break;
    case "file-import":     void openFile();          break;
    // file-export opens the unified format-selection sheet (openExportDialog → export.ts).
    case "file-export":     void openExportDialog(editor, tabManager.getActiveFilePath()); break;
    // file-print bypasses the sheet and goes directly to the system print dialog.
    case "file-print":      printDocument(editor); break;
    case "view-toggle-preview": {
      if (tabManager.isActiveTabInLayoutView()) {
        // Layout view → code view: exit layout, ensure code view not live-preview.
        tabManager.exitLayoutView();
        if (previewEnabled) togglePreview();
      } else if (editor && _layoutDeps) {
        const filePath = tabManager.getActiveFilePath();
        // Note: previous branches that routed `_folder.md` and `hasViewLayout`
        // files through __MARKABLE_OPEN_FOLDER_VIEW_TAB__ were removed after
        // the codefence migration. `_folder.md` is now a normal markdown file
        // whose `select` codefence renders inline as a widget; Cmd-E behaves
        // the same way it does for every other file.
        if (filePath) {
          // Normal file: check for a layout field; if found enter layout view, else toggle preview.
          void (async () => {
            const shown = await showLayoutForFile(filePath, editor.state.doc.toString(), _layoutDeps!);
            if (!shown) togglePreview();
          })();
        } else {
          togglePreview();
        }
      } else {
        togglePreview();
      }
      break;
    }
    case "view-toggle-statusbar":
      if (getStatusBarVisible()) {
        setStatusBarVisible(false);
        document.getElementById("statusbar")?.classList.add("hidden");
      } else {
        ensureStatusBar();
      }
      break;
    case "view-toggle-focus":
      if (editor) void pluginManager.toggle("focus-mode", !pluginManager.getStates()["focus-mode"]);
      break;
    case "view-toggle-typewriter":
      if (editor) void pluginManager.toggle("typewriter-mode", !pluginManager.getStates()["typewriter-mode"]);
      break;
    case "view-toggle-diagrams":
      if (editor) void pluginManager.toggle("diagrams", !pluginManager.getStates()["diagrams"]);
      break;
    case "sidebar.toggleLeft":
      toggleSidebarSide("left");
      break;
    case "sidebar.toggleRight":
      toggleSidebarSide("right");
      break;
    // vault-ux step_05: open Manage Vaults modal via window global.
    // EC-VUX-08: double-open guard lives inside openManageVaultsModal itself.
    // EC-VUX-09: n/a for the keybinding path (Plugin Panel is not involved).
    case "vault-manage": {
      const openVaultFn = (window as any).__MARKABLE_OPEN_MANAGE_VAULTS__;
      if (typeof openVaultFn === "function") openVaultFn();
      break;
    }
    case "theme-next":      nextTheme();              break;
    case "theme-prev":      prevTheme();              break;
    case "theme-light":     void setTheme("default-light"); break;
    case "theme-dark":      void setTheme("default-dark");  break;
    case "theme-system":    void setTheme("system");        break;
    case "view-zoom-in":    void zoomIn();   break;
    case "view-zoom-out":   void zoomOut();  break;
    case "view-zoom-reset": void zoomReset(); break;
    case "format-h1": if (editor) toggleHeading(editor, 1); break;
    case "format-h2": if (editor) toggleHeading(editor, 2); break;
    case "format-h3": if (editor) toggleHeading(editor, 3); break;
    case "format-h4": if (editor) toggleHeading(editor, 4); break;
    case "format-h5": if (editor) toggleHeading(editor, 5); break;
    case "format-h6": if (editor) toggleHeading(editor, 6); break;
    case "format-bold":          if (editor) toggleInlineWrap(editor, "**"); break;
    case "format-italic":        if (editor) toggleInlineWrap(editor, "*");  break;
    case "format-underline":     if (editor) toggleInlineWrap(editor, "__"); break;
    case "format-strikethrough": if (editor) toggleInlineWrap(editor, "~~"); break;
    case "format-highlight":     if (editor) toggleInlineWrap(editor, "=="); break;
    case "format-superscript":   if (editor) toggleInlineWrap(editor, "^");  break;
    case "format-subscript":     if (editor) toggleInlineWrap(editor, "~");  break;
    case "format-math-inline":   if (editor) insertInlineMath(editor);   break;
    case "format-math-block":    if (editor) insertMathBlock(editor);    break;
    case "format-front-matter":  if (editor) insertFrontMatter(editor);  break;
    case "format-image":         if (editor) insertImage(editor);        break;
    case "format-table":         if (editor) insertTable(editor);        break;
    case "format-code-fence":    if (editor) insertCodeFence(editor);    break;
    case "format-quote":         if (editor) toggleLinePrefix(editor, "> ");  break;
    // Insert callout commands (one per canonical type). Builds the template
    // `> [!type]\n> ` and places the cursor at the body line so the user can
    // start typing immediately. Mirrors the slash-command behavior so the two
    // entry points produce identical markdown.
    case "callout-note":
    case "callout-abstract":
    case "callout-info":
    case "callout-todo":
    case "callout-tip":
    case "callout-success":
    case "callout-question":
    case "callout-warning":
    case "callout-failure":
    case "callout-danger":
    case "callout-bug":
    case "callout-example":
    case "callout-quote":
    case "callout-plain": {
      if (!editor) break;
      const canonical = action.slice("callout-".length);
      const text = `> [!${canonical}]\n> `;
      const head = editor.state.selection.main.head;
      editor.dispatch({
        changes: { from: head, to: head, insert: text },
        selection: { anchor: head + text.length },
        effects: setViewMode.of(true),
      });
      break;
    }
    case "format-bullet-list":   if (editor) toggleLinePrefix(editor, "- ");  break;
    case "format-ordered-list":  if (editor) toggleOrderedList(editor);       break;
    case "format-task-list":     if (editor) toggleTaskList(editor);          break;
    // List style menu items (Format > List > List Style). Each calls
    // switchListStyle with the target style name. The function returns
    // boolean but the result is unused here — if the cursor is not on a
    // list line the call silently returns false (FR-2.3).
    case "format-list-style-standard":      if (editor) switchListStyle(editor, "standard");      break;
    case "format-list-style-alphanumeric":  if (editor) switchListStyle(editor, "alphanumeric");  break;
    case "format-list-style-decimal":       if (editor) switchListStyle(editor, "decimal");       break;
    case "format-list-style-steps":         if (editor) switchListStyle(editor, "steps");         break;
    case "format-indent":        if (editor) indentLines(editor);   break;
    case "format-outdent":       if (editor) outdentLines(editor);  break;
    case "format-hr":            if (editor) insertHorizontalRule(editor); break;
    case "format-clear":         if (editor) clearFormatting(editor);     break;
    case "edit-paste-plain": if (editor) pasteWithoutFormatting(editor); break;
    case "edit-copy-plain":  if (editor) copyAsPlainText(editor); break;
    case "edit-copy-html":   if (editor) copyAsHtml(editor);      break;
    case "edit-duplicate-line": if (editor) duplicateLine(editor); break;
    case "edit-delete-line":    if (editor) deleteLine(editor);    break;
    case "edit-goto-line":      showGoToLineOverlay();             break;
    // "edit-insert-count" (Cmd-Shift-3): open the Insert Count dialog.
    // Delegates to the Insert Count plugin via window global (same pattern as command-bar-open).
    // If the plugin is disabled, __MARKABLE_INSERT_COUNT_OPEN__ is null → show alert (EC-02, FR-08.2).
    case "edit-insert-count": {
      const openIC = (window as any).__MARKABLE_INSERT_COUNT_OPEN__;
      if (typeof openIC === "function") {
        openIC();
      } else {
        alert("Enable the Insert Count plugin in Markable > Plugins to use this feature.");
      }
      break;
    }
    case "format-comment":      if (editor) toggleInlineWrap(editor, "%%"); break;
    case "format-link":
    case "edit-paste-link": {
      if (!editor) break;
      const { from, to } = editor.state.selection.main;
      if (from !== to) {
        const label = editor.state.doc.sliceString(from, to);
        const insert = `[${label}]()`;
        editor.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length - 1 } });
      } else {
        editor.dispatch({ changes: { from, to, insert: `[]()` }, selection: { anchor: from + 1 } });
      }
      break;
    }
    case "edit-find":
      if (!editor || !findWidget) break;
      {
        const sel = editor.state.selection.main;
        if (sel.from !== sel.to) findWidget.setPreFill(editor.state.sliceDoc(sel.from, sel.to));
        findWidget.open("find");
      }
      break;
    case "edit-find-replace":
      if (!editor || !findWidget) break;
      {
        const sel = editor.state.selection.main;
        if (sel.from !== sel.to) findWidget.setPreFill(editor.state.sliceDoc(sel.from, sel.to));
        findWidget.open("replace");
      }
      break;
    // Help files open as read-only content tabs so the user's current document
    // is not replaced. openHelpFileInTab() uses tabManager.openContentTab()
    // (step_07 spec).
    case "help-quickstart": void openHelpFileInTab("quickstart.md", "Quickstart"); break;
    case "help-help":       void openHelpFileInTab("help.md", "Help");             break;
    case "help-cheatsheet": void openHelpFileInTab("markdown-cheatsheet.md", "Markdown Cheatsheet"); break;

    case "layouts-open-picker":
      if (_layoutDeps) void openLayoutPicker(_layoutDeps);
      break;

    case "apply-layout": {
      const path = (window as unknown as Record<string, unknown>)["__MARKABLE_CURRENT_FILE__"] as string | null | undefined;
      const open = (window as unknown as Record<string, unknown>)["__MARKABLE_OPEN_ASSIGN_MODAL__"] as ((p: string) => void) | undefined;
      if (path && typeof open === "function") open(path);
      break;
    }

    // Cursor-aware Insert or Edit CodeBlock. If the cursor sits inside a
    // recognized custom fence (sidebar / sidebar-left / grid / grid-card /
    // select), the unified CodeBlock modal opens in edit mode pre-populated
    // for that block type. Otherwise it opens in insert mode with a type
    // picker.
    case "code-block": {
      if (!editor) break;
      const ed = editor;
      const ruleRowContext = getRuleRowContext();
      const detected = findCustomFenceAtCursor(ed);
      if (detected) {
        // step_09 (view-modal): the legacy Select/Sidebar/Grid type-
        // picker modal is gone. The Unified View Modal owns the
        // `select` flow; sidebar and grid fences are edited inline
        // (the user can also use `/sidebar` or `/grid` to insert a
        // fresh stub elsewhere in the document).
        const langFirst = detected.lang.split(/\s+/)[0];
        if (langFirst === "select") {
          const initial = parseSelectBodyForBuilder(detected.body);
          openViewModal("edit", {
            editor: { view: ed, from: detected.from, to: detected.to },
            initial,
            ruleRowContext,
            onSubmit: (state) => {
              const newFence = buildSelectFenceFromState(state);
              ed.dispatch({ changes: { from: detected.from, to: detected.to, insert: newFence } });
            },
          });
        }
        // Sidebar and grid: silent no-op. The fence is editable in
        // place; users can also insert a fresh stub via `/sidebar` or
        // `/grid`. No toast yet — DW-1 follow-up may add one.
      } else {
        const cursorPos = ed.state.selection.main.head;
        openViewModal("insert", {
          editor: { view: ed, from: cursorPos, to: cursorPos },
          ruleRowContext,
          onSubmit: (state) => {
            const newFence = buildSelectFenceFromState(state);
            const line = ed.state.doc.lineAt(cursorPos);
            const needLead = line.from !== cursorPos;
            const insertText = (needLead ? "\n" : "") + newFence + "\n";
            ed.dispatch({ changes: { from: cursorPos, to: cursorPos, insert: insertText } });
          },
        });
      }
      break;
    }

    // Collections (FR-61) — two surviving command-bar entries after refactor
    // step_R01 (2026-06-06). The MVP-era `collection:make-collection` case
    // was deleted; the layout is opted into via the display-options picker.
    case "collection:new-stack": {
      void (async () => {
        const collectionPath = getActiveCollectionPath();
        if (!collectionPath) {
          notifyCollectionsToast("Open a Collection first.");
          return;
        }
        const mod = await import("./plugins/file-browser/collections/commands");
        await mod.newStack(collectionPath);
        const vm = (window as unknown as { __MARKABLE_VAULT_MANAGER__?: { reloadVaultIndex?: () => Promise<void> } })
          .__MARKABLE_VAULT_MANAGER__;
        await vm?.reloadVaultIndex?.();
      })();
      break;
    }
    case "collection:add-reference": {
      // Step 14 / 15 implementation note: the Stack picker UI is a follow-up
      // in step 17/18; this case still wires the entry so the command bar
      // shows the command. When no note is focused, surface a toast.
      void (async () => {
        const notePath = getFocusedNotePath();
        if (!notePath) {
          notifyCollectionsToast("Focus a note in a Collection first.");
          return;
        }
        // The picker UI ships with the renderer's context-menu dispatch in
        // step 14; the command-bar entry stays a thin wrapper around the
        // same call path. With no picker mounted at command-bar invocation
        // time, we emit a toast guiding the user to the right-click flow.
        notifyCollectionsToast("Right-click the note for the Stack picker.");
      })();
      break;
    }

    default: {
      if (action.startsWith("recent-file-")) {
        const idx = parseInt(action.replace("recent-file-", ""), 10);
        const files = getCurrentSettings().recentFiles;
        if (idx >= 0 && idx < files.length) void openRecentFileByPath(files[idx]);
      } else if (action.startsWith("custom:")) {
        void setTheme(action);
      } else {
        // Plugin command fallback: find the command by id in __MARKABLE_COMMANDS__
        // and call its action() directly. This handles all plugin-registered commands
        // (e.g. daily-note-toggle-calendar) that are not wired into the switch above.
        const cmds = (window as unknown as Record<string, unknown>)["__MARKABLE_COMMANDS__"] as
          Array<{ id: string; action: () => void }> | undefined;
        const found = cmds?.find((c) => c.id === action);
        if (found) {
          found.action();
        } else {
          // FR-11: check plugin action extensions registered by IIFE plugins.
          // This runs after the COMMANDS lookup so built-in commands always take
          // priority over plugin-registered action extensions.
          const ext = (window as unknown as Record<string, unknown>)[
            "__MARKABLE_ACTION_EXTENSIONS__"
          ];
          if (ext instanceof Map && (ext as Map<string, () => void>).has(action)) {
            (ext as Map<string, () => void>).get(action)!();
          }
        }
      }
      break;
    }
  }
}

/**
 * Load (or reload) the meta vocabulary store for the active vault and expose
 * it as window.__MARKABLE_META__.
 *
 * Non-blocking: called fire-and-forget from vault activation paths (NFR-1).
 * On any failure: sets an empty store so the global is always a valid MetaStore
 * (EC-1, EC-2). Never throws — errors are logged as warnings only.
 *
 * @param vault - The active VaultEntry, or null when no vault is active.
 */
async function initMeta(vault: Parameters<typeof buildMetaStore>[0] | null): Promise<void> {
  if (!vault) {
    // EC-1: no vault open — clear vocabulary so plugins see an empty store.
    (window as unknown as Record<string, unknown>)["__MARKABLE_META__"] = emptyMetaStore();
    return;
  }
  try {
    const store: MetaStore = await buildMetaStore(vault, readFile, {
      writeFileFn: async (path, content) => { await writeFile(path, content); },
      ensureDirectoryFn: ensureDirectory,
      deleteDirectoryFn: deleteDirectory,
    });
    (window as unknown as Record<string, unknown>)["__MARKABLE_META__"] = store;
  } catch (err) {
    // Defensive: buildMetaStore is designed to never reject, but we guard anyway.
    console.warn("[initMeta] Failed to load meta store:", err);
    (window as unknown as Record<string, unknown>)["__MARKABLE_META__"] = emptyMetaStore();
  }
}

/**
 * Initialize the application
 */
async function initApp() {
  console.log("Initializing Markable 2.0...");

  // Load settings from disk before any UI (TC-5: read before show)
  const settings = await loadSettings();
  console.log("Settings loaded, schema version:", settings.version);

  // Migrate old flat plugin settings keys (focusMode, typewriterMode, wordCount,
  // statusBar.visible, userPlugins) into the unified plugins map introduced in
  // step_03c. migratePluginSettings is idempotent: if settings.plugins is already
  // non-empty it returns the input unchanged (EC-26/27/28).
  const migratedSettings = migratePluginSettings(settings);

  // Persist the migrated map so subsequent launches skip migration entirely.
  // Fire-and-forget (void): if the write fails the migration re-runs next launch
  // with the same idempotent result, so no data is lost.
  if (!settings.plugins || Object.keys(settings.plugins).length === 0) {
    void updateSettings(() => migratedSettings);
  }

  // Copy core plugin .js files from the app bundle to the user data directory.
  // Non-fatal: in `tauri dev` mode the resource directory is absent and the command
  // logs a message instead of copying. A Rust-side version stamp prevents redundant
  // copies across launches (EC-5, EC-34). The await is required — loadPlugins
  // must not run before the copy completes (EC-18 ordering).
  try {
    await copyCorePlugins();
  } catch (err) {
    console.warn("[init] copyCorePlugins failed (non-fatal):", err);
  }

  // Copy bundled default themes to Application Support on first launch.
  // Skipped silently in tauri dev (no bundled resource dir). Non-fatal.
  try {
    await copyDefaultThemes();
  } catch (err) {
    console.warn("[init] copyDefaultThemes failed (non-fatal):", err);
  }

  // Apply window position/size before anything is visible
  await applyWindowSettings(migratedSettings.window);

  // Get editor container
  const editorContainer = document.getElementById("editor");
  if (!editorContainer) {
    console.error("Editor container #editor not found in DOM");
    return;
  }

  // Create editor instance
  editor = createEditor(editorContainer, "");
  if (!editor) {
    console.error("Failed to initialize editor");
    return;
  }

  // Wire the PluginManager to the live EditorView so addExtensions/removeExtensions
  // can dispatch Compartment.reconfigure effects. Must be called before restoreAll()
  // so that any plugin calling api.addExtensions() in onEnable has a live view to
  // dispatch against. EC-18: any pending extensions queued before this point are
  // flushed here (empty under normal startup order).
  pluginManager.setEditorView(editor);

  // Expose the live EditorView instance on the window so IIFE plugins (e.g.
  // auto-toc) can perform an initial build immediately in onEnable rather than
  // waiting for the first user keystroke. This is a progressive enhancement —
  // plugins that read this global must degrade gracefully when it is absent.
  (window as unknown as Record<string, unknown>)["__MARKABLE_EDITOR_VIEW__"] =
    editor;

  // Expose the spell-check Compartment so applyEditorSettings() in settings.ts
  // can reconfigure it without importing @codemirror/* into that shared module.
  (window as unknown as Record<string, unknown>)["__MARKABLE_SPELL_CHECK_COMPARTMENT__"] =
    spellCheckCompartment;

  // AD-8: expose the tab manager so IIFE plugins (e.g. backlinks) can call
  // openFileInTab() for click-to-navigate without an app-internal import.
  (window as unknown as Record<string, unknown>)["__MARKABLE_TAB_MANAGER__"] =
    tabManager;

  // AD-3: expose the file-open dialog so IIFE plugins (e.g. image-toolbar)
  // can open the native file picker. Uses the existing openFileDialog() wrapper
  // (invoke-based, no @tauri-apps/plugin-dialog dependency) and normalises the
  // return value to string | null so the plugin doesn't need to import DialogResult.
  (window as unknown as Record<string, unknown>)["__TAURI_DIALOG__"] = {
    open: async (_opts?: unknown) => {
      const result = await openFileDialog();
      return result.cancelled ? null : (result as { cancelled: false; path: string }).path;
    },
    openFolder: async (defaultPath?: string) => {
      const result = await openFolderDialog(defaultPath);
      return result.cancelled ? null : (result as { cancelled: false; path: string }).path;
    },
    // Native macOS confirm dialog via tauri-plugin-dialog (registered in lib.rs).
    confirm: async (message: string, opts?: { title?: string }) => {
      return await invoke<boolean>("plugin:dialog|confirm", {
        message,
        title: opts?.title ?? "Confirm",
        kind: "info",
      });
    },
  };

  // AD-1: Expose convertFileSrc so IIFE plugins (e.g. media-preview) can resolve
  // local filesystem paths to Tauri asset:// URLs without bundling @tauri-apps/api.
  // convertFileSrc is a pure synchronous function — assigning it here (before plugin
  // loading) ensures EC-35 (startup race condition) cannot occur.
  (window as unknown as Record<string, unknown>)["__MARKABLE_CONVERT_FILE_SRC__"] =
    convertFileSrc;

  // Expose preview mode state so IIFE plugins know whether to render decorations.
  // Plugins must check this before decorating — source/raw mode must show no widgets.
  (window as unknown as Record<string, unknown>)["__MARKABLE_PREVIEW_ENABLED__"] = true;

  // Expose a helper so plugins can force code/source view (disabling Typora preview).
  // Used by the file-browser plugin when opening _folder.md directly — that file has
  // no markdown preview mode; only code view and folder-view (layout view) are valid.
  (window as unknown as Record<string, unknown>)["__MARKABLE_ENSURE_CODE_VIEW__"] = () => {
    if (previewEnabled) togglePreview();
  };

  // Apply editor settings (content width + font size)
  applyEditorSettings(migratedSettings.editor);

  // Preview mode starts ON — hide line numbers
  editorContainer.classList.add("preview-mode");

  // Build the status bar zone references for the unified plugin API.
  // These are passed into loadPlugins so that buildMarkablePluginAPI can wire
  // each plugin's statusBar property to the correct DOM elements.
  //
  // Bug #1 fix: the HTML uses class names (.statusbar-left / -center / -right),
  // not id attributes, so getElementById() returns null. querySelector() correctly
  // matches class selectors.
  const statusBarZones = {
    left:   document.querySelector(".statusbar-left")   as HTMLElement,
    center: document.querySelector(".statusbar-center") as HTMLElement,
    right:  document.querySelector(".statusbar-right")  as HTMLElement,
  };

  // Initialize the sidebar infrastructure before plugins are loaded.
  // initSidebar() creates #app-row and moves #editor into it so that any
  // plugin calling api.registerSidebarPanel() in onEnable finds the wrapper
  // already present. Must run after editor creation and setEditorView().
  initSidebar();

  // ── Command Bar globals (set before loadPlugins so the IIFE can read them
  // at onEnable time, not just at openBar() time) ────────────────────────────
  (window as unknown as Record<string, unknown>)["__MARKABLE_COMMANDS__"] = COMMANDS;
  (window as unknown as Record<string, unknown>)["__MARKABLE_PLUGIN_MANAGER__"] = pluginManager;
  (window as unknown as Record<string, unknown>)["__MARKABLE_GET_SETTINGS__"] = getCurrentSettings;
  (window as unknown as Record<string, unknown>)["__MARKABLE_HANDLE_ACTION__"] = handleAction;
  (window as unknown as Record<string, unknown>)["__MARKABLE_COMMAND_BAR_IS_OPEN__"] = false;
  (window as unknown as Record<string, unknown>)["__MARKABLE_COMMAND_BAR_OPEN__"] = null;
  // Action extensions map: plugins register callbacks keyed by action id so that
  // handleAction() can dispatch to them. Must be set before loadPlugins() fires
  // onEnable callbacks — plugins register their actions during onEnable.
  (window as unknown as Record<string, unknown>)["__MARKABLE_ACTION_EXTENSIONS__"] =
    new Map<string, () => void>();

  // ── Meta system global — set before plugins load so IIFE reads are safe ────
  // emptyMetaStore() ensures the global is always a valid MetaStore shape even
  // before initMeta() resolves (AD-2, EC-1).
  (window as unknown as Record<string, unknown>)["__MARKABLE_META__"] = emptyMetaStore();

  // ── Vault manager initialisation ────────────────────────────────────────────
  // Non-blocking: vault init runs in the background so the window becomes
  // visible before potentially slow index building begins. The File Browser
  // plugin responds to vault state via onVaultChanged once init() completes.
  // The window global is set by vault-manager.ts at module load time.
  vaultManager.init().catch((err) =>
    console.warn("[init] vaultManager.init failed (non-fatal):", err)
  );

  // __MARKABLE_META__ is populated by the onVaultChanged subscription below.
  // The initMeta call that previously appeared here was a no-op: vaultManager.init()
  // is non-blocking so getActiveVault() still returns null at this point, and
  // initMeta(null) = emptyMetaStore() which is already set at line above (L-3).

  // Reload meta vocabulary whenever the user switches vaults (EC-7, FR-2).
  // The MetaStore is replaced atomically (AD-3) — no cross-vault contamination.
  vaultManager.onVaultChanged((vault) => {
    initMeta(vault).catch((err) =>
      console.warn("[onVaultChanged] initMeta failed:", err)
    );
  });

  // Hot-reload meta when a file inside the meta folder changes on disk (FR-12).
  // The vault file watcher emits a VaultFileChangedEvent; isMetaFolderEvent
  // filters to only the relevant paths before triggering a reload.
  vaultManager.onIndexUpdated((event) => {
    const vault = vaultManager.getActiveVault();
    if (!vault) return;
    if (isMetaFolderEvent(event.path, vault)) {
      initMeta(vault).catch((err) =>
        console.warn("[onIndexUpdated] meta hot-reload failed:", err)
      );
    }
  });

  // Load all plugins (core + user) from disk. Must run after setEditorView()
  // so any plugin calling api.addExtensions() in onEnable has a live view.
  // Errors are isolated per-plugin — a failing plugin does not block the rest.
  await pluginManager.loadPlugins(migratedSettings, statusBarZones);

  // Restore persisted sidebar state (open/closed, active tab) after all
  // plugins have been loaded. EC-23: this runs after loadPlugins so we only
  // restore "open" state if at least one panel was actually registered.
  restoreSidebarFromSettings();

  // File-browser-first experience: when a vault is active and the left sidebar
  // is at factory default (never been manually opened/closed by the user),
  // open it automatically so the file browser leads the experience.
  // "Factory default" = open:false AND activeTabId:null (the user has not
  // interacted with the sidebar since the vault was configured).
  {
    const _s = getCurrentSettings();
    const _activeId = _s.activeVaultId;
    const _hasVault = !!_activeId && (_s.vaults ?? []).some((v) => v.id === _activeId);
    if (_hasVault) {
      const _leftSlot = _s.sidebar?.left;
      const _isFactoryDefault =
        !_leftSlot || (_leftSlot.open === false && _leftSlot.activeTabId === null);
      if (_isFactoryDefault) {
        toggleSidebarSide("left");
      }
    }
  }

  // Initialize the tab manager. Must run after initSidebar() (which creates
  // #app-row) and after editor creation. TabManager reads settings to restore
  // the previous session and mounts the MinimalTabBar renderer into #tab-strip.
  await tabManager.init(editor);

  // ── Layouts / custom-render-tab globals ─────────────────────────────────────
  // Set after tabManager.init() so the tabManager singleton is fully initialised
  // before IIFE plugins access these globals in their onEnable calls.

  // FR-09: IIFE plugin access to openCustomRenderTab.
  (window as unknown as Record<string, unknown>)["__MARKABLE_OPEN_CUSTOM_TAB__"] =
    (title: string, renderFn: (container: HTMLElement) => void) =>
      tabManager.openCustomRenderTab(title, renderFn);

  // FR-10: expose marked.parse so IIFE plugins share the same renderer instance.
  // Using the same marked instance avoids duplicate configuration (D-02).
  // breaks:true converts a single newline within a paragraph to <br>, matching
  // the user expectation in a note-taking app (same default as Bear / Obsidian).
  marked.use({ breaks: true });
  (window as unknown as Record<string, unknown>)["__MARKABLE_RENDER_MD__"] =
    (md: string) => marked.parse(md);

  // ── Layouts system (core capability, not a plugin) ──────────────────────────
  // Fetch app data dir once; build deps object with lazy getters so layout
  // operations always read the live vault/meta state at the time of invocation.
  {
    let appDataDir = "";
    try { appDataDir = await getAppDataDir(); } catch { /* non-fatal */ }
    _layoutDeps = {
      appDataDir,
      getActiveVaultRoot: () => vaultManager.getActiveVault()?.rootPaths[0] ?? null,
      getVaultIndex: () => vaultManager.getVaultIndex(),
      getActiveVaultName: () => vaultManager.getActiveVault()?.name ?? "",
      getMetaStore: () => (window as unknown as Record<string, unknown>)["__MARKABLE_META__"] as MetaStore | null,
      showLayoutView: (renderFn) => tabManager.enterLayoutView(renderFn),
      refreshLayoutView: (renderFn) => tabManager.refreshLayoutView(renderFn),
      exitLayoutView: () => tabManager.exitLayoutView(),
      getCurrentFilePath: () => tabManager.getActiveFilePath(),
      getActiveFileContent: () => editor?.state.doc.toString() ?? null,
      onFileUpdated: (path, content) => {
        tabManager.updateTabDoc(path, content);
        if (tabManager.getActiveFilePath() === path && editor) {
          editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: content } });
        }
      },
    };
    injectLayoutsCSS();
    injectSidebarCSS();
    injectGridCSS();
    editor.dispatch({
      effects: StateEffect.appendConfig.of(buildAutoRenderExtension(_layoutDeps)),
    });
    editor.dispatch({
      effects: StateEffect.appendConfig.of(buildLayoutInlineExtension(_layoutDeps)),
    });
    editor.dispatch({
      effects: StateEffect.appendConfig.of(
        buildQuickCommandExtension({
          openLayoutPicker: () => { if (_layoutDeps) void openLayoutPicker(_layoutDeps); },
          enterPreviewMode: () => { if (!previewEnabled) togglePreview(); },
          openCodeBlock: (view, from, to, _preselect) => {
            // step_09 (view-modal): the unified View Modal replaces the
            // legacy type-picker. The `preselect` arg is ignored
            // because the new modal does not have a type picker; the
            // user picks a layout via the six-tab strip. `/sidebar`
            // and `/grid` slash commands handle the other two fence
            // types (step_07).
            view.dispatch({ changes: { from, to, insert: "" } });
            const insertPos = from;
            openViewModal("insert", {
              editor: { view, from: insertPos, to: insertPos },
              ruleRowContext: getRuleRowContext(),
              onSubmit: (state) => {
                const newFence = buildSelectFenceFromState(state);
                const line = view.state.doc.lineAt(insertPos);
                const needLead = line.from !== insertPos;
                const insertText = (needLead ? "\n" : "") + newFence + "\n";
                view.dispatch({ changes: { from: insertPos, to: insertPos, insert: insertText } });
              },
            });
          },
        }),
      ),
    });
    void ensureStarterLayouts(appDataDir);
    (window as unknown as Record<string, unknown>)["__MARKABLE_OPEN_LAYOUT_PICKER_FOR_FILE__"] =
      (path: string) => { if (_layoutDeps) void openLayoutPicker(_layoutDeps, path); };
    // Page-level eye-icon + right-click + Apply-Layout command all open the
    // assign modal in layouts-only mode. Views moved to ```select codefences
    // and are no longer assigned at the page level.
    (window as unknown as Record<string, unknown>)["__MARKABLE_OPEN_ASSIGN_MODAL__"] =
      (path: string) => {
        if (_layoutDeps) void openAssignModal(path, _layoutDeps, undefined, { layoutsOnly: true });
      };
    (window as unknown as Record<string, unknown>)["__MARKABLE_OPEN_FILE_IN_TAB__"] =
      (path: string) => void openAndMaybeLayout(path);

    // Open the unified CodeBlock modal in edit mode for an existing select
    // codefence. The widget's gear icon calls this with the EditorView and
    // the fence body string. (Sidebar and Grid widgets don't have gears yet;
    // the cursor-aware "Insert or Edit CodeBlock" command covers them.)
    (window as unknown as Record<string, unknown>)["__MARKABLE_EDIT_SELECT_FENCE__"] =
      (view: EditorView, body: string) => {
        const range = findSelectFenceRange(view, body);
        if (!range) return;
        openViewModal("edit", {
          editor: { view, from: range.from, to: range.to },
          initial: parseSelectBodyForBuilder(body),
          ruleRowContext: getRuleRowContext(),
          onSubmit: (state) => {
            const newFence = buildSelectFenceFromState(state);
            view.dispatch({ changes: { from: range.from, to: range.to, insert: newFence } });
          },
        });
      };

    // Open the CodeBlock modal for the first recognized codefence in the
    // active editor. If a codefence exists → edit mode (with Remove). If
    // none exists → insert mode at the end of the doc, so the user can
    // "apply" a block. Used by the Folder View entry points (click a
    // folder row, click the visibility badge, "Open Folder View" menu).
    //
    // Deferred two animation frames so CM6 has time to mount the freshly
    // loaded document and rebuild its syntax tree. Without the defer the
    // very-first-open-after-create case finds an empty doc and falls
    // through to insert mode incorrectly.
    (window as unknown as Record<string, unknown>)["__MARKABLE_EDIT_FIRST_CODEBLOCK__"] =
      () => {
        if (!editor) return;
        const ed = editor;
        const open = (): void => {
          const detected = findFirstCustomFence(ed);
          if (detected) {
            // step_09 (view-modal): only `select` fences open the modal.
            // Sidebar / grid fences are edited inline; `/sidebar` and
            // `/grid` slash commands cover insertion.
            const langFirst = detected.lang.split(/\s+/)[0];
            if (langFirst !== "select") return;
            openViewModal("edit", {
              editor: { view: ed, from: detected.from, to: detected.to },
              initial: parseSelectBodyForBuilder(detected.body),
              ruleRowContext: getRuleRowContext(),
              onSubmit: (state) => {
                const newFence = buildSelectFenceFromState(state);
                ed.dispatch({ changes: { from: detected.from, to: detected.to, insert: newFence } });
              },
            });
            return;
          }
          // No codefence in the file yet → open insert mode at the end of doc.
          const insertPos = ed.state.doc.length;
          openViewModal("insert", {
            editor: { view: ed, from: insertPos, to: insertPos },
            ruleRowContext: getRuleRowContext(),
            onSubmit: (state) => {
              const newFence = buildSelectFenceFromState(state);
              const needLead = insertPos > 0 && ed.state.doc.sliceString(insertPos - 1, insertPos) !== "\n";
              const insertText = (needLead ? "\n" : "") + newFence + "\n";
              ed.dispatch({ changes: { from: insertPos, to: insertPos, insert: insertText } });
            },
          });
        };
        requestAnimationFrame(() => requestAnimationFrame(open));
      };
  }

  // Attach dirty-state tracking to the editor via updateListener.
  //
  // tabManager.markActiveTabDirty() is idempotent (FR-7): calling it on every
  // docChanged event is safe and never causes redundant title-bar updates or
  // renderer calls (the method returns early when the tab is already dirty).
  //
  // The legacy isDirty / setDirty() variables and the isReadOnly guard were
  // removed in step_07 — TabManager now owns all dirty-state tracking.
  editor.dispatch({
    effects: StateEffect.appendConfig.of(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          // Single call — TabManager handles the title bar update and renderer
          // notification when the tab transitions from clean to dirty.
          tabManager.markActiveTabDirty();
          // Re-read page-level content-width from the (possibly edited)
          // frontmatter. Cheap regex on the head of the doc; runs on every
          // doc change so the override updates live as the user edits the
          // frontmatter block.
          const head = update.state.doc.sliceString(0, Math.min(2000, update.state.doc.length));
          applyPageContentWidth(readContentWidthFromFrontmatter(head));
        }
      })
    ),
  });

  // Track the .cm-editor pane's width on the editor root as
  // `--editor-pane-width`. Block-level content-width overrides
  // (.cm-block-width-wide / -full) use this to compute their escape
  // size — using viewport width instead would let blocks extend under
  // the file-browser sidebar. The observer runs whenever the editor
  // pane resizes (sidebar collapse/expand, window resize, etc.).
  {
    const paneEl = editor.dom;
    const updatePaneWidth = (): void => {
      paneEl.style.setProperty("--editor-pane-width", `${paneEl.clientWidth}px`);
    };
    updatePaneWidth();
    const ro = new ResizeObserver(updatePaneWidth);
    ro.observe(paneEl);
  }

  // List style status bar indicator (FR-3).
  // Element is created and attached unconditionally; the status bar itself
  // is only shown when a trigger plugin (word-count, etc.) calls ensureStatusBar().
  const listStyleZone = statusBarZones.left;
  if (listStyleZone) {
    const listIndicatorEl = createListStyleIndicator(() => editor);
    listStyleZone.appendChild(listIndicatorEl);
    editor.dispatch({
      effects: StateEffect.appendConfig.of(
        listStyleIndicator(
          listIndicatorEl,
          () => (getCurrentSettings().listStyle ?? "standard") as "standard" | "alphanumeric" | "decimal" | "steps",
        )
      ),
    });
  }

  // Auto-focus the editor so the cursor is blinking immediately
  editor.focus();

  // Discover custom themes from the themes directory
  customThemes = await listThemes();
  buildThemeOrder();
  console.log(`Found ${customThemes.length} custom theme(s)`);

  // Expose custom themes as command bar entries. COMMANDS is the same array
  // reference held by window.__MARKABLE_COMMANDS__, so pushing here makes
  // them available to the command bar on its next open without any extra wiring.
  for (const theme of customThemes) {
    COMMANDS.push({ id: `custom:${theme.filename}`, label: theme.name, defaultKey: "", section: "Theme" });
  }

  // Apply persisted theme before window.show() (no-flash). setTheme rebuilds
  // the native Theme menu with the custom-themes list and the active-theme
  // checkmark, so we don't need a separate updateThemeMenu call here.
  await setTheme(migratedSettings.theme.active, false);

  // Create the floating find/replace widget (appended to document.body, hidden by default).
  // Must be created after `editor` is confirmed non-null.
  findWidget = createFindWidget(editor);

  // Create the Quick Capture overlay (appended to document.body, hidden by default).
  quickCapture = new QuickCaptureWidget();

  // Create settings panel (DOM injection, hidden by default)
  createSettingsPanel();
  initAppearanceCallbacks({
    getThemeOrder,
    getCurrentTheme: () => getCurrentSettings().theme.active,
    setTheme: (t) => void setTheme(t),
  });

  // Create keybindings panel (DOM injection, hidden by default)
  createKeybindingsPanel();

  // Create plugins panel (DOM injection, hidden by default).
  // Definitions come from PluginManager so the panel never needs to know about
  // individual plugins — adding a built-in plugin requires zero changes here.
  createPluginsPanel(
    pluginManager.getDefinitions(),
    pluginManager.getStates(),
    async (id, enabled) => {
      if (editor) await pluginManager.toggle(id, enabled);
    },
    // Reload callback: rescans the user plugins directory for new .js files,
    // enables any that were previously saved as enabled, then refreshes the panel.
    //
    // LOW finding (code review): use getCurrentSettings() rather than the
    // captured `migratedSettings` snapshot. By the time the user clicks "Reload"
    // the settings object may have been mutated (e.g. a plugin was toggled since
    // launch). getCurrentSettings() always returns the live settings reference,
    // ensuring the reload sees up-to-date plugin enable states.
    async () => {
      await pluginManager.reloadUserPlugins(getCurrentSettings(), statusBarZones);
      updateUserPluginDefs(
        pluginManager.getDefinitions(),
        pluginManager.getStates(),
      );
    },
  );

  // Populate the native Open Recent submenu with persisted files
  await refreshRecentFilesMenu();

  // Track window move/resize for settings persistence
  await setupWindowStateListeners();

  // Save the tab session when the user clicks the window close button (FR-6.7d).
  //
  // In Tauri v2, listening to "tauri://close-requested" prevents the default
  // window close. We save the session then call destroy() ourselves to complete
  // the close sequence.
  {
    const appWindow = getCurrentWebviewWindow();
    await appWindow.listen("tauri://close-requested", async () => {
      // Flush the current session to disk before the window is torn down.
      await tabManager.saveSession();
      // Destroy the window now that persistence is complete.
      await appWindow.destroy();
    });
  }

  // Listen for menu events from Rust
  await listen<{ action: string; path?: string }>("menu-event", (event) => {
    const { action, path } = event.payload;
    // "open-file-path" is emitted by Rust when it opens the file dialog itself
    // (hidden-window case) and the user selects a file.
    if (action === "open-file-path" && path) {
      void openFileByPath(path);
    } else {
      handleAction(action);
    }
  });

  // Drag & drop: open .md / .txt files dropped onto the window.
  // EC-14: all dropped files open in new tabs; duplicate-path guard inside
  // openFileInTab() prevents the same file from opening twice.
  // Multiple-file drops are supported — each valid path gets its own tab.
  await getCurrentWebviewWindow().onDragDropEvent(
    createDragDropHandler(tabManager, refreshRecentFilesMenu)
  );

  // D-7: Intercept Cmd-F and Cmd-Shift-F at the document level so the custom
  // FindWidget opens for BOTH the menu event path and the direct keypress path.
  //
  // Rationale: searchKeymap includes `{ key: "Mod-f", run: openSearchPanel }`.
  // With the suppressed panel factory (step_01), openSearchPanel dispatches
  // togglePanel internally but produces no visible UI. Without this listener,
  // pressing Cmd-F directly (not via the menu) would be a no-op for the widget.
  // By listening on `document` at the capture phase we intercept the keydown
  // before it reaches the CM6 editor and before searchKeymap fires.
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    // Resolve action from custom bindings first, then defaults.
    if (!e.defaultPrevented) {
      const custom = getCurrentSettings().keybindings ?? {};
      const actionId = resolveAction(e, custom);
      if (actionId) {
        e.preventDefault();
        e.stopPropagation();
        handleAction(actionId);
        return;
      }
    }

    // Ctrl+G: Go to Line (intercept before CM6 processes it)
    if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key === "g") {
      e.preventDefault();
      e.stopPropagation();
      showGoToLineOverlay();
      return;
    }

    if (!editor || !findWidget) return;

    // On macOS, Command key sets e.metaKey. Cmd-F opens find; Cmd-Opt-F opens
    // find with replace visible. With altKey held, macOS may report e.key as
    // 'ƒ' (Option+F = florin) even when metaKey is also held — handle both.
    const isCmdF =
      e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && e.key === "f";
    const isCmdOptF =
      e.metaKey && e.altKey && !e.shiftKey && !e.ctrlKey &&
      (e.key === "f" || e.key === "ƒ");

    if (isCmdF) {
      e.preventDefault();
      e.stopPropagation();
      const sel = editor.state.selection.main;
      if (sel.from !== sel.to) {
        // FR-5.1 / EC-13: Pre-fill with first line of selection.
        findWidget.setPreFill(editor.state.sliceDoc(sel.from, sel.to));
      }
      findWidget.open("find");
      return;
    }

    if (isCmdOptF) {
      e.preventDefault();
      e.stopPropagation();
      const sel = editor.state.selection.main;
      if (sel.from !== sel.to) {
        // FR-5.1 / EC-13: Pre-fill with first line of selection.
        findWidget.setPreFill(editor.state.sliceDoc(sel.from, sel.to));
      }
      findWidget.open("replace");
    }
  });

  // Clipboard image paste (FR-01 through FR-11, DC-01 through DC-05).
  //
  // Registered at the capture phase (third argument = true) so this listener
  // fires before CM6's own DOM event handlers. When an image is detected the
  // listener calls event.preventDefault() to prevent CM6 from treating the
  // binary data as text paste.
  //
  // Guards 1–2 are evaluated synchronously here (before any async work).
  // Guards 3–5 and all async logic are delegated to handleImagePaste() so the
  // business logic is independently unit-testable (NFR-06).
  document.addEventListener("paste", async (e: ClipboardEvent) => {
    // Guard 1: clipboard must contain at least one image/* item (FR-01, EC-01).
    // extractImageItem returns the first matching item (EC-21) or null.
    const imageItem = extractImageItem(e.clipboardData?.items);
    if (!imageItem) return; // No image data — fall through to CM6 (EC-01)

    // Guard 2: editor must be initialised and focused (EC-06, EC-20, EC-22, EC-23).
    // Checked at call time (not at registration time) so that a null editor at
    // startup never causes a spurious intercept — editor is null until initApp()
    // assigns it (EC-20). hasFocus is false when the command bar or find widget
    // has keyboard focus (EC-22, EC-23).
    if (!editor || !editor.hasFocus) return;

    // Guard 5: item.getAsFile() must return a non-null Blob (EC-15).
    // A DataTransferItem can report type "image/*" but still fail getAsFile().
    const file = imageItem.getAsFile();
    if (!file) return;

    // All synchronous guards passed — take ownership of the event so CM6 does
    // not attempt to paste binary bytes as text.
    e.preventDefault();

    // Capture the non-null editor reference at the point where guard 2 already
    // confirmed editor !== null and editor.hasFocus. Using a local const avoids
    // TypeScript's "possibly null" error inside the lambdas passed to handleImagePaste.
    const liveEditor = editor;

    // Delegate all async logic (Guards 3–4, vault/no-vault branching, write,
    // snippet dispatch) to the testable handleImagePaste function.
    await handleImagePaste({
      imageBlob:        file,
      activeTab:        tabManager.getActiveTab(),
      getActiveVault:   () => vaultManager.getActiveVault(),
      ensureDirectory,
      writeBinaryFile,
      saveImageDialog,
      dispatch:         (tx) => liveEditor.dispatch(tx as Parameters<typeof liveEditor.dispatch>[0]),
      getSelectionHead: () => liveEditor.state.selection.main.head,
      now:              new Date(),
    });
  }, true /* capture phase — must fire before CM6 processes the event */);

  // EC-29: If the FindWidget is open when the window regains focus, do not
  // steal focus away from the find input. The browser restores focus to the
  // last focused element within the widget automatically.
  window.addEventListener("focus", () => {
    if (findWidget?.isOpen()) {
      // FindWidget manages its own focus. No action needed here.
      return;
    }
    // Do not steal focus from the Command Bar overlay when the window regains
    // focus (EC-26, AD-08 in command-bar/00_index.md). The flag is set to true
    // by the plugin at open time and back to false at close time.
    if ((window as any).__MARKABLE_COMMAND_BAR_IS_OPEN__) {
      return;
    }
    if (editor) editor.focus();
  });

  // Respond to OS dark/light mode changes when "system" theme is active
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getCurrentSettings().theme.active === "system") {
      applyBundledTheme("system");
    }
  });

  // The title bar is now managed entirely by TabManager._updateTitleBar(),
  // which is called by _applyActiveTab() on every tab switch and after init().
  // The standalone updateTitleBar() function has been removed in step_07.

  // Modal Command Bar: listen for keybinding changes dispatched by the command-bar
  // plugin after a shortcut is assigned. The plugin writes via Tauri invoke directly
  // and then dispatches this event so the in-memory settings singleton stays current.
  // This allows resolveAction() in the document keydown handler to reflect the new
  // binding immediately, without requiring a page reload (AD-CB-06).
  document.addEventListener("markable-keybindings-changed", (e: Event) => {
    const detail = (e as CustomEvent<{ keybindings: Record<string, string> }>).detail;
    if (detail?.keybindings) {
      // updateSettings expects a pure updater function, not a partial object.
      // Spread the current settings and overwrite only the keybindings field.
      void updateSettings((s) => ({ ...s, keybindings: detail.keybindings }));
    }
  });

  // Show the window now that everything is rendered
  await showWindow();

  console.log("Markable initialized successfully");
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}

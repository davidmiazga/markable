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
import { previewCompartment, previewExtensions } from "./editor/extensions";
import { setViewMode } from "./editor/live-preview";
import { createFindWidget } from "./editor/find-widget";
import type { FindWidget } from "./editor/find-widget";
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
import { registerStatusBarDependent, ensureStatusBar } from "./plugins/status-bar/status-bar";
import {
  readResourceFile,
  openFileDialog,
  openFolderDialog,
  updateRecentFilesMenu,
  listThemes,
  readThemeCss,
  updateThemeMenu,
  copyCorePlugins,
} from "./lib/bridge";
import type { ThemeEntry } from "./lib/bridge";
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
import { createSettingsPanel, toggleSettingsPanel } from "./settings/settings-panel";
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
import { openExportDialog, printDocument } from "./lib/export";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import "@fontsource/inter/400.css";
import "@fontsource/inter/400-italic.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./styles.css";

// Global editor instance. currentFilePath, isDirty, isReadOnly, setDirty(),
// setCurrentFile(), and updateTitleBar() were all removed in step_07 — their
// responsibilities now belong to TabManager (_updateTitleBar, markActiveTabDirty,
// getActiveFilePath, openFileInTab, saveActiveTab, saveActiveTabAs).
let editor: ReturnType<typeof createEditor> = null;
let previewEnabled = true;
/** Floating find/replace widget. Initialized in initApp() after editor is ready. */
let findWidget: FindWidget | null = null;

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

  // Custom themes build on top of dark base
  document.documentElement.setAttribute("data-theme", "dark");
  injectCustomStylesheet(css);
  return true;
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
  await tabManager.openFileInTab(result.path);
  await refreshRecentFilesMenu();
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
  await tabManager.openFileInTab(path);
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
  const opened = await tabManager.openFileInTab(path);

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


/**
 * Central action dispatcher — shared by the native menu-event listener and
 * the custom keybinding document keydown handler.
 */
function handleAction(action: string): void {
  switch (action) {
    case "app-settings":    toggleSettingsPanel();    break;
    case "app-keybindings": toggleKeybindingsPanel(); break;
    case "app-plugins":
      togglePluginsPanel(pluginManager.getStates());
      break;

    // Command Bar plugin open dispatch (AD-03 in command-bar/00_index.md).
    // The plugin registers window.__MARKABLE_COMMAND_BAR_OPEN__ at onEnable and
    // sets it to null at onDisable. If the plugin is off, the global is null and
    // this is a safe no-op (EC-19).
    case "command-bar-open": {
      const openCB = (window as any).__MARKABLE_COMMAND_BAR_OPEN__;
      if (typeof openCB === "function") openCB();
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
    case "view-toggle-preview":    togglePreview();      break;
    case "view-toggle-statusbar":
      if (editor) void pluginManager.toggle("status-bar", !pluginManager.getStates()["status-bar"]);
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
    default: {
      if (action.startsWith("recent-file-")) {
        const idx = parseInt(action.replace("recent-file-", ""), 10);
        const files = getCurrentSettings().recentFiles;
        if (idx >= 0 && idx < files.length) void openRecentFileByPath(files[idx]);
      } else if (action.startsWith("custom:")) {
        void setTheme(action);
      }
      break;
    }
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

  // Load all plugins (core + user) from disk. Must run after setEditorView()
  // so any plugin calling api.addExtensions() in onEnable has a live view.
  // Errors are isolated per-plugin — a failing plugin does not block the rest.
  await pluginManager.loadPlugins(migratedSettings, statusBarZones);

  // Restore persisted sidebar state (open/closed, active tab) after all
  // plugins have been loaded. EC-23: this runs after loadPlugins so we only
  // restore "open" state if at least one panel was actually registered.
  restoreSidebarFromSettings();

  // Initialize the tab manager. Must run after initSidebar() (which creates
  // #app-row) and after editor creation. TabManager reads settings to restore
  // the previous session and mounts the MinimalTabBar renderer into #tab-strip.
  await tabManager.init(editor);

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
        }
      })
    ),
  });

  // List style status bar indicator (FR-3).
  // Registers as a status bar dependent so the bar auto-shows when this
  // feature is active. Creates a clickable indicator in the left zone.
  registerStatusBarDependent("list-style-indicator");
  ensureStatusBar();
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

  // Update the native Theme menu with custom themes
  if (customThemes.length > 0) {
    await updateThemeMenu(customThemes);
  }

  // Apply persisted theme before window.show() (no-flash)
  await setTheme(migratedSettings.theme.active, false);

  // Create the floating find/replace widget (appended to document.body, hidden by default).
  // Must be created after `editor` is confirmed non-null.
  findWidget = createFindWidget(editor);

  // Create settings panel (DOM injection, hidden by default)
  createSettingsPanel();

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
  await getCurrentWebviewWindow().onDragDropEvent(async (event) => {
    if (event.payload.type !== "drop") return;
    const paths = event.payload.paths.filter(
      (p) => p.endsWith(".md") || p.endsWith(".txt")
    );
    if (paths.length === 0) return;
    for (const path of paths) {
      await tabManager.openFileInTab(path);
    }
    await refreshRecentFilesMenu();
  });

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

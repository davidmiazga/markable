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
import { previewCompartment, previewExtensions, editableCompartment } from "./editor/extensions";
import { setLivePreviewFilePath, setViewMode } from "./editor/live-preview";
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
import {
  readFile,
  writeFile,
  readResourceFile,
  openFileDialog,
  saveFileDialog,
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
  addRecentFile,
  removeRecentFile,
  EDITOR_CONSTRAINTS,
} from "./lib/settings";
import { createSettingsPanel, toggleSettingsPanel } from "./settings/settings-panel";
import { createKeybindingsPanel, toggleKeybindingsPanel, eventMatchesKey } from "./keybindings/keybindings-panel";
import {
  createPluginsPanel,
  togglePluginsPanel,
  updateUserPluginDefs,
} from "./plugins/plugins-panel/plugins-panel";
import { pluginManager } from "./plugins/index";
import { migratePluginSettings } from "./plugins/settings-migration";
import { exportAsHtml, markdownToHtml, MINIMAL_CSS } from "./lib/export";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import "@fontsource/inter/400.css";
import "@fontsource/inter/400-italic.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "./styles.css";

// Global editor instance and current file path
let editor: ReturnType<typeof createEditor> = null;
let currentFilePath: string | null = null;
let previewEnabled = true;
/** Set to true when a read-only help file is loaded; cleared on any editable file open. */
let isReadOnly = false;
/** Floating find/replace widget. Initialized in initApp() after editor is ready. */
let findWidget: FindWidget | null = null;
/** True when the document has unsaved changes. */
let isDirty = false;

function getFileName(path: string): string {
  return path.split("/").pop() || path;
}

function updateTitleBar(override?: string) {
  const titleEl = document.getElementById("titlebar-title");
  const baseName = override ?? (currentFilePath ? getFileName(currentFilePath) : "Untitled");
  if (titleEl) {
    titleEl.textContent = isDirty ? `${baseName} •` : baseName;
  }
}

function setDirty(dirty: boolean) {
  if (isDirty === dirty) return;
  isDirty = dirty;
  updateTitleBar();
}

function setCurrentFile(path: string | null) {
  currentFilePath = path;
  setLivePreviewFilePath(path);
  updateTitleBar();
}

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
  editor.dispatch({
    effects: previewCompartment.reconfigure(
      previewEnabled ? previewExtensions : []
    ),
  });
  document.getElementById("editor")?.classList.toggle("preview-mode", previewEnabled);
  console.log(`Preview mode: ${previewEnabled ? "ON" : "OFF"}`);
}

function newFile() {
  if (editor) {
    // FR-11.1: Close the FindWidget and clear the CM6 search state before
    // replacing the document. A `changes`-only transaction does NOT reset
    // StateField values in CM6, so stale highlights from the previous file
    // would remain visible unless we clear explicitly.
    findWidget?.close();
    findWidget?.clearQuery();
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: "" },
      effects: editableCompartment.reconfigure(EditorView.editable.of(true)),
    });
  }
  setCurrentFile(null);
  isReadOnly = false;
  setDirty(false);
}

/**
 * Open a bundled help resource file read-only inside the editor.
 * @param filename  Bare filename, e.g. "quickstart.md"
 * @param title     Title bar label, e.g. "Quickstart"
 */
async function openHelpFile(filename: string, title: string) {
  if (!editor) return;
  try {
    const content = await readResourceFile(filename);
    findWidget?.close();
    findWidget?.clearQuery();
    isReadOnly = true;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: content },
      effects: editableCompartment.reconfigure(EditorView.editable.of(false)),
    });
    setCurrentFile(null);
    setDirty(false);
    updateTitleBar(title);
  } catch (e) {
    console.error("openHelpFile error:", e);
    alert(`Could not open help file: ${filename}\n\n${String(e)}`);
  }
}

async function openFile() {
  console.log("Open file dialog triggered");

  const result = await openFileDialog();

  if (result.cancelled) {
    console.log("User cancelled file open dialog");
    return;
  }

  const path = result.path;
  console.log(`Opening file: ${path}`);

  // Read file contents
  const readResult = await readFile(path);

  if (!readResult.ok) {
    alert(`Error opening file: ${readResult.error.message}`);
    return;
  }

  // Set file path BEFORE dispatch so buildDecorations can resolve relative images
  isReadOnly = false;
  setCurrentFile(path);

  // Load into editor
  if (editor) {
    const content = readResult.value;
    findWidget?.close();
    findWidget?.clearQuery();
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: content },
      effects: editableCompartment.reconfigure(EditorView.editable.of(true)),
    });
    editor.dispatch({ effects: setViewMode.of(true) });
    editor.contentDOM.blur();
  }
  setDirty(false);
  await addRecentFile(path);
  await refreshRecentFilesMenu();

  console.log(`File loaded: ${path}`);
}

/**
 * Load a file by absolute path (no dialog).
 * Used when Rust opens the file dialog itself (hidden-window case)
 * and sends the selected path via the "open-file-path" event.
 */
async function openFileByPath(path: string): Promise<void> {
  const readResult = await readFile(path);
  if (!readResult.ok) {
    alert(`Error opening file: ${readResult.error.message}`);
    return;
  }

  // Set file path BEFORE dispatch so buildDecorations can resolve relative images
  isReadOnly = false;
  setCurrentFile(path);

  if (editor) {
    findWidget?.close();
    findWidget?.clearQuery();
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: readResult.value },
      effects: editableCompartment.reconfigure(EditorView.editable.of(true)),
    });
    // Enter view mode — all lines render in preview until the user clicks
    editor.dispatch({ effects: setViewMode.of(true) });
    editor.contentDOM.blur();
  }

  setDirty(false);
  await addRecentFile(path);
  await refreshRecentFilesMenu();
  console.log(`File loaded (by path): ${path}`);
}

/**
 * Save editor contents to file
 */
async function saveFile() {
  if (isReadOnly) return;
  // If no current file, use save-as dialog
  if (!currentFilePath) {
    return saveFileAs();
  }

  console.log(`Saving file: ${currentFilePath}`);

  // Get editor content
  if (!editor) {
    alert("Editor not ready");
    return;
  }

  const content = editor.state.doc.toString();

  // Write to file
  const result = await writeFile(currentFilePath, content);

  if (!result.ok) {
    alert(`Error saving file: ${result.error.message}`);
    return;
  }

  console.log(`File saved: ${currentFilePath}`);
  setDirty(false);
  await addRecentFile(currentFilePath);
  await refreshRecentFilesMenu();
}

/**
 * Save editor contents to a new file (save-as)
 */
async function saveFileAs() {
  console.log("Save As dialog triggered");

  const result = await saveFileDialog();

  if (result.cancelled) {
    console.log("User cancelled save dialog");
    return;
  }

  const path = result.path;
  console.log(`Saving to: ${path}`);

  if (!editor) {
    alert("Editor not ready");
    return;
  }

  const content = editor.state.doc.toString();

  // Write to file
  const writeResult = await writeFile(path, content);

  if (!writeResult.ok) {
    alert(`Error saving file: ${writeResult.error.message}`);
    return;
  }

  // Update current file path and title bar
  setCurrentFile(path);
  setDirty(false);
  await addRecentFile(path);
  await refreshRecentFilesMenu();

  console.log(`File saved: ${path}`);
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

async function openRecentFileByPath(path: string): Promise<void> {
  const result = await readFile(path);
  if (!result.ok) {
    console.warn(`Recent file not found: ${path}`);
    await removeRecentFile(path);
    await refreshRecentFilesMenu();
    return;
  }

  // Set file path BEFORE dispatch so buildDecorations can resolve relative images
  setCurrentFile(path);

  if (editor) {
    findWidget?.close();
    findWidget?.clearQuery();
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: result.value },
    });
    editor.dispatch({ effects: setViewMode.of(true) });
    editor.contentDOM.blur();
  }
  setDirty(false);
  await addRecentFile(path);
  await refreshRecentFilesMenu();
  console.log(`Opened recent: ${path}`);
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

/**
 * Print the current document.
 * Injects a rendered HTML overlay + print-only stylesheet, calls window.print(),
 * then removes the overlay. The @media print rules hide the editor and show
 * only the rendered content.
 */
function printDocument(): void {
  if (!editor) return;
  const html = markdownToHtml(editor.state.doc.toString());

  // Inject print-only stylesheet
  const style = document.createElement("style");
  style.id = "markable-print-style";
  style.textContent = `
    @media print {
      body > *:not(#markable-print-overlay) { display: none !important; }
      #markable-print-overlay {
        display: block !important;
        position: static !important;
      }
    }
  `;
  document.head.appendChild(style);

  // Inject rendered content overlay (hidden on screen, visible in print)
  const overlay = document.createElement("div");
  overlay.id = "markable-print-overlay";
  overlay.style.cssText = "display:none";
  overlay.innerHTML = `<style>${MINIMAL_CSS}</style><div class="content">${html}</div>`;
  document.body.appendChild(overlay);

  window.print();

  // Clean up after print dialog closes
  style.remove();
  overlay.remove();
}

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
    case "file-new":        newFile();                break;
    case "file-open":       void openFile();          break;
    case "file-save":       void saveFile();          break;
    case "file-save-as":    void saveFileAs();        break;
    case "file-close-all":
      // Clear editor state. Rust already hid the window before emitting this.
      newFile();
      break;
    case "file-import":     void openFile();          break;
    case "file-export":     void exportAsHtml(editor, currentFilePath); break;
    case "file-print":      printDocument(); break;
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
    case "help-quickstart": void openHelpFile("quickstart.md", "Quickstart"); break;
    case "help-help":       void openHelpFile("help.md", "Help");             break;
    case "help-cheatsheet": void openHelpFile("markdown-cheatsheet.md", "Markdown Cheatsheet"); break;
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

  // Load all plugins (core + user) from disk. Must run after setEditorView()
  // so any plugin calling api.addExtensions() in onEnable has a live view.
  // Errors are isolated per-plugin — a failing plugin does not block the rest.
  await pluginManager.loadPlugins(migratedSettings, statusBarZones);

  // Attach dirty-state tracking to the editor via updateListener.
  // The word-count plugin owns its own updateListener via api.addExtensions().
  editor.dispatch({
    effects: StateEffect.appendConfig.of(
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !isReadOnly) {
          setDirty(true);
        }
      })
    ),
  });

  // Auto-focus the editor so the cursor is blinking immediately
  editor.focus();

  // Discover custom themes from the themes directory
  customThemes = await listThemes();
  buildThemeOrder();
  console.log(`Found ${customThemes.length} custom theme(s)`);

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

  // Drag & drop: open .md / .txt files dropped onto the window
  await getCurrentWebviewWindow().onDragDropEvent(async (event) => {
    if (event.payload.type !== "drop") return;
    const paths = event.payload.paths.filter(
      (p) => p.endsWith(".md") || p.endsWith(".txt")
    );
    if (paths.length === 0) return;
    await openFileByPath(paths[0]);
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
    // Custom keybinding overrides — fire before any default handler
    if (!e.defaultPrevented) {
      const custom = getCurrentSettings().keybindings ?? {};
      for (const [actionId, keyStr] of Object.entries(custom)) {
        if (eventMatchesKey(e, keyStr)) {
          e.preventDefault();
          e.stopPropagation();
          handleAction(actionId);
          return;
        }
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
    if (editor) editor.focus();
  });

  // Respond to OS dark/light mode changes when "system" theme is active
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getCurrentSettings().theme.active === "system") {
      applyBundledTheme("system");
    }
  });

  updateTitleBar();

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

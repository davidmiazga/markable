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

import { createEditor } from "./editor/editor";
import { previewCompartment, previewExtensions } from "./editor/extensions";
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
} from "./editor/format";
import {
  readFile,
  writeFile,
  openFileDialog,
  saveFileDialog,
  updateRecentFilesMenu,
  listThemes,
  readThemeCss,
  updateThemeMenu,
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
import { exportAsHtml } from "./lib/export";
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
/** Floating find/replace widget. Initialized in initApp() after editor is ready. */
let findWidget: FindWidget | null = null;

function getFileName(path: string): string {
  return path.split("/").pop() || path;
}

function updateTitleBar() {
  const titleEl = document.getElementById("titlebar-title");
  const displayName = currentFilePath ? getFileName(currentFilePath) : "Untitled";
  if (titleEl) {
    titleEl.textContent = displayName;
  }
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
    });
  }
  currentFilePath = null;
  updateTitleBar();
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

  // Load into editor
  if (editor) {
    const content = readResult.value;
    // FR-11.1 / EC-12: Close the FindWidget and clear CM6 search state before
    // replacing the document. A changes-only transaction does not reset
    // StateField values, so stale highlights from the previous file would
    // remain visible without this explicit clear.
    findWidget?.close();
    findWidget?.clearQuery();
    const transaction = editor.state.update({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: content,
      },
    });
    editor.dispatch(transaction);
  }

  // Update current file and title bar
  currentFilePath = path;
  updateTitleBar();
  await addRecentFile(path);
  await refreshRecentFilesMenu();

  console.log(`File loaded: ${path}`);
}

/**
 * Save editor contents to file
 */
async function saveFile() {
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
  updateTitleBar();
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
  currentFilePath = path;
  updateTitleBar();
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

  if (editor) {
    // FR-11.1 / EC-12: Close the FindWidget and clear CM6 search state before
    // replacing the document. Changes-only transactions do not reset StateField
    // values, so stale highlights from the previous file would remain visible
    // without this explicit clear.
    findWidget?.close();
    findWidget?.clearQuery();
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: result.value },
    });
  }
  currentFilePath = path;
  updateTitleBar();
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
 * Initialize the application
 */
async function initApp() {
  console.log("Initializing Markable 2.0...");

  // Load settings from disk before any UI (TC-5: read before show)
  const settings = await loadSettings();
  console.log("Settings loaded, schema version:", settings.version);

  // Apply window position/size before anything is visible
  await applyWindowSettings(settings.window);

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

  // Apply editor settings (content width + font size)
  applyEditorSettings(settings.editor);

  // Preview mode starts ON — hide line numbers
  editorContainer.classList.add("preview-mode");

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
  await setTheme(settings.theme.active, false);

  // Create the floating find/replace widget (appended to document.body, hidden by default).
  // Must be created after `editor` is confirmed non-null.
  findWidget = createFindWidget(editor);

  // Create settings panel (DOM injection, hidden by default)
  createSettingsPanel((name) => setTheme(name), customThemes);

  // Populate the native Open Recent submenu with persisted files
  await refreshRecentFilesMenu();

  // Track window move/resize for settings persistence
  await setupWindowStateListeners();

  // Listen for menu events from Rust
  await listen<{ action: string }>("menu-event", (event) => {
    switch (event.payload.action) {
      case "app-settings":
        toggleSettingsPanel();
        break;
      case "file-new":
        newFile();
        break;
      case "file-open":
        openFile();
        break;
      case "file-save":
        saveFile();
        break;
      case "file-save-as":
        saveFileAs();
        break;
      case "file-close-all":
        // AC-C1: hide the window rather than destroying it.
        // EC-C2: Tauri hide() is safe on an already-hidden window (no-op).
        // void prefix: hide() returns Promise<void>; not awaited in this
        // synchronous event listener.
        void getCurrentWebviewWindow().hide();
        break;
      case "file-export":
        // FR-2.2: void-prefix keeps the async call from producing an unhandled
        // promise in the synchronous switch/event-listener context.
        // AC-20: exportAsHtml never modifies currentFilePath.
        void exportAsHtml(editor, currentFilePath);
        break;
      case "view-toggle-preview":
        togglePreview();
        break;
      case "theme-next":
        nextTheme();
        break;
      case "theme-prev":
        prevTheme();
        break;
      case "theme-light":
        setTheme("default-light");
        break;
      case "theme-dark":
        setTheme("default-dark");
        break;
      case "theme-system":
        setTheme("system");
        break;
      case "view-zoom-in":
        zoomIn();
        break;
      case "view-zoom-out":
        zoomOut();
        break;
      case "view-zoom-reset":
        zoomReset();
        break;
      case "format-h1": if (editor) toggleHeading(editor, 1); break;
      case "format-h2": if (editor) toggleHeading(editor, 2); break;
      case "format-h3": if (editor) toggleHeading(editor, 3); break;
      case "format-h4": if (editor) toggleHeading(editor, 4); break;
      case "format-h5": if (editor) toggleHeading(editor, 5); break;
      case "format-h6": if (editor) toggleHeading(editor, 6); break;
      case "format-bold": if (editor) toggleInlineWrap(editor, "**"); break;
      case "format-italic": if (editor) toggleInlineWrap(editor, "*"); break;
      case "format-underline": if (editor) toggleInlineWrap(editor, "__"); break;
      case "format-strikethrough": if (editor) toggleInlineWrap(editor, "~~"); break;
      case "format-highlight": if (editor) toggleInlineWrap(editor, "=="); break;
      case "format-link":
      case "edit-paste-link": {
        if (!editor) break;
        const { from, to } = editor.state.selection.main;
        if (from !== to) {
          const label = editor.state.doc.sliceString(from, to);
          const insert = `[${label}]()`;
          editor.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length - 1 },
          });
        } else {
          editor.dispatch({
            changes: { from, to, insert: `[]()` },
            selection: { anchor: from + 1 },
          });
        }
        break;
      }
      case "format-code-fence": if (editor) insertCodeFence(editor); break;
      case "format-quote": if (editor) toggleLinePrefix(editor, "> "); break;
      case "format-bullet-list": if (editor) toggleLinePrefix(editor, "- "); break;
      case "format-ordered-list": if (editor) toggleOrderedList(editor); break;
      case "format-task-list": if (editor) toggleTaskList(editor); break;
      case "format-indent": if (editor) indentLines(editor); break;
      case "format-outdent": if (editor) outdentLines(editor); break;
      case "format-hr": if (editor) insertHorizontalRule(editor); break;
      case "format-clear": if (editor) clearFormatting(editor); break;
      case "edit-paste-plain": if (editor) pasteWithoutFormatting(editor); break;
      case "edit-copy-plain": if (editor) copyAsPlainText(editor); break;
      case "edit-copy-html": if (editor) copyAsHtml(editor); break;

      // EC-1: guard against editor / findWidget not yet initialized
      case "edit-find":
        if (!editor || !findWidget) break;
        {
          // FR-5.1 / FR-5.2: Pre-fill the find input with the current selection
          // if one exists. This spares the user from having to retype the term.
          const sel = editor.state.selection.main;
          if (sel.from !== sel.to) {
            const selectedText = editor.state.sliceDoc(sel.from, sel.to);
            // FR-5.3 / EC-13: Truncate multi-line selections to the first line
            // so the find input stays single-line and the SearchQuery is valid.
            findWidget.setPreFill(selectedText);
          }
          findWidget.open("find");
        }
        break;

      // EC-16: guard against editor / findWidget not yet initialized
      case "edit-find-replace":
        if (!editor || !findWidget) break;
        {
          // FR-5.1 / FR-5.2: Same pre-fill logic as edit-find.
          const sel = editor.state.selection.main;
          if (sel.from !== sel.to) {
            const selectedText = editor.state.sliceDoc(sel.from, sel.to);
            // FR-5.3 / EC-13: First line only for multi-line selections.
            findWidget.setPreFill(selectedText);
          }
          findWidget.open("replace");
        }
        break;

      default: {
        const action = event.payload.action;
        if (action.startsWith("recent-file-")) {
          const idx = parseInt(action.replace("recent-file-", ""), 10);
          const files = getCurrentSettings().recentFiles;
          if (idx >= 0 && idx < files.length) {
            openRecentFileByPath(files[idx]);
          }
        } else if (action.startsWith("custom:")) {
          setTheme(action);
        }
        break;
      }
    }
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

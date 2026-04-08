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
} from "./editor/format";
import {
  readFile,
  writeFile,
  openFileDialog,
  saveFileDialog,
} from "./lib/bridge";
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
let currentTheme: "light" | "dark" | "system" = "system";

/**
 * Extract just the filename from a full path.
 *
 * @param path - Full file path (e.g., "/Users/me/docs/notes.md")
 * @returns Just the filename (e.g., "notes.md")
 */
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

function setTheme(theme: "light" | "dark" | "system") {
  currentTheme = theme;
  if (theme === "system") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
  console.log(`Theme: ${theme}`);
}

const themeOrder: Array<"light" | "dark" | "system"> = ["light", "dark", "system"];

function nextTheme() {
  setTheme(themeOrder[(themeOrder.indexOf(currentTheme) + 1) % themeOrder.length]);
}

function prevTheme() {
  setTheme(themeOrder[(themeOrder.indexOf(currentTheme) - 1 + themeOrder.length) % themeOrder.length]);
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

/**
 * Initialize the application
 */
async function initApp() {
  console.log("Initializing Markable 2.0...");

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

  // Preview mode starts ON — hide line numbers
  editorContainer.classList.add("preview-mode");

  // Auto-focus the editor so the cursor is blinking immediately
  editor.focus();

  // Default to system theme
  setTheme("system");

  // Listen for menu events from Rust
  await listen<{ action: string }>("menu-event", (event) => {
    switch (event.payload.action) {
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
        setTheme("light");
        break;
      case "theme-dark":
        setTheme("dark");
        break;
      case "theme-system":
        setTheme("system");
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
      case "format-code-fence": if (editor) insertCodeFence(editor); break;
      case "format-quote": if (editor) toggleLinePrefix(editor, "> "); break;
      case "format-bullet-list": if (editor) toggleLinePrefix(editor, "- "); break;
      case "format-ordered-list": if (editor) toggleOrderedList(editor); break;
      case "format-task-list": if (editor) toggleTaskList(editor); break;
      case "format-indent": if (editor) indentLines(editor); break;
      case "format-outdent": if (editor) outdentLines(editor); break;
      case "format-hr": if (editor) insertHorizontalRule(editor); break;
      case "format-clear": if (editor) clearFormatting(editor); break;
    }
  });

  // Re-focus editor when window regains focus
  window.addEventListener("focus", () => {
    if (editor) editor.focus();
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

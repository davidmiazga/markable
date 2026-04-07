/**
 * Markable 2.0 — Main Entry Point
 *
 * Initializes the application:
 * 1. Waits for DOM to be ready
 * 2. Creates the CodeMirror editor
 * 3. Sets up event listeners for file operations
 */

import { createEditor } from "./editor/editor";
import {
  readFile,
  writeFile,
  openFileDialog,
  saveFileDialog,
} from "./lib/bridge";
import "./styles.css";

// Global editor instance and current file path
let editor: ReturnType<typeof createEditor> = null;
let currentFilePath: string | null = null;

/**
 * Load file contents into editor
 */
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

  // Update current file and display name
  currentFilePath = path;
  updateFileNameDisplay();

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
  updateFileNameDisplay();
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

  // Update current file path
  currentFilePath = path;
  updateFileNameDisplay();

  console.log(`File saved: ${path}`);
}

/**
 * Update the file name display in toolbar
 */
function updateFileNameDisplay() {
  const fileNameEl = document.getElementById("file-name");
  if (fileNameEl) {
    if (currentFilePath) {
      // Extract just the filename from the path
      const fileName = currentFilePath.split("/").pop() || currentFilePath;
      fileNameEl.textContent = `Editing: ${fileName}`;
    } else {
      fileNameEl.textContent = "";
    }
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
  editor = createEditor(
    editorContainer,
    "# Welcome to Markable 2.0\n\nUse the buttons above to open and save files."
  );
  if (!editor) {
    console.error("Failed to initialize editor");
    return;
  }

  // Set up file dialog button listeners
  const openBtn = document.getElementById("btn-open");
  const saveBtn = document.getElementById("btn-save");

  if (openBtn) {
    openBtn.addEventListener("click", openFile);
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", saveFile);
  }

  console.log("Markable initialized successfully");
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}

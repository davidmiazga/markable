/**
 * Markable 2.0 — Main entry point
 *
 * Initializes the application:
 * 1. Creates the CodeMirror editor
 * 2. Sets up event listeners
 */

import { createEditor } from "./editor/editor";
import "./styles.css";

let editor: ReturnType<typeof createEditor> = null;

/**
 * Initialize the application
 */
function initApp(): void {
  console.log("Initializing Markable 2.0...");

  // Get editor container
  const editorContainer = document.getElementById("editor");
  if (!editorContainer) {
    console.error("Editor container #editor not found in DOM");
    return;
  }

  // Create editor instance
  const welcomeText =
    "# Welcome to Markable 2.0\n\nStart editing your Markdown here.";
  editor = createEditor(editorContainer, welcomeText);

  if (!editor) {
    console.error("Failed to initialize editor");
    return;
  }

  console.log("Markable initialized successfully");
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}

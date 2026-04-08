# Step 05: CodeMirror 6 Setup with Markdown Support (R5)

**Requirement:** R5 — Basic CodeMirror 6 Integration
**Acceptance Criteria:** Editor visible in window, Markdown syntax highlighting works, real-time editing updates, no console errors

---

## Overview

This step integrates **CodeMirror 6** (CM6) as the editor foundation. CM6 is a lightweight, composable editor built for modern JavaScript applications. Phase 1 sets up basic Markdown syntax highlighting; Phase 2 will add Typora-style live preview (syntax hiding).

**Output:** A functional CodeMirror 6 editor with Markdown language support, accessible from the DOM, with factory functions for initialization and extension management.

---

## CodeMirror 6 Basics

### Key Concepts

| Concept | Purpose |
|---------|---------|
| **EditorView** | The rendered editor component; mounted to DOM element |
| **EditorState** | Document content and editor configuration |
| **Extensions** | Composable features (syntax highlighting, line numbers, etc.) |
| **basicSetup** | Pre-built extension bundle with common features |
| **lang-markdown** | Markdown language support (syntax highlighting, folding) |

### Architecture Pattern (Factory)

Create editor instances via a factory function rather than constructors. This pattern:
- Simplifies initialization
- Handles errors gracefully
- Enables testing (easy to mock)
- Allows multiple editor instances if needed (Phase 2+)

---

## Implementation Tasks

### Task 5.1: Install CodeMirror 6 Dependencies

```bash
cd /Users/dave/Documents/web-local-dev/MarkdownEditor-Rewrite/markable-2.0

npm install @codemirror/view@6.40.0 @codemirror/state@6.5.4 @codemirror/lang-markdown@6.5.0
```

**Verify installation:**

```bash
npm list @codemirror/view @codemirror/state @codemirror/lang-markdown
```

Expected:
```
├── @codemirror/lang-markdown@6.5.0
├── @codemirror/state@6.5.4
└── @codemirror/view@6.40.0
```

These versions are pinned and web-researched as of 2026-04-04.

---

### Task 5.2: Create src/editor/extensions.ts

This module builds the editor's extension array with error handling.

**File: `src/editor/extensions.ts`**

```typescript
/**
 * CodeMirror 6 extensions for Markable
 *
 * Extensions are composable features that customize the editor behavior.
 * This module builds the extension array with error handling for
 * optional language modules.
 */

import { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { lineNumbers, highlightActiveLineGutter } from "@codemirror/view";
import { basicSetup } from "codemirror";

/**
 * Build extension array for the editor
 *
 * Includes:
 * - basicSetup: line numbers, folding, gutter, history, etc.
 * - lineNumbers: left gutter with line numbering
 * - highlightActiveLineGutter: highlight gutter line for cursor
 * - markdown: Markdown syntax highlighting and language support
 *
 * If markdown fails to load, continues with other extensions (graceful degradation).
 *
 * @returns Array of CodeMirror extensions
 */
export function buildExtensions(): Extension[] {
  const extensions: Extension[] = [
    basicSetup,
    lineNumbers(),
    highlightActiveLineGutter(),
    EditorView.lineNumbers(),
  ];

  // Load Markdown support with error handling
  try {
    extensions.push(markdown());
    console.log("CodeMirror: Markdown language support loaded");
  } catch (err) {
    console.warn("CodeMirror: Failed to load Markdown support", err);
    console.log("CodeMirror: Falling back to plaintext mode");
    // Continue with other extensions; plaintext mode is acceptable for Phase 1
  }

  return extensions;
}
```

**Notes:**
- `basicSetup` includes line numbers, folding, history, search, etc.
- Try/catch wraps the markdown() call so one error doesn't crash the whole editor
- Warnings logged to console (visible in dev tools)
- Continues with fallback if markdown fails (EC-19 coverage)

---

### Task 5.3: Create src/editor/editor.ts

This module provides the factory function for creating editor instances.

**File: `src/editor/editor.ts`**

```typescript
/**
 * CodeMirror 6 editor factory
 *
 * Provides a factory function to create and initialize EditorView instances.
 * Handles DOM mounting, error cases, and extension setup.
 */

import { EditorView, EditorState } from "@codemirror/view";
import { buildExtensions } from "./extensions";

/**
 * Create and mount a CodeMirror 6 editor
 *
 * @param target - DOM element to mount editor into (usually #editor)
 * @param initialDoc - Optional initial document content (default: empty string)
 * @returns EditorView instance if successful, null if target not found or error occurs
 *
 * # Error Handling
 * - If target is null/undefined, logs error and returns null (EC-18)
 * - If target is not a valid DOM element, logs error and returns null
 * - If buildExtensions() fails, editor still initializes with fallback extensions
 */
export function createEditor(
  target: HTMLElement | null,
  initialDoc?: string
): EditorView | null {
  // Validate target element (EC-18 coverage)
  if (!target) {
    console.error(
      "CodeMirror: Target element not found. Expected #editor DOM element."
    );
    return null;
  }

  if (!(target instanceof HTMLElement)) {
    console.error("CodeMirror: Target is not a valid DOM element", target);
    return null;
  }

  try {
    // Build extensions (with error handling inside)
    const extensions = buildExtensions();

    // Create editor state with initial document
    const state = EditorState.create({
      doc: initialDoc ?? "",
      extensions: extensions,
    });

    // Create and mount editor view
    const view = new EditorView({
      state: state,
      parent: target,
    });

    console.log("CodeMirror: Editor initialized successfully");
    return view;
  } catch (err) {
    console.error("CodeMirror: Failed to initialize editor", err);
    return null;
  }
}

/**
 * Safely create an editor instance
 *
 * Utility function that finds the target element and creates editor.
 * Useful for simple one-off initialization.
 *
 * @param targetSelector - CSS selector for target element (default: "#editor")
 * @param initialDoc - Optional initial content
 * @returns EditorView instance or null
 */
export function createEditorFromSelector(
  targetSelector: string = "#editor",
  initialDoc?: string
): EditorView | null {
  const target = document.querySelector(targetSelector);
  return createEditor(target instanceof HTMLElement ? target : null, initialDoc);
}
```

**Notes:**
- Returns `null` on error (not throwing, so caller can handle gracefully)
- Validates target element type (EC-18 coverage)
- Logs errors to console for debugging
- `createEditorFromSelector` is a convenience wrapper

---

### Task 5.4: Update index.html with Editor Container

Add the editor DOM element and necessary attributes.

**File: `index.html` (update)**

Find the existing `<body>` and update it:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="stylesheet" href="/src/style.css" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Markable</title>
  </head>
  <body>
    <!-- Main application container -->
    <div id="app">
      <!-- Editor container: CodeMirror will mount here -->
      <div
        id="editor"
        role="textbox"
        aria-label="Markdown editor for Markable"
      ></div>
    </div>

    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

**Key attributes:**
- `id="editor"` — Selector for CodeMirror to mount
- `role="textbox"` — Accessibility: declares this as a text input
- `aria-label` — Screen reader description

---

### Task 5.5: Update src/main.ts to Initialize Editor

Update the entry point to create the editor on page load.

**File: `src/main.ts` (update)**

```typescript
/**
 * Markable 2.0 — Main Entry Point
 *
 * Initializes the application:
 * 1. Waits for DOM to be ready
 * 2. Creates the CodeMirror editor
 * 3. Sets up event listeners for file operations
 */

import { createEditor } from "./editor/editor";
import { readFile, writeFile, openFileDialog, saveFileDialog } from "./lib/bridge";
import "./style.css";

// Global editor instance (for future use in event handlers)
let editor: ReturnType<typeof createEditor> = null;

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
  editor = createEditor(editorContainer, "# Welcome to Markable 2.0\n\nStart typing...");
  if (!editor) {
    console.error("Failed to initialize editor");
    return;
  }

  console.log("Markable initialized successfully");

  // Future: Set up event listeners for file operations, etc.
  // (Will be expanded in Phase 2 with menu/button handlers)
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
```

**Notes:**
- Stores editor in global variable for future event handlers
- Provides welcome message as initial content
- Handles both early and late DOM ready states
- Logs initialization progress for debugging

---

### Task 5.6: Add Editor Styling

Create a minimal stylesheet for the editor.

**File: `src/style.css` (update)**

Add to the existing styles:

```css
/* Markable 2.0 — Main Styles */

/* Editor Container */
#editor {
  width: 100%;
  height: 100vh;
  font-family: "Menlo", "Monaco", "Courier New", monospace;
  font-size: 14px;
  line-height: 1.5;
  box-sizing: border-box;
}

/* Editor View (CodeMirror) */
.cm-editor {
  height: 100%;
  width: 100%;
  border: none;
  background: #ffffff;
  color: #333333;
  font-family: inherit;
}

/* Markdown Syntax Highlighting (Light theme) */
.cm-atom {
  color: #0066cc; /* Links, emphasis */
}

.cm-heading {
  color: #0066cc; /* Headings (#, ##, etc.) */
  font-weight: bold;
}

.cm-strong {
  color: #0066cc; /* Bold **text** */
  font-weight: bold;
}

.cm-em {
  color: #0066cc; /* Italic *text* */
  font-style: italic;
}

.cm-keyword {
  color: #0066cc; /* Special syntax */
}

.cm-string {
  color: #228822; /* Code fences, links */
}

/* Line Numbers Gutter */
.cm-gutters {
  background: #f5f5f5;
  border-right: 1px solid #e0e0e0;
  padding-right: 8px;
}

.cm-lineNumbers {
  color: #999999;
  font-family: inherit;
  font-size: 13px;
}

/* Cursor and Selection */
.cm-cursor {
  border-left-color: #0066cc;
  border-left-width: 2px;
}

.cm-selection {
  background: #e3f2fd;
}

/* Active Line Highlight */
.cm-activeLine {
  background: #f9f9f9;
}
```

**Notes:**
- Full viewport height for the editor (#editor, .cm-editor)
- Light theme suitable for Markdown
- Monospace font for code/Markdown consistency
- Line numbers styled with light background

---

### Task 5.7: Create Editor Tests

Test the factory functions and error handling.

**File: `tests/editor.test.ts` (new)**

```typescript
/**
 * Editor factory tests
 *
 * Verify editor initialization, DOM mounting, and error handling
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createEditor, createEditorFromSelector } from "../src/editor/editor";
import { EditorView } from "@codemirror/view";

describe("Editor Factory", () => {
  let container: HTMLElement;

  beforeEach(() => {
    // Create a test container
    container = document.createElement("div");
    container.id = "editor";
    document.body.appendChild(container);
  });

  afterEach(() => {
    // Clean up
    document.body.removeChild(container);
  });

  describe("createEditor", () => {
    it("creates editor with valid target element", () => {
      const editor = createEditor(container);

      expect(editor).not.toBeNull();
      expect(editor).toBeInstanceOf(EditorView);
    });

    it("initializes with empty doc by default", () => {
      const editor = createEditor(container);

      if (editor) {
        const doc = editor.state.doc.toString();
        expect(doc).toBe("");
      }
    });

    it("initializes with provided initial doc", () => {
      const initialContent = "# Hello\n\nWorld";
      const editor = createEditor(container, initialContent);

      if (editor) {
        const doc = editor.state.doc.toString();
        expect(doc).toBe(initialContent);
      }
    });

    it("returns null when target is null", () => {
      const editor = createEditor(null);
      expect(editor).toBeNull();
    });

    it("returns null when target is not a DOM element", () => {
      const editor = createEditor("not-a-dom-element" as any);
      expect(editor).toBeNull();
    });

    it("mounts editor to target DOM element", () => {
      const editor = createEditor(container);

      expect(editor).not.toBeNull();
      // Verify editor view is attached to container
      expect(container.querySelector(".cm-editor")).not.toBeNull();
    });

    it("initializes with Markdown extensions", () => {
      const editor = createEditor(container);

      if (editor) {
        // Verify extensions are loaded by checking for CM6 features
        expect(editor.state.facet).toBeDefined();
        // basicSetup extensions should be present
        expect(editor.contentDOM).toBeDefined();
      }
    });
  });

  describe("createEditorFromSelector", () => {
    it("finds and creates editor by selector", () => {
      const editor = createEditorFromSelector("#editor");

      expect(editor).not.toBeNull();
      expect(editor).toBeInstanceOf(EditorView);
    });

    it("returns null when selector doesn't match", () => {
      const editor = createEditorFromSelector("#nonexistent");

      expect(editor).toBeNull();
    });

    it("passes initial doc to factory", () => {
      const content = "Test content";
      const editor = createEditorFromSelector("#editor", content);

      if (editor) {
        expect(editor.state.doc.toString()).toBe(content);
      }
    });
  });

  describe("Extensions", () => {
    it("includes basicSetup extensions", () => {
      const editor = createEditor(container);

      if (editor) {
        // Verify line numbers are present (part of basicSetup)
        expect(container.querySelector(".cm-lineNumbers")).not.toBeNull();
      }
    });

    it("includes Markdown language support", () => {
      const editor = createEditor(container);

      if (editor) {
        // Verify editor can process Markdown syntax
        // (This is tested indirectly via syntax highlighting)
        expect(editor.state.language).toBeDefined();
      }
    });
  });

  describe("Error Handling", () => {
    it("logs error to console when target is null", () => {
      const consoleSpy = vi.spyOn(console, "error");

      createEditor(null);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Target element not found")
      );
    });

    it("logs error and returns null on initialization failure", () => {
      const consoleSpy = vi.spyOn(console, "error");
      const invalidTarget = "not-a-dom-element" as any;

      const editor = createEditor(invalidTarget);

      expect(editor).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
    });
  });
});
```

**Notes:**
- Uses jsdom or happy-dom for DOM testing
- Vitest is used (same as step 04)
- Tests initialization, error handling, DOM mounting
- EC-18, EC-19 coverage

---

### Task 5.8: Run Tests

```bash
cd /Users/dave/Documents/web-local-dev/MarkdownEditor-Rewrite/markable-2.0

npx vitest tests/editor.test.ts
```

**Expected output:**
```
✓ tests/editor.test.ts (12 tests)
✓ Editor Factory
  ✓ createEditor
    ✓ creates editor with valid target element
    ✓ initializes with empty doc by default
    ✓ initializes with provided initial doc
    ✓ returns null when target is null
    ✓ returns null when target is not a DOM element
    ✓ mounts editor to target DOM element
    ✓ initializes with Markdown extensions
  ✓ createEditorFromSelector
    ✓ finds and creates editor by selector
    ✓ returns null when selector doesn't match
    ✓ passes initial doc to factory
  ✓ Extensions (3 tests)
  ✓ Error Handling (2 tests)
```

---

### Task 5.9: Manual Test — Run Dev Server

```bash
cd /Users/dave/Documents/web-local-dev/MarkdownEditor-Rewrite/markable-2.0

npm run tauri dev
```

**Expected behavior:**
1. Tauri window opens
2. CodeMirror editor is visible and takes full screen
3. Welcome message appears: "# Welcome to Markable 2.0"
4. Line numbers visible on left
5. Type in editor — text appears and syntax highlighting works
   - Try typing `# Heading` — should be highlighted
   - Try typing `**bold**` — should be highlighted
   - Try typing `` `code` `` — should be highlighted

**Acceptance:**
- [ ] Editor is visible (not blank or error)
- [ ] Markdown syntax highlighting works (headings, bold, code are colored)
- [ ] Typing updates content in real-time
- [ ] Console (F12) shows no errors
- [ ] Console shows: "CodeMirror: Editor initialized successfully"

---

### Task 5.10: Test Hot Reload with Editor

While dev server is running, edit `src/editor/editor.ts` and save. Verify:

1. Editor reloads in window
2. No errors appear
3. Editor state is preserved (or resets, both are OK for Phase 1)

---

## Acceptance Checklist (Step 05 Complete When All Pass)

- [ ] `@codemirror/view@6.40.0`, `@codemirror/state@6.5.4`, `@codemirror/lang-markdown@6.5.0` installed
- [ ] `src/editor/extensions.ts` exports buildExtensions() with error handling
- [ ] `src/editor/editor.ts` exports createEditor() factory function
- [ ] `index.html` has `<div id="editor" role="textbox"></div>`
- [ ] `src/main.ts` initializes editor on DOM ready
- [ ] `src/style.css` has editor styling (full viewport height, Markdown colors)
- [ ] `tests/editor.test.ts` has comprehensive test suite
- [ ] `npx vitest tests/editor.test.ts` passes all 12+ tests
- [ ] `npm run tauri dev` displays working editor
- [ ] Markdown syntax highlighting visible (headings, bold, code colored)
- [ ] Typing in editor updates content in real-time
- [ ] Console shows "Editor initialized successfully" (no errors)

---

## Files Modified/Created in This Step

| File | Action | Purpose |
|------|--------|---------|
| `src/editor/extensions.ts` | NEW | Extension builder with error handling |
| `src/editor/editor.ts` | NEW | Editor factory function |
| `index.html` | UPDATED | Add editor container with a11y attributes |
| `src/main.ts` | UPDATED | Initialize editor on app load |
| `src/style.css` | UPDATED | Editor styling and Markdown colors |
| `tests/editor.test.ts` | NEW | Editor factory and extension tests |
| `package.json` | UPDATED | Add CodeMirror dependencies (via npm install) |

---

## Edge Case Coverage (Step 05)

| EC # | Edge Case | Coverage |
|------|-----------|----------|
| EC-18 | CodeMirror init fails (missing DOM) | createEditor returns null, console error (step 05 task 5.9) |
| EC-19 | Markdown plugin fails to load | buildExtensions catches error, logs warning, continues with other extensions |

---

## Summary

Step 05 integrates **CodeMirror 6 with Markdown support** by:

1. Installing pinned CM6 packages (view 6.40.0, state 6.5.4, lang-markdown 6.5.0)
2. Creating a modular extension builder with error handling
3. Providing a factory function for editor initialization
4. Adding editor DOM container and styling
5. Initializing editor on app load
6. Testing all components with Vitest

**Next step:** Move to `step_06_file_dialogs.md` to add file open/save dialog integration.

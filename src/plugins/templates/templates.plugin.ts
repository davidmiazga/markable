/**
 * Templates Plugin for Markable 2.0
 *
 * Provides "New from Template" and "Save as Template" functionality.
 * Templates are .md files stored in a configurable subfolder of the
 * working directory. Users can create documents from templates via a
 * modal picker (Cmd-Shift-N) or save the current document as a
 * reusable template (File > Save as Template).
 *
 * Architecture:
 * - IIFE plugin following the UnifiedPlugin interface
 * - No CM6 extensions (no editor state coupling)
 * - Communicates with handleAction() via window.__MARKABLE_TEMPLATES__
 * - Uses __TAURI_INTERNALS__.invoke for Rust commands (IIFE boundary)
 * - Uses __MARKABLE_TAB_MANAGER__ for tab creation
 * - Uses __MARKABLE_EDITOR_VIEW__ for document content access
 * - Uses __MARKABLE_CURRENT_FILE__ for working directory resolution
 *
 * @module templates.plugin
 */

import type { MarkablePluginAPI } from "../markable-plugin-api";

// ---------------------------------------------------------------------------
// Types and Constants
// ---------------------------------------------------------------------------

/** Plugin settings shape. */
interface TemplatesSettings {
  /** Absolute path to the templates folder. Empty string = not yet configured. */
  templatesFolderPath: string;
  createStarterTemplates: boolean;
  setupComplete: boolean;
}

/** Default settings applied on first enable or when persisted data is absent. */
const DEFAULT_SETTINGS: TemplatesSettings = {
  templatesFolderPath: "",
  createStarterTemplates: true,
  setupComplete: false,
};

/** Style tag identifier for CSS injection/removal. */
const STYLE_ID = "__markable_templates_css__";

// ---------------------------------------------------------------------------
// Module-Level State
// ---------------------------------------------------------------------------

/** Whether the plugin is currently enabled. Guards all async callbacks. */
let _enabled = false;

/** Cached settings loaded on enable. */
let _settings: TemplatesSettings = { ...DEFAULT_SETTINGS };

/** Reference to the MarkablePluginAPI instance. Set on enable, null on disable. */
let _api: MarkablePluginAPI | null = null;

/** Singleton guard: true when the picker or wizard overlay is showing (EC-12). */
let _pickerOpen = false;

// ---------------------------------------------------------------------------
// Starter Template Content
// ---------------------------------------------------------------------------

/**
 * Built-in starter templates written to the templates folder during the
 * setup wizard when "Create starter templates" is checked (FR-6.3).
 *
 * Each key is the filename (including .md extension) and the value is the
 * full file content. The blank template is an empty string by design (EC-6).
 */
const STARTER_TEMPLATES: Record<string, string> = {
  "blank.md": "",

  "note.md": `---
title: ""
date: ""
tags: []
---

# Title

`,

  "meeting-notes.md": `---
title: "Meeting Notes"
date: ""
attendees: []
---

# Meeting Notes

## Attendees

-

## Agenda

1.

## Discussion

## Action Items

- [ ]
`,
};

// ---------------------------------------------------------------------------
// Path Resolution
// ---------------------------------------------------------------------------

/**
 * Derive the working directory from the currently open file.
 *
 * Returns null if no file is open (EC-1: untitled document).
 * The working directory is the parent of __MARKABLE_CURRENT_FILE__.
 */
function getWorkingDirectory(): string | null {
  const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
  if (!currentFile) return null;
  // Find the last path separator to extract the parent directory.
  // This avoids importing Node path utilities (IIFE boundary).
  const lastSlash = currentFile.lastIndexOf("/");
  return lastSlash === -1 ? null : currentFile.substring(0, lastSlash);
}

/**
 * Resolve the absolute path to the templates folder.
 *
 * Returns the stored absolute path, or null if setup is incomplete.
 */
function resolveTemplatesFolder(): string | null {
  return _settings.templatesFolderPath || null;
}

/**
 * Derive the default suggested templates folder path for the setup wizard.
 *
 * Uses the parent directory of the currently open file + "/Templates".
 * Returns null if no file is open.
 */
function getDefaultTemplatesPath(): string | null {
  const workDir = getWorkingDirectory();
  if (!workDir) return null;
  return `${workDir}/Templates`;
}

// ---------------------------------------------------------------------------
// Template Discovery
// ---------------------------------------------------------------------------

/**
 * List .md files in the templates folder.
 *
 * Uses __TAURI_INTERNALS__.invoke directly (IIFE boundary — cannot import
 * from @tauri-apps/api). Returns an empty array if the folder doesn't
 * exist or is empty (EC-3).
 *
 * @param templatesPath - Absolute path to the templates directory.
 * @returns Array of .md filenames (not full paths), sorted alphabetically.
 */
async function discoverTemplates(templatesPath: string): Promise<string[]> {
  try {
    return await (window as any).__TAURI_INTERNALS__.invoke(
      "list_md_files",
      { path: templatesPath }
    );
  } catch (error) {
    console.warn("[templates] Failed to list templates:", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Template Application
// ---------------------------------------------------------------------------

/**
 * Apply a template: open a new tab and fill it with template content.
 *
 * Flow:
 * 1. Read the template file via Tauri.
 * 2. Open a new untitled tab via __MARKABLE_TAB_MANAGER__.
 * 3. Replace the empty doc with template content via CM6 dispatch.
 * 4. Set cursor to end of document (FR-4.4).
 * 5. Tab is automatically dirty because content changed (FR-4.5).
 *
 * @param templatePath - Absolute path to the .md template file.
 */
async function applyTemplate(templatePath: string): Promise<void> {
  // Step 1: Read the template file content from disk.
  let content: string;
  try {
    content = await (window as any).__TAURI_INTERNALS__.invoke(
      "read_file",
      { path: templatePath }
    );
  } catch (error) {
    // EC-5: template read error — alert and bail, do not create an empty tab.
    alert(`Could not read template: ${templatePath.split("/").pop()}. ${String(error)}`);
    return;
  }

  // Step 2: Open a new untitled tab for the template content.
  const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
  if (!tabManager || typeof tabManager.openNewTab !== "function") {
    console.warn("[templates] Tab manager not available.");
    return;
  }
  tabManager.openNewTab();

  // Step 3: Replace empty document content with template.
  const editorView = (window as any).__MARKABLE_EDITOR_VIEW__;
  if (!editorView) {
    console.warn("[templates] Editor view not available.");
    return;
  }

  // EC-6: empty template content is valid — skip dispatch for empty strings.
  // An empty template is equivalent to File > New (tab stays clean).
  if (content.length > 0) {
    editorView.dispatch({
      changes: {
        from: 0,
        to: editorView.state.doc.length,
        insert: content,
      },
      // FR-4.4: place cursor at end of document after template insertion.
      selection: { anchor: content.length },
    });
  }

  // FR-4.5: dirty state is handled automatically by TabManager's
  // updateListener — the dispatch above changes the doc, triggering
  // markActiveTabDirty(). Empty content (EC-6) produces no dispatch,
  // so the tab stays clean (identical to File > New).
}

// ---------------------------------------------------------------------------
// Filename Validation
// ---------------------------------------------------------------------------

/**
 * Validate a template filename entered by the user.
 *
 * Returns null if the name is valid, or an error message string if invalid.
 * Validation rules (EC-8):
 * - Must not be empty or whitespace-only.
 * - Must not contain path separators (/ or \).
 * - Must not start with a dot (hidden file convention).
 *
 * @param name - The raw filename string from the prompt dialog.
 * @returns Null if valid; descriptive error string if invalid.
 */
function validateTemplateName(name: string): string | null {
  if (!name || name.trim().length === 0) {
    return "Template name cannot be empty.";
  }
  if (name.includes("/") || name.includes("\\")) {
    return "Invalid template name. Names cannot contain path separators or start with a dot.";
  }
  if (name.trimStart().startsWith(".")) {
    return "Invalid template name. Names cannot contain path separators or start with a dot.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Save as Template
// ---------------------------------------------------------------------------

/**
 * Save the current editor content as a template file.
 *
 * Flow (FR-5.2):
 * 1. Check working directory exists (EC-1).
 * 2. Prompt user for a filename.
 * 3. Validate the filename (EC-8).
 * 4. Append .md extension if not present.
 * 5. Ensure templates folder exists (FR-5.3).
 * 6. Check for overwrite conflict (EC-7).
 * 7. Write the file.
 * 8. Show confirmation alert.
 */
async function saveAsTemplate(): Promise<void> {
  // No templates folder configured — prompt user to run setup.
  const templatesFolder = resolveTemplatesFolder();
  if (!templatesFolder) {
    alert("No templates folder configured. Use File > New from Template to run setup first.");
    return;
  }

  // Read the current editor content.
  const editorView = (window as any).__MARKABLE_EDITOR_VIEW__;
  if (!editorView) {
    console.warn("[templates] Editor view not available.");
    return;
  }
  const content = editorView.state.doc.toString();

  // FR-5.2 step 1: prompt for filename.
  let filename = prompt("Enter a name for the template:");
  if (filename === null) return; // User cancelled the prompt.

  // FR-5.2 step 2: validate the name (EC-8).
  const validationError = validateTemplateName(filename);
  if (validationError) {
    alert(validationError);
    return;
  }

  filename = filename.trim();

  // FR-5.2 step 3: append .md extension if the user omitted it.
  if (!filename.toLowerCase().endsWith(".md")) {
    filename = filename + ".md";
  }

  // FR-5.3: ensure the templates folder exists before writing.
  try {
    await (window as any).__TAURI_INTERNALS__.invoke(
      "ensure_directory",
      { path: templatesFolder }
    );
  } catch (error) {
    // EC-16 (path is file) or EC-20 (read-only filesystem).
    alert(`Could not create templates folder: ${String(error)}`);
    return;
  }

  const targetPath = `${templatesFolder}/${filename}`;

  // EC-7: check for existing file and confirm overwrite.
  try {
    await (window as any).__TAURI_INTERNALS__.invoke("read_file", { path: targetPath });
    // File exists — ask user to confirm overwrite.
    const overwrite = confirm(`Template '${filename}' already exists. Overwrite?`);
    if (!overwrite) return;
  } catch {
    // File doesn't exist — this is the expected case, proceed with write.
  }

  // FR-5.2 step 5: write the template file.
  try {
    await (window as any).__TAURI_INTERNALS__.invoke(
      "write_file",
      { path: targetPath, content }
    );
    alert(`Template saved: ${filename}`);
  } catch (error) {
    alert(`Failed to save template: ${String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// CSS Injection / Removal
// ---------------------------------------------------------------------------

/**
 * Inject the templates plugin CSS into the document head.
 *
 * All colors reference existing CSS variables for theme compatibility (NFR-4).
 * The style tag is identified by STYLE_ID for clean removal on disable.
 */
function injectTemplatesCSS(): void {
  if (typeof document === "undefined") return;
  // Avoid duplicate injection if called multiple times.
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    /* ── Templates Overlay (shared by picker and wizard) ────────────────── */
    .templates-overlay {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.5);
    }

    /* ── Picker Card ────────────────────────────────────────────────────── */
    .templates-card {
      background: var(--bg-primary, #1e1e1e);
      border: 1px solid var(--border-color, #333);
      border-radius: 8px;
      max-width: 420px;
      width: 90%;
      max-height: 60vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    }

    .templates-header {
      padding: 12px 16px;
      font-weight: 600;
      color: var(--text-primary, #eee);
      border-bottom: 1px solid var(--border-color, #333);
    }

    .templates-filter {
      margin: 8px 12px;
      padding: 6px 10px;
      border: 1px solid var(--border-color, #333);
      border-radius: 4px;
      background: var(--bg-secondary, #252525);
      color: var(--text-primary, #eee);
      font-size: 13px;
      outline: none;
    }
    .templates-filter:focus {
      border-color: var(--selection-bg, #264f78);
    }

    .templates-list {
      overflow-y: auto;
      padding: 4px 0;
      flex: 1;
      min-height: 0;
    }

    .templates-item {
      display: block;
      width: 100%;
      padding: 8px 16px;
      border: none;
      background: transparent;
      color: var(--text-primary, #eee);
      text-align: left;
      font-size: 13px;
      cursor: pointer;
    }
    .templates-item:hover {
      background: var(--bg-secondary, #252525);
    }
    .templates-item.selected {
      background: var(--selection-bg, #264f78);
      color: #fff;
    }

    .templates-empty {
      padding: 16px;
      color: var(--text-secondary, #888);
      text-align: center;
      font-size: 13px;
    }

    /* ── Wizard Card ────────────────────────────────────────────────────── */
    .templates-wizard-card {
      background: var(--bg-primary, #1e1e1e);
      border: 1px solid var(--border-color, #333);
      border-radius: 8px;
      max-width: 420px;
      width: 90%;
      padding: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    }
    .templates-wizard-card p {
      color: var(--text-secondary, #888);
      font-size: 13px;
      margin: 8px 0 12px;
    }
    .templates-wizard-card label {
      color: var(--text-primary, #eee);
      font-size: 13px;
    }

    .templates-wizard-path-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 4px 0 12px;
    }

    .templates-wizard-path-display {
      flex: 1;
      padding: 6px 10px;
      border: 1px solid var(--border-color, #333);
      border-radius: 4px;
      background: var(--bg-secondary, #252525);
      color: var(--text-primary, #eee);
      font-size: 12px;
      word-break: break-all;
      min-height: 32px;
      display: flex;
      align-items: center;
    }

    .templates-wizard-path-placeholder {
      color: var(--text-secondary, #888);
    }

    .templates-wizard-field {
      display: block;
      width: 100%;
      margin: 4px 0 12px;
      padding: 6px 10px;
      border: 1px solid var(--border-color, #333);
      border-radius: 4px;
      background: var(--bg-secondary, #252525);
      color: var(--text-primary, #eee);
      font-size: 13px;
      box-sizing: border-box;
    }

    .templates-wizard-checkbox {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 8px 0 16px;
      cursor: pointer;
    }

    .templates-wizard-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .templates-wizard-error {
      color: #f44;
      font-size: 12px;
      margin: 4px 0;
    }

    /* ── Shared Button Styles ───────────────────────────────────────────── */
    .templates-btn {
      padding: 6px 14px;
      border: 1px solid var(--border-color, #333);
      border-radius: 4px;
      font-size: 13px;
      cursor: pointer;
    }
    .templates-btn-primary {
      background: var(--selection-bg, #264f78);
      color: #fff;
      border-color: var(--selection-bg, #264f78);
    }
    .templates-btn-primary:hover {
      opacity: 0.9;
    }
    .templates-btn-secondary {
      background: transparent;
      color: var(--text-primary, #eee);
    }
    .templates-btn-secondary:hover {
      background: var(--bg-secondary, #252525);
    }
  `;
  document.head.appendChild(style);
}

/**
 * Remove the templates plugin CSS from the document head.
 * Safe to call if the style tag was never injected.
 */
function removeTemplatesCSS(): void {
  if (typeof document === "undefined") return;
  document.getElementById(STYLE_ID)?.remove();
}

// ---------------------------------------------------------------------------
// Picker UI
// ---------------------------------------------------------------------------

/** Reference to the current overlay element (picker or wizard). */
let _overlayEl: HTMLElement | null = null;

/**
 * Close the picker or wizard overlay and reset the singleton guard.
 */
function closePicker(): void {
  if (_overlayEl) {
    _overlayEl.remove();
    _overlayEl = null;
  }
  _pickerOpen = false;
}

/**
 * Close the picker if it is currently open.
 * Called by onDisable to ensure cleanup.
 */
function closePickerIfOpen(): void {
  if (_pickerOpen) {
    closePicker();
  }
}

/**
 * Show the template picker modal with filter and keyboard navigation.
 *
 * Displays a card overlay listing all discovered templates. The user can:
 * - Type to filter by case-insensitive substring (FR-3.3)
 * - Navigate with ArrowUp/ArrowDown (FR-3.4)
 * - Select with Enter or click (FR-3.2)
 * - Dismiss with Escape or clicking the backdrop (FR-3.5, EC-19)
 *
 * @param templatesFolder - Absolute path to the templates directory (captured at open time, EC-10).
 * @param templates - Array of .md filenames discovered in the folder.
 */
function showPickerUI(templatesFolder: string, templates: string[]): void {
  _pickerOpen = true;

  // Build the overlay backdrop.
  const overlay = document.createElement("div");
  overlay.className = "templates-overlay";
  _overlayEl = overlay;

  // Build the card container.
  const card = document.createElement("div");
  card.className = "templates-card";

  // Header.
  const header = document.createElement("div");
  header.className = "templates-header";
  header.textContent = "New from Template";

  // Filter input.
  const filter = document.createElement("input");
  filter.className = "templates-filter";
  filter.type = "text";
  filter.placeholder = "Filter templates...";

  // Template list container.
  const listEl = document.createElement("div");
  listEl.className = "templates-list";

  card.appendChild(header);
  card.appendChild(filter);
  card.appendChild(listEl);
  overlay.appendChild(card);

  // State for filtering and keyboard navigation.
  let filteredIndices: number[] = templates.map((_, i) => i);
  let selectedIdx = 0;

  /**
   * Rebuild the list DOM from the current filtered indices.
   * Display names are filenames with .md stripped (FR-2.3).
   */
  function rebuildList(): void {
    listEl.innerHTML = "";

    if (filteredIndices.length === 0) {
      const empty = document.createElement("div");
      empty.className = "templates-empty";
      // EC-3: different message depending on whether filtering or truly empty.
      empty.textContent = filter.value.length > 0
        ? "No matching templates."
        : `No templates found. Add .md files to your templates folder or use File > Save as Template.`;
      listEl.appendChild(empty);
      return;
    }

    filteredIndices.forEach((origIdx, displayIdx) => {
      const btn = document.createElement("button");
      btn.className = "templates-item";
      if (displayIdx === selectedIdx) btn.classList.add("selected");

      // Strip .md extension for display (FR-2.3).
      const displayName = templates[origIdx].replace(/\.md$/i, "");
      btn.textContent = displayName;

      // Click handler: select this template (FR-3.2).
      btn.addEventListener("click", () => {
        // EC-13: close immediately so rapid double-click has no target.
        const templatePath = `${templatesFolder}/${templates[origIdx]}`;
        closePicker();
        void applyTemplate(templatePath);
      });

      listEl.appendChild(btn);
    });
  }

  /**
   * Update the visual selection highlight without rebuilding the entire list.
   */
  function updateSelection(): void {
    const items = listEl.querySelectorAll(".templates-item");
    items.forEach((el, i) => {
      el.classList.toggle("selected", i === selectedIdx);
    });
    // Scroll the selected item into view if needed.
    items[selectedIdx]?.scrollIntoView({ block: "nearest" });
  }

  // Filter handler (FR-3.3): case-insensitive substring match.
  filter.addEventListener("input", () => {
    const query = filter.value.toLowerCase();
    filteredIndices = templates
      .map((name, i) => ({ name: name.replace(/\.md$/i, "").toLowerCase(), i }))
      .filter(({ name }) => name.includes(query))
      .map(({ i }) => i);
    selectedIdx = 0;
    rebuildList();
  });

  // Keyboard navigation handler (FR-3.4).
  // Attached to the overlay so it captures events while the filter is focused.
  overlay.addEventListener("keydown", (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (filteredIndices.length > 0) {
          // Clamp at end of list.
          selectedIdx = Math.min(selectedIdx + 1, filteredIndices.length - 1);
          updateSelection();
        }
        break;

      case "ArrowUp":
        e.preventDefault();
        if (filteredIndices.length > 0) {
          // Clamp at beginning of list.
          selectedIdx = Math.max(selectedIdx - 1, 0);
          updateSelection();
        }
        break;

      case "Enter":
        e.preventDefault();
        if (filteredIndices.length > 0 && filteredIndices[selectedIdx] !== undefined) {
          const origIdx = filteredIndices[selectedIdx];
          const templatePath = `${templatesFolder}/${templates[origIdx]}`;
          closePicker();
          void applyTemplate(templatePath);
        }
        break;

      case "Escape":
        // EC-19: Escape always closes the picker.
        e.preventDefault();
        closePicker();
        break;
    }
  });

  // Backdrop click dismissal (FR-3.5): clicking outside the card closes the picker.
  overlay.addEventListener("click", (e: MouseEvent) => {
    if (e.target === overlay) {
      closePicker();
    }
  });

  // Initial render.
  rebuildList();

  // Mount and focus.
  document.body.appendChild(overlay);
  filter.focus();
}

// ---------------------------------------------------------------------------
// Setup Wizard
// ---------------------------------------------------------------------------

/**
 * Show the first-use setup wizard.
 *
 * Presents a path display and a "Choose Folder" button backed by the native
 * folder picker. The user selects (or creates via the OS dialog) the folder
 * where templates will live. On success the settings are saved and the picker
 * opens immediately.
 */
function showSetupWizard(): void {
  _pickerOpen = true;

  const overlay = document.createElement("div");
  overlay.className = "templates-overlay";
  _overlayEl = overlay;

  const card = document.createElement("div");
  card.className = "templates-wizard-card";

  // Header.
  const header = document.createElement("div");
  header.className = "templates-header";
  header.textContent = "Templates Setup";

  // Description.
  const desc = document.createElement("p");
  desc.textContent = "Choose a folder where your template files will be stored.";

  // Folder path row: display + Choose button.
  const pathRow = document.createElement("div");
  pathRow.className = "templates-wizard-path-row";

  const pathDisplay = document.createElement("div");
  pathDisplay.className = "templates-wizard-path-display";

  // Seed the display with the default suggested path (workDir/Templates).
  let chosenPath = getDefaultTemplatesPath() ?? "";
  pathDisplay.textContent = chosenPath || "No folder selected";
  if (!chosenPath) pathDisplay.classList.add("templates-wizard-path-placeholder");

  const chooseBtn = document.createElement("button");
  chooseBtn.className = "templates-btn templates-btn-secondary";
  chooseBtn.textContent = "Choose…";

  pathRow.appendChild(pathDisplay);
  pathRow.appendChild(chooseBtn);

  // Error message element (hidden by default).
  const errorEl = document.createElement("div");
  errorEl.className = "templates-wizard-error";
  errorEl.style.display = "none";

  // Checkbox for starter templates.
  const checkboxLabel = document.createElement("label");
  checkboxLabel.className = "templates-wizard-checkbox";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = _settings.createStarterTemplates;
  checkboxLabel.appendChild(checkbox);
  checkboxLabel.appendChild(document.createTextNode(" Create starter templates"));

  // Action buttons.
  const actions = document.createElement("div");
  actions.className = "templates-wizard-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "templates-btn templates-btn-secondary";
  cancelBtn.textContent = "Cancel";

  const doneBtn = document.createElement("button");
  doneBtn.className = "templates-btn templates-btn-primary";
  doneBtn.textContent = "Create Folder";

  actions.appendChild(cancelBtn);
  actions.appendChild(doneBtn);

  // Assemble card.
  card.appendChild(header);
  card.appendChild(desc);
  card.appendChild(pathRow);
  card.appendChild(errorEl);
  card.appendChild(checkboxLabel);
  card.appendChild(actions);
  overlay.appendChild(card);

  // "Choose…" opens the native folder picker, seeded at the working directory.
  chooseBtn.addEventListener("click", async () => {
    const dialog = (window as any).__TAURI_DIALOG__;
    if (!dialog?.openFolder) {
      errorEl.textContent = "Folder picker not available.";
      errorEl.style.display = "block";
      return;
    }
    const startDir = getWorkingDirectory() ?? undefined;
    const picked: string | null = await dialog.openFolder(startDir);
    if (picked) {
      chosenPath = picked;
      pathDisplay.textContent = picked;
      pathDisplay.classList.remove("templates-wizard-path-placeholder");
      errorEl.style.display = "none";
    }
  });

  /**
   * Handle the "Create Folder" / "Done" action.
   */
  async function handleDone(): Promise<void> {
    if (!chosenPath) {
      errorEl.textContent = "Please choose a folder first.";
      errorEl.style.display = "block";
      return;
    }
    errorEl.style.display = "none";

    // Ensure the chosen folder exists (user may have picked a new path that
    // doesn't exist yet, or created it via the OS picker's New Folder button).
    try {
      await (window as any).__TAURI_INTERNALS__.invoke("ensure_directory", { path: chosenPath });
    } catch (error) {
      errorEl.textContent = `Could not create folder: ${String(error)}`;
      errorEl.style.display = "block";
      return;
    }

    // Write starter templates if checked.
    const createStarters = checkbox.checked;
    if (createStarters) {
      for (const [filename, content] of Object.entries(STARTER_TEMPLATES)) {
        try {
          await (window as any).__TAURI_INTERNALS__.invoke("write_file", {
            path: `${chosenPath}/${filename}`,
            content,
          });
        } catch (error) {
          console.warn(`[templates] Failed to write starter template ${filename}:`, error);
        }
      }
    }

    // Save settings.
    _settings.templatesFolderPath = chosenPath;
    _settings.createStarterTemplates = createStarters;
    _settings.setupComplete = true;
    if (_api) await _api.saveSettings(_settings as unknown as Record<string, unknown>);

    // Transition to picker.
    closePicker();
    const discoveredTemplates = await discoverTemplates(chosenPath);
    showPickerUI(chosenPath, discoveredTemplates);
  }

  cancelBtn.addEventListener("click", () => closePicker());
  doneBtn.addEventListener("click", () => void handleDone());

  overlay.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); closePicker(); }
  });
  overlay.addEventListener("click", (e: MouseEvent) => {
    if (e.target === overlay) closePicker();
  });

  document.body.appendChild(overlay);
  chooseBtn.focus();
}

// ---------------------------------------------------------------------------
// openPicker Entry Point
// ---------------------------------------------------------------------------

/**
 * Open the template picker or setup wizard.
 *
 * Called by handleAction("file-new-from-template") via the window global.
 * Checks preconditions (enabled, file open, not already showing) then
 * delegates to the wizard or picker UI.
 */
async function openPicker(): Promise<void> {
  if (!_enabled) return;

  // EC-12: picker is already open — prevent duplicate overlays.
  if (_pickerOpen) return;

  // Refresh settings from disk in case they changed externally.
  if (_api) {
    const loaded = await _api.loadSettings();
    if (loaded) {
      _settings = { ...DEFAULT_SETTINGS, ...loaded } as TemplatesSettings;
    }
  }

  // Check if setup has been completed.
  if (!_settings.setupComplete) {
    // EC-2: folder doesn't exist yet — show setup wizard.
    showSetupWizard();
    return;
  }

  // Capture templates folder path at open time (EC-10: dir changes while
  // picker is open have no effect; EC-14: settings changes are captured).
  const templatesFolder = resolveTemplatesFolder();
  if (!templatesFolder) {
    // setupComplete is true but path is missing (corrupted settings) — re-run wizard.
    _settings.setupComplete = false;
    showSetupWizard();
    return;
  }

  // Discover available templates.
  const templates = await discoverTemplates(templatesFolder);

  // Show the picker UI.
  showPickerUI(templatesFolder, templates);
}

// ---------------------------------------------------------------------------
// Plugin Detail Settings UI (Plugins Panel)
// ---------------------------------------------------------------------------

/**
 * Render the plugin detail settings in the Plugins Panel.
 *
 * Provides a text input for the templates folder name, a Save button,
 * and a "Reconfigure Templates Folder" button that resets setupComplete
 * and re-triggers the wizard (FR-9.4).
 *
 * @param container - The DOM element to render settings into.
 */
function renderDetailExtra(container: HTMLElement): void {
  const wrapper = document.createElement("div");
  wrapper.style.padding = "8px 0";

  // Current folder path display.
  const label = document.createElement("div");
  label.style.cssText = "margin-bottom:4px;font-size:12px;color:var(--text-secondary,#888)";
  label.textContent = "Templates folder:";

  const pathDisplay = document.createElement("div");
  pathDisplay.style.cssText = "font-size:12px;color:var(--text-primary,#eee);word-break:break-all;margin-bottom:8px;padding:4px 0";
  pathDisplay.textContent = _settings.templatesFolderPath || "Not configured";

  // Choose Folder button — opens the native picker.
  const chooseBtn = document.createElement("button");
  chooseBtn.textContent = "Choose Folder…";
  chooseBtn.style.cssText = "padding:4px 10px;border:1px solid var(--border-color,#333);border-radius:3px;background:var(--selection-bg,#264f78);color:#fff;font-size:12px;cursor:pointer;margin-right:6px";

  chooseBtn.addEventListener("click", async () => {
    const dialog = (window as any).__TAURI_DIALOG__;
    if (!dialog?.openFolder) return;
    const startDir = _settings.templatesFolderPath
      ? _settings.templatesFolderPath.substring(0, _settings.templatesFolderPath.lastIndexOf("/"))
      : (getWorkingDirectory() ?? undefined);
    const picked: string | null = await dialog.openFolder(startDir);
    if (picked) {
      _settings.templatesFolderPath = picked;
      _settings.setupComplete = true;
      pathDisplay.textContent = picked;
      if (_api) await _api.saveSettings(_settings as unknown as Record<string, unknown>);
    }
  });

  wrapper.appendChild(label);
  wrapper.appendChild(pathDisplay);
  wrapper.appendChild(chooseBtn);
  container.appendChild(wrapper);
}

// ---------------------------------------------------------------------------
// Plugin Export (UnifiedPlugin interface)
// ---------------------------------------------------------------------------

const plugin = {
  id: "templates",
  name: "Templates",
  version: "1.0.0",
  description: "Create documents from reusable template files",
  detail:
    "Create new documents from reusable .md template files stored in your " +
    "working directory. Access via File > New from Template (Cmd-Shift-N) or " +
    "save the current document as a template with File > Save as Template.",

  // No sidebarPanelId — this plugin does not register a sidebar panel (FR-8.1).

  // Settings UI rendered in the Plugins Panel detail view.
  renderDetailExtra,

  /**
   * Enable the plugin: inject CSS, load settings, and expose the window global.
   *
   * The window global __MARKABLE_TEMPLATES__ is the bridge between handleAction()
   * in main.ts and the plugin's openPicker()/saveAsTemplate() methods (AD-1).
   */
  onEnable(api: MarkablePluginAPI): void {
    _enabled = true;
    _api = api;

    // FR-8.2 step 1: inject CSS.
    injectTemplatesCSS();

    // FR-8.2 step 2: load settings eagerly (non-blocking).
    void (async () => {
      const loaded = await api.loadSettings();
      if (loaded) {
        _settings = { ...DEFAULT_SETTINGS, ...loaded } as TemplatesSettings;
      }
    })();

    // FR-8.2 step 3: expose the window global so handleAction() can call us (AD-1).
    (window as any).__MARKABLE_TEMPLATES__ = {
      openPicker,
      saveAsTemplate,
    };

    // Show template menu items now that the plugin is active.
    void (window as any).__TAURI_INTERNALS__.invoke("set_template_menu_enabled", { enabled: true });
  },

  /**
   * Disable the plugin: close any open picker, remove CSS, and delete the global.
   */
  onDisable(_api: MarkablePluginAPI): void {
    _enabled = false;

    // FR-8.3 step 1: close picker if open.
    closePickerIfOpen();

    // FR-8.3 step 2: remove CSS.
    removeTemplatesCSS();

    // FR-8.3 step 3: remove the window global so handleAction() shows the
    // "enable plugin" alert instead of calling stale references.
    delete (window as any).__MARKABLE_TEMPLATES__;

    // Hide template menu items when plugin is off.
    void (window as any).__TAURI_INTERNALS__.invoke("set_template_menu_enabled", { enabled: false });

    // FR-8.3 step 4: clear module-level state.
    _api = null;
    _pickerOpen = false;
    _settings = { ...DEFAULT_SETTINGS };
  },
};

export default plugin;

// ---------------------------------------------------------------------------
// Named exports for testing
// ---------------------------------------------------------------------------
// Pure functions and constants exported so unit tests can import them directly
// without needing the full plugin lifecycle or window globals.

export {
  validateTemplateName,
  getWorkingDirectory,
  resolveTemplatesFolder,
  STARTER_TEMPLATES,
  DEFAULT_SETTINGS,
};

// Expose the full plugin object as a named export for tests that call
// onEnable/onDisable directly.
export { plugin };

// Expose core functions for integration tests.
export { applyTemplate, saveAsTemplate, openPicker, discoverTemplates };

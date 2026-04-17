---
title: "Step 03 — Plugin Core Logic"
last-updated: "2026-04-16"
review-cadence-days: 7
status: active
---

# Step 03: Plugin Core Logic

**Goal**: Create `templates.plugin.ts` with the UnifiedPlugin interface, settings management, template discovery, template application, and save-as-template logic. The picker UI (DOM) is deferred to step_04; this step implements the data/logic layer and exposes the window global.

## Requirement Traceability

- FR-1 (templates folder), FR-2 (discovery), FR-4 (application), FR-5 (creation)
- FR-8 (plugin lifecycle), FR-9 (settings)
- AD-1 (window global), AD-2 (vault-relative), AD-4 (verbatim copy)
- EC-1, EC-2, EC-5 through EC-8, EC-10, EC-11, EC-14, EC-16 through EC-18, EC-20

## File Location

`src/plugins/templates/templates.plugin.ts`

## Architecture

The plugin is structured as a single file with the following internal sections:

1. **Types and Constants**
2. **Settings Management** (load/save via api)
3. **Path Resolution** (derive working dir from `__MARKABLE_CURRENT_FILE__`)
4. **Template Discovery** (list_md_files via `__TAURI_INTERNALS__`)
5. **Template Application** (openNewTab + CM6 dispatch)
6. **Save-as-Template** (prompt, validate, write)
7. **Starter Templates** (content strings for wizard)
8. **Picker and Wizard Stubs** (DOM creation deferred to step_04)
9. **Plugin Export** (UnifiedPlugin with onEnable/onDisable)

### Type-Only Import

```typescript
import type { MarkablePluginAPI } from "../markable-plugin-api";
```

This is erased at compile time. All runtime CM6 access uses window globals.

## 1. Types and Constants

```typescript
/** Plugin settings shape (FR-9.1). */
interface TemplatesSettings {
  templatesFolderName: string;
  createStarterTemplates: boolean;
  setupComplete: boolean;
}

const DEFAULT_SETTINGS: TemplatesSettings = {
  templatesFolderName: "Templates",
  createStarterTemplates: true,
  setupComplete: false,
};

/** Style tag identifier for CSS injection. */
const STYLE_ID = "__markable_templates_css__";
```

## 2. Module-Level State

```typescript
/** Whether the plugin is currently enabled. Guards all async callbacks. */
let _enabled = false;

/** Cached settings loaded on enable. */
let _settings: TemplatesSettings = { ...DEFAULT_SETTINGS };

/** Reference to the MarkablePluginAPI instance. Set on enable, null on disable. */
let _api: MarkablePluginAPI | null = null;

/** Singleton guard: true when the picker is currently showing (EC-12). */
let _pickerOpen = false;
```

## 3. Path Resolution

```typescript
/**
 * Derive the working directory from the currently open file.
 *
 * Returns null if no file is open (EC-1: untitled document).
 * The working directory is the parent of __MARKABLE_CURRENT_FILE__.
 */
function getWorkingDirectory(): string | null {
  const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
  if (!currentFile) return null;
  const lastSlash = currentFile.lastIndexOf("/");
  return lastSlash === -1 ? null : currentFile.substring(0, lastSlash);
}

/**
 * Resolve the absolute path to the templates folder.
 *
 * Returns null if no file is open (EC-1).
 */
function resolveTemplatesFolder(): string | null {
  const workDir = getWorkingDirectory();
  if (!workDir) return null;
  return `${workDir}/${_settings.templatesFolderName}`;
}
```

## 4. Template Discovery

```typescript
/**
 * List .md files in the templates folder.
 *
 * Uses __TAURI_INTERNALS__.invoke directly (IIFE boundary).
 * Returns an empty array if the folder doesn't exist or is empty.
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
```

## 5. Template Application

```typescript
/**
 * Apply a template: open a new tab and fill it with template content.
 *
 * 1. Read the template file via Tauri.
 * 2. Open a new untitled tab via __MARKABLE_TAB_MANAGER__.
 * 3. Replace the empty doc with template content via CM6 dispatch.
 * 4. Set cursor to end of document (FR-4.4).
 * 5. Tab is automatically dirty because content changed (FR-4.5).
 *
 * @param templatePath - Absolute path to the .md template file.
 */
async function applyTemplate(templatePath: string): Promise<void> {
  // Read file
  let content: string;
  try {
    content = await (window as any).__TAURI_INTERNALS__.invoke(
      "read_file",
      { path: templatePath }
    );
  } catch (error) {
    alert(`Could not read template: ${templatePath.split("/").pop()}. ${String(error)}`);
    return; // EC-5: do not create tab on read failure
  }

  // Open new tab
  const tabManager = (window as any).__MARKABLE_TAB_MANAGER__;
  if (!tabManager || typeof tabManager.openNewTab !== "function") {
    console.warn("[templates] Tab manager not available.");
    return;
  }
  tabManager.openNewTab();

  // Replace empty document content with template
  const editorView = (window as any).__MARKABLE_EDITOR_VIEW__;
  if (!editorView) {
    console.warn("[templates] Editor view not available.");
    return;
  }

  // EC-6: empty template => empty content is valid, dispatch is a no-op for empty string
  if (content.length > 0) {
    editorView.dispatch({
      changes: {
        from: 0,
        to: editorView.state.doc.length,
        insert: content,
      },
      // FR-4.4: cursor at end of document
      selection: { anchor: content.length },
    });
  }

  // FR-4.5: mark tab dirty (content differs from saved empty file).
  // The dispatch above changes the doc, and TabManager's updateListener
  // will detect docChanged and set isDirty. But if content is empty (EC-6),
  // no dispatch fired, so the tab stays clean — which is correct (it's
  // identical to File > New).
}
```

## 6. Save-as-Template

```typescript
/**
 * Validate a template filename.
 *
 * Returns null if valid, or an error message string if invalid (EC-8).
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

/**
 * Save the current editor content as a template file.
 *
 * Flow (FR-5.2):
 * 1. Check working directory (EC-1).
 * 2. Prompt for filename.
 * 3. Validate filename (EC-8).
 * 4. Append .md if not present.
 * 5. Ensure templates folder exists (FR-5.3).
 * 6. Check for overwrite conflict (EC-7).
 * 7. Write file.
 * 8. Show confirmation.
 */
async function saveAsTemplate(): Promise<void> {
  // EC-1: no file open
  const templatesFolder = resolveTemplatesFolder();
  if (!templatesFolder) {
    alert("Save your document first to establish a working directory, then try again.");
    return;
  }

  // Get editor content
  const editorView = (window as any).__MARKABLE_EDITOR_VIEW__;
  if (!editorView) {
    console.warn("[templates] Editor view not available.");
    return;
  }
  const content = editorView.state.doc.toString();

  // Prompt for filename (FR-5.2 step 1)
  let filename = prompt("Enter a name for the template:");
  if (filename === null) return; // cancelled

  // Validate (FR-5.2 step 2, EC-8)
  const validationError = validateTemplateName(filename);
  if (validationError) {
    alert(validationError);
    return;
  }

  filename = filename.trim();

  // Append .md if needed (FR-5.2 step 3)
  if (!filename.toLowerCase().endsWith(".md")) {
    filename = filename + ".md";
  }

  // Ensure templates folder exists (FR-5.3)
  try {
    await (window as any).__TAURI_INTERNALS__.invoke(
      "ensure_directory",
      { path: templatesFolder }
    );
  } catch (error) {
    alert(`Could not create templates folder: ${String(error)}`);
    return; // EC-16, EC-20
  }

  const targetPath = `${templatesFolder}/${filename}`;

  // Check for existing file (EC-7)
  try {
    await (window as any).__TAURI_INTERNALS__.invoke("read_file", { path: targetPath });
    // File exists — confirm overwrite
    const overwrite = confirm(`Template '${filename}' already exists. Overwrite?`);
    if (!overwrite) return;
  } catch {
    // File doesn't exist — good, proceed
  }

  // Write file (FR-5.2 step 5)
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
```

## 7. Starter Template Content

```typescript
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
```

## 8. openPicker Entry Point

The `openPicker()` function is the entry point called by `handleAction`. It:

1. Guards against EC-1 (no file open).
2. Guards against EC-12 (picker already open).
3. Loads settings (if not cached).
4. Checks `setupComplete` — if false, shows the setup wizard (step_04).
5. If setup complete, resolves the templates folder path, captures it (EC-10, EC-14), discovers templates, and shows the picker (step_04).

```typescript
/**
 * Open the template picker or setup wizard.
 *
 * Called by handleAction("file-new-from-template") via the window global.
 */
async function openPicker(): Promise<void> {
  if (!_enabled) return;

  // EC-1: no file open
  if (!getWorkingDirectory()) {
    alert("Save your document first to establish a working directory, then try again.");
    return;
  }

  // EC-12: picker already open
  if (_pickerOpen) return;

  // Load settings
  if (_api) {
    const loaded = await _api.loadSettings();
    if (loaded) {
      _settings = { ...DEFAULT_SETTINGS, ...loaded } as TemplatesSettings;
    }
  }

  // Check if setup has been completed
  if (!_settings.setupComplete) {
    // EC-2: folder doesn't exist yet either — show setup wizard
    showSetupWizard(); // Implemented in step_04
    return;
  }

  // Capture templates folder path at open time (EC-10, EC-14)
  const templatesFolder = resolveTemplatesFolder();
  if (!templatesFolder) return;

  // Discover templates
  const templates = await discoverTemplates(templatesFolder);

  // Show the picker UI (step_04)
  showPickerUI(templatesFolder, templates);
}
```

**Note**: `showSetupWizard()` and `showPickerUI()` are stub functions that will be fully implemented in step_04. In this step, they can be defined as simple stubs:

```typescript
function showSetupWizard(): void {
  // Implemented in step_04
  console.log("[templates] Setup wizard (step_04)");
}

function showPickerUI(_templatesFolder: string, _templates: string[]): void {
  // Implemented in step_04
  console.log("[templates] Picker UI (step_04)");
}
```

## 9. Plugin Export

```typescript
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

  // renderDetailExtra is implemented in step_04 (settings UI in Plugins Panel).

  onEnable(api: MarkablePluginAPI): void {
    _enabled = true;
    _api = api;

    // FR-8.2 step 1: inject CSS (step_04 provides the styles)
    injectTemplatesCSS();

    // FR-8.2 step 2: load settings eagerly
    void (async () => {
      const loaded = await api.loadSettings();
      if (loaded) {
        _settings = { ...DEFAULT_SETTINGS, ...loaded } as TemplatesSettings;
      }
    })();

    // FR-8.2 step 3: expose window global (AD-1)
    (window as any).__MARKABLE_TEMPLATES__ = {
      openPicker,
      saveAsTemplate,
    };
  },

  onDisable(_api: MarkablePluginAPI): void {
    _enabled = false;

    // FR-8.3 step 1: close picker if open
    closePickerIfOpen(); // step_04

    // FR-8.3 step 2: remove CSS
    removeTemplatesCSS();

    // FR-8.3 step 3: remove window global
    delete (window as any).__MARKABLE_TEMPLATES__;

    // FR-8.3 step 4: clear state
    _api = null;
    _pickerOpen = false;
    _settings = { ...DEFAULT_SETTINGS };
  },
};

export default plugin;
```

**Stubs for step_04**:

```typescript
function injectTemplatesCSS(): void {
  // Full CSS injected in step_04
}

function removeTemplatesCSS(): void {
  if (typeof document === "undefined") return;
  document.getElementById(STYLE_ID)?.remove();
}

function closePickerIfOpen(): void {
  // Implemented in step_04
  _pickerOpen = false;
}
```

## Exported Functions for Testing

Export the following pure functions so tests can import them directly:

```typescript
export {
  validateTemplateName,
  getWorkingDirectory,
  resolveTemplatesFolder,
  STARTER_TEMPLATES,
  DEFAULT_SETTINGS,
};
```

## Verification

After this step:
- The plugin file exists and compiles.
- The plugin can be loaded by the IIFE system (after step_05 adds it to the build).
- `onEnable` sets `window.__MARKABLE_TEMPLATES__` with working `openPicker()` and `saveAsTemplate()` methods.
- `onDisable` cleans up all state.
- `saveAsTemplate()` works end-to-end (prompts, validates, writes).
- `applyTemplate()` works end-to-end (reads file, opens tab, inserts content).
- Picker UI shows stubs — full DOM is step_04.

## Files Changed

| File | Change |
|---|---|
| `src/plugins/templates/templates.plugin.ts` | **NEW** — full plugin logic |

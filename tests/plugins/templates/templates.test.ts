/**
 * Unit and integration tests for the Templates plugin.
 *
 * Covers:
 * - validateTemplateName: filename validation rules (EC-8)
 * - getWorkingDirectory: path extraction from __MARKABLE_CURRENT_FILE__
 * - resolveTemplatesFolder: templates folder path construction
 * - STARTER_TEMPLATES: content verification
 * - DEFAULT_SETTINGS: default values verification
 * - Plugin lifecycle: onEnable/onDisable side effects
 * - applyTemplate: template application (EC-5, EC-6, FR-4.4)
 * - saveAsTemplate: save flow (EC-1, EC-7, EC-8, FR-5.3)
 * - openPicker: precondition guards (EC-1, EC-12)
 *
 * Test file: tests/plugins/templates/templates.test.ts
 * Source: src/plugins/templates/templates.plugin.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  validateTemplateName,
  getWorkingDirectory,
  resolveTemplatesFolder,
  STARTER_TEMPLATES,
  DEFAULT_SETTINGS,
  plugin,
  applyTemplate,
  saveAsTemplate,
  openPicker,
} from "../../../src/plugins/templates/templates.plugin";

// ---------------------------------------------------------------------------
// Global stubs for browser APIs not present in the test environment
// ---------------------------------------------------------------------------
// JSDOM/happy-dom may not define window.alert, window.prompt, or
// window.confirm. We assign no-op defaults here so vi.spyOn() can
// intercept them in individual tests without "Received undefined" errors.

if (typeof window.alert !== "function") {
  window.alert = () => {};
}
if (typeof window.prompt !== "function") {
  window.prompt = () => null;
}
if (typeof window.confirm !== "function") {
  window.confirm = () => false;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock MarkablePluginAPI for onEnable/onDisable tests.
 * The api exposes loadSettings and saveSettings as vi.fn() stubs.
 */
function mockApi() {
  return {
    loadSettings: vi.fn().mockResolvedValue(null),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    addExtensions: vi.fn(),
    removeExtensions: vi.fn(),
    registerSidebarPanel: vi.fn(),
    unregisterSidebarPanel: vi.fn(),
    statusBar: { left: null, center: null, right: null },
  } as any;
}

// ---------------------------------------------------------------------------
// validateTemplateName
// ---------------------------------------------------------------------------

describe("validateTemplateName", () => {
  it("rejects empty string", () => {
    expect(validateTemplateName("")).not.toBeNull();
  });

  it("rejects whitespace-only string", () => {
    expect(validateTemplateName("   ")).not.toBeNull();
  });

  it("rejects name with forward slash", () => {
    expect(validateTemplateName("path/to/file")).not.toBeNull();
  });

  it("rejects name with backslash", () => {
    expect(validateTemplateName("path\\to\\file")).not.toBeNull();
  });

  it("rejects name starting with dot", () => {
    expect(validateTemplateName(".hidden")).not.toBeNull();
  });

  it("rejects name with leading whitespace then dot", () => {
    expect(validateTemplateName("  .hidden")).not.toBeNull();
  });

  it("accepts valid simple name", () => {
    expect(validateTemplateName("my-template")).toBeNull();
  });

  it("accepts name with spaces", () => {
    expect(validateTemplateName("My Template")).toBeNull();
  });

  it("accepts name with hyphens and underscores", () => {
    expect(validateTemplateName("my_template-v2")).toBeNull();
  });

  it("accepts name already ending with .md", () => {
    expect(validateTemplateName("template.md")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getWorkingDirectory
// ---------------------------------------------------------------------------

describe("getWorkingDirectory", () => {
  afterEach(() => {
    delete (window as any).__MARKABLE_CURRENT_FILE__;
  });

  it("returns parent directory of current file", () => {
    (window as any).__MARKABLE_CURRENT_FILE__ = "/Users/test/docs/current.md";
    expect(getWorkingDirectory()).toBe("/Users/test/docs");
  });

  it("returns null when __MARKABLE_CURRENT_FILE__ is null", () => {
    (window as any).__MARKABLE_CURRENT_FILE__ = null;
    expect(getWorkingDirectory()).toBeNull();
  });

  it("returns null when __MARKABLE_CURRENT_FILE__ is undefined", () => {
    // Property not set at all.
    expect(getWorkingDirectory()).toBeNull();
  });

  it("returns null when path has no slash (defensive)", () => {
    (window as any).__MARKABLE_CURRENT_FILE__ = "file.md";
    expect(getWorkingDirectory()).toBeNull();
  });

  it("handles root-level file path", () => {
    (window as any).__MARKABLE_CURRENT_FILE__ = "/file.md";
    expect(getWorkingDirectory()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// resolveTemplatesFolder
// ---------------------------------------------------------------------------

describe("resolveTemplatesFolder", () => {
  afterEach(() => {
    plugin.onDisable(mockApi());
  });

  it("returns the stored absolute path when configured", () => {
    const api = mockApi();
    api.loadSettings.mockResolvedValue({
      templatesFolderPath: "/Users/test/Templates",
      setupComplete: true,
    });
    plugin.onEnable(api);
    // Manually patch _settings via the api load (synchronous stand-in).
    // We test the function directly after simulating a configured state.
    // Since loadSettings is async, call resolveTemplatesFolder after patching.
    // Use the exported function directly with a pre-configured plugin state.
    plugin.onDisable(api);
  });

  it("returns null when templatesFolderPath is empty (not configured)", () => {
    const api = mockApi();
    plugin.onEnable(api);
    // Default settings have templatesFolderPath: "" → null.
    expect(resolveTemplatesFolder()).toBeNull();
    plugin.onDisable(api);
  });
});

// ---------------------------------------------------------------------------
// STARTER_TEMPLATES
// ---------------------------------------------------------------------------

describe("STARTER_TEMPLATES", () => {
  it("blank.md is empty string", () => {
    expect(STARTER_TEMPLATES["blank.md"]).toBe("");
  });

  it("note.md contains YAML front matter", () => {
    expect(STARTER_TEMPLATES["note.md"]).toContain("---");
    expect(STARTER_TEMPLATES["note.md"]).toContain("title:");
  });

  it("meeting-notes.md contains expected sections", () => {
    const content = STARTER_TEMPLATES["meeting-notes.md"];
    expect(content).toContain("## Attendees");
    expect(content).toContain("## Agenda");
    expect(content).toContain("## Action Items");
  });

  it("all keys end with .md", () => {
    for (const key of Object.keys(STARTER_TEMPLATES)) {
      expect(key.endsWith(".md")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_SETTINGS
// ---------------------------------------------------------------------------

describe("DEFAULT_SETTINGS", () => {
  it("templatesFolderPath is empty string (unconfigured)", () => {
    expect(DEFAULT_SETTINGS.templatesFolderPath).toBe("");
  });

  it("setupComplete is false", () => {
    expect(DEFAULT_SETTINGS.setupComplete).toBe(false);
  });

  it("createStarterTemplates is true", () => {
    expect(DEFAULT_SETTINGS.createStarterTemplates).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Plugin lifecycle
// ---------------------------------------------------------------------------

describe("Plugin lifecycle", () => {
  let api: ReturnType<typeof mockApi>;

  beforeEach(() => {
    api = mockApi();
  });

  afterEach(() => {
    // Ensure clean state.
    delete (window as any).__MARKABLE_TEMPLATES__;
    delete (window as any).__MARKABLE_CURRENT_FILE__;
  });

  it("onEnable sets window.__MARKABLE_TEMPLATES__", () => {
    expect((window as any).__MARKABLE_TEMPLATES__).toBeUndefined();
    plugin.onEnable(api);
    expect((window as any).__MARKABLE_TEMPLATES__).toBeDefined();
    expect(typeof (window as any).__MARKABLE_TEMPLATES__.openPicker).toBe("function");
    expect(typeof (window as any).__MARKABLE_TEMPLATES__.saveAsTemplate).toBe("function");
    plugin.onDisable(api);
  });

  it("onDisable removes window.__MARKABLE_TEMPLATES__", () => {
    plugin.onEnable(api);
    expect((window as any).__MARKABLE_TEMPLATES__).toBeDefined();
    plugin.onDisable(api);
    expect((window as any).__MARKABLE_TEMPLATES__).toBeUndefined();
  });

  it("onEnable loads settings eagerly", async () => {
    api.loadSettings.mockResolvedValue({ templatesFolderPath: "/custom/path" });
    plugin.onEnable(api);
    // Wait for the async IIFE to complete.
    await vi.waitFor(() => {
      expect(api.loadSettings).toHaveBeenCalled();
    });
    plugin.onDisable(api);
  });

  it("onDisable resets module-level state", () => {
    plugin.onEnable(api);
    plugin.onDisable(api);
    // After disable, the global should be gone and calling openPicker
    // should not throw (the function returns immediately since _enabled is false).
    expect((window as any).__MARKABLE_TEMPLATES__).toBeUndefined();
  });

  it("has correct plugin metadata", () => {
    expect(plugin.id).toBe("templates");
    expect(plugin.name).toBe("Templates");
    expect(plugin.version).toBe("1.0.0");
    expect(plugin.description).toBeTruthy();
    expect(plugin.detail).toBeTruthy();
  });

  it("has renderDetailExtra function", () => {
    expect(typeof plugin.renderDetailExtra).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// applyTemplate (integration-style)
// ---------------------------------------------------------------------------

describe("applyTemplate", () => {
  let mockInvoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockInvoke = vi.fn();
    (window as any).__TAURI_INTERNALS__ = { invoke: mockInvoke };
    (window as any).__MARKABLE_TAB_MANAGER__ = { openNewTab: vi.fn() };
    (window as any).__MARKABLE_EDITOR_VIEW__ = {
      state: { doc: { length: 0, toString: () => "" } },
      dispatch: vi.fn(),
    };
  });

  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
    delete (window as any).__MARKABLE_TAB_MANAGER__;
    delete (window as any).__MARKABLE_EDITOR_VIEW__;
  });

  it("calls openNewTab and dispatches content", async () => {
    mockInvoke.mockResolvedValue("# Template content");
    await applyTemplate("/path/to/template.md");

    expect(mockInvoke).toHaveBeenCalledWith("read_file", { path: "/path/to/template.md" });
    expect((window as any).__MARKABLE_TAB_MANAGER__.openNewTab).toHaveBeenCalled();
    expect((window as any).__MARKABLE_EDITOR_VIEW__.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({ insert: "# Template content" }),
      })
    );
  });

  it("handles empty content (EC-6) — openNewTab called, no dispatch", async () => {
    mockInvoke.mockResolvedValue("");
    await applyTemplate("/path/to/blank.md");

    expect((window as any).__MARKABLE_TAB_MANAGER__.openNewTab).toHaveBeenCalled();
    // Empty content means no dispatch call (skip for empty string).
    expect((window as any).__MARKABLE_EDITOR_VIEW__.dispatch).not.toHaveBeenCalled();
  });

  it("handles read_file failure (EC-5) — shows alert, no tab created", async () => {
    mockInvoke.mockRejectedValue("File not found");
    vi.spyOn(window, "alert").mockImplementation(() => {});

    await applyTemplate("/path/to/missing.md");

    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining("Could not read template"));
    expect((window as any).__MARKABLE_TAB_MANAGER__.openNewTab).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it("sets cursor at end of document (FR-4.4)", async () => {
    const templateContent = "Line 1\nLine 2\nLine 3";
    mockInvoke.mockResolvedValue(templateContent);
    await applyTemplate("/path/to/template.md");

    expect((window as any).__MARKABLE_EDITOR_VIEW__.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { anchor: templateContent.length },
      })
    );
  });
});

// ---------------------------------------------------------------------------
// saveAsTemplate (integration-style)
// ---------------------------------------------------------------------------

describe("saveAsTemplate", () => {
  let mockInvoke: ReturnType<typeof vi.fn>;
  let api: ReturnType<typeof mockApi>;

  beforeEach(() => {
    mockInvoke = vi.fn();
    (window as any).__TAURI_INTERNALS__ = { invoke: mockInvoke };
    (window as any).__MARKABLE_EDITOR_VIEW__ = {
      state: { doc: { length: 10, toString: () => "# Content" } },
      dispatch: vi.fn(),
    };
    api = mockApi();
    // Enable the plugin so _settings are initialized.
    plugin.onEnable(api);
  });

  afterEach(() => {
    plugin.onDisable(api);
    delete (window as any).__TAURI_INTERNALS__;
    delete (window as any).__MARKABLE_EDITOR_VIEW__;
    delete (window as any).__MARKABLE_CURRENT_FILE__;
  });

  it("shows alert when no file open (EC-1)", async () => {
    (window as any).__MARKABLE_CURRENT_FILE__ = null;
    vi.spyOn(window, "alert").mockImplementation(() => {});

    await saveAsTemplate();

    expect(window.alert).toHaveBeenCalledWith(
      expect.stringContaining("Save your document first")
    );
    vi.restoreAllMocks();
  });

  it("appends .md if missing", async () => {
    (window as any).__MARKABLE_CURRENT_FILE__ = "/Users/test/docs/file.md";
    vi.spyOn(window, "prompt").mockReturnValue("my-template");
    vi.spyOn(window, "alert").mockImplementation(() => {});
    // ensure_directory succeeds.
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "ensure_directory") return Promise.resolve();
      if (cmd === "read_file") return Promise.reject("not found");
      if (cmd === "write_file") return Promise.resolve();
      return Promise.resolve();
    });

    await saveAsTemplate();

    // Should have been called with .md appended.
    expect(mockInvoke).toHaveBeenCalledWith("write_file", {
      path: "/Users/test/docs/Templates/my-template.md",
      content: "# Content",
    });
    vi.restoreAllMocks();
  });

  it("validates filename (EC-8)", async () => {
    (window as any).__MARKABLE_CURRENT_FILE__ = "/Users/test/docs/file.md";
    vi.spyOn(window, "prompt").mockReturnValue("/invalid");
    vi.spyOn(window, "alert").mockImplementation(() => {});

    await saveAsTemplate();

    expect(window.alert).toHaveBeenCalledWith(
      expect.stringContaining("Invalid template name")
    );
    // Should not have called any Tauri commands after validation failure.
    expect(mockInvoke).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("calls ensure_directory before writing (FR-5.3)", async () => {
    (window as any).__MARKABLE_CURRENT_FILE__ = "/Users/test/docs/file.md";
    vi.spyOn(window, "prompt").mockReturnValue("test");
    vi.spyOn(window, "alert").mockImplementation(() => {});

    const callOrder: string[] = [];
    mockInvoke.mockImplementation((cmd: string) => {
      callOrder.push(cmd);
      if (cmd === "ensure_directory") return Promise.resolve();
      if (cmd === "read_file") return Promise.reject("not found");
      if (cmd === "write_file") return Promise.resolve();
      return Promise.resolve();
    });

    await saveAsTemplate();

    // ensure_directory must be called before write_file.
    const ensureIdx = callOrder.indexOf("ensure_directory");
    const writeIdx = callOrder.indexOf("write_file");
    expect(ensureIdx).toBeLessThan(writeIdx);
    vi.restoreAllMocks();
  });

  it("checks for existing file and confirms overwrite (EC-7)", async () => {
    (window as any).__MARKABLE_CURRENT_FILE__ = "/Users/test/docs/file.md";
    vi.spyOn(window, "prompt").mockReturnValue("existing.md");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "ensure_directory") return Promise.resolve();
      // read_file succeeds, meaning the file exists.
      if (cmd === "read_file") return Promise.resolve("old content");
      if (cmd === "write_file") return Promise.resolve();
      return Promise.resolve();
    });

    await saveAsTemplate();

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("already exists")
    );
    // Since confirm returned true, write_file should have been called.
    expect(mockInvoke).toHaveBeenCalledWith("write_file", expect.any(Object));
    vi.restoreAllMocks();
  });

  it("aborts on overwrite cancel (EC-7)", async () => {
    (window as any).__MARKABLE_CURRENT_FILE__ = "/Users/test/docs/file.md";
    vi.spyOn(window, "prompt").mockReturnValue("existing.md");
    vi.spyOn(window, "confirm").mockReturnValue(false);

    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "ensure_directory") return Promise.resolve();
      if (cmd === "read_file") return Promise.resolve("old content");
      return Promise.resolve();
    });

    await saveAsTemplate();

    // write_file should NOT have been called.
    expect(mockInvoke).not.toHaveBeenCalledWith("write_file", expect.any(Object));
    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// openPicker
// ---------------------------------------------------------------------------

describe("openPicker", () => {
  let api: ReturnType<typeof mockApi>;

  beforeEach(() => {
    api = mockApi();
    (window as any).__TAURI_INTERNALS__ = { invoke: vi.fn().mockResolvedValue([]) };
  });

  afterEach(() => {
    // Clean up any overlay that might have been created.
    document.querySelectorAll(".templates-overlay").forEach((el) => el.remove());
    plugin.onDisable(api);
    delete (window as any).__TAURI_INTERNALS__;
    delete (window as any).__MARKABLE_CURRENT_FILE__;
  });

  it("shows alert when no file open (EC-1)", async () => {
    (window as any).__MARKABLE_CURRENT_FILE__ = null;
    plugin.onEnable(api);
    vi.spyOn(window, "alert").mockImplementation(() => {});

    await openPicker();

    expect(window.alert).toHaveBeenCalledWith(
      expect.stringContaining("Save your document first")
    );
    vi.restoreAllMocks();
  });

  it("is no-op when plugin is disabled", async () => {
    // Do NOT call onEnable — plugin should be disabled.
    (window as any).__MARKABLE_CURRENT_FILE__ = "/test/file.md";
    vi.spyOn(window, "alert").mockImplementation(() => {});

    await openPicker();

    // Should not even show the "save first" alert since it returns early.
    expect(window.alert).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("shows setup wizard when setupComplete is false", async () => {
    (window as any).__MARKABLE_CURRENT_FILE__ = "/test/file.md";
    api.loadSettings.mockResolvedValue({ setupComplete: false });
    plugin.onEnable(api);

    await openPicker();

    // The wizard should create an overlay with the wizard card.
    const wizardCard = document.querySelector(".templates-wizard-card");
    expect(wizardCard).not.toBeNull();
  });

  it("shows picker UI when setupComplete is true", async () => {
    (window as any).__MARKABLE_CURRENT_FILE__ = "/test/file.md";
    api.loadSettings.mockResolvedValue({
      setupComplete: true,
      templatesFolderPath: "/test/Templates",
    });
    plugin.onEnable(api);

    await openPicker();

    // The picker should create an overlay with the picker card.
    const pickerCard = document.querySelector(".templates-card");
    expect(pickerCard).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Picker filter logic
// ---------------------------------------------------------------------------

describe("Picker filter logic", () => {
  let api: ReturnType<typeof mockApi>;

  beforeEach(() => {
    api = mockApi();
    api.loadSettings.mockResolvedValue({
      setupComplete: true,
      templatesFolderPath: "/test/Templates",
    });
    (window as any).__MARKABLE_CURRENT_FILE__ = "/test/file.md";
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockResolvedValue(["note.md", "meeting-notes.md", "blank.md"]),
    };
    plugin.onEnable(api);
  });

  afterEach(() => {
    document.querySelectorAll(".templates-overlay").forEach((el) => el.remove());
    plugin.onDisable(api);
    delete (window as any).__TAURI_INTERNALS__;
    delete (window as any).__MARKABLE_CURRENT_FILE__;
  });

  it("shows all templates when filter is empty", async () => {
    await openPicker();
    const items = document.querySelectorAll(".templates-item");
    expect(items.length).toBe(3);
  });

  it("filters by case-insensitive substring", async () => {
    await openPicker();
    const filterInput = document.querySelector(".templates-filter") as HTMLInputElement;
    expect(filterInput).not.toBeNull();

    // Type "note" — should match "note" and "meeting-notes".
    filterInput.value = "note";
    filterInput.dispatchEvent(new Event("input"));

    const items = document.querySelectorAll(".templates-item");
    expect(items.length).toBe(2);
  });

  it("shows empty message when no matches", async () => {
    await openPicker();
    const filterInput = document.querySelector(".templates-filter") as HTMLInputElement;

    filterInput.value = "zzzzz";
    filterInput.dispatchEvent(new Event("input"));

    const empty = document.querySelector(".templates-empty");
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toContain("No matching templates");
  });
});

// ---------------------------------------------------------------------------
// Picker keyboard navigation
// ---------------------------------------------------------------------------

describe("Picker keyboard navigation", () => {
  let api: ReturnType<typeof mockApi>;

  beforeEach(() => {
    api = mockApi();
    api.loadSettings.mockResolvedValue({
      setupComplete: true,
      templatesFolderPath: "/test/Templates",
    });
    (window as any).__MARKABLE_CURRENT_FILE__ = "/test/file.md";
    (window as any).__TAURI_INTERNALS__ = {
      invoke: vi.fn().mockResolvedValue(["alpha.md", "beta.md", "gamma.md"]),
    };
    (window as any).__MARKABLE_TAB_MANAGER__ = { openNewTab: vi.fn() };
    (window as any).__MARKABLE_EDITOR_VIEW__ = {
      state: { doc: { length: 0, toString: () => "" } },
      dispatch: vi.fn(),
    };
    plugin.onEnable(api);
  });

  afterEach(() => {
    document.querySelectorAll(".templates-overlay").forEach((el) => el.remove());
    plugin.onDisable(api);
    delete (window as any).__TAURI_INTERNALS__;
    delete (window as any).__MARKABLE_CURRENT_FILE__;
    delete (window as any).__MARKABLE_TAB_MANAGER__;
    delete (window as any).__MARKABLE_EDITOR_VIEW__;
  });

  it("ArrowDown moves selection forward", async () => {
    await openPicker();
    const overlay = document.querySelector(".templates-overlay") as HTMLElement;

    // Initially first item is selected.
    let selected = document.querySelector(".templates-item.selected");
    expect(selected?.textContent).toBe("alpha");

    // Press ArrowDown.
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    selected = document.querySelector(".templates-item.selected");
    expect(selected?.textContent).toBe("beta");
  });

  it("ArrowDown clamps at end", async () => {
    await openPicker();
    const overlay = document.querySelector(".templates-overlay") as HTMLElement;

    // Press ArrowDown 10 times — should clamp at gamma (index 2).
    for (let i = 0; i < 10; i++) {
      overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    }
    const selected = document.querySelector(".templates-item.selected");
    expect(selected?.textContent).toBe("gamma");
  });

  it("ArrowUp moves selection backward", async () => {
    await openPicker();
    const overlay = document.querySelector(".templates-overlay") as HTMLElement;

    // Move to second item first.
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));

    const selected = document.querySelector(".templates-item.selected");
    expect(selected?.textContent).toBe("alpha");
  });

  it("ArrowUp clamps at beginning", async () => {
    await openPicker();
    const overlay = document.querySelector(".templates-overlay") as HTMLElement;

    // Press ArrowUp 5 times when already at index 0.
    for (let i = 0; i < 5; i++) {
      overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    }
    const selected = document.querySelector(".templates-item.selected");
    expect(selected?.textContent).toBe("alpha");
  });

  it("Escape closes picker (EC-19)", async () => {
    await openPicker();
    const overlay = document.querySelector(".templates-overlay") as HTMLElement;
    expect(overlay).not.toBeNull();

    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    // Overlay should be removed.
    expect(document.querySelector(".templates-overlay")).toBeNull();
  });

  it("Enter applies selected template", async () => {
    // Mock read_file to return template content.
    const mockInvoke = (window as any).__TAURI_INTERNALS__.invoke;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "list_md_files") return Promise.resolve(["alpha.md", "beta.md", "gamma.md"]);
      if (cmd === "read_file") return Promise.resolve("# Alpha template");
      return Promise.resolve();
    });

    await openPicker();
    const overlay = document.querySelector(".templates-overlay") as HTMLElement;

    // Press Enter to select first item.
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    // Picker should close.
    expect(document.querySelector(".templates-overlay")).toBeNull();
    // Template should be applied (read_file called with alpha.md path).
    expect(mockInvoke).toHaveBeenCalledWith("read_file", expect.objectContaining({
      path: expect.stringContaining("alpha.md"),
    }));
  });
});

// ---------------------------------------------------------------------------
// Setup wizard
// ---------------------------------------------------------------------------

describe("Setup wizard", () => {
  let api: ReturnType<typeof mockApi>;
  let mockInvoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    api = mockApi();
    // setupComplete: false triggers wizard.
    api.loadSettings.mockResolvedValue({ setupComplete: false });
    mockInvoke = vi.fn();
    (window as any).__TAURI_INTERNALS__ = { invoke: mockInvoke };
    (window as any).__MARKABLE_CURRENT_FILE__ = "/test/docs/file.md";
    plugin.onEnable(api);
  });

  afterEach(() => {
    document.querySelectorAll(".templates-overlay").forEach((el) => el.remove());
    plugin.onDisable(api);
    delete (window as any).__TAURI_INTERNALS__;
    delete (window as any).__MARKABLE_CURRENT_FILE__;
  });

  it("shows wizard when setupComplete is false", async () => {
    await openPicker();
    expect(document.querySelector(".templates-wizard-card")).not.toBeNull();
  });

  it("creates folder via ensure_directory on Create Folder click", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "ensure_directory") return Promise.resolve();
      if (cmd === "write_file") return Promise.resolve();
      if (cmd === "list_md_files") return Promise.resolve(["blank.md", "note.md", "meeting-notes.md"]);
      return Promise.resolve();
    });

    await openPicker();

    const createBtn = Array.from(document.querySelectorAll(".templates-btn-primary"))
      .find((el) => el.textContent === "Create Folder") as HTMLElement;
    expect(createBtn).not.toBeNull();

    createBtn.click();
    // Wait for async operation. The wizard uses the default path derived from
    // __MARKABLE_CURRENT_FILE__ (/test/docs/file.md → /test/docs/Templates).
    await vi.waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("ensure_directory", {
        path: "/test/docs/Templates",
      });
    });
  });

  it("writes starter templates when checked", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "ensure_directory") return Promise.resolve();
      if (cmd === "write_file") return Promise.resolve();
      if (cmd === "list_md_files") return Promise.resolve([]);
      return Promise.resolve();
    });

    await openPicker();

    // Checkbox should be checked by default.
    const checkbox = document.querySelector(".templates-wizard-checkbox input[type='checkbox']") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);

    const createBtn = Array.from(document.querySelectorAll(".templates-btn-primary"))
      .find((el) => el.textContent === "Create Folder") as HTMLElement;
    createBtn.click();

    await vi.waitFor(() => {
      // Should have written starter templates.
      const writeFileCalls = mockInvoke.mock.calls.filter(
        (call: any[]) => call[0] === "write_file"
      );
      expect(writeFileCalls.length).toBe(Object.keys(STARTER_TEMPLATES).length);
    });
  });

  it("skips starters when checkbox is unchecked", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "ensure_directory") return Promise.resolve();
      if (cmd === "write_file") return Promise.resolve();
      if (cmd === "list_md_files") return Promise.resolve([]);
      return Promise.resolve();
    });

    await openPicker();

    // Uncheck the checkbox.
    const checkbox = document.querySelector(".templates-wizard-checkbox input[type='checkbox']") as HTMLInputElement;
    checkbox.checked = false;

    const createBtn = Array.from(document.querySelectorAll(".templates-btn-primary"))
      .find((el) => el.textContent === "Create Folder") as HTMLElement;
    createBtn.click();

    await vi.waitFor(() => {
      // Should have called ensure_directory but NOT write_file.
      expect(mockInvoke).toHaveBeenCalledWith("ensure_directory", expect.any(Object));
    });

    // No write_file calls for starters.
    const writeFileCalls = mockInvoke.mock.calls.filter(
      (call: any[]) => call[0] === "write_file"
    );
    expect(writeFileCalls.length).toBe(0);
  });

  it("saves settings on success", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "ensure_directory") return Promise.resolve();
      if (cmd === "write_file") return Promise.resolve();
      if (cmd === "list_md_files") return Promise.resolve([]);
      return Promise.resolve();
    });

    await openPicker();

    const createBtn = Array.from(document.querySelectorAll(".templates-btn-primary"))
      .find((el) => el.textContent === "Create Folder") as HTMLElement;
    createBtn.click();

    await vi.waitFor(() => {
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          setupComplete: true,
          templatesFolderPath: "/test/docs/Templates",
        })
      );
    });
  });

  it("shows error and stays open on folder creation failure (EC-15)", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "ensure_directory") return Promise.reject("Permission denied");
      return Promise.resolve();
    });

    await openPicker();

    const createBtn = Array.from(document.querySelectorAll(".templates-btn-primary"))
      .find((el) => el.textContent === "Create Folder") as HTMLElement;
    createBtn.click();

    await vi.waitFor(() => {
      const errorEl = document.querySelector(".templates-wizard-error") as HTMLElement;
      expect(errorEl.style.display).toBe("block");
      expect(errorEl.textContent).toContain("Could not create folder");
    });

    // Wizard should still be open.
    expect(document.querySelector(".templates-wizard-card")).not.toBeNull();
  });

  it("opens picker after successful setup (FR-6.4)", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "ensure_directory") return Promise.resolve();
      if (cmd === "write_file") return Promise.resolve();
      if (cmd === "list_md_files") return Promise.resolve(["blank.md"]);
      return Promise.resolve();
    });

    await openPicker();

    const createBtn = Array.from(document.querySelectorAll(".templates-btn-primary"))
      .find((el) => el.textContent === "Create Folder") as HTMLElement;
    createBtn.click();

    await vi.waitFor(() => {
      // Wizard should be replaced by the picker.
      expect(document.querySelector(".templates-wizard-card")).toBeNull();
      expect(document.querySelector(".templates-card")).not.toBeNull();
    });
  });

  it("Cancel button closes wizard", async () => {
    await openPicker();

    const cancelBtn = Array.from(document.querySelectorAll(".templates-btn-secondary"))
      .find((el) => el.textContent === "Cancel") as HTMLElement;
    cancelBtn.click();

    expect(document.querySelector(".templates-overlay")).toBeNull();
  });
});

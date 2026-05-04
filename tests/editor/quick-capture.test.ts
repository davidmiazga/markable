// ---------------------------------------------------------------------------
// Module-level mocks — must be defined BEFORE imports
// ---------------------------------------------------------------------------

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: vi.fn(),
}));
vi.mock("@tauri-apps/api/dpi", () => ({
  PhysicalPosition: vi.fn(),
  PhysicalSize: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockEnsureDirectory = vi.fn((_dir?: any) => Promise.resolve({ ok: true }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockWriteFile = vi.fn((_path?: any, _content?: any) => Promise.resolve({ ok: true }));
const mockGetHomeDir = vi.fn(() => Promise.resolve("/Users/testuser"));

vi.mock("../../src/lib/bridge", () => ({
  ensureDirectory: (dir: unknown) => mockEnsureDirectory(dir),
  writeFile: (path: unknown, content: unknown) => mockWriteFile(path, content),
  getHomeDir: () => mockGetHomeDir(),
}));

vi.mock("../../src/lib/settings", () => ({
  getCurrentSettings: vi.fn(() => ({
    quickCapture: {
      inboxFolder: "Inbox",
      fallbackPath: "~/Documents/Markable Inbox",
    },
  })),
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QuickCaptureWidget } from "../../src/editor/quick-capture";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWidget() {
  const w = new QuickCaptureWidget();
  return w;
}

function getOverlay() {
  return document.getElementById("quick-capture-overlay") as HTMLDivElement;
}

function getContentArea(overlay: HTMLElement) {
  return overlay.querySelector("textarea") as HTMLTextAreaElement;
}

function getTitleInput(overlay: HTMLElement) {
  return overlay.querySelector("input") as HTMLInputElement;
}

function getInboxLabel(overlay: HTMLElement) {
  return overlay.querySelector(".qc-inbox-label") as HTMLSpanElement;
}

function fireKeydown(el: HTMLElement, key: string, opts: KeyboardEventInit = {}) {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...opts }));
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let widget: QuickCaptureWidget;

beforeEach(() => {
  mockEnsureDirectory.mockResolvedValue({ ok: true });
  mockWriteFile.mockResolvedValue({ ok: true });
  mockGetHomeDir.mockResolvedValue("/Users/testuser");
  widget = makeWidget();
});

afterEach(() => {
  widget.destroy();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// _deriveTitle
// ---------------------------------------------------------------------------

describe("_deriveTitle", () => {
  it("strips leading # heading markers", () => {
    expect(widget._deriveTitle("# Hello world")).toBe("Hello world");
  });

  it("strips multiple # heading markers", () => {
    expect(widget._deriveTitle("### Deep heading")).toBe("Deep heading");
  });

  it("strips * bold/italic delimiters", () => {
    expect(widget._deriveTitle("**Bold**")).toBe("Bold");
  });

  it("strips _ italic delimiters", () => {
    expect(widget._deriveTitle("_italic_")).toBe("italic");
  });

  it("strips backtick code delimiters", () => {
    expect(widget._deriveTitle("`code`")).toBe("code");
  });

  it("uses only the first line", () => {
    expect(widget._deriveTitle("First line\nSecond line")).toBe("First line");
  });

  it("truncates at 60 characters", () => {
    const long = "a".repeat(80);
    expect(widget._deriveTitle(long)).toHaveLength(60);
  });

  it("returns 'capture' for empty string", () => {
    expect(widget._deriveTitle("")).toBe("capture");
  });

  it("returns 'capture' for whitespace-only first line", () => {
    expect(widget._deriveTitle("   \nsomething")).toBe("capture");
  });

  it("returns 'capture' for heading-only line with no text", () => {
    expect(widget._deriveTitle("### ")).toBe("capture");
  });
});

// ---------------------------------------------------------------------------
// _buildFilename
// ---------------------------------------------------------------------------

describe("_buildFilename", () => {
  it("produces a lowercase slug", () => {
    const name = widget._buildFilename("Hello World");
    expect(name).toMatch(/^hello-world-/);
  });

  it("strips special characters", () => {
    const name = widget._buildFilename("Hello! World?");
    expect(name).toMatch(/^hello-world-/);
  });

  it("includes a timestamp segment", () => {
    const name = widget._buildFilename("test");
    // Format is YYYYMMDDThh-mm-ss (no hyphens in date part)
    expect(name).toMatch(/\d{8}T\d{2}-\d{2}-\d{2}/);
  });

  it("ends with .md extension", () => {
    expect(widget._buildFilename("test")).toMatch(/\.md$/);
  });

  it("collapses consecutive hyphens", () => {
    const name = widget._buildFilename("hello  ---  world");
    expect(name).not.toMatch(/--/);
  });

  it("falls back to 'capture' slug for empty title", () => {
    const name = widget._buildFilename("!@#$%");
    expect(name).toMatch(/^capture-/);
  });
});

// ---------------------------------------------------------------------------
// open() / close()
// ---------------------------------------------------------------------------

describe("open()", () => {
  it("makes the overlay visible", () => {
    widget.open();
    const overlay = getOverlay();
    expect(overlay.style.display).not.toBe("none");
  });

  it("clears content and title fields", () => {
    const overlay = getOverlay();
    const content = getContentArea(overlay);
    const title = getTitleInput(overlay);
    content.value = "old content";
    title.value = "old title";
    widget.open();
    expect(content.value).toBe("");
    expect(title.value).toBe("");
  });

  it("resets _titleDirty to false", () => {
    widget.open();
    // Simulate dirtying the title
    const overlay = getOverlay();
    getTitleInput(overlay).dispatchEvent(new Event("input", { bubbles: true }));
    expect(widget["_titleDirty"]).toBe(true);
    // Re-open should reset
    widget.open();
    expect(widget["_titleDirty"]).toBe(false);
  });

  it("focuses the title input", () => {
    widget.open();
    const overlay = getOverlay();
    expect(document.activeElement).toBe(getTitleInput(overlay));
  });
});

describe("close()", () => {
  it("hides the overlay", () => {
    widget.open();
    widget.close();
    const overlay = getOverlay();
    expect(overlay.style.display).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// _getInboxPath
// ---------------------------------------------------------------------------

describe("_getInboxPath", () => {
  it("returns vault root + inboxFolder when vault is active", () => {
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: () => ({ rootPaths: ["/vault/root"] }),
    };
    const path = widget._getInboxPath();
    expect(path).toBe("/vault/root/Inbox");
    delete (window as any).__MARKABLE_VAULT_MANAGER__;
  });

  it("returns fallbackPath when no vault is active", () => {
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: () => null,
    };
    const path = widget._getInboxPath();
    expect(path).toBe("~/Documents/Markable Inbox");
    delete (window as any).__MARKABLE_VAULT_MANAGER__;
  });

  it("returns fallbackPath when vault manager is absent", () => {
    const path = widget._getInboxPath();
    expect(path).toBe("~/Documents/Markable Inbox");
  });
});

// ---------------------------------------------------------------------------
// _save()
// ---------------------------------------------------------------------------

describe("_save()", () => {
  it("calls ensureDirectory before writeFile", async () => {
    const callOrder: string[] = [];
    mockEnsureDirectory.mockImplementation(async () => {
      callOrder.push("ensureDirectory");
      return { ok: true };
    });
    mockWriteFile.mockImplementation(async () => {
      callOrder.push("writeFile");
      return { ok: true };
    });

    widget.open();
    getContentArea(getOverlay()).value = "Test note";
    await widget["_save"]();

    expect(callOrder).toEqual(["ensureDirectory", "writeFile"]);
  });

  it("passes the correct directory to ensureDirectory", async () => {
    (window as any).__MARKABLE_VAULT_MANAGER__ = {
      getActiveVault: () => ({ rootPaths: ["/my/vault"] }),
    };
    widget.open();
    getContentArea(getOverlay()).value = "Note content";
    await widget["_save"]();

    expect(mockEnsureDirectory).toHaveBeenCalledWith("/my/vault/Inbox");
    delete (window as any).__MARKABLE_VAULT_MANAGER__;
  });

  it("closes overlay on successful save", async () => {
    widget.open();
    getContentArea(getOverlay()).value = "Some note";
    await widget["_save"]();

    expect(getOverlay().style.display).toBe("none");
  });

  it("shows error in inbox label on writeFile failure", async () => {
    mockWriteFile.mockResolvedValue({ ok: false, error: { message: "disk full" } } as any);

    widget.open();
    getContentArea(getOverlay()).value = "Some note";
    await widget["_save"]();

    const label = getInboxLabel(getOverlay());
    expect(label.textContent).toMatch(/disk full/);
    expect(getOverlay().style.display).not.toBe("none");
  });

  it("shows error in inbox label on ensureDirectory failure", async () => {
    mockEnsureDirectory.mockRejectedValue(new Error("permission denied"));

    widget.open();
    getContentArea(getOverlay()).value = "Some note";
    await widget["_save"]();

    const label = getInboxLabel(getOverlay());
    expect(label.textContent).toMatch(/permission denied/);
  });

  it("uses titleInput value when provided", async () => {
    widget.open();
    const overlay = getOverlay();
    getTitleInput(overlay).value = "my custom title";
    getContentArea(overlay).value = "Note content";
    await widget["_save"]();

    const firstArg = (mockWriteFile.mock.calls[0] as unknown as [string, string])[0];
    expect(firstArg).toMatch(/my-custom-title/);
  });

  it("derives title from content when titleInput is empty", async () => {
    widget.open();
    const overlay = getOverlay();
    getTitleInput(overlay).value = "";
    getContentArea(overlay).value = "Auto derived title note";
    await widget["_save"]();

    const firstArg = (mockWriteFile.mock.calls[0] as unknown as [string, string])[0];
    expect(firstArg).toMatch(/auto-derived-title-note/);
  });
});

// ---------------------------------------------------------------------------
// Keyboard events
// ---------------------------------------------------------------------------

describe("keyboard shortcuts", () => {
  it("Escape closes the overlay", () => {
    widget.open();
    const overlay = getOverlay();
    fireKeydown(overlay, "Escape");
    expect(overlay.style.display).toBe("none");
  });

  it("Cmd+Enter triggers _save", async () => {
    widget.open();
    const overlay = getOverlay();
    getContentArea(overlay).value = "Keyboard save note";

    const saveSpy = vi.spyOn(widget as any, "_save").mockResolvedValue(undefined);
    fireKeydown(overlay, "Enter", { metaKey: true });
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Enter triggers _save", async () => {
    widget.open();
    const overlay = getOverlay();
    getContentArea(overlay).value = "Ctrl save note";

    const saveSpy = vi.spyOn(widget as any, "_save").mockResolvedValue(undefined);
    fireKeydown(overlay, "Enter", { ctrlKey: true });
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Title auto-derive behavior
// ---------------------------------------------------------------------------

describe("title auto-derive", () => {
  it("updates title input when content changes and title is not dirty", () => {
    widget.open();
    const overlay = getOverlay();
    const content = getContentArea(overlay);
    const title = getTitleInput(overlay);

    content.value = "Meeting notes";
    content.dispatchEvent(new Event("input", { bubbles: true }));

    expect(title.value).toBe("Meeting notes");
  });

  it("does NOT update title input when title has been manually edited", () => {
    widget.open();
    const overlay = getOverlay();
    const content = getContentArea(overlay);
    const title = getTitleInput(overlay);

    // User types in title first → marks dirty
    title.value = "my custom title";
    title.dispatchEvent(new Event("input", { bubbles: true }));

    // Now content input should not override
    content.value = "Some content";
    content.dispatchEvent(new Event("input", { bubbles: true }));

    expect(title.value).toBe("my custom title");
  });

  it("title input focus pre-selects the text", () => {
    widget.open();
    const overlay = getOverlay();
    const title = getTitleInput(overlay);
    title.value = "pre-selected text";

    const selectSpy = vi.spyOn(title, "select");
    title.dispatchEvent(new FocusEvent("focus", { bubbles: true }));

    expect(selectSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Tab key navigation
// ---------------------------------------------------------------------------

describe("Tab key in content area", () => {
  it("moves focus to title input", () => {
    widget.open();
    const overlay = getOverlay();
    const content = getContentArea(overlay);
    const title = getTitleInput(overlay);

    const focusSpy = vi.spyOn(title, "focus");
    fireKeydown(content, "Tab");

    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it("prevents default browser tab behavior", () => {
    widget.open();
    const overlay = getOverlay();
    const content = getContentArea(overlay);

    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    const preventSpy = vi.spyOn(event, "preventDefault");
    content.dispatchEvent(event);

    expect(preventSpy).toHaveBeenCalledTimes(1);
  });
});
